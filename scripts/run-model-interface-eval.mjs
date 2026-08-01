#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  link,
  open,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { arch, platform } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder, promisify } from "node:util";
import {
  canonicalJson,
  contentDigest,
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "../packages/prototype/dist/index.js";
import {
  ARMS,
  BENCHMARK,
  DEFAULT_ARMS,
  MAX_REPEATS,
  MAX_REQUEST_BYTES,
  MAX_RESULTS_BYTES,
  MAX_TIMEOUT_MS,
  ModelEvalError,
  PROMPT_PATHS,
  REQUEST_SCHEMA,
  RESULT_SCHEMA,
  assertModelTimelineDelta,
  assertStructuredEventOrder,
  assertValid,
  assertVisibleEvidenceRefs,
  createModelEvalValidators,
  continuityStateBytes,
  currentEvidence,
  digestFile,
  digestText,
  loadBenchmarkCases,
  loadRunConfig,
  memoryBudgetBytes,
  validateAdapterResponse,
  visibleEvidence,
} from "./model-interface-eval.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const defaultCasesPath = "benchmarks/model-interface/v1/cases.jsonl";
const maxResponseBytes = 256 * 1024;
const maxRuntimeFileBytes = 64 * 1024 * 1024;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);

class AdapterError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
  }
}

class RunSetupError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunSetupError";
  }
}

class JsonLineAdapter {
  constructor(command, args) {
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "inherit"],
    });
    this.stdoutChunks = [];
    this.stdoutBytes = 0;
    this.ready = new Promise((resolveReady) => {
      this.resolveReady = resolveReady;
    });
    this.exit = new Promise((resolveExit) => {
      this.resolveExit = resolveExit;
    });
    this.failure = new Promise((resolveFailure) => {
      this.resolveFailure = resolveFailure;
    });

    this.child.stdout.on("data", (chunk) => {
      if (!this.started) this.unsolicited = true;
      this.stdoutBytes += chunk.length;
      if (this.stdoutBytes <= maxResponseBytes) {
        this.stdoutChunks.push(chunk);
        return;
      }
      if (this.tooLarge) return;
      this.tooLarge = true;
      this.child.stdout.destroy();
      this.child.kill("SIGKILL");
      this.resolveFailure(
        new ModelEvalError(
          `adapter response exceeds ${maxResponseBytes} bytes`,
          {
            code: "response.too-large",
            stage: "protocol",
          },
        ),
      );
    });
    this.child.once("spawn", () => {
      this.resolveReady();
    });
    this.child.on("error", (error) => {
      this.startError = error;
      this.resolveReady();
    });
    this.child.on("close", (code, signal) => {
      this.closed = true;
      this.resolveExit({ code, signal });
    });
  }

  async request(value, timeoutMs) {
    if (this.started) {
      throw new AdapterError(
        "adapter accepts exactly one request",
        "adapter.concurrent-request",
      );
    }
    this.started = true;
    await this.ready;
    if (this.startError) {
      throw new AdapterError(
        `adapter process could not start: ${this.startError.message}`,
        "adapter.start",
      );
    }
    let timer;
    const timeout = new Promise((_, rejectTimeout) => {
      timer = setTimeout(() => {
        this.child.kill("SIGTERM");
        rejectTimeout(
          new AdapterError(
            `adapter did not exit within ${timeoutMs} ms`,
            "adapter.timeout",
          ),
        );
      }, timeoutMs);
    });
    const failure = this.failure.then((error) => {
      throw error;
    });
    try {
      await Promise.race([
        new Promise((resolveWrite, rejectWrite) => {
          this.child.stdin.end(`${canonicalJson(value)}\n`, (error) => {
            if (error) {
              rejectWrite(
                new AdapterError(
                  "could not write request to adapter",
                  "adapter.write",
                ),
              );
            } else {
              resolveWrite();
            }
          });
        }),
        failure,
        timeout,
      ]);

      const outcome = await Promise.race([this.exit, failure, timeout]);
      if (outcome.code !== 0) {
        throw new AdapterError(
          `adapter exited with ${
            outcome.signal
              ? `signal ${outcome.signal}`
              : `status ${outcome.code}`
          }`,
          "adapter.exited",
        );
      }
      const lines = decodeResponseLines(this.stdoutChunks, this.stdoutBytes);
      if (this.unsolicited || lines.length > 1) {
        throw new AdapterError(
          "adapter emitted more than one response",
          "adapter.unsolicited-output",
        );
      }
      if (lines.length === 0) {
        throw new AdapterError(
          "adapter exited before returning a response",
          "adapter.exited",
        );
      }
      return lines[0];
    } finally {
      clearTimeout(timer);
    }
  }

  async stop() {
    if (this.closed) return;
    this.child.stdin.end();
    if (await this.waitForExit(2_000)) return;
    this.child.kill("SIGTERM");
    if (await this.waitForExit(2_000)) return;
    this.child.kill("SIGKILL");
    await this.exit;
  }

  async waitForExit(timeoutMs) {
    let timer;
    return Promise.race([
      this.exit.then(() => {
        clearTimeout(timer);
        return true;
      }),
      new Promise((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), timeoutMs);
      }),
    ]);
  }
}

function decodeResponseLines(chunks, bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(Buffer.concat(chunks, bytes));
  } catch {
    throw new ModelEvalError("adapter response is not valid UTF-8", {
      code: "response.invalid-utf8",
      stage: "protocol",
    });
  }
  if (text.length === 0) return [];
  const lines = text.split(/\r\n|[\n\r]/u);
  if (/(?:\r\n|[\n\r])$/u.test(text)) lines.pop();
  return lines;
}

export async function runModelInterfaceEval(options) {
  options = {
    priorStateMode: "rolling",
    ...options,
  };
  validateRunOptions(options);
  const outputPath = resolve(options.output);
  await assertOutputOutsideCheckout(outputPath);
  const validators = await createModelEvalValidators();
  const config = await loadRunConfig(options.config, validators.config);
  const source = await readSourceState();
  await assertBenchmarkRevision(config.benchmarkRevision, source.revision);
  const runtimeDigest = await runtimeStateDigest(options.adapter);
  const corpus = await loadBenchmarkCases(
    options.cases ?? defaultCasesPath,
    validators,
  );
  const caseIds = new Set(corpus.map(({ id }) => id));
  for (const caseId of options.caseIds) {
    if (!caseIds.has(caseId)) throw new Error(`unknown case ${caseId}`);
  }
  const cases = corpus.filter(
    (testCase) =>
      options.caseIds.length === 0 || options.caseIds.includes(testCase.id),
  );
  if (cases.length === 0) throw new Error("no benchmark cases selected");

  const prompts = Object.fromEntries(
    await Promise.all(
      ARMS.map(async (arm) => [arm, await readFile(PROMPT_PATHS[arm], "utf8")]),
    ),
  );
  const packageDocument = parseStrictJson(
    await readFile("packages/prototype/package.json", "utf8"),
    "packages/prototype/package.json",
  );
  const run = {
    attemptId: randomUUID(),
    config,
    configDigest: contentDigest(config),
    corpusDigest: await digestFile(options.cases ?? defaultCasesPath),
    promptDigests: Object.fromEntries(
      ARMS.map((arm) => [arm, digestText(prompts[arm])]),
    ),
    selection: {
      arms: options.arms,
      cases: cases.map(({ id }) => id),
      priorStateMode: options.priorStateMode,
      repeats: options.repeats,
      timeoutMs: options.timeoutMs,
    },
    timelineVersion: packageDocument.version,
    startedAt: new Date().toISOString(),
    sourceRevision: source.revision,
    sourceDirty: source.dirty,
    sourceStateDigest: source.stateDigest,
    runtimeDigest,
    node: process.versions.node,
    platform: platform(),
    arch: arch(),
  };
  if (!options.overwrite) await assertOutputAvailable(outputPath);
  const partialPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${randomUUID()}.partial`,
  );
  const output = await open(partialPath, "wx");
  const total = cases.length * options.arms.length * options.repeats * 3;
  let completed = 0;
  let outputClosed = false;
  let outputBytes = 0;
  let preservePartial = false;
  let published = false;
  let requestNumber = 0;

  try {
    for (let repeat = 0; repeat < options.repeats; repeat += 1) {
      for (const [caseIndex, testCase] of cases.entries()) {
        const armOffset = (repeat + caseIndex) % options.arms.length;
        for (let armIndex = 0; armIndex < options.arms.length; armIndex += 1) {
          const arm =
            options.arms[(armIndex + armOffset) % options.arms.length];
          let memory = "";
          let admittedEvents = [...testCase.setupEvents];
          const knowledgeCuts = [];

          for (const cut of testCase.cuts) {
            const teacherPrior =
              arm === "timeline" && options.priorStateMode === "teacher-forced"
                ? goldPriorState(testCase, cut.index)
                : null;
            const priorEvents =
              arm === "structured-extraction"
                ? testCase.setupEvents
                : (teacherPrior?.events ?? admittedEvents);
            const priorKnowledgeCuts =
              teacherPrior?.knowledgeCuts ?? knowledgeCuts;
            requestNumber += 1;
            const requestId = `request-${requestNumber}`;
            const budget =
              arm === "narrative-memory" ||
              arm === "structured-extraction" ||
              arm === "timeline"
                ? memoryBudgetBytes(testCase, cut.index)
                : null;
            const input = {
              entities: testCase.entities,
              contract: testCase.contract,
              setupEvents: testCase.setupEvents,
              question: cut.question,
              evidence:
                arm === "direct" || arm === "structured-extraction"
                  ? visibleEvidence(testCase, cut.index)
                  : currentEvidence(testCase, cut.index),
              ...(arm === "narrative-memory"
                ? { memory, memoryBudgetBytes: budget }
                : {}),
              ...(arm === "timeline"
                ? {
                    priorRun: {
                      schema: "covenant.timeline.run.v0alpha3",
                      contract: testCase.contract,
                      events: priorEvents,
                    },
                    knowledgeCuts: [...priorKnowledgeCuts],
                    stateBudgetBytes: budget,
                  }
                : {}),
              ...(arm === "structured-extraction"
                ? { stateBudgetBytes: budget }
                : {}),
            };
            const request = {
              schema: REQUEST_SCHEMA,
              requestId,
              benchmark: BENCHMARK,
              config: run.config,
              configDigest: run.configDigest,
              caseId: testCase.contract.id,
              arm,
              repeat,
              cut: cut.index,
              prompt: prompts[arm],
              input,
            };
            const requestText = canonicalJson(request);
            const requestBytes = Buffer.byteLength(requestText, "utf8");
            if (requestBytes > MAX_REQUEST_BYTES) {
              throw new Error(
                `request ${requestId} uses ${requestBytes} bytes; limit is ${MAX_REQUEST_BYTES}`,
              );
            }
            const result = {
              schema: RESULT_SCHEMA,
              benchmark: BENCHMARK,
              run,
              requestId,
              requestText,
              requestDigest: digestText(requestText),
              responseText: null,
              responseDigest: null,
              caseId: testCase.id,
              family: testCase.family,
              arm,
              repeat,
              cut: cut.index,
              traits: cut.traits,
              status: "error",
              answer: null,
              proposedEvents: null,
              proposedQuery: null,
              admitted: null,
              conclusion: null,
              proofVerified: null,
              memory: null,
              memoryBytes: null,
              memoryBudgetBytes: arm === "narrative-memory" ? budget : null,
              stateBytes: null,
              stateBudgetBytes:
                arm === "structured-extraction" || arm === "timeline"
                  ? budget
                  : null,
              usage: null,
              latencyMs: 0,
              error: null,
            };

            const started = process.hrtime.bigint();
            let adapter;
            try {
              adapter = new JsonLineAdapter(
                options.adapter[0],
                options.adapter.slice(1),
              );
              const line = await adapter.request(request, options.timeoutMs);
              result.responseText = line;
              result.responseDigest = digestText(line);
              const response = parseStrictJson(
                line,
                `adapter response for ${requestId}`,
              );
              validateAdapterResponse(response, request, validators);
              result.usage = response.usage ?? null;
              if (response.error !== undefined) {
                if (response.error.scope === "run") {
                  throw new RunSetupError(response.error.message);
                }
                throw new ModelEvalError(response.error.message, {
                  code: response.error.code,
                  stage: "adapter",
                });
              }

              if (arm === "direct") {
                result.answer = response.answer;
                result.status = "ok";
              } else if (arm === "narrative-memory") {
                result.answer = response.answer;
                result.memory = response.memory;
                result.memoryBytes = Buffer.byteLength(response.memory, "utf8");
                if (result.memoryBytes > budget) {
                  throw new ModelEvalError(
                    `memory uses ${result.memoryBytes} bytes; budget is ${budget}`,
                    {
                      code: "memory.over-budget",
                      stage: "memory",
                    },
                  );
                }
                memory = response.memory;
                result.status = "ok";
              } else {
                result.proposedEvents = response.events;
                result.proposedQuery = response.query;
                assertModelTimelineDelta(response.events);
                for (const [index, event] of response.events.entries()) {
                  if (
                    event.type === "point.declared" ||
                    event.type === "interval.declared"
                  ) {
                    throw new ModelEvalError(
                      `adapter response.events[${index}]: declarations are setup data, not model deltas`,
                      {
                        code: "event.declaration-not-allowed",
                        stage: "admission",
                      },
                    );
                  }
                  assertVisibleEvidenceRefs(
                    event,
                    arm === "structured-extraction"
                      ? visibleEvidence(testCase, cut.index)
                      : currentEvidence(testCase, cut.index),
                    `adapter response.events[${index}]`,
                  );
                }
                if (arm === "structured-extraction") {
                  assertStructuredEventOrder(
                    response.events,
                    visibleEvidence(testCase, cut.index),
                  );
                }

                let parsedRun;
                const candidateEvents = [...priorEvents, ...response.events];
                try {
                  parsedRun = parseRunDocumentV0Alpha3({
                    schema: "covenant.timeline.run.v0alpha3",
                    contract: testCase.contract,
                    events: candidateEvents,
                  });
                } catch (error) {
                  throw stageError(error, "admission", "run.rejected");
                }
                const candidateKnowledgeCuts =
                  arm === "timeline"
                    ? [
                        ...priorKnowledgeCuts,
                        {
                          cut: cut.index,
                          recordedThrough:
                            candidateEvents.length === 0
                              ? null
                              : candidateEvents.length - 1,
                        },
                      ]
                    : [];
                result.stateBytes = continuityStateBytes(
                  parsedRun,
                  candidateKnowledgeCuts,
                  testCase.setupEvents.length,
                );
                if (result.stateBytes > budget) {
                  throw new ModelEvalError(
                    `Timeline state uses ${result.stateBytes} bytes; budget is ${budget}`,
                    {
                      code: "state.over-budget",
                      stage: "admission",
                    },
                  );
                }
                result.admitted = true;
                if (
                  arm === "timeline" &&
                  options.priorStateMode === "rolling"
                ) {
                  admittedEvents = candidateEvents;
                }

                let query;
                try {
                  query = parseQueryV0Alpha3(response.query, parsedRun);
                } catch (error) {
                  throw stageError(error, "query", "query.rejected");
                }
                let conclusion;
                try {
                  conclusion = reasonTemporalQueryV0Alpha3(parsedRun, query);
                } catch (error) {
                  throw stageError(error, "reasoning", "reasoning.failed");
                }
                result.conclusion = conclusion;
                result.answer = conclusion.result;
                result.proofVerified = verifyTemporalConclusionV0Alpha3(
                  parsedRun,
                  query,
                  conclusion,
                );
                if (!result.proofVerified) {
                  throw new ModelEvalError(
                    "temporal conclusion proof did not verify",
                    {
                      code: "proof.rejected",
                      stage: "reasoning",
                    },
                  );
                }
                result.status = "ok";
              }
            } catch (error) {
              if (error instanceof RunSetupError) throw error;
              if (
                error instanceof AdapterError &&
                error.code === "adapter.start"
              ) {
                throw new RunSetupError(error.message);
              }
              const failure = classifyFailure(error);
              result.error = {
                stage: failure.stage,
                code: failure.code,
                message: failure.message,
              };
              if (
                (arm === "structured-extraction" || arm === "timeline") &&
                result.admitted === null
              ) {
                result.admitted = false;
              }
            } finally {
              result.latencyMs =
                Number(process.hrtime.bigint() - started) / 1_000_000;
              await adapter?.stop();
            }

            assertValid(
              validators.result,
              result,
              `benchmark result ${requestId}`,
            );
            const resultLine = `${canonicalJson(result)}\n`;
            const resultBytes = Buffer.byteLength(resultLine, "utf8");
            if (outputBytes + resultBytes > MAX_RESULTS_BYTES) {
              throw new Error(
                `results would exceed the ${MAX_RESULTS_BYTES}-byte artifact limit`,
              );
            }
            await output.write(resultLine);
            outputBytes += resultBytes;
            completed += 1;
            if (completed === total || completed % 12 === 0) {
              process.stderr.write(
                `model-interface benchmark: ${completed}/${total}\n`,
              );
            }

            if (arm === "timeline" && options.priorStateMode === "rolling") {
              knowledgeCuts.push({
                cut: cut.index,
                recordedThrough:
                  admittedEvents.length === 0
                    ? null
                    : admittedEvents.length - 1,
              });
            }
          }
        }
      }
    }
    await output.sync();
    await output.close();
    outputClosed = true;

    const finalSource = await readSourceState();
    if (
      finalSource.revision !== source.revision ||
      finalSource.status !== source.status ||
      finalSource.stateDigest !== source.stateDigest
    ) {
      throw new Error(
        "repository source state changed during the benchmark run",
      );
    }
    if ((await runtimeStateDigest(options.adapter)) !== runtimeDigest) {
      throw new Error("benchmark runtime files changed during the run");
    }

    try {
      if (options.overwrite) {
        await rename(partialPath, outputPath);
        published = true;
      } else {
        await link(partialPath, outputPath);
        published = true;
      }
    } catch (error) {
      preservePartial = true;
      throw new Error(
        `${error.message}; validated artifact retained at ${partialPath}`,
        { cause: error },
      );
    }
    if (!options.overwrite) {
      try {
        await rm(partialPath);
      } catch (error) {
        process.stderr.write(
          `model-interface benchmark: published ${outputPath}; could not remove ${partialPath}: ${error.message}\n`,
        );
      }
    }
  } finally {
    if (!outputClosed) {
      try {
        await output.close();
      } catch (error) {
        process.stderr.write(
          `model-interface benchmark: could not close ${partialPath}: ${error.message}\n`,
        );
      }
    }
    if (!published && !preservePartial) {
      await rm(partialPath, { force: true });
    }
  }

  return { completed, output: options.output };
}

async function assertOutputOutsideCheckout(outputPath) {
  const [checkout, parent] = await Promise.all([
    realpath(root),
    realpath(dirname(outputPath)),
  ]);
  const target = join(parent, basename(outputPath));
  const pathFromCheckout = relative(checkout, target);
  if (
    pathFromCheckout === "" ||
    (!pathFromCheckout.startsWith(`..${sep}`) && !isAbsolute(pathFromCheckout))
  ) {
    throw new Error("output must be outside the repository checkout");
  }
}

async function assertOutputAvailable(path) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`output already exists: ${path}`);
}

export async function runtimeStateDigest(adapter) {
  const distRoot = resolve("packages/prototype/dist");
  const distFiles = await runtimeJavaScriptFiles(distRoot);
  const scriptFiles = await runtimeJavaScriptFiles(join(root, "scripts"));
  const adapterFiles = [];
  for (const [position, value] of adapter.entries()) {
    if (position === 0 && value === process.execPath) continue;
    if (position === 0 && !isAbsolute(value) && !value.includes(sep)) continue;
    const path = resolve(value);
    try {
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size > maxRuntimeFileBytes) continue;
      adapterFiles.push({
        position,
        digest: await digestFile(path),
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return contentDigest({
    adapter: adapterFiles,
    dist: await Promise.all(
      distFiles.map(async (path) => ({
        path: relative(distRoot, path).split(sep).join("/"),
        digest: await digestFile(path),
      })),
    ),
    scripts: await Promise.all(
      scriptFiles.map(async (path) => ({
        path: relative(root, path).split(sep).join("/"),
        digest: await digestFile(path),
      })),
    ),
  });
}

async function runtimeJavaScriptFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await runtimeJavaScriptFiles(path)));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))
    ) {
      files.push(path);
    }
  }
  return files;
}

function validateRunOptions(options) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new Error("run options must be an object");
  }
  for (const field of ["config", "output"]) {
    if (typeof options[field] !== "string" || options[field].length === 0) {
      throw new Error(`${field} must be a non-empty path`);
    }
  }
  if (
    !Array.isArray(options.adapter) ||
    options.adapter.length === 0 ||
    options.adapter.some(
      (part) => typeof part !== "string" || part.length === 0,
    )
  ) {
    throw new Error("adapter must be a non-empty command");
  }
  if (
    !Array.isArray(options.arms) ||
    options.arms.length === 0 ||
    options.arms.some((arm) => !ARMS.includes(arm)) ||
    new Set(options.arms).size !== options.arms.length
  ) {
    throw new Error("arms must contain unique benchmark arms");
  }
  if (
    !Array.isArray(options.caseIds) ||
    options.caseIds.some(
      (caseId) => typeof caseId !== "string" || caseId.length === 0,
    ) ||
    new Set(options.caseIds).size !== options.caseIds.length
  ) {
    throw new Error("caseIds must contain unique case identifiers");
  }
  assertBoundedOption(options.repeats, "repeats", MAX_REPEATS);
  assertBoundedOption(options.timeoutMs, "timeoutMs", MAX_TIMEOUT_MS);
  if (typeof options.overwrite !== "boolean") {
    throw new Error("overwrite must be a boolean");
  }
  if (
    options.priorStateMode !== "rolling" &&
    options.priorStateMode !== "teacher-forced"
  ) {
    throw new Error("priorStateMode must be rolling or teacher-forced");
  }
  if (
    options.priorStateMode === "teacher-forced" &&
    (options.arms.length !== 1 || options.arms[0] !== "timeline")
  ) {
    throw new Error("teacher-forced mode may run only the Timeline arm");
  }
}

function goldPriorState(testCase, cutIndex) {
  const events = [...testCase.setupEvents];
  const knowledgeCuts = [];
  for (const cut of testCase.cuts.slice(0, cutIndex)) {
    events.push(...cut.goldEvents);
    knowledgeCuts.push({
      cut: cut.index,
      recordedThrough: events.length === 0 ? null : events.length - 1,
    });
  }
  return { events, knowledgeCuts };
}

function assertBoundedOption(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}`);
  }
}

export async function readSourceState() {
  try {
    const [{ stdout: revision }, { stdout: status }, { stdout: files }] =
      await Promise.all([
        execFileAsync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }),
        execFileAsync(
          "git",
          ["status", "--porcelain=v1", "--untracked-files=all"],
          { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
        ),
        execFileAsync(
          "git",
          ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
          {
            cwd: root,
            encoding: "buffer",
            maxBuffer: 8 * 1024 * 1024,
          },
        ),
      ]);
    const paths = files
      .toString("utf8")
      .split("\0")
      .filter((path) => path.length > 0)
      .sort();
    return {
      revision: revision.trim(),
      dirty: status.length > 0,
      status,
      stateDigest: contentDigest(
        await Promise.all(
          paths.map(async (path) => ({
            path,
            digest: await digestWorkingTreePath(join(root, path)),
          })),
        ),
      ),
    };
  } catch {
    return {
      revision: "unavailable",
      dirty: null,
      status: null,
      stateDigest: null,
    };
  }
}

async function digestWorkingTreePath(path) {
  try {
    return await digestFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertBenchmarkRevision(benchmarkRevision, sourceRevision) {
  if (benchmarkRevision === sourceRevision) return;
  const resolved = await resolveGitCommit(benchmarkRevision);
  if (resolved === sourceRevision) return;
  throw new Error(
    `run configuration benchmarkRevision ${benchmarkRevision} does not resolve to source revision ${sourceRevision}`,
  );
}

async function resolveGitCommit(revision) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

function classifyFailure(error) {
  if (error instanceof AdapterError) {
    return {
      stage: "adapter",
      code: error.code,
      message: boundedErrorMessage(error.message),
    };
  }
  if (error instanceof ModelEvalError) {
    return {
      stage: error.stage,
      code: error.code,
      message: boundedErrorMessage(error.message),
    };
  }
  return {
    stage: "protocol",
    code: "response.invalid",
    message: boundedErrorMessage(
      error instanceof Error ? error.message : String(error),
    ),
  };
}

function boundedErrorMessage(value) {
  const source = String(value);
  const wellFormed =
    typeof source.toWellFormed === "function"
      ? source.toWellFormed()
      : source.replaceAll(
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
          "\uFFFD",
        );
  const bounded = Array.from(wellFormed).slice(0, 480).join("");
  return bounded || "benchmark request failed";
}

function stageError(error, stage, code) {
  return new ModelEvalError(
    error instanceof Error ? error.message : String(error),
    { stage, code },
  );
}

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("adapter command is required after --");
  }
  const flags = argv.slice(0, separator);
  const options = {
    adapter: argv.slice(separator + 1),
    arms: [...DEFAULT_ARMS],
    caseIds: [],
    cases: defaultCasesPath,
    config: null,
    output: null,
    overwrite: false,
    priorStateMode: "rolling",
    repeats: 3,
    timeoutMs: 120_000,
  };

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--overwrite") {
      options.overwrite = true;
      continue;
    }
    const value = flags[index + 1];
    if (value === undefined) throw new Error(`${flag} requires a value`);
    index += 1;
    switch (flag) {
      case "--arm":
        options.arms = value.split(",");
        break;
      case "--case":
        options.caseIds.push(value);
        break;
      case "--cases":
        options.cases = value;
        break;
      case "--config":
        options.config = value;
        break;
      case "--output":
        options.output = value;
        break;
      case "--prior-state":
        options.priorStateMode = value;
        break;
      case "--repeats":
        options.repeats = parseBoundedPositiveInteger(value, flag, MAX_REPEATS);
        break;
      case "--timeout-ms":
        options.timeoutMs = parseBoundedPositiveInteger(
          value,
          flag,
          MAX_TIMEOUT_MS,
        );
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }

  if (!options.config) throw new Error("--config is required");
  if (!options.output) throw new Error("--output is required");
  for (const arm of options.arms) {
    if (!ARMS.includes(arm)) throw new Error(`unknown arm ${arm}`);
  }
  if (new Set(options.arms).size !== options.arms.length) {
    throw new Error("--arm contains a duplicate");
  }
  return options;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseBoundedPositiveInteger(value, flag, maximum) {
  const parsed = parsePositiveInteger(value, flag);
  if (parsed > maximum) {
    throw new Error(`${flag} must not exceed ${maximum}`);
  }
  return parsed;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await runModelInterfaceEval(options);
  process.stderr.write(
    `wrote ${result.completed} result records to ${result.output}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

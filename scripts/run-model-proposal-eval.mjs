#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  link,
  open,
  readFile,
  readdir,
  realpath,
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
import Ajv2020 from "ajv/dist/2020.js";
import {
  TemporalModelProposalErrorV1,
  canonicalJson,
  compileTemporalModelProposalV1,
  contentDigest,
  verifyTemporalModelProposalCandidateV1,
} from "../packages/prototype/dist/index.js";
import {
  MAX_REPEATS,
  MAX_TIMEOUT_MS,
  assertNoCredentialFields,
  digestFile,
  digestText,
  loadBenchmarkCasesArtifact,
} from "./model-interface-eval.mjs";
import {
  MODEL_PROPOSAL_BOUNDARY_BENCHMARK,
  MODEL_PROPOSAL_BOUNDARY_RESULT_SCHEMA,
  ModelProposalBoundaryError,
  completeBoundaryCut,
  createBoundaryAdapterRequest,
  createBoundaryObservation,
  createBoundaryReferenceScope,
  createBoundaryTrajectory,
  evaluateBoundaryProposal,
  validateBoundaryProviderOutput,
} from "./model-proposal-boundary.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultCasesPath = join(
  root,
  "benchmarks/model-interface/v1/cases.jsonl",
);
const promptPath = join(
  root,
  "benchmarks/model-proposal-boundary/v1/prompts/proposal.md",
);
const resultSchemaPath = join(
  root,
  "benchmarks/model-proposal-boundary/v1/result.schema.json",
);
const packagePath = join(root, "packages/prototype/package.json");
const maxConfigBytes = 64 * 1024;
const maxRequestBytes = 256 * 1024;
const maxResponseBytes = 1_310_720;
const maxResultsBytes = 128 * 1024 * 1024;
const maxRuntimeFileBytes = 64 * 1024 * 1024;
const maxErrorCharacters = 480;
const proposalOptions = {
  maxChanges: 8,
  maxSupportsPerChange: 4,
};
const execFileAsync = promisify(execFile);

class AdapterProcessError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AdapterProcessError";
    this.code = code;
  }
}

class ObservationError extends Error {
  constructor(message, { code, stage, usage = null }) {
    super(message);
    this.name = "ObservationError";
    this.code = code;
    this.stage = stage;
    this.usage = usage;
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
    this.chunks = [];
    this.bytes = 0;
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
      this.bytes += chunk.length;
      if (this.bytes <= maxResponseBytes) {
        this.chunks.push(chunk);
        return;
      }
      if (this.tooLarge) return;
      this.tooLarge = true;
      this.child.stdout.destroy();
      this.child.kill("SIGKILL");
      this.resolveFailure(
        new AdapterProcessError(
          `adapter response exceeds ${maxResponseBytes} bytes`,
          "response.too-large",
        ),
      );
    });
    this.child.once("spawn", () => this.resolveReady());
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
      throw new AdapterProcessError(
        "adapter accepts exactly one request",
        "adapter.concurrent-request",
      );
    }
    this.started = true;
    await this.ready;
    if (this.startError) {
      throw new AdapterProcessError(
        `adapter process could not start: ${this.startError.message}`,
        "adapter.start",
      );
    }

    let timer;
    const timeout = new Promise((_, rejectTimeout) => {
      timer = setTimeout(() => {
        this.child.kill("SIGTERM");
        rejectTimeout(
          new AdapterProcessError(
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
                new AdapterProcessError(
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
        throw new AdapterProcessError(
          `adapter exited with ${
            outcome.signal
              ? `signal ${outcome.signal}`
              : `status ${outcome.code}`
          }`,
          "adapter.exited",
        );
      }
      const lines = decodeResponseLines(this.chunks, this.bytes);
      if (this.unsolicited || lines.length > 1) {
        throw new AdapterProcessError(
          "adapter emitted more than one response",
          "adapter.unsolicited-output",
        );
      }
      if (lines.length === 0) {
        throw new AdapterProcessError(
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

export async function createModelProposalEvalValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const path of [
    join(root, "schemas/v0alpha3/common.schema.json"),
    join(root, "schemas/v0alpha3/query.schema.json"),
    join(root, "schemas/v0alpha3/conclusion.schema.json"),
    join(root, "schemas/model-proposal/v1/proposal.schema.json"),
    join(root, "schemas/model-proposal/v1/candidate.schema.json"),
    resultSchemaPath,
  ]) {
    ajv.addSchema(parseStrictJson(await readFile(path, "utf8"), path));
  }
  const resultSchema = parseStrictJson(
    await readFile(resultSchemaPath, "utf8"),
    resultSchemaPath,
  );
  return {
    config: requiredValidator(
      ajv,
      `${resultSchema.$id}#/$defs/runConfig`,
      "run configuration",
    ),
    result: requiredValidator(ajv, resultSchema.$id, "benchmark result"),
    usage: requiredValidator(
      ajv,
      `${resultSchema.$id}#/$defs/usage`,
      "adapter usage",
    ),
  };
}

export async function runModelProposalEval(options, dependencies = {}) {
  validateRunOptions(options);
  const outputPath = resolve(options.output);
  await assertOutputOutsideCheckout(outputPath);
  const validators = await createModelProposalEvalValidators();
  const config = await loadConfig(options.config, validators.config);
  const readState = dependencies.readSourceState ?? readSourceState;
  const source = await readState();
  if (source.dirty !== false || typeof source.stateDigest !== "string") {
    throw new RunSetupError(
      "model-proposal benchmark runs require a clean Git checkout",
    );
  }
  await assertBenchmarkRevision(config.benchmarkRevision, source.revision);
  const runtimeDigest = await runtimeStateDigest(options.adapter);

  const casesPath = resolve(options.cases ?? defaultCasesPath);
  const corpusArtifact = await loadBenchmarkCasesArtifact(casesPath);
  const corpus = corpusArtifact.cases;
  const selectedIds = new Set(options.caseIds);
  const availableIds = new Set(corpus.map(({ id }) => id));
  for (const caseId of selectedIds) {
    if (!availableIds.has(caseId)) throw new Error(`unknown case ${caseId}`);
  }
  const cases = corpus.filter(
    ({ id }) => selectedIds.size === 0 || selectedIds.has(id),
  );
  if (cases.length === 0) throw new Error("no benchmark cases selected");

  const [prompt, packageText] = await Promise.all([
    readFile(promptPath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);
  const packageDocument = parseStrictJson(packageText, packagePath);
  const run = {
    config,
    configDigest: contentDigest(config),
    corpusDigest: corpusArtifact.digest,
    promptDigest: digestText(prompt),
    selection: {
      cases: cases.map(({ id }) => id),
      repeats: options.repeats,
      timeoutMs: options.timeoutMs,
    },
    timelineVersion: packageDocument.version,
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
  const output = await open(partialPath, "wx", 0o600);
  const total = cases.length * options.repeats * 3;
  let completed = 0;
  let outputBytes = 0;
  let outputClosed = false;
  let published = false;
  let requestNumber = 0;

  try {
    for (let repeat = 0; repeat < options.repeats; repeat += 1) {
      for (const testCase of cases) {
        const referenceScope = createBoundaryReferenceScope(testCase);
        let trajectory = createBoundaryTrajectory(testCase);

        for (const cut of testCase.cuts) {
          requestNumber += 1;
          const requestId = `request-${requestNumber}`;
          const observation = createBoundaryObservation({
            testCase,
            cut,
            trajectory,
            referenceScope,
            requestId,
          });
          assertOutputSchemaBinding(observation);
          const request = createBoundaryAdapterRequest({
            requestId,
            prompt,
            observation,
            config,
          });
          const requestText = canonicalJson(request);
          const requestBytes = Buffer.byteLength(requestText, "utf8");
          if (requestBytes > maxRequestBytes) {
            throw new RunSetupError(
              `request ${requestId} uses ${requestBytes} bytes; limit is ${maxRequestBytes}`,
            );
          }

          const result = createResult({
            run,
            requestId,
            requestText,
            observation,
            testCase,
            repeat,
            cut,
          });
          const started = process.hrtime.bigint();
          let adapter;
          let cutCompleted = false;

          try {
            adapter = new JsonLineAdapter(
              options.adapter[0],
              options.adapter.slice(1),
            );
            const responseText = await adapter.request(
              request,
              options.timeoutMs,
            );
            result.responseText = responseText;
            result.responseDigest = digestText(responseText);
            const response = parseAdapterLine(responseText, requestId);
            const parsed = parseAdapterResponse(
              response,
              requestId,
              validators.usage,
            );
            result.usage = parsed.usage;
            if (parsed.error) {
              if (parsed.error.scope === "run") {
                throw new RunSetupError(parsed.error.message);
              }
              throw new ObservationError(parsed.error.message, {
                stage: "adapter",
                code: parsed.error.code,
                usage: parsed.usage,
              });
            }

            try {
              validateBoundaryProviderOutput(parsed.proposal, observation);
            } catch (error) {
              if (
                error instanceof ModelProposalBoundaryError &&
                error.stage === "schema"
              ) {
                result.responseSchemaValid = false;
                throw new ObservationError(error.message, {
                  stage: "response-schema",
                  code: error.code,
                  usage: parsed.usage,
                });
              }
              throw error;
            }
            result.responseSchemaValid = true;
            result.proposal = parsed.proposal;

            let candidate;
            try {
              candidate = compileTemporalModelProposalV1(
                parsed.proposal,
                observation.host,
                proposalOptions,
              );
            } catch (error) {
              if (!(error instanceof TemporalModelProposalErrorV1)) throw error;
              result.compiled = false;
              result.error = {
                stage: "compilation",
                code: error.code,
                message: boundedErrorMessage(error.message),
              };
              trajectory = completeBoundaryCut(trajectory, cut.index);
              cutCompleted = true;
            }

            if (candidate !== undefined) {
              result.compiled = true;
              result.candidate = candidate;
              result.candidateVerified = verifyTemporalModelProposalCandidateV1(
                candidate,
                parsed.proposal,
                observation.host,
                proposalOptions,
              );

              if (!result.candidateVerified) {
                result.error = {
                  stage: "candidate-verification",
                  code: "proposal.candidate-verification",
                  message: "candidate re-verification failed after compilation",
                };
                trajectory = completeBoundaryCut(trajectory, cut.index);
                cutCompleted = true;
              } else {
                const evaluated = evaluateBoundaryProposal({
                  proposal: parsed.proposal,
                  observation,
                  trajectory,
                  testCase,
                  cut,
                  referenceScope,
                });
                if (
                  !evaluated.compiled ||
                  evaluated.candidate === undefined ||
                  canonicalJson(evaluated.candidate) !==
                    canonicalJson(candidate)
                ) {
                  throw new RunSetupError(
                    "proposal compilation changed during one observation",
                  );
                }
                trajectory = evaluated.trajectory;
                cutCompleted = true;
                result.applied = evaluated.applied;
                result.conclusion = evaluated.conclusion ?? null;
                result.proofVerified = evaluated.proofVerified ?? null;

                if (evaluated.error) {
                  result.error = mapEvaluationError(evaluated.error);
                }
              }
            }

            result.status = result.error ? "error" : "ok";
          } catch (error) {
            if (error instanceof RunSetupError) throw error;
            if (
              error instanceof AdapterProcessError &&
              error.code === "adapter.start"
            ) {
              throw new RunSetupError(error.message);
            }
            const failure = classifyObservationFailure(error, result);
            result.error = failure;
            result.usage ??= error?.usage ?? null;
            if (!cutCompleted) {
              trajectory = completeBoundaryCut(trajectory, cut.index);
              cutCompleted = true;
            }
          } finally {
            const elapsed =
              Number(process.hrtime.bigint() - started) / 1_000_000;
            result.latencyMs = elapsed;
            await adapter?.stop();
          }

          assertValidResult(validators.result, result, requestId);
          const line = `${canonicalJson(result)}\n`;
          const bytes = Buffer.byteLength(line, "utf8");
          if (outputBytes + bytes > maxResultsBytes) {
            throw new RunSetupError(
              `results would exceed the ${maxResultsBytes}-byte artifact limit`,
            );
          }
          await writeAll(output, line);
          outputBytes += bytes;
          completed += 1;
          if (completed === total || completed % 12 === 0) {
            process.stderr.write(
              `model-proposal benchmark: ${completed}/${total}\n`,
            );
          }
        }
      }
    }

    await output.sync();
    await output.close();
    outputClosed = true;
    const finalSource = await readState();
    if (!sameSourceState(source, finalSource)) {
      throw new RunSetupError(
        "repository source state changed during the benchmark run",
      );
    }
    if ((await runtimeStateDigest(options.adapter)) !== runtimeDigest) {
      throw new RunSetupError(
        "benchmark runtime files changed during the benchmark run",
      );
    }

    if (options.overwrite) {
      await rename(partialPath, outputPath);
      published = true;
    } else {
      await link(partialPath, outputPath);
      published = true;
      try {
        await rm(partialPath);
      } catch (error) {
        process.stderr.write(
          `model-proposal benchmark: published ${outputPath}; could not remove ${partialPath}: ${error.message}\n`,
        );
      }
    }
  } finally {
    if (!outputClosed) {
      await output.close().catch(() => undefined);
    }
    if (!published) await rm(partialPath, { force: true });
  }

  return { completed, output: options.output };
}

function createResult({
  run,
  requestId,
  requestText,
  observation,
  testCase,
  repeat,
  cut,
}) {
  return {
    schema: MODEL_PROPOSAL_BOUNDARY_RESULT_SCHEMA,
    benchmark: MODEL_PROPOSAL_BOUNDARY_BENCHMARK,
    run,
    requestId,
    requestText,
    requestDigest: digestText(requestText),
    outputSchemaJson: observation.outputSchemaText,
    outputSchemaDigest: observation.outputSchemaDigest,
    responseText: null,
    responseDigest: null,
    caseId: testCase.id,
    family: testCase.family,
    repeat,
    cut: cut.index,
    traits: cut.traits,
    status: "error",
    proposal: null,
    responseSchemaValid: null,
    compiled: null,
    candidate: null,
    candidateVerified: null,
    applied: null,
    conclusion: null,
    proofVerified: null,
    usage: null,
    latencyMs: 0,
    error: null,
  };
}

async function writeAll(file, value) {
  const bytes = Buffer.from(value, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(
      bytes,
      offset,
      bytes.length - offset,
      null,
    );
    if (bytesWritten < 1) {
      throw new RunSetupError("could not write the complete result artifact");
    }
    offset += bytesWritten;
  }
}

function parseAdapterLine(text, requestId) {
  try {
    return parseStrictJson(text, `adapter response for ${requestId}`);
  } catch {
    throw new ObservationError("adapter response is not strict JSON", {
      stage: "protocol",
      code: "response.invalid-json",
    });
  }
}

function parseAdapterResponse(response, requestId, usageValidator) {
  if (!isRecord(response)) {
    throw new ObservationError("adapter response must be an object", {
      stage: "protocol",
      code: "response.invalid",
    });
  }
  const usage =
    response.usage === undefined
      ? null
      : validateUsage(response.usage, usageValidator);

  if (response.schema === "covenant.timeline.model-eval.adapter-error.v1") {
    assertExactKeys(response, ["schema", "requestId", "error"], ["usage"]);
    if (response.requestId !== requestId) {
      throw new ObservationError("adapter response requestId mismatch", {
        stage: "protocol",
        code: "response.request-id",
        usage,
      });
    }
    const error = validateAdapterError(response.error);
    return { error, proposal: null, usage };
  }

  const { usage: _usage, ...proposal } = response;
  return { error: null, proposal, usage };
}

function validateAdapterError(error) {
  if (!isRecord(error)) {
    throw new ObservationError("adapter error must be an object", {
      stage: "protocol",
      code: "response.invalid",
    });
  }
  assertExactKeys(error, ["code", "message", "scope"]);
  if (
    typeof error.code !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(error.code)
  ) {
    throw new ObservationError("adapter error code is invalid", {
      stage: "protocol",
      code: "response.invalid",
    });
  }
  if (
    typeof error.message !== "string" ||
    error.message.length === 0 ||
    error.message.length > 480
  ) {
    throw new ObservationError("adapter error message is invalid", {
      stage: "protocol",
      code: "response.invalid",
    });
  }
  if (error.scope !== "run" && error.scope !== "observation") {
    throw new ObservationError("adapter error scope is invalid", {
      stage: "protocol",
      code: "response.invalid",
    });
  }
  return error;
}

function validateUsage(usage, validator) {
  if (validator(usage)) return usage;
  throw new ObservationError("adapter usage is invalid", {
    stage: "protocol",
    code: "response.usage",
  });
}

function mapEvaluationError(error) {
  if (error.stage === "compiler") {
    return {
      stage: "compilation",
      code: error.code,
      message: boundedErrorMessage(error.message),
    };
  }
  if (error.stage === "continuity") {
    return {
      stage: "application",
      code: error.code,
      message: boundedErrorMessage(error.message),
    };
  }
  throw new RunSetupError(
    `evaluator returned an unsupported error stage ${error.stage}`,
  );
}

function classifyObservationFailure(error, result) {
  if (error instanceof AdapterProcessError) {
    return {
      stage: "adapter",
      code: error.code,
      message: boundedErrorMessage(error.message),
    };
  }
  if (error instanceof ObservationError) {
    return {
      stage: error.stage,
      code: error.code,
      message: boundedErrorMessage(error.message),
    };
  }
  if (error instanceof ModelProposalBoundaryError) {
    if (error.code === "proposal.candidate-verification") {
      result.compiled = true;
      result.candidateVerified = false;
      return {
        stage: "candidate-verification",
        code: error.code,
        message: boundedErrorMessage(error.message),
      };
    }
    if (error.code === "proposal.proof-verification") {
      return {
        stage: "proof-verification",
        code: error.code,
        message: boundedErrorMessage(error.message),
      };
    }
  }
  throw error;
}

function assertOutputSchemaBinding(observation) {
  if (
    canonicalJson(observation.outputSchema) !== observation.outputSchemaText ||
    digestText(observation.outputSchemaText) !==
      observation.outputSchemaDigest ||
    contentDigest(observation.outputSchema) !== observation.outputSchemaDigest
  ) {
    throw new RunSetupError(
      "generated output schema text and digest are not byte-equivalent",
    );
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
    throw new AdapterProcessError(
      "adapter response is not valid UTF-8",
      "response.invalid-utf8",
    );
  }
  if (text.length === 0) return [];
  const lines = text.split(/\r\n|[\n\r]/u);
  if (/(?:\r\n|[\n\r])$/u.test(text)) lines.pop();
  return lines;
}

async function loadConfig(path, validator) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > maxConfigBytes) {
    throw new Error(`configuration exceeds ${maxConfigBytes} bytes`);
  }
  const config = parseStrictJson(await readFile(path, "utf8"), path);
  if (!validator(config)) {
    throw new Error(`${path}: ${formatValidationErrors(validator.errors)}`);
  }
  assertNoCredentialFields(
    config.generation.parameters,
    `${path}.generation.parameters`,
  );
  return config;
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

function requiredValidator(ajv, id, label) {
  const validator = ajv.getSchema(id);
  if (!validator) throw new Error(`${label} schema is not registered`);
  return validator;
}

function assertValidResult(validator, result, requestId) {
  if (validator(result)) return;
  throw new RunSetupError(
    `benchmark result ${requestId}: ${formatValidationErrors(validator.errors)}`,
  );
}

function formatValidationErrors(errors) {
  return (errors ?? [])
    .slice(0, 12)
    .map(
      ({ instancePath, message }) =>
        `${instancePath || "$"} ${message ?? "is invalid"}`,
    )
    .join("; ");
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(value, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new ObservationError(`adapter response is missing ${key}`, {
        stage: "protocol",
        code: "response.invalid",
      });
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ObservationError(
        `adapter response contains unsupported field ${key}`,
        { stage: "protocol", code: "response.invalid" },
      );
    }
  }
}

function boundedErrorMessage(value) {
  const source = String(value);
  const wellFormed =
    typeof source.toWellFormed === "function"
      ? source.toWellFormed()
      : source.replaceAll(
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu,
          "\uFFFD",
        );
  const sanitized = wellFormed.replace(/[\u0000-\u001f\u007f]/gu, " ");
  return (
    Array.from(sanitized).slice(0, maxErrorCharacters).join("") ||
    "benchmark observation failed"
  );
}

function validateRunOptions(options) {
  if (!isRecord(options)) throw new Error("run options must be an object");
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
    options.cases !== undefined &&
    (typeof options.cases !== "string" || options.cases.length === 0)
  ) {
    throw new Error("cases must be a non-empty path");
  }
}

function assertBoundedOption(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}`);
  }
}

async function runtimeStateDigest(adapter) {
  const distRoot = join(root, "packages/prototype/dist");
  const distFiles = await runtimeJavaScriptFiles(distRoot);
  const scriptFiles = await runtimeJavaScriptFiles(join(root, "scripts"));
  const adapterFiles = [];
  const command = basename(adapter[0]);
  const interpreterCommand =
    adapter[0] === process.execPath ||
    command === basename(process.execPath) ||
    /^(?:bun|deno|node|nodejs|python(?:3(?:\.\d+)*)?)$/u.test(command);
  const entrypoint = interpreterCommand ? 1 : 0;
  const value = adapter[entrypoint];

  if (
    value !== undefined &&
    (entrypoint !== 0 || isAbsolute(value) || value.includes(sep))
  ) {
    const path = resolve(value);
    try {
      const metadata = await stat(path);
      if (metadata.isFile() && metadata.size <= maxRuntimeFileBytes) {
        adapterFiles.push({
          position: entrypoint,
          digest: await digestFile(path),
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return contentDigest({
    adapterArgv: adapter,
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
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
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

async function readSourceState() {
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
          {
            cwd: root,
            encoding: "utf8",
            maxBuffer: 8 * 1024 * 1024,
          },
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
    const paths = files.toString("utf8").split("\0").filter(Boolean).sort();
    return {
      revision: revision.trim(),
      dirty: status.length > 0,
      status,
      stateDigest: contentDigest(
        await Promise.all(
          paths.map(async (path) => ({
            path,
            digest: await digestFile(join(root, path)),
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

function sameSourceState(left, right) {
  return (
    left.revision === right.revision &&
    left.dirty === right.dirty &&
    left.status === right.status &&
    left.stateDigest === right.stateDigest
  );
}

async function assertBenchmarkRevision(benchmarkRevision, sourceRevision) {
  if (benchmarkRevision === sourceRevision) return;
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${benchmarkRevision}^{commit}`,
      ],
      { cwd: root, encoding: "utf8" },
    );
    if (stdout.trim() === sourceRevision) return;
  } catch {
    // The error below is the stable public failure.
  }
  throw new Error(
    `run configuration benchmarkRevision ${benchmarkRevision} does not resolve to source revision ${sourceRevision}`,
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
    caseIds: [],
    cases: defaultCasesPath,
    config: null,
    output: null,
    overwrite: false,
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
      case "--repeats":
        options.repeats = parsePositiveInteger(value, flag, MAX_REPEATS);
        break;
      case "--timeout-ms":
        options.timeoutMs = parsePositiveInteger(value, flag, MAX_TIMEOUT_MS);
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }
  if (!options.config) throw new Error("--config is required");
  if (!options.output) throw new Error("--output is required");
  return options;
}

function parsePositiveInteger(value, flag, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${flag} must be an integer from 1 through ${maximum}`);
  }
  return parsed;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await runModelProposalEval(options);
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

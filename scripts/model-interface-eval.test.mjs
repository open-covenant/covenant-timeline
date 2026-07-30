import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../packages/prototype/dist/index.js";
import {
  assertModelTimelineDelta,
  createModelEvalValidators,
  digestText,
  loadBenchmarkCases,
  loadRunConfig,
  readJsonLines,
  validateAdapterResponse,
} from "./model-interface-eval.mjs";
import { runModelInterfaceEval } from "./run-model-interface-eval.mjs";
import { scoreModelInterfaceEval } from "./score-model-interface-eval.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const casesPath = join(root, "benchmarks/model-interface/v1/cases.jsonl");
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();

test("the model-interface corpus is kernel-derived and balanced", async () => {
  const validators = await createModelEvalValidators();
  const cases = await loadBenchmarkCases(casesPath, validators);

  assert.equal(cases.length, 12);
  assert.equal(
    cases.reduce((total, testCase) => total + testCase.cuts.length, 0),
    36,
  );
  assert.equal(new Set(cases.map(({ id }) => id)).size, 12);
});

test("Timeline deltas reject duplicate claims and benchmark-scale excess", async () => {
  const [testCase] = await loadBenchmarkCases(casesPath);
  const [event] = testCase.cuts[0].goldEvents;
  const duplicate = {
    ...structuredClone(event),
    id: "duplicate-event",
    sequence: event.sequence + 1,
    assertion: {
      ...structuredClone(event.assertion),
      id: "duplicate-assertion",
    },
  };

  assert.throws(
    () => assertModelTimelineDelta([event, duplicate]),
    (error) => error.code === "event.duplicate-claim",
  );

  const lower = structuredClone(event);
  lower.assertion.coordinate = {
    minimum: event.assertion.coordinate.minimum,
  };
  const upper = {
    ...structuredClone(event),
    id: "upper-event",
    sequence: event.sequence + 1,
    assertion: {
      ...structuredClone(event.assertion),
      id: "upper-assertion",
      coordinate: {
        maximum: event.assertion.coordinate.maximum,
      },
    },
  };
  assert.doesNotThrow(() => assertModelTimelineDelta([lower, upper]));

  assert.throws(
    () =>
      assertModelTimelineDelta(
        Array.from({ length: 9 }, (_, index) => ({
          ...structuredClone(event),
          id: `event-${index}`,
          sequence: index,
          assertion: {
            ...structuredClone(event.assertion),
            id: `assertion-${index}`,
            coordinate: { minimum: index, maximum: index },
          },
        })),
      ),
    (error) => error.code === "event.delta-limit",
  );

  const excessiveReferences = structuredClone(event);
  excessiveReferences.assertion.evidenceRefs = Array.from(
    { length: 9 },
    (_, index) => `sha256:${index.toString(16).padStart(64, "0")}`,
  );
  assert.throws(
    () => assertModelTimelineDelta([excessiveReferences]),
    (error) => error.code === "event.reference-limit",
  );
});

test("run configuration rejects unreported settings", async () => {
  const validators = await createModelEvalValidators();
  const valid = {
    schema: "covenant.timeline.model-eval.config.v1",
    id: "test-run",
    benchmarkRevision: sourceRevision,
    adapter: { id: "gold-fixture", version: "1" },
    model: { provider: "test", id: "gold", revision: "1" },
    generation: {
      temperature: 0,
      seed: 1,
      maxOutputTokens: 4096,
      parameters: {},
    },
  };
  assert.equal(validators.config(valid), true);
  assert.equal(validators.config({ ...valid, undisclosedRetries: 2 }), false);
  assert.equal(
    validators.usage({
      inputTokens: 1e308,
      outputTokens: 1e308,
      costUsd: 1e308,
    }),
    false,
  );
  await assert.rejects(
    runModelInterfaceEval({
      adapter: ["adapter"],
      arms: ["direct"],
      caseIds: [],
      config: "config.json",
      output: "results.jsonl",
      overwrite: false,
      repeats: 21,
      timeoutMs: 1,
    }),
    /repeats must be an integer from 1 through 20/,
  );
});

test("run configuration rejects credential-like parameters", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-config-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const configPath = join(temporaryDirectory, "run-config.json");
  const validators = await createModelEvalValidators();
  for (const key of [
    "token",
    "bearerToken",
    "privateKey",
    "openaiKey",
    "anthropicKey",
  ]) {
    await writeFile(
      configPath,
      `${JSON.stringify({
        schema: "covenant.timeline.model-eval.config.v1",
        id: "test-secret-run",
        benchmarkRevision: sourceRevision,
        adapter: { id: "test", version: "1" },
        model: { provider: "test", id: "test", revision: "1" },
        generation: {
          temperature: 0,
          seed: 1,
          maxOutputTokens: 4096,
          parameters: {
            [key]: "must-not-be-recorded",
          },
        },
      })}\n`,
    );
    await assert.rejects(
      loadRunConfig(configPath, validators.config),
      /credentials must be passed through the adapter environment/,
    );
  }
});

test("runner binds benchmarkRevision to the checked-out source", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-revision-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeConfig(configPath, "revision-mismatch");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.benchmarkRevision = "b".repeat(40);
  await writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8");

  await assert.rejects(
    runModelInterfaceEval({
      adapter: ["not-invoked"],
      arms: ["direct"],
      caseIds: ["bounds.deploy-window"],
      cases: casesPath,
      config: configPath,
      output: resultsPath,
      overwrite: false,
      repeats: 1,
      timeoutMs: 1_000,
    }),
    /benchmarkRevision .* does not resolve to source revision/,
  );
  await assert.rejects(readFile(resultsPath, "utf8"), { code: "ENOENT" });
});

test("runner accepts a legacy Git ref that resolves to the source", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-ref-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "gold-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeConfig(configPath, "legacy-ref");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.benchmarkRevision = "HEAD";
  await writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8");
  await writeFile(adapterPath, goldAdapterSource);

  const run = await runModelInterfaceEval({
    adapter: [process.execPath, adapterPath, casesPath],
    arms: ["direct"],
    caseIds: ["bounds.deploy-window"],
    cases: casesPath,
    config: configPath,
    output: resultsPath,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });
  assert.equal(run.completed, 3);
  const score = await scoreModelInterfaceEval({
    cases: casesPath,
    results: resultsPath,
  });
  assert.equal(score.coverage.complete, true);
});

test("adapter error envelopes are closed and bounded", async () => {
  const validators = await createModelEvalValidators();
  const request = {
    arm: "direct",
    requestId: "request-1",
  };
  const valid = {
    schema: "covenant.timeline.model-eval.adapter-error.v1",
    requestId: "request-1",
    error: {
      code: "provider.http-429",
      message: "provider returned a rate limit response",
      scope: "observation",
    },
  };
  assert.doesNotThrow(() =>
    validateAdapterResponse(valid, request, validators),
  );

  for (const invalid of [
    {
      ...valid,
      schema: "covenant.timeline.model-eval.response.v1",
    },
    {
      ...valid,
      answer: {
        type: "context.consistency",
        status: "consistent",
      },
    },
    {
      ...valid,
      error: {
        ...valid.error,
        code: "UPPERCASE",
      },
    },
    {
      ...valid,
      error: {
        ...valid.error,
        message: "x".repeat(481),
      },
    },
    {
      ...valid,
      error: {
        ...valid.error,
        scope: "case",
      },
    },
  ]) {
    assert.throws(() => validateAdapterResponse(invalid, request, validators));
  }
});

test("gold fixture exercises the runner and scorer end to end", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "gold-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeFile(
    configPath,
    `${JSON.stringify({
      schema: "covenant.timeline.model-eval.config.v1",
      id: "test-gold-run",
      benchmarkRevision: sourceRevision,
      adapter: { id: "gold-fixture", version: "1" },
      model: { provider: "test", id: "gold", revision: "1" },
      generation: {
        temperature: 0,
        seed: 1,
        maxOutputTokens: 4096,
        parameters: {},
      },
    })}\n`,
  );
  await writeFile(adapterPath, goldAdapterSource);

  const run = await runModelInterfaceEval({
    adapter: [process.execPath, adapterPath, casesPath],
    arms: ["direct", "narrative-memory", "timeline"],
    caseIds: [],
    cases: casesPath,
    config: configPath,
    output: resultsPath,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });
  assert.equal(run.completed, 108);
  assert.equal(
    (await readFile(resultsPath, "utf8")).trim().split("\n").length,
    108,
  );
  const orderedResults = await readJsonLines(resultsPath);
  assert.deepEqual(
    orderedResults.slice(0, 9).map(({ arm }) => arm),
    [
      ...Array(3).fill("direct"),
      ...Array(3).fill("narrative-memory"),
      ...Array(3).fill("timeline"),
    ],
  );
  assert.deepEqual(
    orderedResults.slice(9, 18).map(({ arm }) => arm),
    [
      ...Array(3).fill("narrative-memory"),
      ...Array(3).fill("timeline"),
      ...Array(3).fill("direct"),
    ],
  );

  const score = await scoreModelInterfaceEval({
    cases: casesPath,
    results: resultsPath,
  });
  assert.deepEqual(score.coverage, {
    expected: 108,
    observed: 108,
    missing: 0,
    complete: true,
    repeats: 1,
  });
  assert.equal(score.arms.direct.answerExactRate.value, 1);
  assert.equal(score.arms["narrative-memory"].answerExactRate.value, 1);
  assert.equal(score.arms.timeline.endToEndExactRate.value, 1);
  assert.equal(score.arms.timeline.answerExactRate.value, 1);
  assert.equal(score.arms.timeline.admissionRate.value, 1);
  assert.equal(score.arms.timeline.representationExactAssertionF1, 1);
  assert.equal(score.arms.timeline.projectedStateExactRate.value, 1);
  assert.equal(score.arms.timeline.queryExactRate.value, 1);
  assert.equal(score.arms.timeline.proofVerificationRate.value, 1);
  assert.deepEqual(score.paired.timelineVsDirect, {
    win: 0,
    loss: 0,
    tie: 36,
    bothCorrect: 36,
    bothIncorrect: 0,
  });

  const tamperedPath = join(temporaryDirectory, "tampered-results.jsonl");
  const tampered = await readJsonLines(resultsPath);
  tampered[0].answer = {
    type: "context.consistency",
    status: "consistent",
  };
  await writeFile(
    tamperedPath,
    `${tampered.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  await assert.rejects(
    scoreModelInterfaceEval({
      cases: casesPath,
      results: tamperedPath,
    }),
    /answer does not match stored response/,
  );

  const hiddenPriorPath = join(
    temporaryDirectory,
    "hidden-prior-results.jsonl",
  );
  const hiddenPrior = await readJsonLines(resultsPath);
  const hiddenPriorResult = hiddenPrior.find(
    (result) => result.arm === "timeline",
  );
  const hiddenPriorRequest = JSON.parse(hiddenPriorResult.requestText);
  hiddenPriorRequest.input.priorRun.hiddenGoldAnswer = hiddenPriorResult.answer;
  hiddenPriorResult.requestText = canonicalJson(hiddenPriorRequest);
  hiddenPriorResult.requestDigest = digestText(hiddenPriorResult.requestText);
  await writeResults(hiddenPriorPath, hiddenPrior);
  await assert.rejects(
    scoreModelInterfaceEval({
      cases: casesPath,
      results: hiddenPriorPath,
    }),
    /fields do not match the request protocol/,
  );

  const fabricatedFailurePath = join(
    temporaryDirectory,
    "fabricated-failure-results.jsonl",
  );
  const fabricatedFailure = await readJsonLines(resultsPath);
  const fabricatedFailureResult = fabricatedFailure.find(
    (result) => result.arm === "timeline" && result.status === "ok",
  );
  fabricatedFailureResult.status = "error";
  fabricatedFailureResult.answer = null;
  fabricatedFailureResult.conclusion = null;
  fabricatedFailureResult.proofVerified = null;
  fabricatedFailureResult.error = {
    stage: "query",
    code: "query.rejected",
    message: "fabricated failure",
  };
  await writeResults(fabricatedFailurePath, fabricatedFailure);
  await assert.rejects(
    scoreModelInterfaceEval({
      cases: casesPath,
      results: fabricatedFailurePath,
    }),
    /successful Timeline result does not reproduce/,
  );

  const oversizedLatencyPath = join(
    temporaryDirectory,
    "oversized-latency-results.jsonl",
  );
  const oversizedLatency = await readJsonLines(resultsPath);
  oversizedLatency[0].latencyMs = 1e308;
  await writeResults(oversizedLatencyPath, oversizedLatency);
  await assert.rejects(
    scoreModelInterfaceEval({
      cases: casesPath,
      results: oversizedLatencyPath,
    }),
    /latencyMs.*must be <= 1000000/,
  );

  const credentialArtifactPath = join(
    temporaryDirectory,
    "credential-artifact-results.jsonl",
  );
  const credentialArtifact = await readJsonLines(resultsPath);
  credentialArtifact[0].run.config.generation.parameters.openaiKey =
    "must-not-be-recorded";
  await writeResults(credentialArtifactPath, credentialArtifact);
  await assert.rejects(
    scoreModelInterfaceEval({
      cases: casesPath,
      results: credentialArtifactPath,
    }),
    /credentials must be passed through the adapter environment/,
  );

  const revisionMismatchPath = join(
    temporaryDirectory,
    "revision-mismatch-results.jsonl",
  );
  const revisionMismatch = await readJsonLines(resultsPath);
  for (const result of revisionMismatch) {
    result.run.sourceRevision = "b".repeat(40);
  }
  await writeResults(revisionMismatchPath, revisionMismatch);
  await assert.rejects(
    scoreModelInterfaceEval({
      cases: casesPath,
      results: revisionMismatchPath,
    }),
    /benchmarkRevision does not match run.sourceRevision/,
  );
});

test("empty Timeline extraction cannot pass end-to-end scoring", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-empty-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "empty-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeConfig(configPath, "empty-fixture");
  await writeFile(adapterPath, emptyAdapterSource);

  await runModelInterfaceEval({
    adapter: [process.execPath, adapterPath, casesPath],
    arms: ["timeline"],
    caseIds: ["bounds.deploy-window"],
    cases: casesPath,
    config: configPath,
    output: resultsPath,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });
  const score = await scoreModelInterfaceEval({
    cases: casesPath,
    results: resultsPath,
  });
  assert.deepEqual(score.arms.timeline.answerExactRate, {
    numerator: 1,
    denominator: 3,
    value: 1 / 3,
  });
  assert.deepEqual(score.arms.timeline.endToEndExactRate, {
    numerator: 0,
    denominator: 3,
    value: 0,
  });
  assert.equal(score.arms.timeline.representationExactAssertionRecall.value, 0);
  assert.equal(score.arms.timeline.representationExactAssertionF1, 0);
  assert.equal(score.arms.timeline.projectedStateExactRate.value, 0);
});

test("semantic state and knowledge cuts tolerate equivalent event encodings", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-equivalent-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "equivalent-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeFile(
    configPath,
    `${JSON.stringify({
      schema: "covenant.timeline.model-eval.config.v1",
      id: "test-equivalent-run",
      benchmarkRevision: sourceRevision,
      adapter: { id: "equivalent-fixture", version: "1" },
      model: { provider: "test", id: "equivalent", revision: "1" },
      generation: {
        temperature: 0,
        seed: 1,
        maxOutputTokens: 4096,
        parameters: {},
      },
    })}\n`,
  );
  await writeFile(adapterPath, equivalentAdapterSource);

  await runModelInterfaceEval({
    adapter: [process.execPath, adapterPath, casesPath],
    arms: ["timeline"],
    caseIds: ["bounds.incubation"],
    cases: casesPath,
    config: configPath,
    output: resultsPath,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });
  const score = await scoreModelInterfaceEval({
    cases: casesPath,
    results: resultsPath,
  });
  assert.equal(score.arms.timeline.endToEndExactRate.value, 1);
  assert.equal(score.arms.timeline.projectedStateExactRate.value, 1);
  assert.equal(score.arms.timeline.queryExactRate.value, 1);
  assert.ok(score.arms.timeline.representationExactAssertionF1 < 1);
});

test("runner preserves semantic, memory, and admission failures", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-failures-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "failure-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeFile(
    configPath,
    `${JSON.stringify({
      schema: "covenant.timeline.model-eval.config.v1",
      id: "test-failure-run",
      benchmarkRevision: sourceRevision,
      adapter: { id: "failure-fixture", version: "1" },
      model: { provider: "test", id: "failure", revision: "1" },
      generation: {
        temperature: 0,
        seed: 1,
        maxOutputTokens: 4096,
        parameters: {},
      },
    })}\n`,
  );
  await writeFile(adapterPath, failureAdapterSource);

  await runModelInterfaceEval({
    adapter: [process.execPath, adapterPath, casesPath],
    arms: ["direct", "narrative-memory", "timeline"],
    caseIds: ["bounds.deploy-window"],
    cases: casesPath,
    config: configPath,
    output: resultsPath,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });

  const results = await readJsonLines(resultsPath);
  assert.equal(results.length, 9);
  assert.equal(
    results.filter(
      (result) =>
        result.arm === "direct" &&
        result.cut === 0 &&
        result.status === "ok" &&
        result.answer.status === "bounded",
    ).length,
    1,
  );
  assert.equal(
    results.filter(
      (result) => result.arm === "narrative-memory" && result.status === "ok",
    ).length,
    2,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.arm === "narrative-memory" &&
        result.cut === 1 &&
        result.error?.code === "memory.over-budget",
    ).length,
    1,
  );
  assert.equal(
    results.find(
      (result) => result.arm === "narrative-memory" && result.cut === 2,
    ).memory,
    "carry-2",
  );
  assert.deepEqual(
    results
      .filter((result) => result.arm === "timeline")
      .map((result) => result.error?.code),
    ["evidence.not-visible", "event.delta-limit", "response.query"],
  );
  assert.ok(
    results
      .filter((result) => result.error)
      .every((result) => Array.from(result.error.message).length <= 480),
  );

  const score = await scoreModelInterfaceEval({
    cases: casesPath,
    results: resultsPath,
  });
  assert.deepEqual(score.coverage, {
    expected: 9,
    observed: 9,
    missing: 0,
    complete: true,
    repeats: 1,
  });
  assert.deepEqual(score.arms.direct.answerExactRate, {
    numerator: 2,
    denominator: 3,
    value: 2 / 3,
  });
  assert.deepEqual(score.arms.direct.unsupportedDefiniteRate, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
  });
});

test("runner rejects more than one adapter response", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-extra-output-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "extra-output-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeFile(
    configPath,
    `${JSON.stringify({
      schema: "covenant.timeline.model-eval.config.v1",
      id: "test-extra-output-run",
      benchmarkRevision: sourceRevision,
      adapter: { id: "extra-output-fixture", version: "1" },
      model: { provider: "test", id: "extra-output", revision: "1" },
      generation: {
        temperature: 0,
        seed: 1,
        maxOutputTokens: 4096,
        parameters: {},
      },
    })}\n`,
  );
  await writeFile(adapterPath, extraOutputAdapterSource);

  await runModelInterfaceEval({
    adapter: [process.execPath, adapterPath],
    arms: ["direct"],
    caseIds: ["bounds.deploy-window"],
    cases: casesPath,
    config: configPath,
    output: resultsPath,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });
  const results = await readJsonLines(resultsPath);
  assert.deepEqual(
    results.map((result) => result.error?.code),
    Array(3).fill("adapter.unsolicited-output"),
  );
});

test("runner preserves structured adapter failures", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-adapter-error-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "error-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeConfig(configPath, "error-envelope");
  await writeFile(
    adapterPath,
    String.raw`
import { createInterface } from "node:readline";

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    schema: "covenant.timeline.model-eval.adapter-error.v1",
    requestId: request.requestId,
    error: {
      code: "provider.http-429",
      message: "provider returned a rate limit response",
      scope: "observation",
    },
    usage: {
      inputTokens: 12,
      outputTokens: 0,
      costUsd: null,
    },
  }) + "\n");
});
`,
  );

  await runModelInterfaceEval({
    adapter: [process.execPath, adapterPath],
    arms: ["direct"],
    caseIds: ["bounds.deploy-window"],
    cases: casesPath,
    config: configPath,
    output: resultsPath,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });
  const results = await readJsonLines(resultsPath);
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.equal(result.status, "error");
    assert.deepEqual(result.error, {
      stage: "adapter",
      code: "provider.http-429",
      message: "provider returned a rate limit response",
    });
    assert.deepEqual(result.usage, {
      inputTokens: 12,
      outputTokens: 0,
      costUsd: null,
    });
    assert.equal(typeof result.responseText, "string");
    assert.equal(typeof result.responseDigest, "string");
  }
  const score = await scoreModelInterfaceEval({
    cases: casesPath,
    results: resultsPath,
  });
  assert.deepEqual(score.arms.direct.answerExactRate, {
    numerator: 0,
    denominator: 3,
    value: 0,
  });

  const runScopedPath = join(
    temporaryDirectory,
    "run-scoped-error-results.jsonl",
  );
  const runScoped = await readJsonLines(resultsPath);
  for (const result of runScoped) {
    const response = JSON.parse(result.responseText);
    response.error.scope = "run";
    result.responseText = canonicalJson(response);
    result.responseDigest = digestText(result.responseText);
  }
  await writeResults(runScopedPath, runScoped);
  await assert.rejects(
    scoreModelInterfaceEval({
      cases: casesPath,
      results: runScopedPath,
    }),
    /stored adapter error must be observation-scoped/,
  );
});

test("runner aborts on run-scoped adapter failures", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-run-error-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "run-error-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeConfig(configPath, "run-error-envelope");
  await writeFile(
    adapterPath,
    String.raw`
import { createInterface } from "node:readline";

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    schema: "covenant.timeline.model-eval.adapter-error.v1",
    requestId: request.requestId,
    error: {
      code: "adapter.credentials",
      message: "adapter credentials are unavailable",
      scope: "run",
    },
  }) + "\n");
});
`,
  );

  await assert.rejects(
    runModelInterfaceEval({
      adapter: [process.execPath, adapterPath],
      arms: ["direct"],
      caseIds: ["bounds.deploy-window"],
      cases: casesPath,
      config: configPath,
      output: resultsPath,
      overwrite: false,
      repeats: 1,
      timeoutMs: 5_000,
    }),
    /adapter credentials are unavailable/,
  );
  await assert.rejects(readFile(resultsPath, "utf8"), { code: "ENOENT" });
});

test("runner aborts on adapter start failures", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-start-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeConfig(configPath, "missing-adapter");

  await assert.rejects(
    runModelInterfaceEval({
      adapter: [join(temporaryDirectory, "does-not-exist")],
      arms: ["direct"],
      caseIds: ["bounds.deploy-window"],
      cases: casesPath,
      config: configPath,
      output: resultsPath,
      overwrite: false,
      repeats: 1,
      timeoutMs: 1_000,
    }),
    /adapter process could not start/,
  );
  await assert.rejects(readFile(resultsPath, "utf8"), { code: "ENOENT" });
});

test("runner rejects completed output when runtime files change", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-runtime-change-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "changing-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeConfig(configPath, "changing-adapter");
  await writeFile(
    adapterPath,
    String.raw`
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  const request = JSON.parse(line);
  appendFileSync(fileURLToPath(import.meta.url), "\n// changed");
  process.stdout.write(JSON.stringify({
    schema: "covenant.timeline.model-eval.adapter-error.v1",
    requestId: request.requestId,
    error: {
      code: "provider.http-429",
      message: "provider returned a rate limit response",
      scope: "observation",
    },
  }) + "\n");
});
`,
  );

  await assert.rejects(
    runModelInterfaceEval({
      adapter: [process.execPath, adapterPath],
      arms: ["direct"],
      caseIds: ["bounds.deploy-window"],
      cases: casesPath,
      config: configPath,
      output: resultsPath,
      overwrite: false,
      repeats: 1,
      timeoutMs: 5_000,
    }),
    /benchmark runtime files changed during the run/,
  );
  await assert.rejects(readFile(resultsPath, "utf8"), { code: "ENOENT" });

  const partials = (await readdir(temporaryDirectory)).filter((name) =>
    name.endsWith(".partial"),
  );
  assert.deepEqual(partials, []);
});

test("runner retains validated output when atomic publication fails", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-publish-failure-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "occupying-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeConfig(configPath, "occupying-adapter");
  await writeFile(
    adapterPath,
    String.raw`
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  const request = JSON.parse(line);
  try {
    writeFileSync(new URL("./results.jsonl", import.meta.url), "occupied", {
      flag: "wx",
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  process.stdout.write(JSON.stringify({
    schema: "covenant.timeline.model-eval.adapter-error.v1",
    requestId: request.requestId,
    error: {
      code: "provider.http-429",
      message: "provider returned a rate limit response",
      scope: "observation",
    },
  }) + "\n");
});
`,
  );

  await assert.rejects(
    runModelInterfaceEval({
      adapter: [process.execPath, adapterPath],
      arms: ["direct"],
      caseIds: ["bounds.deploy-window"],
      cases: casesPath,
      config: configPath,
      output: resultsPath,
      overwrite: false,
      repeats: 1,
      timeoutMs: 5_000,
    }),
    /validated artifact retained at /,
  );
  assert.equal(await readFile(resultsPath, "utf8"), "occupied");

  const partials = (await readdir(temporaryDirectory)).filter((name) =>
    name.endsWith(".partial"),
  );
  assert.equal(partials.length, 1);
  assert.equal(
    (await readFile(join(temporaryDirectory, partials[0]), "utf8"))
      .trim()
      .split("\n").length,
    3,
  );
});

test("runner terminates an oversized adapter response", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-oversized-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "oversized-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeConfig(configPath, "oversized-adapter");
  await writeFile(adapterPath, oversizedAdapterSource);

  await runModelInterfaceEval({
    adapter: [process.execPath, adapterPath],
    arms: ["direct"],
    caseIds: ["bounds.deploy-window"],
    cases: casesPath,
    config: configPath,
    output: resultsPath,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });
  const results = await readJsonLines(resultsPath);
  assert.deepEqual(
    results.map((result) => result.error?.code),
    Array(3).fill("response.too-large"),
  );
});

test("runner rejects invalid UTF-8 adapter output", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-eval-utf8-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "invalid-utf8-adapter.mjs");
  const configPath = join(temporaryDirectory, "run-config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeConfig(configPath, "invalid-utf8-adapter");
  await writeFile(adapterPath, invalidUtf8AdapterSource);

  await runModelInterfaceEval({
    adapter: [process.execPath, adapterPath],
    arms: ["narrative-memory"],
    caseIds: ["bounds.deploy-window"],
    cases: casesPath,
    config: configPath,
    output: resultsPath,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });
  const results = await readJsonLines(resultsPath);
  assert.deepEqual(
    results.map((result) => result.error?.code),
    Array(3).fill("response.invalid-utf8"),
  );
  assert.ok(results.every((result) => result.responseText === null));
});

async function writeConfig(path, fixture) {
  await writeFile(
    path,
    `${JSON.stringify({
      schema: "covenant.timeline.model-eval.config.v1",
      id: `test-${fixture}-run`,
      benchmarkRevision: sourceRevision,
      adapter: { id: fixture, version: "1" },
      model: { provider: "test", id: fixture, revision: "1" },
      generation: {
        temperature: 0,
        seed: 1,
        maxOutputTokens: 4096,
        parameters: {},
      },
    })}\n`,
  );
}

async function writeResults(path, results) {
  await writeFile(
    path,
    `${results.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

const goldAdapterSource = String.raw`
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const cases = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);
const byId = new Map(
  cases.map((testCase) => [testCase.contract.id, testCase]),
);
const assertionIds = new Map(
  cases.map((testCase) => [
    testCase.contract.id,
    new Map(
      testCase.cuts
        .flatMap((cut) => cut.goldEvents)
        .filter((event) => event.assertion)
        .map((event) => [
          event.assertion.id,
          "model-assertion-" + event.sequence,
        ]),
    ),
  ]),
);
const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  const request = JSON.parse(line);
  const testCase = byId.get(request.caseId);
  const cut = testCase.cuts[request.cut];
  const common = {
    schema: "covenant.timeline.model-eval.response.v1",
    requestId: request.requestId,
  };
  const ids = assertionIds.get(request.caseId);
  const events = cut.goldEvents.map((event) => {
    const renamed = {
      ...event,
      id: "model-event-" + event.sequence,
    };
    if (event.assertion) {
      renamed.assertion = {
        ...event.assertion,
        id: ids.get(event.assertion.id),
        ...(event.assertion.supersedes
          ? {
              supersedes: event.assertion.supersedes.map((id) => ids.get(id)),
            }
          : {}),
      };
    }
    if (event.type === "assertion.retracted") {
      renamed.assertionId = ids.get(event.assertionId);
    }
    return renamed;
  });
  const response =
    request.arm === "timeline"
      ? {
          ...common,
          events,
          query: { ...cut.goldQuery, id: "model-query-" + request.cut },
        }
      : request.arm === "narrative-memory"
        ? { ...common, answer: cut.expectedResult, memory: "" }
        : { ...common, answer: cut.expectedResult };
  process.stdout.write(JSON.stringify(response) + "\n");
});
`;

const failureAdapterSource = String.raw`
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const cases = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);
const byId = new Map(
  cases.map((testCase) => [testCase.contract.id, testCase]),
);
const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  const request = JSON.parse(line);
  const cut = byId.get(request.caseId).cuts[request.cut];
  const common = {
    schema: "covenant.timeline.model-eval.response.v1",
    requestId: request.requestId,
  };
  let response;
  if (request.arm === "direct") {
    response = {
      ...common,
      answer:
        request.cut === 0
          ? {
              type: "difference.bounds",
              status: "bounded",
              minimum: 0,
              maximum: 0,
            }
          : cut.expectedResult,
    };
  } else if (request.arm === "narrative-memory") {
    if (request.cut === 0) {
      response = { ...common, answer: cut.expectedResult, memory: "carry" };
    } else if (request.cut === 1) {
      response = {
        ...common,
        answer: cut.expectedResult,
        memory: "x".repeat(request.input.memoryBudgetBytes + 1),
      };
    } else {
      response = {
        ...common,
        answer: cut.expectedResult,
        memory: request.input.memory === "carry" ? "carry-2" : "lost-state",
      };
    }
  } else {
    if (request.cut === 0) {
      const events = cut.goldEvents.map((event) => ({
        ...event,
        assertion: event.assertion
          ? {
              ...event.assertion,
              evidenceRefs: ["sha256:" + "f".repeat(64)],
            }
          : event.assertion,
      }));
      response = { ...common, events, query: cut.goldQuery };
    } else if (request.cut === 1) {
      const base = cut.goldEvents[0];
      const start = request.input.priorRun.events.length;
      const evidenceRef = request.input.evidence[0].digest;
      const events = Array.from({ length: 40 }, (_, index) => ({
        ...base,
        id: "oversized-event-" + index,
        sequence: start + index,
        assertion: {
          ...base.assertion,
          id: "oversized-assertion-" + index,
          evidenceRefs: [evidenceRef],
        },
      }));
      response = { ...common, events, query: cut.goldQuery };
    } else {
      const query = { ...cut.goldQuery };
      for (let index = 0; index < 200; index += 1) {
        query["unexpected-" + index] = index;
      }
      response = { ...common, events: [], query };
    }
  }
  process.stdout.write(JSON.stringify(response) + "\n");
});
`;

const equivalentAdapterSource = String.raw`
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const cases = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);
const byId = new Map(
  cases.map((testCase) => [testCase.contract.id, testCase]),
);
const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  const request = JSON.parse(line);
  const cut = byId.get(request.caseId).cuts[request.cut];
  const start = request.input.priorRun.events.length;
  let events;
  if (request.cut === 0) {
    const [combined, end] = cut.goldEvents;
    const common = {
      ...combined,
      assertion: {
        ...combined.assertion,
      },
    };
    events = [
      {
        ...common,
        id: "split-minimum",
        sequence: start,
        assertion: {
          ...common.assertion,
          id: "split-minimum",
          coordinate: { minimum: common.assertion.coordinate.minimum },
        },
      },
      {
        ...common,
        id: "split-maximum",
        sequence: start + 1,
        assertion: {
          ...common.assertion,
          id: "split-maximum",
          coordinate: { maximum: common.assertion.coordinate.maximum },
        },
      },
      {
        ...end,
        id: "model-end-maximum",
        sequence: start + 2,
        assertion: { ...end.assertion, id: "model-end-maximum" },
      },
    ];
  } else {
    events = cut.goldEvents.map((event, index) => ({
      ...event,
      id: "model-event-" + request.cut + "-" + index,
      sequence: start + index,
      assertion: event.assertion
        ? {
            ...event.assertion,
            id: "model-assertion-" + request.cut + "-" + index,
          }
        : event.assertion,
    }));
  }
  const recordedThrough =
    start + events.length === 0 ? null : start + events.length - 1;
  const response = {
    schema: "covenant.timeline.model-eval.response.v1",
    requestId: request.requestId,
    events,
    query: {
      ...cut.goldQuery,
      id: "model-query-" + request.cut,
      recordedThrough,
    },
  };
  process.stdout.write(JSON.stringify(response) + "\n");
});
`;

const extraOutputAdapterSource = String.raw`
import { createInterface } from "node:readline";

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});
input.on("line", (line) => {
  const request = JSON.parse(line);
  const response = JSON.stringify({
    schema: "covenant.timeline.model-eval.response.v1",
    requestId: request.requestId,
    answer: { type: "context.consistency", status: "consistent" },
  });
  process.stdout.write(response + "\n" + response + "\n");
});
`;

const emptyAdapterSource = String.raw`
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const cases = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);
const byId = new Map(
  cases.map((testCase) => [testCase.contract.id, testCase]),
);
const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  const request = JSON.parse(line);
  const cut = byId.get(request.caseId).cuts[request.cut];
  const response = {
    schema: "covenant.timeline.model-eval.response.v1",
    requestId: request.requestId,
    events: [],
    query: {
      ...cut.goldQuery,
      id: "empty-query-" + request.cut,
      recordedThrough: request.input.priorRun.events.length - 1,
    },
  };
  process.stdout.write(JSON.stringify(response) + "\n");
});
`;

const oversizedAdapterSource = String.raw`
import { createInterface } from "node:readline";

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});
input.on("line", () => {
  process.stdout.write("x".repeat(300 * 1024));
  setInterval(() => process.stdout.write("x".repeat(64 * 1024)), 1);
});
`;

const invalidUtf8AdapterSource = String.raw`
import { createInterface } from "node:readline";

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});
input.on("line", () => {
  process.stdout.write(Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x7d, 0x0a]));
});
`;

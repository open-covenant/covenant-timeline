import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../packages/prototype/dist/index.js";
import { diagnoseModelInterfaceEval } from "./diagnose-model-interface-eval.mjs";
import {
  createModelEvalValidators,
  readJsonLines,
} from "./model-interface-eval.mjs";
import { runModelInterfaceEval } from "./run-model-interface-eval.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const casesPath = join(root, "benchmarks/model-interface/v1/cases.jsonl");
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();

test("trajectory diagnostics distinguish rolling history from direct observations", async (t) => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-model-diagnostics-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const adapterPath = join(temporaryDirectory, "diagnostic-adapter.mjs");
  const configPath = join(temporaryDirectory, "config.json");
  const resultsPath = join(temporaryDirectory, "results.jsonl");
  await writeFile(adapterPath, diagnosticAdapterSource);
  await writeFile(
    configPath,
    `${canonicalJson({
      schema: "covenant.timeline.model-eval.config.v1",
      id: "trajectory-diagnostics",
      benchmarkRevision: sourceRevision,
      adapter: { id: "diagnostic-fixture", version: "1" },
      model: { provider: "test", id: "diagnostic", revision: "1" },
      generation: {
        temperature: 0,
        seed: 1,
        maxOutputTokens: 4096,
        parameters: {},
      },
    })}\n`,
  );

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
  const diagnostics = await diagnoseModelInterfaceEval({
    cases: casesPath,
    results: resultsPath,
  });

  assert.deepEqual(diagnostics.coverage, {
    expected: 9,
    observed: 9,
    missing: 0,
    complete: true,
    repeats: 1,
  });
  assert.deepEqual(diagnostics.summary, {
    trajectoryCount: 5,
    trajectoriesWithRecordedError: 3,
    recordedObservationCount: 9,
    errorObservationCount: 5,
    observationsAfterFirstRecordedErrorCount: 4,
    priorProjectedState: { exact: 1, degraded: 2, total: 3 },
    admittedWithError: {
      total: 3,
      stages: { query: 3 },
      codes: { "query.rejected": 3 },
    },
  });

  const direct = diagnostics.trajectories.filter(({ arm }) => arm === "direct");
  assert.equal(direct.length, 3);
  assert.ok(direct.every(({ scope }) => scope === "independent"));
  assert.ok(
    direct.every(
      ({ observationsAfterFirstRecordedError }) =>
        observationsAfterFirstRecordedError.length === 0,
    ),
  );
  assert.deepEqual(direct[0].firstRecordedError, {
    cut: 0,
    stage: "adapter",
    code: "provider.fixture",
  });
  assert.equal(direct[1].firstRecordedError, null);

  const narrative = diagnostics.trajectories.find(
    ({ arm }) => arm === "narrative-memory",
  );
  assert.equal(narrative.scope, "rolling");
  assert.deepEqual(narrative.firstRecordedError, {
    cut: 0,
    stage: "adapter",
    code: "provider.fixture",
  });
  assert.deepEqual(narrative.observationsAfterFirstRecordedError, [1, 2]);
  assert.ok(
    narrative.observations
      .slice(1)
      .every(({ afterFirstRecordedError }) => afterFirstRecordedError),
  );
  assert.equal(narrative.priorProjectedState, null);

  const timeline = diagnostics.trajectories.find(
    ({ arm }) => arm === "timeline",
  );
  assert.deepEqual(timeline.firstRecordedError, {
    cut: 0,
    stage: "query",
    code: "query.rejected",
  });
  assert.deepEqual(timeline.observationsAfterFirstRecordedError, [1, 2]);
  assert.deepEqual(
    timeline.observations.map(({ priorProjectedState }) => priorProjectedState),
    ["exact", "degraded", "degraded"],
  );
  assert.deepEqual(timeline.priorProjectedState, {
    exact: 1,
    degraded: 2,
    total: 3,
  });

  const validators = await createModelEvalValidators();
  assert.equal(validators.diagnostics(diagnostics), true);
  const unclosed = structuredClone(diagnostics);
  unclosed.summary.unexpected = 1;
  assert.equal(validators.diagnostics(unclosed), false);

  const cliOutput = execFileSync(
    process.execPath,
    [
      join(root, "scripts/diagnose-model-interface-eval.mjs"),
      "--cases",
      casesPath,
      "--results",
      resultsPath,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(cliOutput, `${canonicalJson(diagnostics)}\n`);

  const tamperedPath = join(temporaryDirectory, "tampered.jsonl");
  const results = await readJsonLines(resultsPath);
  const incompletePath = join(temporaryDirectory, "incomplete.jsonl");
  const incomplete = results.filter(
    (result) => !(result.arm === "direct" && result.cut === 1),
  );
  await writeFile(
    incompletePath,
    `${incomplete.map((record) => canonicalJson(record)).join("\n")}\n`,
  );
  const incompleteDiagnostics = await diagnoseModelInterfaceEval({
    cases: casesPath,
    results: incompletePath,
  });
  assert.deepEqual(incompleteDiagnostics.coverage, {
    expected: 9,
    observed: 8,
    missing: 1,
    complete: false,
    repeats: 1,
  });
  assert.equal(incompleteDiagnostics.summary.recordedObservationCount, 8);
  assert.deepEqual(
    incompleteDiagnostics.trajectories.find(
      ({ arm, cuts }) => arm === "direct" && cuts[0] === 1,
    ),
    {
      arm: "direct",
      caseId: "bounds.deploy-window",
      family: "bounded-indeterminate",
      repeat: 0,
      scope: "independent",
      cuts: [1],
      expectedObservationCount: 1,
      recordedObservationCount: 0,
      firstRecordedError: null,
      observations: [],
      observationsAfterFirstRecordedError: [],
      priorProjectedState: null,
      admittedWithError: { total: 0, stages: {}, codes: {} },
    },
  );

  const tampered = structuredClone(results);
  tampered[0].requestDigest = `sha256:${"0".repeat(64)}`;
  await writeFile(
    tamperedPath,
    `${tampered.map((record) => canonicalJson(record)).join("\n")}\n`,
  );
  await assert.rejects(
    diagnoseModelInterfaceEval({
      cases: casesPath,
      results: tamperedPath,
    }),
    /requestDigest does not match requestText/,
  );
});

const diagnosticAdapterSource = String.raw`
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
  if (request.arm !== "timeline" && request.cut === 0) {
    response = {
      schema: "covenant.timeline.model-eval.adapter-error.v1",
      requestId: request.requestId,
      error: {
        code: "provider.fixture",
        message: "fixture observation error",
        scope: "observation",
      },
    };
  } else if (request.arm === "direct") {
    response = { ...common, answer: cut.expectedResult };
  } else if (request.arm === "narrative-memory") {
    response = {
      ...common,
      answer: cut.expectedResult,
      memory: "memory-" + request.cut,
    };
  } else {
    response = {
      ...common,
      events: [],
      query: {
        ...cut.goldQuery,
        id: "invalid-query-" + request.cut,
        fromPointId: "missing-point",
      },
    };
  }
  process.stdout.write(JSON.stringify(response) + "\n");
});
`;

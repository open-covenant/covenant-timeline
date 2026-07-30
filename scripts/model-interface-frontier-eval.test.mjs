import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createModelEvalValidators,
  loadBenchmarkCases,
  readJsonLines,
  validateAdapterResponse,
} from "./model-interface-eval.mjs";
import {
  assertFrozenPrimary,
  assertFrozenTeacher,
  createGate,
  evaluateModelInterfaceGate,
} from "./evaluate-model-interface-gate.mjs";
import { materializeHeldoutCases } from "./materialize-model-interface-heldout.mjs";
import { runModelInterfaceEval } from "./run-model-interface-eval.mjs";
import {
  exactSignFlipP,
  scoreModelInterfaceEval,
  scoreModelInterfaceEvalArtifacts,
} from "./score-model-interface-eval.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const casesPath = join(root, "benchmarks/model-interface/v1/cases.jsonl");
const heldoutPath = join(
  root,
  "benchmarks/model-interface/v1/heldout-cases.jsonl",
);
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();

test("held-out paraphrases materialize deterministically and preserve gold semantics", async () => {
  const [expected, materialized, baseCases, heldoutCases] = await Promise.all([
    readFile(heldoutPath),
    materializeHeldoutCases({}),
    loadBenchmarkCases(casesPath),
    loadBenchmarkCases(heldoutPath),
  ]);
  assert.deepEqual(materialized, expected);
  assert.equal(heldoutCases.length, baseCases.length);

  for (let caseIndex = 0; caseIndex < baseCases.length; caseIndex += 1) {
    const base = baseCases[caseIndex];
    const heldout = heldoutCases[caseIndex];
    assert.equal(heldout.id, `${base.id}.paraphrase`);
    assert.deepEqual(
      heldout.cuts.map(({ expectedResult }) => expectedResult),
      base.cuts.map(({ expectedResult }) => expectedResult),
    );
    assert.ok(
      heldout.evidence.every(
        ({ text }, index) => text !== base.evidence[index].text,
      ),
    );
    assert.ok(
      heldout.cuts.every(
        ({ question }, index) => question !== base.cuts[index].question,
      ),
    );
  }
});

test("stateless structured extraction is scored against the complete visible record", async (t) => {
  const fixture = await createFixture(t);
  const results = join(fixture.directory, "structured.jsonl");
  await runModelInterfaceEval({
    adapter: [process.execPath, fixture.adapter, heldoutPath],
    arms: ["structured-extraction"],
    caseIds: ["bounds.deploy-window.paraphrase"],
    cases: heldoutPath,
    config: fixture.config,
    output: results,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });

  const records = await readJsonLines(results);
  assert.deepEqual(
    records.map(({ status }) => status),
    ["ok", "ok", "ok"],
  );
  assert.deepEqual(
    records.map((record) => {
      const request = JSON.parse(record.requestText);
      return {
        evidence: request.input.evidence.length,
        events: record.proposedEvents.length,
      };
    }),
    [
      { evidence: 1, events: 1 },
      { evidence: 2, events: 2 },
      { evidence: 3, events: 3 },
    ],
  );

  const score = await scoreModelInterfaceEval({
    results,
    cases: heldoutPath,
  });
  assert.equal(
    score.arms["structured-extraction"].representationExactAssertionF1,
    1,
  );
  assert.equal(score.arms["structured-extraction"].endToEndExactRate.value, 1);
});

test("teacher-forced Timeline cuts never inherit an earlier model failure", async (t) => {
  const fixture = await createFixture(t);
  const results = join(fixture.directory, "teacher.jsonl");
  await runModelInterfaceEval({
    adapter: [process.execPath, fixture.adapter, heldoutPath, "--fail-first"],
    arms: ["timeline"],
    caseIds: ["bounds.deploy-window.paraphrase"],
    cases: heldoutPath,
    config: fixture.config,
    output: results,
    overwrite: false,
    priorStateMode: "teacher-forced",
    repeats: 1,
    timeoutMs: 5_000,
  });

  const records = await readJsonLines(results);
  assert.deepEqual(
    records.map(({ status }) => status),
    ["error", "ok", "ok"],
  );
  assert.equal(records[0].run.selection.priorStateMode, "teacher-forced");

  const cases = await loadBenchmarkCases(heldoutPath);
  const testCase = cases.find(
    ({ id }) => id === "bounds.deploy-window.paraphrase",
  );
  const cutOneRequest = JSON.parse(records[1].requestText);
  const cutTwoRequest = JSON.parse(records[2].requestText);
  assert.deepEqual(cutOneRequest.input.priorRun.events, [
    ...testCase.setupEvents,
    ...testCase.cuts[0].goldEvents,
  ]);
  assert.deepEqual(cutTwoRequest.input.priorRun.events, [
    ...testCase.setupEvents,
    ...testCase.cuts[0].goldEvents,
    ...testCase.cuts[1].goldEvents,
  ]);

  const score = await scoreModelInterfaceEval({
    results,
    cases: heldoutPath,
  });
  assert.equal(score.arms.timeline.endToEndExactRate.numerator, 2);
  assert.equal(score.arms.timeline.endToEndExactRate.denominator, 3);
  assert.equal(score.diagnosticOnly, true);
  assert.equal(score.teacherForcedPriorCuts.endToEndExactRate.numerator, 2);
  assert.equal(score.teacherForcedPriorCuts.endToEndExactRate.denominator, 2);
});

test("teacher forcing rejects baseline arms", async () => {
  await assert.rejects(
    runModelInterfaceEval({
      adapter: ["unused"],
      arms: ["narrative-memory"],
      caseIds: [],
      config: "unused.json",
      output: "unused.jsonl",
      overwrite: false,
      priorStateMode: "teacher-forced",
      repeats: 1,
      timeoutMs: 1,
    }),
    /teacher-forced mode may run only the Timeline arm/u,
  );
});

test("structured extraction rejects malformed event and query output", async () => {
  const validators = await createModelEvalValidators();
  assert.throws(
    () =>
      validateAdapterResponse(
        {
          schema: "covenant.timeline.model-eval.response.v1",
          requestId: "request-1",
          events: "not-an-array",
          query: null,
        },
        { arm: "structured-extraction", requestId: "request-1" },
        validators,
      ),
    /response\.events/u,
  );
});

test("structured extraction rejects histories that put future evidence first", async (t) => {
  const fixture = await createFixture(t);
  const results = join(fixture.directory, "misordered.jsonl");
  await runModelInterfaceEval({
    adapter: [
      process.execPath,
      fixture.adapter,
      heldoutPath,
      "--misorder-history",
    ],
    arms: ["structured-extraction"],
    caseIds: ["history.delayed-outage.paraphrase"],
    cases: heldoutPath,
    config: fixture.config,
    output: results,
    overwrite: false,
    repeats: 1,
    timeoutMs: 5_000,
  });

  const records = await readJsonLines(results);
  assert.equal(records[2].status, "error");
  assert.equal(records[2].error.stage, "admission");
  assert.equal(records[2].error.code, "event.evidence-order");
  const score = await scoreModelInterfaceEval({
    results,
    cases: heldoutPath,
  });
  assert.equal(
    score.arms["structured-extraction"].endToEndExactRate.numerator,
    2,
  );
});

test("the complete frozen selection rehearses continue, kill, and inconclusive decisions", async (t) => {
  const fixture = await createFixture(t);
  const primaryPath = join(fixture.directory, "primary.jsonl");
  const teacherPath = join(fixture.directory, "teacher-full.jsonl");
  await runModelInterfaceEval({
    adapter: [
      process.execPath,
      fixture.adapter,
      heldoutPath,
      "--fail-baselines",
    ],
    arms: ["narrative-memory", "structured-extraction", "timeline"],
    caseIds: [],
    cases: heldoutPath,
    config: fixture.config,
    output: primaryPath,
    overwrite: false,
    repeats: 3,
    timeoutMs: 120_000,
  });
  await runModelInterfaceEval({
    adapter: [process.execPath, fixture.adapter, heldoutPath],
    arms: ["timeline"],
    caseIds: [],
    cases: heldoutPath,
    config: fixture.config,
    output: teacherPath,
    overwrite: false,
    priorStateMode: "teacher-forced",
    repeats: 3,
    timeoutMs: 120_000,
  });

  const [primaryArtifact, teacherArtifact] = await Promise.all([
    scoreModelInterfaceEvalArtifacts({
      results: primaryPath,
      cases: heldoutPath,
    }),
    scoreModelInterfaceEvalArtifacts({
      results: teacherPath,
      cases: heldoutPath,
    }),
  ]);
  assert.equal(primaryArtifact.score.coverage.observed, 324);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(
        Object.groupBy(primaryArtifact.results, ({ arm }) => arm),
      ).map(([arm, records]) => [arm, records.length]),
    ),
    {
      "narrative-memory": 108,
      "structured-extraction": 108,
      timeline: 108,
    },
  );
  assert.equal(teacherArtifact.score.coverage.observed, 108);
  assert.equal(
    teacherArtifact.score.teacherForcedPriorCuts.endToEndExactRate.denominator,
    72,
  );
  assert.equal(
    teacherArtifact.score.teacherForcedPriorCuts
      .representationExactAssertionRecall.denominator,
    72,
  );

  const runtimeDigest = `sha256:${"a".repeat(64)}`;
  const primaryScore = freezeScore(primaryArtifact.score, runtimeDigest);
  const teacherScore = freezeScore(teacherArtifact.score, runtimeDigest);
  const source = {
    dirty: false,
    revision: primaryScore.run.sourceRevision,
    stateDigest: primaryScore.run.sourceStateDigest,
  };
  assert.doesNotThrow(() =>
    assertFrozenPrimary(
      primaryScore,
      primaryArtifact.cases,
      source,
      runtimeDigest,
    ),
  );
  assert.doesNotThrow(() =>
    assertFrozenTeacher(
      teacherScore,
      primaryScore,
      primaryArtifact.cases,
      source,
      runtimeDigest,
    ),
  );

  const passing = await createGate({
    score: primaryScore,
    teacherScore,
    results: primaryArtifact.results,
    teacherResults: teacherArtifact.results,
  });
  assert.equal(passing.decision, "continue");
  assert.equal(passing.failedChecks.length, 0);
  assert.equal(passing.teacherDiagnostic.priorCutObservations, 72);

  const noAdvantage = structuredClone(primaryScore);
  for (const comparison of [
    noAdvantage.paired.timelineVsNarrativeMemory,
    noAdvantage.paired.timelineVsStructuredExtraction,
  ]) {
    comparison.win = 0;
    comparison.loss = 0;
    comparison.tie = 108;
    comparison.bothCorrect = 108;
    comparison.bothIncorrect = 0;
    comparison.answerExactDifference = 0;
    comparison.caseClusterSignFlipP = 1;
  }
  const killed = await createGate({
    score: noAdvantage,
    teacherScore,
    results: primaryArtifact.results,
    teacherResults: teacherArtifact.results,
  });
  assert.equal(killed.decision, "kill");
  assert.ok(
    killed.failedChecks.includes("timeline.vs-narrative-memory.difference"),
  );

  const belowF1 = structuredClone(primaryScore);
  belowF1.arms.timeline.representationExactAssertionF1 = 0.919;
  const absoluteFailure = await createGate({
    score: belowF1,
    teacherScore,
    results: primaryArtifact.results,
    teacherResults: teacherArtifact.results,
  });
  assert.equal(absoluteFailure.decision, "kill");
  assert.ok(absoluteFailure.failedChecks.includes("timeline.assertion-f1"));

  const degradedTeacher = structuredClone(teacherScore);
  degradedTeacher.teacherForcedPriorCuts.representationExactAssertionF1 = 0;
  degradedTeacher.teacherForcedPriorCuts.answerExactRate.value = 0;
  degradedTeacher.teacherForcedPriorCuts.endToEndExactRate.value = 0;
  const diagnosticOnly = await createGate({
    score: primaryScore,
    teacherScore: degradedTeacher,
    results: primaryArtifact.results,
    teacherResults: teacherArtifact.results,
  });
  assert.equal(diagnosticOnly.decision, "continue");
  assert.equal(diagnosticOnly.teacherDiagnostic.assertionF1, 0);

  const operationalResults = structuredClone(primaryArtifact.results);
  const failedBaseline = operationalResults.find(
    ({ arm }) => arm === "narrative-memory",
  );
  failedBaseline.error.code = "provider.http-429";
  const inconclusive = await createGate({
    score: primaryScore,
    teacherScore,
    results: operationalResults,
    teacherResults: teacherArtifact.results,
  });
  assert.equal(inconclusive.decision, "inconclusive");
  assert.deepEqual(inconclusive.operationalErrorCodes, ["provider.http-429"]);

  const changedCorpus = structuredClone(primaryScore);
  changedCorpus.corpusDigest = `sha256:${"b".repeat(64)}`;
  assert.throws(
    () =>
      assertFrozenPrimary(
        changedCorpus,
        primaryArtifact.cases,
        source,
        runtimeDigest,
      ),
    /frozen held-out corpus/u,
  );
  assert.throws(
    () =>
      assertFrozenPrimary(
        primaryScore,
        primaryArtifact.cases,
        source,
        `sha256:${"c".repeat(64)}`,
      ),
    /frozen OpenAI adapter runtime/u,
  );
  const changedPrompt = structuredClone(primaryScore);
  changedPrompt.run.promptDigests.timeline = `sha256:${"d".repeat(64)}`;
  assert.throws(
    () =>
      assertFrozenPrimary(
        changedPrompt,
        primaryArtifact.cases,
        source,
        runtimeDigest,
      ),
    /frozen held-out corpus/u,
  );
  const changedModel = structuredClone(primaryScore);
  changedModel.run.config.model.id = "different-model";
  assert.throws(
    () =>
      assertFrozenPrimary(
        changedModel,
        primaryArtifact.cases,
        source,
        runtimeDigest,
      ),
    /model configuration/u,
  );
  assert.throws(
    () =>
      assertFrozenPrimary(
        primaryScore,
        primaryArtifact.cases,
        { ...source, revision: "different-revision" },
        runtimeDigest,
      ),
    /does not match the benchmark source revision/u,
  );

  const spliced = structuredClone(primaryArtifact.results);
  spliced[0].run.attemptId = "different-attempt";
  const splicedPath = join(fixture.directory, "spliced.jsonl");
  await writeFile(
    splicedPath,
    `${spliced.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  await assert.rejects(
    scoreModelInterfaceEval({
      results: splicedPath,
      cases: heldoutPath,
    }),
    /multiple run records/u,
  );
});

test("the formal gate requires the teacher artifact", async () => {
  await assert.rejects(
    evaluateModelInterfaceGate({ results: "unused.jsonl" }),
    /--teacher-results is required/u,
  );
});

test("the comparative test enumerates case-cluster sign assignments exactly", () => {
  assert.equal(exactSignFlipP(Array(12).fill(1)), 1 / 4096);
  assert.equal(exactSignFlipP(Array(12).fill(0)), 1);
  assert.equal(exactSignFlipP([]), null);
});

async function createFixture(t) {
  const directory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-frontier-eval-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const adapter = join(directory, "gold-adapter.mjs");
  const config = join(directory, "config.json");
  await writeFile(adapter, goldAdapterSource);
  await writeFile(
    config,
    `${JSON.stringify({
      schema: "covenant.timeline.model-eval.config.v1",
      id: "frontier-eval-fixture",
      benchmarkRevision: sourceRevision,
      adapter: { id: "openai-responses", version: "1" },
      model: {
        provider: "openai",
        id: "gpt-5.6-sol",
        revision: "gpt-5.6-sol",
      },
      generation: {
        temperature: 0,
        seed: null,
        maxOutputTokens: 16384,
        parameters: {
          reasoningEffort: "high",
          structuredOutput: true,
          verbosity: "low",
        },
      },
    })}\n`,
  );
  return { adapter, config, directory };
}

function freezeScore(score, runtimeDigest) {
  const frozen = structuredClone(score);
  frozen.run.sourceDirty = false;
  frozen.run.runtimeDigest = runtimeDigest;
  return frozen;
}

const goldAdapterSource = String.raw`
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const cases = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);
const byId = new Map(cases.map((testCase) => [testCase.contract.id, testCase]));
const failFirst = process.argv.includes("--fail-first");
const failBaselines = process.argv.includes("--fail-baselines");
const misorderHistory = process.argv.includes("--misorder-history");
const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  const request = JSON.parse(line);
  const testCase = byId.get(request.caseId);
  const cut = testCase.cuts[request.cut];
  if (failBaselines && request.arm !== "timeline") {
    process.stdout.write(JSON.stringify({
      schema: "covenant.timeline.model-eval.adapter-error.v1",
      requestId: request.requestId,
      error: {
        code: "model.fixture-baseline",
        message: "fixture baseline failure",
        scope: "observation",
      },
    }) + "\n");
    return;
  }
  if (failFirst && request.cut === 0) {
    process.stdout.write(JSON.stringify({
      schema: "covenant.timeline.model-eval.adapter-error.v1",
      requestId: request.requestId,
      error: {
        code: "model.fixture-failure",
        message: "fixture failure",
        scope: "observation",
      },
    }) + "\n");
    return;
  }
  let events =
    request.arm === "structured-extraction"
      ? testCase.cuts
          .slice(0, request.cut + 1)
          .flatMap(({ goldEvents }) => goldEvents)
      : cut.goldEvents;
  let query = cut.goldQuery;
  if (
    misorderHistory &&
    request.arm === "structured-extraction" &&
    testCase.id === "history.delayed-outage.paraphrase" &&
    request.cut === 2
  ) {
    events = [events[2], events[0], events[1]].map((event, index) => ({
      ...event,
      sequence: testCase.setupEvents.length + index,
    }));
    query = {
      ...query,
      recordedThrough: testCase.setupEvents.length + 1,
    };
  }
  if (request.arm === "direct") {
    process.stdout.write(JSON.stringify({
      schema: "covenant.timeline.model-eval.response.v1",
      requestId: request.requestId,
      answer: cut.expectedResult,
    }) + "\n");
    return;
  }
  if (request.arm === "narrative-memory") {
    process.stdout.write(JSON.stringify({
      schema: "covenant.timeline.model-eval.response.v1",
      requestId: request.requestId,
      answer: cut.expectedResult,
      memory: "",
    }) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify({
    schema: "covenant.timeline.model-eval.response.v1",
    requestId: request.requestId,
    events,
    query,
  }) + "\n");
});
`;

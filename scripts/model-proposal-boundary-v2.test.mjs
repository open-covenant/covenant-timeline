import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  assertGateConsistency,
  assertFrozenInputs,
  bindGateToAttemptLedger,
  completePreparedAttempt,
  createModelProposalBoundaryV2Gate,
  prepareModelProposalBoundaryV2Attempt,
  registerPreparedAttempt,
  resultPathDigest,
  scoreGrounding,
  writeModelProposalBoundaryV2Artifact,
} from "./evaluate-model-proposal-boundary-v2.mjs";
import { loadBenchmarkCasesArtifact } from "./model-interface-eval.mjs";
import { materializeModelProposalBoundaryV2 } from "./materialize-model-proposal-boundary-v2.mjs";
import { parseStrictJson } from "./strict-json.mjs";
import { runtimeStateDigest } from "./run-model-proposal-eval.mjs";
import { runModelProposalBoundaryV2Attempt } from "./run-model-proposal-boundary-v2.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const benchmarkDirectory = join(root, "benchmarks/model-proposal-boundary/v2");
const casesPath = join(benchmarkDirectory, "cases.jsonl");
const supportsPath = join(benchmarkDirectory, "acceptable-supports.json");
const gateSchemaPath = join(benchmarkDirectory, "gate.schema.json");
const ledgerSchemaPath = join(benchmarkDirectory, "attempt-ledger.schema.json");

test("v2 corpus materializes exactly and preserves valid gold trajectories", async () => {
  const [materialized, corpus, supports, artifact] = await Promise.all([
    materializeModelProposalBoundaryV2(),
    readFile(casesPath, "utf8"),
    readFile(supportsPath, "utf8"),
    loadBenchmarkCasesArtifact(casesPath, undefined, {
      multipleEvidence: true,
    }),
  ]);

  assert.equal(materialized.corpus, corpus);
  assert.equal(materialized.supports, supports);
  assert.equal(artifact.cases.length, 12);
  assert.equal(
    artifact.digest,
    "sha256:a0055e7b5aa701819a7ca422e6915cc9c622bb04ed2214b1cf8d2606152fdeb4",
  );
});

test("official adapter runtime binding is stable across checkout and Node paths", async (t) => {
  const movedRoot = await mkdtemp(join(tmpdir(), "proposal-v2-runtime-"));
  t.after(() => rm(movedRoot, { recursive: true, force: true }));
  await mkdir(join(movedRoot, "packages/prototype"), { recursive: true });
  await cp(
    join(root, "packages/prototype/dist"),
    join(movedRoot, "packages/prototype/dist"),
    { recursive: true },
  );
  await cp(join(root, "scripts"), join(movedRoot, "scripts"), {
    recursive: true,
  });

  const relative = await runtimeStateDigest([
    "node",
    "scripts/openai-responses-model-eval-adapter.mjs",
  ]);
  const absolute = await runtimeStateDigest([
    process.execPath,
    join(root, "scripts/openai-responses-model-eval-adapter.mjs"),
  ]);
  const movedNode = join(movedRoot, "bin/node");
  const moved = await runtimeStateDigest(
    [
      movedNode,
      join(movedRoot, "scripts/openai-responses-model-eval-adapter.mjs"),
    ],
    { repositoryRoot: movedRoot, nodeExecutable: movedNode },
  );
  assert.equal(relative, absolute);
  assert.equal(absolute, moved);
});

test("v2 evidence is noisy and every gold change has a unique accepted span", async () => {
  const [artifact, supports] = await Promise.all([
    loadBenchmarkCasesArtifact(casesPath, undefined, {
      multipleEvidence: true,
    }),
    readJson(supportsPath),
  ]);
  let constraints = 0;
  let corrections = 0;
  let retractions = 0;
  let contextTraps = 0;

  for (const testCase of artifact.cases) {
    for (const cut of testCase.cuts) {
      const evidence = testCase.evidence.filter(
        ({ cut: evidenceCut }) => evidenceCut === cut.index,
      );
      const accepted = supports.cases[testCase.id][cut.index];
      assert.equal(evidence.length, cut.goldEvents.length + 2);
      assert.equal(accepted.length, cut.goldEvents.length);
      assert.equal(
        evidence.every(({ id }) => /^record-[0-9a-f]{16}$/u.test(id)),
        true,
      );
      const acceptedIds = new Set(accepted.map(({ evidenceId }) => evidenceId));
      const distractors = evidence.filter(({ id }) => !acceptedIds.has(id));
      assert.equal(distractors.length, 2);
      assert.equal(
        distractors.every(
          ({ text }) =>
            !/\b(?:noise|test|non-temporal|distractor|sandbox)\b/iu.test(text),
        ),
        true,
      );
      for (const { evidenceId, quotes } of accepted) {
        const source = evidence.find(({ id }) => id === evidenceId)?.text;
        assert.ok(source);
        assert.equal(quotes.length, 1);
        assert.notEqual(quotes[0], source);
        assert.equal(source.indexOf(quotes[0]), source.lastIndexOf(quotes[0]));
      }
      for (const event of cut.goldEvents) {
        if (event.type === "constraint.asserted") constraints += 1;
        if (event.type === "assertion.retracted") retractions += 1;
        if (event.assertion?.supersedes?.length) corrections += 1;
      }
      if (cut.traits.includes("context-isolation")) contextTraps += 1;
    }
  }

  assert.equal(constraints, 2);
  assert.equal(retractions, 3);
  assert.equal(corrections, 5);
  assert.equal(contextTraps, 6);
});

test("grounding scores accepted spans and penalizes distractors and duplicates", async () => {
  const [artifact, supports] = await Promise.all([
    loadBenchmarkCasesArtifact(casesPath, undefined, {
      multipleEvidence: true,
    }),
    readJson(supportsPath),
  ]);
  const testCase = artifact.cases[0];
  const accepted = supports.cases[testCase.id][0];
  const [
    {
      change,
      evidenceId,
      quotes: [quote],
    },
  ] = accepted;
  const results = [
    resultWithChanges(testCase.id, 0, 0, [
      {
        ...change,
        supports: [
          { evidenceId, quote },
          { evidenceId, quote },
          {
            evidenceId: "record-0000000000000000",
            quote: "Delivery dashboard",
          },
        ],
      },
    ]),
  ];

  const score = scoreGrounding({
    cases: [testCase],
    results,
    supportDocument: supports,
    repeats: 1,
  });
  assert.deepEqual(score.overall, {
    accepted: 1,
    predicted: 3,
    expected: accepted.length,
    precision: 1 / 3,
    recall: 1 / accepted.length,
    f1: 0.5,
  });
});

test("grounding binds each support to the change it justifies", async () => {
  const [artifact, supports] = await Promise.all([
    loadBenchmarkCasesArtifact(casesPath, undefined, {
      multipleEvidence: true,
    }),
    readJson(supportsPath),
  ]);
  const testCase = artifact.cases.find(({ id }) =>
    Object.values(supports.cases[id]).some((cut) => cut.length > 1),
  );
  assert.ok(testCase);
  const cut = Object.values(supports.cases[testCase.id]).findIndex(
    (entries) => entries.length > 1,
  );
  const accepted = supports.cases[testCase.id][cut];
  const changes = accepted.map(({ change }, index) => {
    const other = accepted[(index + 1) % accepted.length];
    return {
      ...change,
      supports: [{ evidenceId: other.evidenceId, quote: other.quotes[0] }],
    };
  });

  const score = scoreGrounding({
    cases: [testCase],
    results: [resultWithChanges(testCase.id, 0, cut, changes)],
    supportDocument: supports,
    repeats: 1,
  });
  assert.deepEqual(score.overall, {
    accepted: 0,
    predicted: accepted.length,
    expected: accepted.length,
    precision: 0,
    recall: 0,
    f1: 0,
  });
});

test("v2 gate distinguishes reliability failure from provider infrastructure", async () => {
  const score = passingScore();
  const grounding = passingGrounding();
  const passing = createModelProposalBoundaryV2Gate({
    score,
    results: [],
    grounding,
  });
  assert.equal(passing.decision, "continue");
  assert.deepEqual(passing.failedChecks, []);

  const weakGrounding = structuredClone(grounding);
  weakGrounding.overall.f1 = 0.8;
  const killed = createModelProposalBoundaryV2Gate({
    score,
    results: [],
    grounding: weakGrounding,
  });
  assert.equal(killed.decision, "kill");
  assert.ok(killed.failedChecks.includes("support-f1"));

  const inconclusive = createModelProposalBoundaryV2Gate({
    score,
    results: [{ error: { code: "provider.http-429" } }],
    grounding: weakGrounding,
  });
  assert.equal(inconclusive.decision, "inconclusive");
  assert.deepEqual(inconclusive.operationalErrors, ["provider.http-429"]);
});

test("gate consistency rejects contradictory decisions and grounding totals", () => {
  const gate = createModelProposalBoundaryV2Gate({
    score: passingScore(),
    results: [],
    grounding: passingGrounding(),
  });
  assert.doesNotThrow(() => assertGateConsistency(gate));

  const contradictory = structuredClone(gate);
  contradictory.decision = "kill";
  assert.throws(
    () => assertGateConsistency(contradictory),
    /decision is inconsistent/u,
  );

  const falsePass = structuredClone(gate);
  falsePass.checks[0].actual = 0;
  assert.throws(
    () => assertGateConsistency(falsePass),
    /contradicts its requirement/u,
  );

  const falseAuthority = {
    ...gate,
    bindings: { ...gate.bindings, authoritative: false },
  };
  assert.throws(
    () => assertGateConsistency(falseAuthority),
    /authority is inconsistent/u,
  );

  const incorrectAggregate = structuredClone(gate);
  incorrectAggregate.grounding.overall.accepted -= 1;
  assert.throws(
    () => assertGateConsistency(incorrectAggregate),
    /grounding score is inconsistent|aggregate grounding counts/u,
  );
});

test("attempt ledger retains the first valid attempt and permits one infrastructure rerun", () => {
  const firstGate = createModelProposalBoundaryV2Gate({
    score: passingScore(),
    results: [{ error: { code: "provider.http-429" } }],
    grounding: passingGrounding(),
  });
  const firstPending = pendingAttempt(
    firstGate.bindings.attemptId,
    1,
    "2026-07-31T23:59:59.000Z",
  );
  let ledger = registerPreparedAttempt(baseLedger(firstGate), firstPending);
  ledger = claimForGate(ledger, firstGate);
  const first = completePreparedAttempt(ledger, firstGate);
  ledger = first.ledger;
  assert.equal(ledger.closed, false);
  assert.equal(ledger.authoritativeAttemptId, null);

  const secondScore = passingScore();
  secondScore.run.attemptId = "00000000-0000-4000-8000-000000000002";
  secondScore.run.startedAt = "2026-08-01T00:01:00.000Z";
  const secondGate = createModelProposalBoundaryV2Gate({
    score: secondScore,
    results: [],
    grounding: passingGrounding(),
  });
  ledger = registerPreparedAttempt(
    ledger,
    pendingAttempt(
      secondGate.bindings.attemptId,
      2,
      "2026-08-01T00:00:59.000Z",
    ),
  );
  ledger = claimForGate(ledger, secondGate);
  ledger = completePreparedAttempt(ledger, secondGate).ledger;
  assert.equal(ledger.closed, true);
  assert.equal(ledger.authoritativeAttemptId, secondGate.bindings.attemptId);
  assert.throws(
    () =>
      registerPreparedAttempt(
        ledger,
        pendingAttempt(
          "00000000-0000-4000-8000-000000000003",
          3,
          "2026-08-01T00:02:00.000Z",
        ),
      ),
    /cannot prepare/u,
  );
});

test("attempt ledger schema accepts pending, claimed, and completed states", async () => {
  const schema = await readJson(ledgerSchemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const gate = createModelProposalBoundaryV2Gate({
    score: passingScore(),
    results: [],
    grounding: passingGrounding(),
  });
  const pending = registerPreparedAttempt(
    baseLedger(gate),
    pendingAttempt(gate.bindings.attemptId, 1, "2026-07-31T23:59:59.000Z"),
  );
  assert.equal(validate(pending), true, JSON.stringify(validate.errors));
  const claimed = claimForGate(pending, gate);
  assert.equal(validate(claimed), true, JSON.stringify(validate.errors));
  const completed = completePreparedAttempt(claimed, gate).ledger;
  assert.equal(validate(completed), true, JSON.stringify(validate.errors));
});

test("formal v2 runner atomically claims one output before inference", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "proposal-v2-run-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ledgerPath = join(directory, "attempt-ledger.json");
  const output = join(directory, "results.jsonl");
  const gate = createModelProposalBoundaryV2Gate({
    score: passingScore(),
    results: [],
    grounding: passingGrounding(),
  });
  const ledger = registerPreparedAttempt(
    { ...baseLedger(gate), initializedAt: "2020-01-01T00:00:00.000Z" },
    pendingAttempt(gate.bindings.attemptId, 1, "2020-01-01T00:00:01.000Z"),
  );
  await writeFile(ledgerPath, `${JSON.stringify(ledger)}\n`, "utf8");

  let calls = 0;
  await runModelProposalBoundaryV2Attempt(
    formalRunOptions(ledgerPath, output),
    {
      run: async (options) => {
        calls += 1;
        assert.equal(options.attemptId, gate.bindings.attemptId);
        assert.equal(options.overwrite, false);
        assert.equal(options.output, output);
        assert.match(options.resultsArtifactId, UUID_V4);
        assert.equal(options.resultsPathDigest, await resultPathDigest(output));
        assert.equal(
          new Date(options.startedAt).toISOString(),
          options.startedAt,
        );
        return { completed: 108, output };
      },
    },
  );
  const retained = JSON.parse(await readFile(ledgerPath, "utf8"));
  assert.equal(retained.attempts[0].status, "claimed");
  assert.equal(
    retained.attempts[0].resultsPathDigest,
    await resultPathDigest(output),
  );
  assert.equal(calls, 1);

  await assert.rejects(
    runModelProposalBoundaryV2Attempt(
      formalRunOptions(ledgerPath, join(directory, "alternate.jsonl")),
      { run: async () => (calls += 1) },
    ),
    /no prepared attempt to claim/u,
  );
  assert.equal(calls, 1);
});

test("formal v2 runner does not claim an existing output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "proposal-v2-existing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ledgerPath = join(directory, "attempt-ledger.json");
  const output = join(directory, "results.jsonl");
  const gate = createModelProposalBoundaryV2Gate({
    score: passingScore(),
    results: [],
    grounding: passingGrounding(),
  });
  const ledger = registerPreparedAttempt(
    { ...baseLedger(gate), initializedAt: "2020-01-01T00:00:00.000Z" },
    pendingAttempt(gate.bindings.attemptId, 1, "2020-01-01T00:00:01.000Z"),
  );
  await writeFile(ledgerPath, `${JSON.stringify(ledger)}\n`, "utf8");
  await writeFile(output, "existing\n", "utf8");

  await assert.rejects(
    runModelProposalBoundaryV2Attempt(formalRunOptions(ledgerPath, output), {
      run: async () => assert.fail("overwrote existing output"),
    }),
    /artifact output already exists/u,
  );
  const retained = JSON.parse(await readFile(ledgerPath, "utf8"));
  assert.equal(retained.attempts[0].status, "pending");
  assert.equal(await readFile(output, "utf8"), "existing\n");
});

test("an interrupted claimed attempt fails closed and cannot be replayed", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "proposal-v2-interrupt-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ledgerPath = join(directory, "attempt-ledger.json");
  const output = join(directory, "results.jsonl");
  const gate = createModelProposalBoundaryV2Gate({
    score: passingScore(),
    results: [],
    grounding: passingGrounding(),
  });
  const ledger = registerPreparedAttempt(
    { ...baseLedger(gate), initializedAt: "2020-01-01T00:00:00.000Z" },
    pendingAttempt(gate.bindings.attemptId, 1, "2020-01-01T00:00:01.000Z"),
  );
  await writeFile(ledgerPath, `${JSON.stringify(ledger)}\n`, "utf8");

  await assert.rejects(
    runModelProposalBoundaryV2Attempt(formalRunOptions(ledgerPath, output), {
      run: async () => {
        throw new Error("interrupted");
      },
    }),
    /interrupted/u,
  );
  const retained = JSON.parse(await readFile(ledgerPath, "utf8"));
  assert.equal(retained.attempts[0].status, "claimed");
  await assert.rejects(
    prepareModelProposalBoundaryV2Attempt({ ledger: ledgerPath }),
    /cannot prepare another attempt/u,
  );
  await assert.rejects(
    runModelProposalBoundaryV2Attempt(formalRunOptions(ledgerPath, output), {
      run: async () => assert.fail("replayed claimed attempt"),
    }),
    /no prepared attempt to claim/u,
  );
});

test("completion rejects an artifact that differs from the claimed output", () => {
  const gate = createModelProposalBoundaryV2Gate({
    score: passingScore(),
    results: [],
    grounding: passingGrounding(),
  });
  const pending = registerPreparedAttempt(
    baseLedger(gate),
    pendingAttempt(gate.bindings.attemptId, 1, "2026-07-31T23:59:59.000Z"),
  );
  const claimed = claimForGate(pending, gate);
  for (const field of ["startedAt", "resultsArtifactId", "resultsPathDigest"]) {
    const mismatched = structuredClone(gate);
    mismatched.bindings[field] =
      field === "startedAt"
        ? "2026-08-01T00:00:01.000Z"
        : field === "resultsArtifactId"
          ? "00000000-0000-4000-8000-000000000099"
          : digest("9");
    assert.throws(
      () => completePreparedAttempt(claimed, mismatched),
      /do not match the claimed attempt artifact/u,
    );
  }
});

test("attempt preparation is retained before a runner can use its UUID", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "proposal-v2-ledger-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "attempt-ledger.json");
  const gate = createModelProposalBoundaryV2Gate({
    score: passingScore(),
    results: [],
    grounding: passingGrounding(),
  });
  const ledger = baseLedger(gate);
  ledger.initializedAt = "2020-01-01T00:00:00.000Z";
  await writeFile(path, `${JSON.stringify(ledger)}\n`, "utf8");

  const prepared = await prepareModelProposalBoundaryV2Attempt({
    ledger: path,
  });
  assert.equal(prepared.attempt.status, "pending");
  const retained = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(retained.attempts, [prepared.attempt]);
  await assert.rejects(
    prepareModelProposalBoundaryV2Attempt({ ledger: path }),
    /cannot prepare another attempt/u,
  );
});

test("v2 artifacts write canonical bytes outside the checkout without overwrite", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "proposal-v2-artifact-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "gate.json");
  const value = { z: 1, a: 2 };
  await writeModelProposalBoundaryV2Artifact(output, value);
  assert.equal(await readFile(output, "utf8"), '{"a":2,"z":1}\n');
  await assert.rejects(
    writeModelProposalBoundaryV2Artifact(output, value),
    /EEXIST/u,
  );
  await assert.rejects(
    writeModelProposalBoundaryV2Artifact(
      join(benchmarkDirectory, "forbidden-output.json"),
      value,
    ),
    /outside the repository/u,
  );
});

test("v2 gate bindings accept only frozen inputs and a claimed output identity", async (t) => {
  const [corpusArtifact, supportDocument] = await Promise.all([
    loadBenchmarkCasesArtifact(casesPath, undefined, {
      multipleEvidence: true,
    }),
    readJson(supportsPath),
  ]);
  const source = {
    dirty: false,
    revision: "a".repeat(40),
    stateDigest: digest("7"),
  };
  const movedRoot = await mkdtemp(join(tmpdir(), "proposal-v2-rescore-"));
  t.after(() => rm(movedRoot, { recursive: true, force: true }));
  await mkdir(join(movedRoot, "packages/prototype"), { recursive: true });
  await cp(
    join(root, "packages/prototype/dist"),
    join(movedRoot, "packages/prototype/dist"),
    { recursive: true },
  );
  await cp(join(root, "scripts"), join(movedRoot, "scripts"), {
    recursive: true,
  });
  const localRuntime = await runtimeStateDigest([
    process.execPath,
    join(root, "scripts/openai-responses-model-eval-adapter.mjs"),
  ]);
  const movedRuntime = await runtimeStateDigest(
    [
      process.execPath,
      join(movedRoot, "scripts/openai-responses-model-eval-adapter.mjs"),
    ],
    { repositoryRoot: movedRoot },
  );
  assert.equal(localRuntime, movedRuntime);
  const runtime = movedRuntime;
  const results = join(tmpdir(), "proposal-v2-frozen-results.jsonl");
  const score = passingScore();
  score.corpusDigest = corpusArtifact.digest;
  score.run = {
    ...score.run,
    sourceRevision: source.revision,
    sourceStateDigest: source.stateDigest,
    runtimeDigest: localRuntime,
    promptDigest:
      "sha256:34809fd6d1ba493c0b5d9da1f4e809d4a030cb38307207e9954685ceadd08e9b",
    selection: {
      cases: corpusArtifact.cases.map(({ id }) => id),
      repeats: 3,
      timeoutMs: 120_000,
    },
    config: frozenConfig(source.revision),
    resultsPathDigest: await resultPathDigest(results),
  };

  await assert.doesNotReject(
    assertFrozenInputs({
      cases: casesPath,
      supports: supportsPath,
      corpusArtifact,
      supportDocument,
      score,
      source,
      runtime,
    }),
  );

  const altered = structuredClone(score);
  altered.run.config.model.id = "different-model";
  await assert.rejects(
    assertFrozenInputs({
      cases: casesPath,
      supports: supportsPath,
      corpusArtifact,
      supportDocument,
      score: altered,
      source,
      runtime,
    }),
    /configuration does not match/u,
  );
});

test("passing gate conforms to the closed v2 artifact schema", async () => {
  const schema = await readJson(gateSchemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const core = createModelProposalBoundaryV2Gate({
    score: passingScore(),
    results: [],
    grounding: passingGrounding(),
  });
  const pending = pendingAttempt(
    core.bindings.attemptId,
    1,
    "2026-07-31T23:59:59.000Z",
  );
  const completed = completePreparedAttempt(
    claimForGate(registerPreparedAttempt(baseLedger(core), pending), core),
    core,
  );
  const gate = bindGateToAttemptLedger(core, completed);
  assert.doesNotThrow(() => assertGateConsistency(gate));
  assert.equal(validate(gate), true, JSON.stringify(validate.errors));

  const contradictory = structuredClone(gate);
  contradictory.checks[0].passed = false;
  assert.equal(validate(contradictory), false);
});

function resultWithChanges(caseId, repeat, cut, changes) {
  return {
    caseId,
    repeat,
    cut,
    proposal: {
      changes,
    },
  };
}

function passingScore() {
  const metrics = passingMetrics(108);
  return {
    coverage: { complete: true, expected: 108, observed: 108 },
    metrics,
    repeatMetrics: Array.from({ length: 3 }, (_, repeat) => ({
      repeat,
      metrics: passingMetrics(36),
    })),
    run: {
      attemptId: "00000000-0000-4000-8000-000000000001",
      startedAt: "2026-08-01T00:00:00.000Z",
      resultsArtifactId: "00000000-0000-4000-8000-000000000101",
      resultsPathDigest: digest("0"),
      sourceRevision: "a".repeat(40),
      sourceStateDigest: digest("1"),
      runtimeDigest: digest("2"),
      promptDigest: digest("3"),
      configDigest: digest("4"),
    },
    corpusDigest: digest("5"),
    resultsDigest: digest("6"),
  };
}

function passingMetrics(total) {
  return {
    responseSchemaValidRate: rate(total, total),
    compilerValidRate: rate(total, total),
    candidateVerificationRate: rate(total, total),
    appliedRate: rate(total, total),
    representationExactAssertionPrecision: rate(total, total),
    representationExactAssertionRecall: rate(total, total),
    representationExactAssertionF1: 1,
    projectedStateExactRate: rate(total, total),
    queryExactRate: rate(total, total),
    answerExactRate: rate(total, total),
    proofVerificationRate: rate(total, total),
    endToEndExactRate: rate(total, total),
  };
}

function passingGrounding() {
  return {
    overall: groundingScore(141),
    repeats: [groundingScore(47), groundingScore(47), groundingScore(47)],
  };
}

function baseLedger(gate) {
  return {
    schema: "covenant.timeline.model-proposal-attempt-ledger.v2",
    ledgerId: "00000000-0000-4000-8000-000000000010",
    initializedAt: "2026-07-31T23:59:58.000Z",
    benchmark: "model-proposal-boundary-v2",
    bindings: {
      sourceRevision: gate.bindings.sourceRevision,
      sourceStateDigest: gate.bindings.sourceStateDigest,
      runtimeDigest: gate.bindings.runtimeDigest,
      corpusDigest: gate.bindings.corpusDigest,
      acceptableSupportsDigest: gate.bindings.acceptableSupportsDigest,
      promptDigest: gate.bindings.promptDigest,
      configDigest: gate.bindings.configDigest,
    },
    attempts: [],
    authoritativeAttemptId: null,
    closed: false,
  };
}

function pendingAttempt(attemptId, ordinal, preparedAt) {
  return { ordinal, attemptId, preparedAt, status: "pending" };
}

function claimForGate(ledger, gate) {
  return {
    ...ledger,
    attempts: ledger.attempts.map((attempt, index) =>
      index === ledger.attempts.length - 1
        ? {
            ...attempt,
            claimedAt: gate.bindings.startedAt,
            status: "claimed",
            resultsArtifactId: gate.bindings.resultsArtifactId,
            resultsPathDigest: gate.bindings.resultsPathDigest,
          }
        : attempt,
    ),
  };
}

function formalRunOptions(ledger, output) {
  return {
    adapter: ["node", "unused-adapter.mjs"],
    cases: casesPath,
    config: join(tmpdir(), "unused-config.json"),
    ledger,
    output,
    repeats: 3,
    timeoutMs: 120_000,
  };
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function frozenConfig(benchmarkRevision) {
  return {
    schema: "covenant.timeline.model-proposal-eval.config.v1",
    id: "proposal-v2-test",
    benchmarkRevision,
    adapter: { id: "openai-responses", version: "1" },
    model: {
      provider: "openai",
      id: "gpt-5.6-sol",
      revision: "gpt-5.6-sol",
    },
    generation: {
      temperature: null,
      seed: null,
      maxOutputTokens: 16_384,
      parameters: {
        structuredOutput: true,
        reasoningEffort: "high",
        verbosity: "low",
      },
    },
  };
}

function groundingScore(total) {
  return {
    accepted: total,
    predicted: total,
    expected: total,
    precision: 1,
    recall: 1,
    f1: 1,
  };
}

function rate(numerator, denominator) {
  return { numerator, denominator, value: numerator / denominator };
}

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

async function readJson(path) {
  return parseStrictJson(await readFile(path, "utf8"), path);
}

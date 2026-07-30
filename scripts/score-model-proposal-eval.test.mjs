import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  compileTemporalModelProposalV1,
  contentDigest,
} from "../packages/prototype/dist/index.js";
import { digestFile, digestText } from "./model-interface-eval.mjs";
import {
  createBoundaryAdapterRequest,
  createBoundaryObservation,
  createBoundaryReferenceScope,
  createBoundaryTrajectory,
  evaluateBoundaryProposal,
} from "./model-proposal-boundary.mjs";
import { scoreModelProposalEval } from "./score-model-proposal-eval.mjs";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const casesPath = join(root, "benchmarks/model-interface/v1/cases.jsonl");
const promptPath = join(
  root,
  "benchmarks/model-proposal-boundary/v1/prompts/proposal.md",
);
const scorerPath = join(root, "scripts/score-model-proposal-eval.mjs");
const temporaryDirectories = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("scores an exact run and emits the same canonical artifact from the CLI", async () => {
  const fixture = await createExactRun();
  const resultsPath = await writeResults(fixture.results);
  const score = await scoreModelProposalEval({ results: resultsPath });

  assert.deepEqual(score.coverage, {
    expected: 3,
    observed: 3,
    missing: 0,
    duplicate: 0,
    unexpected: 0,
    complete: true,
    cases: 1,
    cutsPerCase: 3,
    repeats: 1,
  });
  assert.deepEqual(score.outcomes, { ok: 3, error: 0 });
  assert.deepEqual(score.metrics.responseSchemaValidRate, rate(3, 3));
  assert.deepEqual(score.metrics.compilerValidRate, rate(3, 3));
  assert.deepEqual(score.metrics.candidateVerificationRate, rate(3, 3));
  assert.deepEqual(score.metrics.appliedRate, rate(3, 3));
  assert.deepEqual(
    score.metrics.representationExactAssertionPrecision,
    rate(3, 3),
  );
  assert.deepEqual(
    score.metrics.representationExactAssertionRecall,
    rate(3, 3),
  );
  assert.equal(score.metrics.representationExactAssertionF1, 1);
  assert.deepEqual(score.metrics.projectedStateExactRate, rate(3, 3));
  assert.deepEqual(score.metrics.queryExactRate, rate(3, 3));
  assert.deepEqual(score.metrics.answerExactRate, rate(3, 3));
  assert.deepEqual(score.metrics.proofVerificationRate, rate(3, 3));
  assert.deepEqual(score.metrics.endToEndExactRate, rate(3, 3));
  assert.deepEqual(score.metrics.latencyMs, {
    count: 3,
    mean: 20,
    p50: 20,
    p95: 30,
  });
  assert.deepEqual(score.failures, { total: 0, stages: {}, codes: {} });

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    scorerPath,
    "--results",
    resultsPath,
    "--cases",
    casesPath,
  ]);
  assert.equal(stderr, "");
  assert.equal(stdout, `${canonicalJson(score)}\n`);
});

test("keeps failed observations in every downstream denominator", async () => {
  const fixture = await createExactRun();
  const failed = structuredClone(fixture.results);
  const result = failed[2];
  const usage = result.usage;
  result.responseText = canonicalJson({
    schema: "covenant.timeline.model-proposal.v1",
    requestId: result.requestId,
    changes: [],
    usage,
  });
  result.responseDigest = digestText(result.responseText);
  result.status = "error";
  result.proposal = null;
  result.responseSchemaValid = false;
  result.compiled = null;
  result.candidate = null;
  result.candidateVerified = null;
  result.applied = null;
  result.conclusion = null;
  result.proofVerified = null;
  result.error = {
    stage: "response-schema",
    code: "proposal.schema",
    message:
      "provider proposal failed its output schema: $ must have required property 'query'",
  };

  const score = await scoreModelProposalEval({
    results: await writeResults(failed),
  });

  assert.deepEqual(score.outcomes, { ok: 2, error: 1 });
  assert.deepEqual(score.metrics.responseSchemaValidRate, rate(2, 3));
  assert.deepEqual(score.metrics.compilerValidRate, rate(2, 3));
  assert.deepEqual(score.metrics.candidateVerificationRate, rate(2, 3));
  assert.deepEqual(score.metrics.appliedRate, rate(2, 3));
  assert.deepEqual(
    score.metrics.representationExactAssertionPrecision,
    rate(2, 2),
  );
  assert.deepEqual(
    score.metrics.representationExactAssertionRecall,
    rate(2, 3),
  );
  assert.equal(score.metrics.representationExactAssertionF1, 0.8);
  assert.deepEqual(score.metrics.projectedStateExactRate, rate(2, 3));
  assert.deepEqual(score.metrics.queryExactRate, rate(2, 3));
  assert.deepEqual(score.metrics.answerExactRate, rate(2, 3));
  assert.deepEqual(score.metrics.proofVerificationRate, rate(2, 3));
  assert.deepEqual(score.metrics.endToEndExactRate, rate(2, 3));
  assert.equal(score.metrics.latencyMs.count, 3);
  assert.equal(score.metrics.inputTokens.count, 3);
  assert.deepEqual(score.failures, {
    total: 1,
    stages: { "response-schema": 1 },
    codes: { "proposal.schema": 1 },
  });
});

test("compiler-rejected proposals retain their precision denominator", async () => {
  const fixture = await createExactRun();
  const failed = structuredClone(fixture.results);
  const result = failed[2];
  result.proposal.changes[0].supports[0].quote =
    "text that does not occur in the evidence";
  result.responseText = canonicalJson({
    ...result.proposal,
    usage: result.usage,
  });
  result.responseDigest = digestText(result.responseText);
  result.status = "error";
  result.compiled = false;
  result.candidate = null;
  result.candidateVerified = null;
  result.applied = null;
  result.conclusion = null;
  result.proofVerified = null;
  let compilerError;
  try {
    compileTemporalModelProposalV1(
      result.proposal,
      fixture.observations[2].host,
      {
        maxChanges: 8,
        maxSupportsPerChange: 4,
      },
    );
  } catch (error) {
    compilerError = error;
  }
  assert.ok(compilerError instanceof Error);
  result.error = {
    stage: "compilation",
    code: compilerError.code,
    message: compilerError.message,
  };

  const score = await scoreModelProposalEval({
    results: await writeResults(failed),
  });

  assert.deepEqual(
    score.metrics.representationExactAssertionPrecision,
    rate(2, 3),
  );
  assert.deepEqual(
    score.metrics.representationExactAssertionRecall,
    rate(2, 3),
  );
  assert.equal(score.metrics.representationExactAssertionF1, 2 / 3);
});

test("reports duplicate, missing, and unexpected observation coverage", async () => {
  const fixture = await createExactRun();
  const duplicate = structuredClone(fixture.results[2]);
  const duplicatePath = await writeResults([...fixture.results, duplicate]);
  const duplicateScore = await scoreModelProposalEval({
    results: duplicatePath,
  });

  assert.deepEqual(duplicateScore.coverage, {
    expected: 3,
    observed: 4,
    missing: 0,
    duplicate: 1,
    unexpected: 0,
    complete: false,
    cases: 1,
    cutsPerCase: 3,
    repeats: 1,
  });
  assert.deepEqual(duplicateScore.metrics.endToEndExactRate, rate(2, 3));
  assert.equal(duplicateScore.metrics.latencyMs.count, 4);

  const missingPath = await writeResults(fixture.results.slice(0, 2));
  const missingScore = await scoreModelProposalEval({ results: missingPath });
  assert.deepEqual(missingScore.coverage, {
    expected: 3,
    observed: 2,
    missing: 1,
    duplicate: 0,
    unexpected: 0,
    complete: false,
    cases: 1,
    cutsPerCase: 3,
    repeats: 1,
  });
  assert.deepEqual(missingScore.metrics.endToEndExactRate, rate(2, 3));

  const unexpected = structuredClone(fixture.results[2]);
  unexpected.caseId = "unexpected.case";
  const unexpectedScore = await scoreModelProposalEval({
    results: await writeResults([...fixture.results.slice(0, 2), unexpected]),
  });
  assert.deepEqual(unexpectedScore.coverage, {
    expected: 3,
    observed: 3,
    missing: 1,
    duplicate: 0,
    unexpected: 1,
    complete: false,
    cases: 1,
    cutsPerCase: 3,
    repeats: 1,
  });
  assert.deepEqual(unexpectedScore.metrics.endToEndExactRate, rate(2, 3));
  assert.equal(unexpectedScore.metrics.latencyMs.count, 2);
});

test("rejects fabricated application outcomes", async () => {
  const fixture = await createExactRun();
  const tampered = structuredClone(fixture.results);
  const result = tampered[2];
  result.status = "error";
  result.applied = false;
  result.conclusion = null;
  result.proofVerified = null;
  result.error = {
    stage: "application",
    code: "proposal.continuity-limit",
    message: "model-visible continuity state exceeds 4096 bytes",
  };

  await assert.rejects(
    scoreModelProposalEval({ results: await writeResults(tampered) }),
    /applied outcome does not reproduce/u,
  );
});

test("does not execute an unexpected row's dynamic output schema", async () => {
  const fixture = await createExactRun();
  const unexpected = structuredClone(fixture.results[2]);
  unexpected.caseId = "unexpected.case";
  const outputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "string",
    pattern: "[",
  };
  unexpected.outputSchemaJson = canonicalJson(outputSchema);
  unexpected.outputSchemaDigest = contentDigest(outputSchema);
  const request = JSON.parse(unexpected.requestText);
  request.outputSchema = outputSchema;
  request.outputSchemaDigest = unexpected.outputSchemaDigest;
  unexpected.requestText = canonicalJson(request);
  unexpected.requestDigest = digestText(unexpected.requestText);

  const score = await scoreModelProposalEval({
    results: await writeResults([...fixture.results.slice(0, 2), unexpected]),
  });

  assert.equal(score.coverage.unexpected, 1);
  assert.equal(score.coverage.missing, 1);
  assert.equal(score.coverage.complete, false);
});

test("rejects malformed JSONL before scoring", async () => {
  const directory = await temporaryDirectory();
  const resultsPath = join(directory, "malformed.jsonl");
  await writeFile(resultsPath, '{"schema":\n', "utf8");

  await assert.rejects(
    scoreModelProposalEval({ results: resultsPath }),
    /malformed\.jsonl:1/u,
  );
});

async function createExactRun() {
  const cases = (await readFile(casesPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const testCase = cases.find(({ id }) => id === "bounds.deploy-window");
  assert.ok(testCase);
  const prompt = await readFile(promptPath, "utf8");
  const config = {
    schema: "covenant.timeline.model-proposal-eval.config.v1",
    id: "score-test",
    benchmarkRevision: "test-revision",
    adapter: { id: "fixture-adapter", version: "1" },
    model: {
      provider: "fixture",
      id: "fixture-model",
      revision: "fixture-model-r1",
    },
    generation: {
      temperature: 0,
      seed: 7,
      maxOutputTokens: 1024,
      parameters: { structuredOutput: true },
    },
  };
  const run = {
    config,
    configDigest: contentDigest(config),
    corpusDigest: await digestFile(casesPath),
    promptDigest: digestText(prompt),
    selection: {
      cases: [testCase.id],
      repeats: 1,
      timeoutMs: 1000,
    },
    timelineVersion: "0.0.0-alpha.3",
    sourceRevision: "test-revision",
    sourceDirty: false,
    sourceStateDigest: `sha256:${"1".repeat(64)}`,
    runtimeDigest: `sha256:${"2".repeat(64)}`,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
  const referenceScope = createBoundaryReferenceScope(testCase);
  let trajectory = createBoundaryTrajectory(testCase);
  const results = [];
  const observations = [];

  for (const cut of testCase.cuts) {
    const requestId = `request-${testCase.contract.id}-${cut.index}`;
    const observation = createBoundaryObservation({
      testCase,
      cut,
      trajectory,
      referenceScope,
      requestId,
    });
    observations.push(observation);
    const proposal = exactProposal({
      testCase,
      cut,
      referenceScope,
      requestId,
    });
    const evaluation = evaluateBoundaryProposal({
      proposal,
      observation,
      trajectory,
      testCase,
      cut,
      referenceScope,
    });
    assert.equal(evaluation.compiled, true);
    assert.equal(evaluation.applied, true);
    const request = createBoundaryAdapterRequest({
      requestId,
      prompt,
      observation,
      config,
    });
    const usage = {
      inputTokens: 100 + cut.index,
      outputTokens: 50 + cut.index,
      costUsd: 0.01,
    };
    const responseText = canonicalJson({ ...proposal, usage });
    const requestText = canonicalJson(request);
    results.push({
      schema: "covenant.timeline.model-proposal-eval.result.v1",
      benchmark: "model-proposal-boundary-v1",
      run,
      requestId,
      requestText,
      requestDigest: digestText(requestText),
      outputSchemaJson: observation.outputSchemaText,
      outputSchemaDigest: observation.outputSchemaDigest,
      responseText,
      responseDigest: digestText(responseText),
      caseId: testCase.id,
      family: testCase.family,
      repeat: 0,
      cut: cut.index,
      traits: cut.traits,
      status: "ok",
      proposal,
      responseSchemaValid: true,
      compiled: true,
      candidate: evaluation.candidate,
      candidateVerified: true,
      applied: true,
      conclusion: evaluation.conclusion,
      proofVerified: true,
      usage,
      latencyMs: 10 * (cut.index + 1),
      error: null,
    });
    trajectory = evaluation.trajectory;
  }
  return { observations, results };
}

function exactProposal({ testCase, cut, referenceScope, requestId }) {
  const evidenceByDigest = new Map(
    testCase.evidence
      .filter(({ cut: evidenceCut }) => evidenceCut === cut.index)
      .map((evidence) => [evidence.digest, evidence]),
  );
  return {
    schema: "covenant.timeline.model-proposal.v1",
    requestId,
    changes: cut.goldEvents.map((event) => {
      assert.equal(event.type, "coordinate.asserted");
      const evidence = evidenceByDigest.get(event.assertion.evidenceRefs[0]);
      assert.ok(evidence);
      return {
        type: "coordinate",
        pointHandle: requiredReference(
          referenceScope,
          ({ type, pointId }) =>
            type === "point" && pointId === event.assertion.pointId,
        ).handle,
        bounds: proposalBounds(event.assertion.coordinate),
        supports: [{ evidenceId: evidence.id, quote: evidence.text }],
        revision: { type: "keep" },
      };
    }),
    query: {
      type: "difference",
      targetHandle: requiredReference(
        referenceScope,
        ({ type, fromPointId, toPointId }) =>
          type === "difference" &&
          fromPointId === cut.goldQuery.fromPointId &&
          toPointId === cut.goldQuery.toPointId,
      ).handle,
      knowledgeCut: { type: "current" },
    },
  };
}

function proposalBounds(bounds) {
  if (
    bounds.minimum !== undefined &&
    bounds.maximum !== undefined &&
    bounds.minimum === bounds.maximum
  ) {
    return { type: "exact", value: bounds.minimum };
  }
  if (bounds.minimum !== undefined) {
    return { type: "lower-bound", minimum: bounds.minimum };
  }
  return { type: "upper-bound", maximum: bounds.maximum };
}

function requiredReference(referenceScope, predicate) {
  const reference = referenceScope.hostCatalog.find(predicate);
  assert.ok(reference);
  return reference;
}

function rate(numerator, denominator) {
  return { numerator, denominator, value: numerator / denominator };
}

async function writeResults(results) {
  const directory = await temporaryDirectory();
  const path = join(directory, "results.jsonl");
  await writeFile(
    path,
    `${results.map((result) => canonicalJson(result)).join("\n")}\n`,
    "utf8",
  );
  return path;
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "proposal-score-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

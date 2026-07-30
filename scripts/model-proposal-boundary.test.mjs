import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { contentDigest } from "../packages/prototype/dist/index.js";
import {
  completeBoundaryCut,
  createBoundaryAdapterRequest,
  createBoundaryObservation,
  createBoundaryReferenceScope,
  createBoundaryTrajectory,
  evaluateBoundaryProposal,
  validateBoundaryProviderOutput,
} from "./model-proposal-boundary.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cases = (
  await readFile(
    join(root, "benchmarks/model-interface/v1/cases.jsonl"),
    "utf8",
  )
)
  .trim()
  .split("\n")
  .map(JSON.parse);
const testCase = cases.find(({ id }) => id === "bounds.deploy-window");
assert.ok(testCase);

test("model input exposes opaque references without benchmark answers", () => {
  const { observation, referenceScope } = createFixture();
  const inputKeys = collectKeys(observation.input);

  for (const key of [
    "contract",
    "run",
    "setupEvents",
    "goldEvents",
    "goldQuery",
    "expectedResult",
    "digest",
    "cutIndex",
    "contextId",
    "pointId",
    "fromPointId",
    "toPointId",
    "leftPointId",
    "rightPointId",
    "leftIntervalId",
    "rightIntervalId",
  ]) {
    assert.equal(inputKeys.has(key), false, `${key} remains host-owned`);
  }

  assert.ok(
    referenceScope.hostCatalog.some(({ pointId }) => pointId === "window-open"),
  );
  assert.ok(
    observation.input.references.some(
      ({ handle }) => handle === pointHandle(referenceScope, "window-open"),
    ),
  );
  for (const reference of observation.input.references) {
    assert.match(
      reference.handle,
      /^(?:context|point|difference|point-relation|interval-relation)-\d{3}$/u,
    );
  }
});

test("the complete provider request excludes hidden benchmark canaries", () => {
  const synthetic = structuredClone(testCase);
  const canaries = [
    "hidden-family-canary-9a2f",
    "hidden-trait-canary-7b4e",
    "hidden-event-canary-3c8d",
    "hidden-query-canary-6e1a",
    "hidden-answer-canary-5f0b",
  ];
  synthetic.family = canaries[0];
  const cut = synthetic.cuts[0];
  cut.traits = [canaries[1]];
  cut.goldEvents = [{ hidden: canaries[2] }];
  cut.goldQuery = { hidden: canaries[3] };
  cut.expectedResult = { hidden: canaries[4] };

  const requestId = "request-canary";
  const referenceScope = createBoundaryReferenceScope(synthetic);
  const observation = createBoundaryObservation({
    testCase: synthetic,
    cut,
    trajectory: createBoundaryTrajectory(synthetic),
    referenceScope,
    requestId,
  });
  const request = createBoundaryAdapterRequest({
    requestId,
    prompt: "Extract the temporal proposal.",
    observation,
    config: { schema: "fixture-config" },
  });
  const serialized = JSON.stringify(request);

  for (const canary of canaries) {
    assert.equal(
      serialized.includes(canary),
      false,
      `request leaked ${canary}`,
    );
  }
  assert.deepEqual(Object.keys(request).sort(), [
    "arm",
    "benchmark",
    "config",
    "configDigest",
    "input",
    "outputSchema",
    "outputSchemaDigest",
    "prompt",
    "requestId",
    "schema",
  ]);
  assert.deepEqual(Object.keys(request.input).sort(), [
    "evidence",
    "priorState",
    "question",
    "references",
  ]);
  assert.deepEqual(Object.keys(request.input.priorState).sort(), [
    "assertions",
    "knowledgeCuts",
  ]);
  for (const evidence of request.input.evidence) {
    assert.deepEqual(Object.keys(evidence).sort(), ["id", "text"]);
  }
});

test("the provider schema and digest are stable and request-bound", () => {
  const first = createFixture({ requestId: "request-stable" }).observation;
  const second = createFixture({ requestId: "request-stable" }).observation;
  const other = createFixture({ requestId: "request-other" }).observation;

  assert.equal(first.outputSchemaText, second.outputSchemaText);
  assert.equal(first.outputSchemaDigest, second.outputSchemaDigest);
  assert.equal(first.outputSchemaDigest, contentDigest(first.outputSchema));
  assert.notEqual(first.outputSchemaDigest, other.outputSchemaDigest);
  assert.ok(first.outputSchemaText.includes('"request-stable"'));
  assert.equal(first.outputSchemaText.includes('"request-other"'), false);
});

test("a schema-valid proposal compiles, applies, and earns exact metrics", () => {
  const fixture = createFixture();
  const proposal = exactProposal(fixture);

  validateBoundaryProviderOutput(proposal, fixture.observation);
  const result = evaluateBoundaryProposal({
    proposal,
    observation: fixture.observation,
    trajectory: fixture.trajectory,
    testCase,
    cut: fixture.cut,
    referenceScope: fixture.referenceScope,
  });

  assert.equal(result.compiled, true);
  assert.equal(result.applied, true);
  assert.equal(result.proofVerified, true);
  assert.deepEqual(result.conclusion.result, fixture.cut.expectedResult);
  assert.deepEqual(result.metrics, {
    assertionPrecision: 1,
    assertionRecall: 1,
    assertionF1: 1,
    projectedStateExact: true,
    queryExact: true,
    evidenceAttributionExact: true,
    answerExact: true,
    proofVerified: true,
    endToEndExact: true,
  });
  assert.deepEqual(result.trajectory.knowledgeCuts, [
    { handle: "cut-001", cutIndex: 0, recordedThrough: 2 },
  ]);
});

test("schema-valid unsupported evidence fails in the compiler and preserves continuity", () => {
  const fixture = createFixture();
  const proposal = exactProposal(fixture);
  proposal.changes[0].supports[0].quote = "not present in the evidence";

  validateBoundaryProviderOutput(proposal, fixture.observation);
  const result = evaluateBoundaryProposal({
    proposal,
    observation: fixture.observation,
    trajectory: fixture.trajectory,
    testCase,
    cut: fixture.cut,
    referenceScope: fixture.referenceScope,
  });

  assert.equal(result.compiled, false);
  assert.equal(result.applied, false);
  assert.equal(result.error.stage, "compiler");
  assert.equal(result.error.code, "model-proposal.rejected");
  assert.strictEqual(result.trajectory.run, fixture.trajectory.run);
  assert.deepEqual(result.trajectory.knowledgeCuts, [
    { handle: "cut-001", cutIndex: 0, recordedThrough: 1 },
  ]);
});

test("provider errors can advance the record cut without mutating admitted state", () => {
  const fixture = createFixture();
  const continued = completeBoundaryCut(fixture.trajectory, fixture.cut.index);
  const nextCut = testCase.cuts[1];
  const observation = createBoundaryObservation({
    testCase,
    cut: nextCut,
    trajectory: continued,
    referenceScope: fixture.referenceScope,
    requestId: "request-after-provider-error",
  });

  assert.strictEqual(continued.run, fixture.trajectory.run);
  assert.deepEqual(observation.input.priorState, {
    assertions: [],
    knowledgeCuts: [{ handle: "cut-001" }],
  });
  assert.deepEqual(observation.host.knowledgeCutCatalog, [
    { handle: "cut-001", recordedThrough: 1 },
  ]);
});

function createFixture({ requestId = "request-001" } = {}) {
  const cut = testCase.cuts[0];
  const referenceScope = createBoundaryReferenceScope(testCase);
  const trajectory = createBoundaryTrajectory(testCase);
  const observation = createBoundaryObservation({
    testCase,
    cut,
    trajectory,
    referenceScope,
    requestId,
  });
  return {
    cut,
    observation,
    referenceScope,
    requestId,
    trajectory,
  };
}

function exactProposal({ cut, observation, referenceScope, requestId }) {
  const evidence = observation.input.evidence[0];
  return {
    schema: "covenant.timeline.model-proposal.v1",
    requestId,
    changes: [
      {
        type: "coordinate",
        pointHandle: pointHandle(referenceScope, "window-open"),
        bounds: { type: "exact", value: 10 },
        supports: [
          {
            evidenceId: evidence.id,
            quote: "The release window opened at offset 10.",
          },
        ],
        revision: { type: "keep" },
      },
    ],
    query: {
      type: "difference",
      targetHandle: differenceHandle(
        referenceScope,
        cut.goldQuery.fromPointId,
        cut.goldQuery.toPointId,
      ),
      knowledgeCut: { type: "current" },
    },
  };
}

function pointHandle(referenceScope, pointId) {
  return requiredReference(
    referenceScope,
    ({ type, pointId: candidate }) => type === "point" && candidate === pointId,
  ).handle;
}

function differenceHandle(referenceScope, fromPointId, toPointId) {
  return requiredReference(
    referenceScope,
    ({ type, fromPointId: from, toPointId: to }) =>
      type === "difference" && from === fromPointId && to === toPointId,
  ).handle;
}

function requiredReference(referenceScope, predicate) {
  const reference = referenceScope.hostCatalog.find(predicate);
  assert.ok(reference);
  return reference;
}

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys);
    return keys;
  }
  if (value === null || typeof value !== "object") return keys;
  for (const [key, entry] of Object.entries(value)) {
    keys.add(key);
    collectKeys(entry, keys);
  }
  return keys;
}

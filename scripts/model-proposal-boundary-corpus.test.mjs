import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createBoundaryObservation,
  createBoundaryReferenceScope,
  createBoundaryTrajectory,
  evaluateBoundaryProposal,
} from "./model-proposal-boundary.mjs";
import { bindCompiledAssertionIds } from "./model-proposal-fixtures.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const casesPath = join(root, "benchmarks/model-interface/v1/cases.jsonl");
const cases = (await readFile(casesPath, "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse);
const casesById = new Map(cases.map((testCase) => [testCase.id, testCase]));

test("request-scoped proposal boundary reproduces every gold trajectory", () => {
  let evaluatedCuts = 0;

  for (const testCase of cases) {
    const referenceScope = createBoundaryReferenceScope(testCase);
    let trajectory = createBoundaryTrajectory(testCase);
    const candidateAssertionByGold = new Map();
    const goldAssertionByCandidate = new Map();
    const goldAssertionIds = testCase.cuts.flatMap(({ goldEvents }) =>
      goldEvents.flatMap(({ assertion }) => (assertion ? [assertion.id] : [])),
    );

    for (const cut of testCase.cuts) {
      const requestId = `proposal:${testCase.contract.id}:${cut.index}`;
      const observation = createBoundaryObservation({
        testCase,
        cut,
        trajectory,
        referenceScope,
        requestId,
      });
      const proposal = createGoldBoundaryProposal({
        testCase,
        cut,
        trajectory,
        referenceScope,
        requestId,
        candidateAssertionByGold,
      });

      assertNoGoldAssertionIds(
        observation.input,
        goldAssertionIds,
        `${testCase.id} cut ${cut.index}: model input`,
      );
      assertNoGoldAssertionIds(
        proposal,
        goldAssertionIds,
        `${testCase.id} cut ${cut.index}: model proposal`,
      );

      const evaluation = evaluateBoundaryProposal({
        proposal,
        observation,
        trajectory,
        testCase,
        cut,
        referenceScope,
      });

      assert.equal(
        evaluation.compiled,
        true,
        `${testCase.id} cut ${cut.index}: proposal compiled`,
      );
      assert.equal(
        evaluation.applied,
        true,
        `${testCase.id} cut ${cut.index}: candidate applied`,
      );
      assert.equal(
        evaluation.proofVerified,
        true,
        `${testCase.id} cut ${cut.index}: proof verified`,
      );
      assert.deepEqual(
        evaluation.metrics,
        {
          assertionPrecision: 1,
          assertionRecall: 1,
          assertionF1: 1,
          projectedStateExact: true,
          queryExact: true,
          evidenceAttributionExact: true,
          answerExact: true,
          proofVerified: true,
          endToEndExact: true,
        },
        `${testCase.id} cut ${cut.index}: exact boundary metrics`,
      );

      bindCompiledAssertionIds(
        testCase.id,
        cut.index,
        cut.goldEvents,
        evaluation.candidate.candidateEvents,
        candidateAssertionByGold,
        goldAssertionByCandidate,
      );
      trajectory = evaluation.trajectory;

      for (const [goldId, candidateId] of candidateAssertionByGold) {
        assert.match(
          trajectory.assertionHandles.get(candidateId),
          /^assertion-\d{3}$/u,
          `${testCase.id} cut ${cut.index}: ${goldId} has an opaque handle`,
        );
      }
      evaluatedCuts += 1;
    }
  }

  assert.equal(evaluatedCuts, 36);
});

test("assertion metrics score the current extraction delta", () => {
  const testCase = casesById.get("bounds.deploy-window");
  assert.ok(testCase);
  const referenceScope = createBoundaryReferenceScope(testCase);
  let trajectory = createBoundaryTrajectory(testCase);
  const candidateAssertionByGold = new Map();
  const goldAssertionByCandidate = new Map();

  for (const cut of testCase.cuts.slice(0, 2)) {
    const requestId = `proposal:${testCase.contract.id}:${cut.index}`;
    const observation = createBoundaryObservation({
      testCase,
      cut,
      trajectory,
      referenceScope,
      requestId,
    });
    const proposal = createGoldBoundaryProposal({
      testCase,
      cut,
      trajectory,
      referenceScope,
      requestId,
      candidateAssertionByGold,
    });
    const evaluation = evaluateBoundaryProposal({
      proposal,
      observation,
      trajectory,
      testCase,
      cut,
      referenceScope,
    });
    bindCompiledAssertionIds(
      testCase.id,
      cut.index,
      cut.goldEvents,
      evaluation.candidate.candidateEvents,
      candidateAssertionByGold,
      goldAssertionByCandidate,
    );
    trajectory = evaluation.trajectory;
  }

  const cut = testCase.cuts[2];
  const requestId = `proposal:${testCase.contract.id}:${cut.index}`;
  const observation = createBoundaryObservation({
    testCase,
    cut,
    trajectory,
    referenceScope,
    requestId,
  });
  const proposal = {
    ...createGoldBoundaryProposal({
      testCase,
      cut,
      trajectory,
      referenceScope,
      requestId,
      candidateAssertionByGold,
    }),
    changes: [],
  };
  const evaluation = evaluateBoundaryProposal({
    proposal,
    observation,
    trajectory,
    testCase,
    cut,
    referenceScope,
  });

  assert.equal(evaluation.metrics.assertionPrecision, 0);
  assert.equal(evaluation.metrics.assertionRecall, 0);
  assert.equal(evaluation.metrics.assertionF1, 0);
  assert.equal(evaluation.metrics.projectedStateExact, false);
  assert.equal(evaluation.metrics.evidenceAttributionExact, false);
  assert.equal(evaluation.metrics.endToEndExact, false);
});

function createGoldBoundaryProposal({
  testCase,
  cut,
  trajectory,
  referenceScope,
  requestId,
  candidateAssertionByGold,
}) {
  const evidenceByDigest = new Map(
    testCase.evidence
      .filter(({ cut: evidenceCut }) => evidenceCut === cut.index)
      .map((entry) => [entry.digest, entry]),
  );

  return {
    schema: "covenant.timeline.model-proposal.v1",
    requestId,
    changes: cut.goldEvents.map((event) =>
      boundaryChange({
        event,
        trajectory,
        referenceScope,
        evidenceByDigest,
        candidateAssertionByGold,
      }),
    ),
    query: boundaryQuery(cut, trajectory, referenceScope),
  };
}

function boundaryChange({
  event,
  trajectory,
  referenceScope,
  evidenceByDigest,
  candidateAssertionByGold,
}) {
  const supports = eventEvidenceRefs(event).map((digest) => {
    const evidence = evidenceByDigest.get(digest);
    assert.ok(evidence, `${event.id}: evidence is current`);
    return { evidenceId: evidence.id, quote: evidence.text };
  });

  if (event.type === "coordinate.asserted") {
    return {
      type: "coordinate",
      pointHandle: requireHandle(
        referenceScope.pointHandleById,
        event.assertion.pointId,
      ),
      bounds: proposalBounds(event.assertion.coordinate),
      supports,
      revision: proposalRevision(
        event.assertion.supersedes,
        trajectory,
        candidateAssertionByGold,
      ),
    };
  }
  if (event.type === "constraint.asserted") {
    return {
      type: "constraint",
      differenceHandle: requireHandle(
        referenceScope.differenceHandleByPair,
        pairKey(
          event.assertion.constraint.fromPointId,
          event.assertion.constraint.toPointId,
        ),
      ),
      bounds: proposalBounds(event.assertion.constraint),
      supports,
      revision: proposalRevision(
        event.assertion.supersedes,
        trajectory,
        candidateAssertionByGold,
      ),
    };
  }
  if (event.type === "assertion.retracted") {
    return {
      type: "retraction",
      assertionHandle: goldAssertionHandle(
        event.assertionId,
        trajectory,
        candidateAssertionByGold,
      ),
      supports,
    };
  }
  throw new Error(`${event.id}: unsupported boundary change`);
}

function boundaryQuery(cut, trajectory, referenceScope) {
  const query = cut.goldQuery;
  const currentRecordedThrough =
    trajectory.run.events.length + cut.goldEvents.length - 1;
  const knowledgeCut =
    query.recordedThrough === currentRecordedThrough
      ? { type: "current" }
      : {
          type: "prior",
          cutHandle: priorCutHandle(
            query.recordedThrough,
            trajectory.knowledgeCuts,
          ),
        };

  if (query.type === "context.consistency") {
    return {
      type: "consistency",
      targetHandle: requireHandle(
        referenceScope.contextHandleById,
        query.contextId,
      ),
      knowledgeCut,
    };
  }
  if (query.type === "difference.bounds") {
    return {
      type: "difference",
      targetHandle: requireHandle(
        referenceScope.differenceHandleByPair,
        pairKey(query.fromPointId, query.toPointId),
      ),
      knowledgeCut,
    };
  }
  if (query.type === "point.relations") {
    return {
      type: "point-relation",
      targetHandle: requireHandle(
        referenceScope.pointRelationHandleByPair,
        pairKey(query.leftPointId, query.rightPointId),
      ),
      knowledgeCut,
    };
  }
  return {
    type: "interval-relation",
    targetHandle: requireHandle(
      referenceScope.intervalRelationHandleByPair,
      pairKey(query.leftIntervalId, query.rightIntervalId),
    ),
    knowledgeCut,
  };
}

function proposalBounds(value) {
  if (
    value.minimum !== undefined &&
    value.maximum !== undefined &&
    value.minimum === value.maximum
  ) {
    return { type: "exact", value: value.minimum };
  }
  if (value.minimum !== undefined && value.maximum !== undefined) {
    return {
      type: "closed-range",
      minimum: value.minimum,
      maximum: value.maximum,
    };
  }
  if (value.minimum !== undefined) {
    return { type: "lower-bound", minimum: value.minimum };
  }
  return { type: "upper-bound", maximum: value.maximum };
}

function proposalRevision(
  supersedes = [],
  trajectory,
  candidateAssertionByGold,
) {
  assert.ok(supersedes.length <= 1);
  return supersedes.length === 0
    ? { type: "keep" }
    : {
        type: "supersede",
        assertionHandle: goldAssertionHandle(
          supersedes[0],
          trajectory,
          candidateAssertionByGold,
        ),
      };
}

function goldAssertionHandle(goldId, trajectory, candidateAssertionByGold) {
  const candidateId = candidateAssertionByGold.get(goldId);
  assert.ok(candidateId, `${goldId}: candidate assertion is bound`);
  return requireHandle(trajectory.assertionHandles, candidateId);
}

function priorCutHandle(recordedThrough, knowledgeCuts) {
  const cut = knowledgeCuts.find(
    (candidate) => candidate.recordedThrough === recordedThrough,
  );
  assert.ok(cut, `no prior cut maps to sequence ${recordedThrough}`);
  return cut.handle;
}

function requireHandle(map, key) {
  const handle = map.get(key);
  assert.ok(handle, `no opaque handle for ${key}`);
  return handle;
}

function eventEvidenceRefs(event) {
  return event.type === "assertion.retracted"
    ? event.evidenceRefs
    : event.assertion.evidenceRefs;
}

function pairKey(left, right) {
  return `${left}\u0000${right}`;
}

function assertNoGoldAssertionIds(value, ids, label) {
  const text = JSON.stringify(value);
  for (const id of ids) {
    assert.equal(text.includes(id), false, `${label} leaked ${id}`);
  }
}

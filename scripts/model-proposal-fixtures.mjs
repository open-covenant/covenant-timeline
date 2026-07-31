import assert from "node:assert/strict";
import {
  canonicalJson,
  parseRunDocumentV0Alpha3,
  projectTemporalStateV0Alpha3,
} from "../packages/prototype/dist/index.js";

export function createGoldModelProposalFixture({
  testCase,
  cut,
  candidateEvents,
  assertionIds,
  knowledgeCuts,
  referenceCatalog,
}) {
  const evidence = testCase.evidence.filter(
    ({ cut: evidenceCut }) => evidenceCut === cut.index,
  );
  const requestId = `proposal:${testCase.contract.id}:${cut.index}`;
  const run = createRunDocument(testCase.contract, candidateEvents);
  const proposal = {
    schema: "covenant.timeline.model-proposal.v1",
    requestId,
    changes: cut.goldEvents.map((event) =>
      proposalChange(event, evidence, assertionIds),
    ),
    query: queryIntent(
      cut.goldQuery,
      candidateEvents.length + cut.goldEvents.length - 1,
      knowledgeCuts,
    ),
  };
  const host = {
    run,
    expectedRequestId: requestId,
    evidenceCatalog: evidence.map(({ id, text }) => ({
      id,
      status: "current",
      text,
    })),
    referenceCatalog,
    assertionCatalog: [...assertionIds].map(
      ([goldAssertionId, candidateAssertionId]) => ({
        handle: assertionHandle(goldAssertionId),
        assertionId: candidateAssertionId,
      }),
    ),
    knowledgeCutCatalog: knowledgeCuts,
  };

  return { proposal, host };
}

export function createModelProposalReferenceCatalog(testCase) {
  const points = testCase.setupEvents
    .filter(({ type }) => type === "point.declared")
    .map(({ point }) => point);
  const intervals = testCase.setupEvents
    .filter(({ type }) => type === "interval.declared")
    .map(({ interval }) => interval);
  const references = [
    ...testCase.contract.contexts.map(({ id }) => ({
      type: "context",
      handle: contextHandle(id),
      contextId: id,
    })),
    ...points.map(({ id }) => ({
      type: "point",
      handle: pointHandle(id),
      pointId: id,
    })),
  ];

  for (const left of points) {
    for (const right of points) {
      if (
        left.id === right.id ||
        left.contextId !== right.contextId ||
        left.axisId !== right.axisId
      ) {
        continue;
      }
      references.push({
        type: "difference",
        handle: differenceHandle(left.id, right.id),
        fromPointId: left.id,
        toPointId: right.id,
      });
      references.push({
        type: "point-relation",
        handle: pointRelationHandle(left.id, right.id),
        leftPointId: left.id,
        rightPointId: right.id,
      });
    }
  }

  for (const left of intervals) {
    for (const right of intervals) {
      if (left.id === right.id || left.contextId !== right.contextId) continue;
      references.push({
        type: "interval-relation",
        handle: intervalRelationHandle(left.id, right.id),
        leftIntervalId: left.id,
        rightIntervalId: right.id,
      });
    }
  }

  return references;
}

export function bindCompiledAssertionIds(
  caseId,
  cut,
  goldEvents,
  candidateEvents,
  assertionIds,
  reverseAssertionIds,
) {
  const unmatched = [...candidateEvents];
  for (const gold of goldEvents) {
    const index = unmatched.findIndex((candidate) =>
      sameEventSemantics(gold, candidate, reverseAssertionIds),
    );
    assert.notEqual(index, -1, `${caseId} cut ${cut}: ${gold.id} was compiled`);
    const [candidate] = unmatched.splice(index, 1);
    if (
      gold.type === "coordinate.asserted" ||
      gold.type === "constraint.asserted"
    ) {
      assertionIds.set(gold.assertion.id, candidate.assertion.id);
      reverseAssertionIds.set(candidate.assertion.id, gold.assertion.id);
    }
  }
  assert.equal(
    unmatched.length,
    0,
    `${caseId} cut ${cut}: unmatched candidate`,
  );
}

export function projectSemanticState(run) {
  return run.contract.contexts.map(({ id }) => {
    const state = projectTemporalStateV0Alpha3(
      run,
      id,
      run.events.length === 0 ? null : run.events.length - 1,
    );
    return {
      contextId: id,
      coordinates: state.coordinates.map(normalizeAssertion).sort(compareJson),
      constraints: state.constraints.map(normalizeAssertion).sort(compareJson),
      facts: state.facts.map(normalizeAssertion).sort(compareJson),
    };
  });
}

export function createRunDocument(contract, events) {
  return parseRunDocumentV0Alpha3({
    schema: "covenant.timeline.run.v0alpha3",
    contract,
    events,
  });
}

export function createKnowledgeCutHandle(cut) {
  return `cut:${cut}`;
}

function proposalChange(event, evidence, assertionIds) {
  const supports = eventEvidenceRefs(event).map((digest) => {
    const source = evidence.find((entry) => entry.digest === digest);
    assert.ok(source, `${event.id}: evidence must be current at this cut`);
    return { evidenceId: source.id, quote: source.text };
  });

  if (event.type === "coordinate.asserted") {
    return {
      type: "coordinate",
      pointHandle: pointHandle(event.assertion.pointId),
      bounds: proposalBounds(event.assertion.coordinate),
      supports,
      revision: proposalRevision(event.assertion.supersedes, assertionIds),
    };
  }
  if (event.type === "constraint.asserted") {
    return {
      type: "constraint",
      differenceHandle: differenceHandle(
        event.assertion.constraint.fromPointId,
        event.assertion.constraint.toPointId,
      ),
      bounds: proposalBounds(event.assertion.constraint),
      supports,
      revision: proposalRevision(event.assertion.supersedes, assertionIds),
    };
  }
  if (event.type === "assertion.retracted") {
    assert.ok(assertionIds.has(event.assertionId));
    return {
      type: "retraction",
      assertionHandle: assertionHandle(event.assertionId),
      supports,
    };
  }
  throw new Error(`${event.id}: gold cut contains a host-owned declaration`);
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

function proposalRevision(supersedes = [], assertionIds) {
  assert.ok(supersedes.length <= 1);
  if (supersedes.length === 0) return { type: "keep" };
  assert.ok(assertionIds.has(supersedes[0]));
  return {
    type: "supersede",
    assertionHandle: assertionHandle(supersedes[0]),
  };
}

function queryIntent(query, currentCut, knowledgeCuts) {
  const knowledgeCut =
    query.recordedThrough === currentCut
      ? { type: "current" }
      : {
          type: "prior",
          cutHandle: priorCutHandle(query.recordedThrough, knowledgeCuts),
        };

  if (query.type === "context.consistency") {
    return {
      type: "consistency",
      targetHandle: contextHandle(query.contextId),
      knowledgeCut,
    };
  }
  if (query.type === "difference.bounds") {
    return {
      type: "difference",
      targetHandle: differenceHandle(query.fromPointId, query.toPointId),
      knowledgeCut,
    };
  }
  if (query.type === "point.relations") {
    return {
      type: "point-relation",
      targetHandle: pointRelationHandle(query.leftPointId, query.rightPointId),
      knowledgeCut,
    };
  }
  return {
    type: "interval-relation",
    targetHandle: intervalRelationHandle(
      query.leftIntervalId,
      query.rightIntervalId,
    ),
    knowledgeCut,
  };
}

function priorCutHandle(recordedThrough, knowledgeCuts) {
  const entry = knowledgeCuts.find(
    (candidate) => candidate.recordedThrough === recordedThrough,
  );
  assert.ok(entry, `no prior cut maps to sequence ${recordedThrough}`);
  return entry.handle;
}

function sameEventSemantics(gold, candidate, reverseAssertionIds) {
  if (gold.type !== candidate.type) return false;
  if (gold.type === "assertion.retracted") {
    return (
      reverseAssertionIds.get(candidate.assertionId) === gold.assertionId &&
      canonicalJson([...candidate.evidenceRefs].sort()) ===
        canonicalJson([...gold.evidenceRefs].sort())
    );
  }
  if (
    gold.type !== "coordinate.asserted" &&
    gold.type !== "constraint.asserted"
  ) {
    return false;
  }
  const candidateAssertion = normalizeComparableAssertion({
    ...candidate.assertion,
    id: gold.assertion.id,
    ...(candidate.assertion.supersedes
      ? {
          supersedes: candidate.assertion.supersedes.map((id) =>
            reverseAssertionIds.get(id),
          ),
        }
      : {}),
  });
  return (
    canonicalJson(candidateAssertion) ===
    canonicalJson(normalizeComparableAssertion(gold.assertion))
  );
}

function normalizeAssertion({
  id: _id,
  supersedes: _supersedes,
  evidenceRefs,
  ...value
}) {
  return {
    ...value,
    evidenceRefs: [...evidenceRefs].sort(),
  };
}

function normalizeComparableAssertion(assertion) {
  const { evidenceRefs, supersedes, ...value } = assertion;
  return {
    ...value,
    ...(evidenceRefs === undefined
      ? {}
      : { evidenceRefs: [...evidenceRefs].sort() }),
    ...(supersedes === undefined ? {} : { supersedes: [...supersedes].sort() }),
  };
}

function compareJson(left, right) {
  return canonicalJson(left).localeCompare(canonicalJson(right), "en");
}

function eventEvidenceRefs(event) {
  return event.type === "assertion.retracted"
    ? event.evidenceRefs
    : event.assertion.evidenceRefs;
}

function assertionHandle(id) {
  return `assertion:${id}`;
}

function contextHandle(id) {
  return `context:${id}`;
}

function differenceHandle(from, to) {
  return `difference:${from}:${to}`;
}

function intervalRelationHandle(left, right) {
  return `interval-relation:${left}:${right}`;
}

function pointHandle(id) {
  return `point:${id}`;
}

function pointRelationHandle(left, right) {
  return `point-relation:${left}:${right}`;
}

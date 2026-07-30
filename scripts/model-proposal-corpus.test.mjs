import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  canonicalJson,
  compileTemporalModelProposalV1,
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  projectTemporalStateV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "../packages/prototype/dist/index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const casesPath = join(root, "benchmarks/model-interface/v1/cases.jsonl");
const candidateSchemaId =
  "https://covenant-timeline.org/schemas/model-proposal/v1/candidate.schema.json";
const [commonSchema, querySchema, candidateSchema] = await Promise.all([
  readJson("schemas/v0alpha3/common.schema.json"),
  readJson("schemas/v0alpha3/query.schema.json"),
  readJson("schemas/model-proposal/v1/candidate.schema.json"),
]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const schema of [commonSchema, querySchema, candidateSchema]) {
  ajv.addSchema(schema);
}
const validateCandidate = ajv.getSchema(candidateSchemaId);
if (!validateCandidate) {
  throw new Error(`schema is not registered: ${candidateSchemaId}`);
}

test("model proposals reproduce every gold temporal trajectory", async () => {
  const cases = (await readFile(casesPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);

  let compiledCuts = 0;
  for (const testCase of cases) {
    let candidateEvents = [...testCase.setupEvents];
    let goldEvents = [...testCase.setupEvents];
    const assertionIds = new Map();
    const reverseAssertionIds = new Map();
    const knowledgeCuts = [];
    const references = referenceCatalog(testCase);

    for (const cut of testCase.cuts) {
      const evidence = testCase.evidence.filter(
        ({ cut: evidenceCut }) => evidenceCut === cut.index,
      );
      const expectedCurrentCut =
        candidateEvents.length + cut.goldEvents.length - 1;
      const requestId = `proposal:${testCase.contract.id}:${cut.index}`;
      const proposal = {
        schema: "covenant.timeline.model-proposal.v1",
        requestId,
        changes: cut.goldEvents.map((event) =>
          proposalChange(event, evidence, assertionIds),
        ),
        query: queryIntent(cut.goldQuery, expectedCurrentCut, knowledgeCuts),
      };
      const baseRun = runDocument(testCase.contract, candidateEvents);
      const candidate = compileTemporalModelProposalV1(proposal, {
        run: baseRun,
        expectedRequestId: requestId,
        evidenceCatalog: evidence.map(({ id, text }) => ({
          id,
          status: "current",
          text,
        })),
        referenceCatalog: references,
        assertionCatalog: [...assertionIds].map(
          ([goldAssertionId, candidateAssertionId]) => ({
            handle: assertionHandle(goldAssertionId),
            assertionId: candidateAssertionId,
          }),
        ),
        knowledgeCutCatalog: knowledgeCuts,
      });

      assert.equal(
        validateCandidate(candidate),
        true,
        `${testCase.id} cut ${cut.index}: candidate schema: ${JSON.stringify(validateCandidate.errors)}`,
      );
      assert.equal(
        candidate.candidateEvents.length,
        cut.goldEvents.length,
        `${testCase.id} cut ${cut.index}: candidate event count`,
      );
      bindAssertionIds(
        testCase.id,
        cut.index,
        cut.goldEvents,
        candidate.candidateEvents,
        assertionIds,
        reverseAssertionIds,
      );

      candidateEvents = [...candidateEvents, ...candidate.candidateEvents];
      goldEvents = [...goldEvents, ...cut.goldEvents];
      const candidateRun = runDocument(testCase.contract, candidateEvents);
      const goldRun = runDocument(testCase.contract, goldEvents);

      assert.deepEqual(
        semanticState(candidateRun),
        semanticState(goldRun),
        `${testCase.id} cut ${cut.index}: projected state`,
      );
      assert.deepEqual(
        candidate.candidateQuery,
        parseQueryV0Alpha3(candidate.candidateQuery, candidateRun),
        `${testCase.id} cut ${cut.index}: compiled query`,
      );
      const conclusion = reasonTemporalQueryV0Alpha3(
        candidateRun,
        candidate.candidateQuery,
      );
      assert.deepEqual(
        conclusion.result,
        cut.expectedResult,
        `${testCase.id} cut ${cut.index}: semantic result`,
      );
      assert.equal(
        verifyTemporalConclusionV0Alpha3(
          candidateRun,
          candidate.candidateQuery,
          conclusion,
        ),
        true,
        `${testCase.id} cut ${cut.index}: proof verification`,
      );

      knowledgeCuts.push({
        handle: knowledgeCutHandle(cut.index),
        recordedThrough:
          candidateEvents.length === 0 ? null : candidateEvents.length - 1,
      });
      compiledCuts += 1;
    }
  }

  assert.equal(compiledCuts, 36);
});

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

function referenceCatalog(testCase) {
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

function bindAssertionIds(
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

function sameEventSemantics(gold, candidate, reverseAssertionIds) {
  if (gold.type !== candidate.type) return false;
  if (gold.type === "assertion.retracted") {
    return (
      reverseAssertionIds.get(candidate.assertionId) === gold.assertionId &&
      canonicalJson(candidate.evidenceRefs) === canonicalJson(gold.evidenceRefs)
    );
  }
  if (
    gold.type !== "coordinate.asserted" &&
    gold.type !== "constraint.asserted"
  ) {
    return false;
  }
  const candidateAssertion = {
    ...candidate.assertion,
    id: gold.assertion.id,
    ...(candidate.assertion.supersedes
      ? {
          supersedes: candidate.assertion.supersedes.map((id) =>
            reverseAssertionIds.get(id),
          ),
        }
      : {}),
  };
  return canonicalJson(candidateAssertion) === canonicalJson(gold.assertion);
}

function semanticState(run) {
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

function normalizeAssertion({ id: _id, supersedes: _supersedes, ...value }) {
  return value;
}

function compareJson(left, right) {
  return canonicalJson(left).localeCompare(canonicalJson(right), "en");
}

function runDocument(contract, events) {
  return parseRunDocumentV0Alpha3({
    schema: "covenant.timeline.run.v0alpha3",
    contract,
    events,
  });
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

function knowledgeCutHandle(cut) {
  return `cut:${cut}`;
}

function pointHandle(id) {
  return `point:${id}`;
}

function pointRelationHandle(left, right) {
  return `point-relation:${left}:${right}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

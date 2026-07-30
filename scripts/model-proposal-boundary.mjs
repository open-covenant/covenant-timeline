import Ajv2020 from "ajv/dist/2020.js";
import {
  TemporalModelProposalErrorV1,
  canonicalJson,
  compileTemporalModelProposalV1,
  contentDigest,
  createTemporalModelProposalOutputSchemaV1,
  projectTemporalStateV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
  verifyTemporalModelProposalCandidateV1,
} from "../packages/prototype/dist/index.js";
import {
  createRunDocument,
  projectSemanticState,
} from "./model-proposal-fixtures.mjs";

export const MODEL_PROPOSAL_BOUNDARY_BENCHMARK = "model-proposal-boundary-v1";
export const MODEL_PROPOSAL_BOUNDARY_REQUEST_SCHEMA =
  "covenant.timeline.model-eval.request.v1";
export const MODEL_PROPOSAL_BOUNDARY_RESULT_SCHEMA =
  "covenant.timeline.model-proposal-eval.result.v1";
export const MODEL_PROPOSAL_BOUNDARY_CONTINUITY_BYTES = 4 * 1024;

const MAX_ERROR_MESSAGE_LENGTH = 480;

export class ModelProposalBoundaryError extends Error {
  constructor(
    message,
    { code = "proposal-eval.invalid", stage = "harness" } = {},
  ) {
    super(message);
    this.name = "ModelProposalBoundaryError";
    this.code = code;
    this.stage = stage;
  }
}

export function createBoundaryReferenceScope(testCase) {
  const hostCatalog = [];
  const modelCatalog = [];
  const byHandle = new Map();
  const contextHandleById = new Map();
  const pointHandleById = new Map();
  const differenceHandleByPair = new Map();
  const pointRelationHandleByPair = new Map();
  const intervalRelationHandleByPair = new Map();
  const points = testCase.setupEvents
    .filter(({ type }) => type === "point.declared")
    .map(({ point }) => point);
  const pointById = new Map(points.map((point) => [point.id, point]));
  const intervals = testCase.setupEvents
    .filter(({ type }) => type === "interval.declared")
    .map(({ interval }) => {
      const start = pointById.get(interval.startPointId);
      if (!start) {
        throw new ModelProposalBoundaryError(
          `interval ${interval.id} has no declared start point`,
        );
      }
      return { ...interval, axisId: start.axisId };
    });
  const add = (prefix, hostEntry, modelEntry) => {
    const handle = `${prefix}-${String(hostCatalog.length + 1).padStart(3, "0")}`;
    const hostValue = { ...hostEntry, handle };
    const modelValue = { ...modelEntry, handle };
    hostCatalog.push(hostValue);
    modelCatalog.push(modelValue);
    byHandle.set(handle, hostValue);
    return handle;
  };

  for (const context of testCase.contract.contexts) {
    const handle = add(
      "context",
      { type: "context", contextId: context.id },
      {
        type: "context",
        mode: context.mode,
        label: `${context.mode} temporal context`,
      },
    );
    contextHandleById.set(context.id, handle);
  }
  for (const point of points) {
    const handle = add(
      "point",
      { type: "point", pointId: point.id },
      {
        type: "point",
        context: contextHandleById.get(point.contextId),
        label: entityLabel(testCase, point.id),
      },
    );
    pointHandleById.set(point.id, handle);
  }
  for (const from of points) {
    for (const to of points) {
      if (
        from.id === to.id ||
        from.contextId !== to.contextId ||
        from.axisId !== to.axisId
      ) {
        continue;
      }
      const differenceHandle = add(
        "difference",
        {
          type: "difference",
          fromPointId: from.id,
          toPointId: to.id,
        },
        {
          type: "difference",
          context: contextHandleById.get(from.contextId),
          from: entityLabel(testCase, from.id),
          to: entityLabel(testCase, to.id),
          meaning: `${entityLabel(testCase, to.id)} minus ${entityLabel(testCase, from.id)}`,
        },
      );
      differenceHandleByPair.set(pairKey(from.id, to.id), differenceHandle);

      const relationHandle = add(
        "point-relation",
        {
          type: "point-relation",
          leftPointId: from.id,
          rightPointId: to.id,
        },
        {
          type: "point-relation",
          context: contextHandleById.get(from.contextId),
          left: entityLabel(testCase, from.id),
          right: entityLabel(testCase, to.id),
        },
      );
      pointRelationHandleByPair.set(pairKey(from.id, to.id), relationHandle);
    }
  }
  for (const left of intervals) {
    for (const right of intervals) {
      if (
        left.id === right.id ||
        left.contextId !== right.contextId ||
        left.axisId !== right.axisId
      ) {
        continue;
      }
      const handle = add(
        "interval-relation",
        {
          type: "interval-relation",
          leftIntervalId: left.id,
          rightIntervalId: right.id,
        },
        {
          type: "interval-relation",
          context: contextHandleById.get(left.contextId),
          left: entityLabel(testCase, left.id),
          right: entityLabel(testCase, right.id),
        },
      );
      intervalRelationHandleByPair.set(pairKey(left.id, right.id), handle);
    }
  }

  return {
    hostCatalog,
    modelCatalog,
    byHandle,
    contextHandleById,
    pointHandleById,
    differenceHandleByPair,
    pointRelationHandleByPair,
    intervalRelationHandleByPair,
  };
}

export function createBoundaryTrajectory(testCase) {
  const run = createRunDocument(testCase.contract, testCase.setupEvents);
  const assertionHandles = new Map();
  let nextAssertionOrdinal = 1;
  for (const event of run.events) {
    if (!event.assertion) continue;
    assertionHandles.set(
      event.assertion.id,
      assertionHandle(nextAssertionOrdinal),
    );
    nextAssertionOrdinal += 1;
  }
  return {
    run,
    assertionHandles,
    knowledgeCuts: [],
    nextAssertionOrdinal,
  };
}

export function createBoundaryObservation({
  testCase,
  cut,
  trajectory,
  referenceScope,
  requestId,
}) {
  const evidence = testCase.evidence.filter(
    ({ cut: evidenceCut }) => evidenceCut === cut.index,
  );
  const assertionView = activeAssertionView(
    trajectory.run,
    trajectory.assertionHandles,
    referenceScope,
    testCase,
  );
  const knowledgeCutView = trajectory.knowledgeCuts.map(({ handle }) => ({
    handle,
  }));
  const host = {
    run: trajectory.run,
    expectedRequestId: requestId,
    evidenceCatalog: evidence.map(({ id, text }) => ({
      id,
      status: "current",
      text,
    })),
    referenceCatalog: referenceScope.hostCatalog,
    assertionCatalog: [...trajectory.assertionHandles].map(
      ([assertionId, handle]) => ({ handle, assertionId }),
    ),
    knowledgeCutCatalog: trajectory.knowledgeCuts.map(
      ({ handle, recordedThrough }) => ({ handle, recordedThrough }),
    ),
  };
  const outputSchema = createTemporalModelProposalOutputSchemaV1(host, {
    maxChanges: 8,
    maxSupportsPerChange: 4,
  });
  const outputSchemaText = canonicalJson(outputSchema);
  const continuity = {
    assertions: assertionView,
    knowledgeCuts: knowledgeCutView,
  };

  return {
    host,
    input: {
      question: cut.question,
      evidence: evidence.map(({ id, text }) => ({ id, text })),
      references: referenceScope.modelCatalog,
      priorState: continuity,
    },
    outputSchema,
    outputSchemaText,
    outputSchemaDigest: contentDigest(outputSchema),
    priorStateBytes: Buffer.byteLength(canonicalJson(continuity), "utf8"),
  };
}

export function createBoundaryAdapterRequest({
  requestId,
  prompt,
  observation,
  config,
}) {
  return {
    schema: MODEL_PROPOSAL_BOUNDARY_REQUEST_SCHEMA,
    benchmark: MODEL_PROPOSAL_BOUNDARY_BENCHMARK,
    arm: "proposal",
    requestId,
    prompt,
    input: observation.input,
    outputSchema: observation.outputSchema,
    outputSchemaDigest: observation.outputSchemaDigest,
    config,
    configDigest: contentDigest(config),
  };
}

export function validateBoundaryProviderOutput(value, observation) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(observation.outputSchema);
  if (validate(value)) return;
  const message = (validate.errors ?? [])
    .slice(0, 8)
    .map(
      ({ instancePath, message: issueMessage }) =>
        `${instancePath || "$"} ${issueMessage ?? "is invalid"}`,
    )
    .join("; ");
  throw new ModelProposalBoundaryError(
    boundedMessage(`provider proposal failed its output schema: ${message}`),
    { code: "proposal.schema", stage: "schema" },
  );
}

export function evaluateBoundaryProposal({
  proposal,
  observation,
  trajectory,
  testCase,
  cut,
  referenceScope,
}) {
  validateBoundaryProviderOutput(proposal, observation);

  let candidate;
  try {
    candidate = compileTemporalModelProposalV1(proposal, observation.host, {
      maxChanges: 8,
      maxSupportsPerChange: 4,
    });
  } catch (error) {
    if (error instanceof TemporalModelProposalErrorV1) {
      return {
        compiled: false,
        applied: false,
        error: {
          stage: "compiler",
          code: error.code,
          message: boundedMessage(error.message),
          issues: error.issues,
        },
        trajectory: completeBoundaryCut(trajectory, cut.index),
      };
    }
    throw error;
  }
  if (
    !verifyTemporalModelProposalCandidateV1(
      candidate,
      proposal,
      observation.host,
      {
        maxChanges: 8,
        maxSupportsPerChange: 4,
      },
    )
  ) {
    throw new ModelProposalBoundaryError(
      "candidate re-verification failed after compilation",
      { code: "proposal.candidate-verification", stage: "harness" },
    );
  }

  const staged = stageCandidate(trajectory, candidate, testCase.contract);
  const stateView = activeAssertionView(
    staged.run,
    staged.assertionHandles,
    referenceScope,
    testCase,
  );
  const nextCutView = [
    ...trajectory.knowledgeCuts.map(({ handle }) => ({
      handle,
    })),
    { handle: cutHandle(cut.index) },
  ];
  const continuityBytes = Buffer.byteLength(
    canonicalJson({
      assertions: stateView,
      knowledgeCuts: nextCutView,
    }),
    "utf8",
  );
  if (continuityBytes > MODEL_PROPOSAL_BOUNDARY_CONTINUITY_BYTES) {
    return {
      compiled: true,
      applied: false,
      candidate,
      continuityBytes,
      error: {
        stage: "continuity",
        code: "proposal.continuity-limit",
        message: `model-visible continuity state exceeds ${MODEL_PROPOSAL_BOUNDARY_CONTINUITY_BYTES} bytes`,
      },
      trajectory: completeBoundaryCut(trajectory, cut.index),
    };
  }

  const conclusion = reasonTemporalQueryV0Alpha3(
    staged.run,
    candidate.candidateQuery,
  );
  const proofVerified = verifyTemporalConclusionV0Alpha3(
    staged.run,
    candidate.candidateQuery,
    conclusion,
  );
  if (!proofVerified) {
    throw new ModelProposalBoundaryError(
      "kernel returned a conclusion whose proof did not verify",
      { code: "proposal.proof-verification", stage: "harness" },
    );
  }
  const nextTrajectory = completeBoundaryCut(staged, cut.index);
  const metrics = boundaryObservationMetrics({
    proposal,
    candidate,
    candidateRun: staged.run,
    priorRun: trajectory.run,
    testCase,
    cut,
    trajectory,
    referenceScope,
    conclusion,
  });

  return {
    compiled: true,
    applied: true,
    candidate,
    conclusion,
    proofVerified,
    continuityBytes,
    metrics,
    trajectory: nextTrajectory,
  };
}

export function boundaryObservationMetrics({
  proposal,
  candidate,
  candidateRun,
  priorRun,
  testCase,
  cut,
  trajectory,
  referenceScope,
  conclusion,
}) {
  const goldRun = goldRunAtCut(testCase, cut.index);
  const candidateAtoms = stateAtoms(projectSemanticState(candidateRun));
  const goldAtoms = stateAtoms(projectSemanticState(goldRun));
  const candidateDelta = deltaAtoms(candidate.candidateEvents, priorRun);
  const goldPriorRun =
    cut.index === 0
      ? createRunDocument(testCase.contract, testCase.setupEvents)
      : goldRunAtCut(testCase, cut.index - 1);
  const goldDelta = deltaAtoms(cut.goldEvents, goldPriorRun);
  const representation = setMetrics(candidateDelta, goldDelta);
  const queryExact = proposalQueryExact({
    proposal,
    testCase,
    cut,
    trajectory,
    referenceScope,
  });
  const answerExact =
    canonicalJson(conclusion.result) === canonicalJson(cut.expectedResult);
  const projectedStateExact = setsEqual(candidateAtoms, goldAtoms);

  return {
    assertionPrecision: representation.precision,
    assertionRecall: representation.recall,
    assertionF1: representation.f1,
    projectedStateExact,
    queryExact,
    evidenceAttributionExact: representation.f1 === 1,
    answerExact,
    proofVerified: true,
    endToEndExact:
      projectedStateExact &&
      queryExact &&
      representation.f1 === 1 &&
      answerExact,
  };
}

export function completeBoundaryCut(trajectory, cutIndex) {
  const recordedThrough =
    trajectory.run.events.length === 0
      ? null
      : trajectory.run.events.length - 1;
  return {
    ...trajectory,
    knowledgeCuts: [
      ...trajectory.knowledgeCuts,
      { handle: cutHandle(cutIndex), cutIndex, recordedThrough },
    ],
  };
}

function stageCandidate(trajectory, candidate, contract) {
  const assertionHandles = new Map(trajectory.assertionHandles);
  let nextAssertionOrdinal = trajectory.nextAssertionOrdinal;
  for (const event of candidate.candidateEvents) {
    if (!event.assertion) continue;
    assertionHandles.set(
      event.assertion.id,
      assertionHandle(nextAssertionOrdinal),
    );
    nextAssertionOrdinal += 1;
  }
  return {
    ...trajectory,
    run: createRunDocument(contract, [
      ...trajectory.run.events,
      ...candidate.candidateEvents,
    ]),
    assertionHandles,
    nextAssertionOrdinal,
  };
}

function activeAssertionView(run, assertionHandles, referenceScope, testCase) {
  const assertions = [];
  const recordedThrough =
    run.events.length === 0 ? null : run.events.length - 1;
  for (const context of run.contract.contexts) {
    const state = projectTemporalStateV0Alpha3(
      run,
      context.id,
      recordedThrough,
    );
    for (const assertion of state.coordinates) {
      const handle = assertionHandles.get(assertion.id);
      const target = referenceScope.pointHandleById.get(assertion.pointId);
      if (!handle || !target) continue;
      assertions.push({
        handle,
        type: "coordinate",
        target,
        bounds: assertion.coordinate,
      });
    }
    for (const assertion of state.constraints) {
      const handle = assertionHandles.get(assertion.id);
      const target = referenceScope.differenceHandleByPair.get(
        pairKey(
          assertion.constraint.fromPointId,
          assertion.constraint.toPointId,
        ),
      );
      if (!handle || !target) continue;
      assertions.push({
        handle,
        type: "constraint",
        target,
        bounds: {
          ...(assertion.constraint.minimum === undefined
            ? {}
            : { minimum: assertion.constraint.minimum }),
          ...(assertion.constraint.maximum === undefined
            ? {}
            : { maximum: assertion.constraint.maximum }),
        },
      });
    }
    for (const assertion of state.facts) {
      const handle = assertionHandles.get(assertion.id);
      if (!handle) continue;
      assertions.push({
        handle,
        type: "fact",
        proposition: entityLabel(testCase, assertion.propositionRef),
        ...(assertion.validDuring === undefined
          ? {}
          : { validDuring: entityLabel(testCase, assertion.validDuring) }),
        ...(assertion.observedAt === undefined
          ? {}
          : { observedAt: entityLabel(testCase, assertion.observedAt) }),
        ...(assertion.assertedAt === undefined
          ? {}
          : { assertedAt: entityLabel(testCase, assertion.assertedAt) }),
      });
    }
  }
  return assertions.sort((left, right) =>
    left.handle.localeCompare(right.handle, "en"),
  );
}

function proposalQueryExact({
  proposal,
  testCase,
  cut,
  trajectory,
  referenceScope,
}) {
  const query = proposal?.query;
  const reference = referenceScope.byHandle.get(query?.targetHandle);
  if (!reference || !queryTypeMatchesReference(query.type, reference.type)) {
    return false;
  }
  const expectedBody = queryBody(cut.goldQuery);
  const actualBody = queryBodyFromReference(query.type, reference);
  if (canonicalJson(actualBody) !== canonicalJson(expectedBody)) return false;

  const expectedCut = expectedKnowledgeCut(testCase, cut);
  if (query.knowledgeCut?.type !== expectedCut.type) return false;
  if (expectedCut.type === "current") return true;
  const selected = trajectory.knowledgeCuts.find(
    ({ handle }) => handle === query.knowledgeCut.cutHandle,
  );
  return selected?.cutIndex === expectedCut.cutIndex;
}

function expectedKnowledgeCut(testCase, cut) {
  const sequences = [];
  let events = testCase.setupEvents.length;
  for (const candidateCut of testCase.cuts) {
    events += candidateCut.goldEvents.length;
    sequences.push(events === 0 ? null : events - 1);
  }
  if (cut.goldQuery.recordedThrough === sequences[cut.index]) {
    return { type: "current" };
  }
  const cutIndex = sequences
    .slice(0, cut.index)
    .findIndex((sequence) => sequence === cut.goldQuery.recordedThrough);
  return cutIndex < 0 ? { type: "invalid" } : { type: "prior", cutIndex };
}

function queryBody(query) {
  if (query.type === "context.consistency") {
    return { type: query.type, contextId: query.contextId };
  }
  if (query.type === "difference.bounds") {
    return {
      type: query.type,
      fromPointId: query.fromPointId,
      toPointId: query.toPointId,
    };
  }
  if (query.type === "point.relations") {
    return {
      type: query.type,
      leftPointId: query.leftPointId,
      rightPointId: query.rightPointId,
    };
  }
  return {
    type: query.type,
    leftIntervalId: query.leftIntervalId,
    rightIntervalId: query.rightIntervalId,
  };
}

function queryBodyFromReference(type, reference) {
  if (type === "consistency" && reference.type === "context") {
    return { type: "context.consistency", contextId: reference.contextId };
  }
  if (type === "difference" && reference.type === "difference") {
    return {
      type: "difference.bounds",
      fromPointId: reference.fromPointId,
      toPointId: reference.toPointId,
    };
  }
  if (type === "point-relation" && reference.type === "point-relation") {
    return {
      type: "point.relations",
      leftPointId: reference.leftPointId,
      rightPointId: reference.rightPointId,
    };
  }
  if (type === "interval-relation" && reference.type === "interval-relation") {
    return {
      type: "interval.relations",
      leftIntervalId: reference.leftIntervalId,
      rightIntervalId: reference.rightIntervalId,
    };
  }
  return { type: "invalid" };
}

function queryTypeMatchesReference(queryType, referenceType) {
  return (
    (queryType === "consistency" && referenceType === "context") ||
    (queryType === "difference" && referenceType === "difference") ||
    (queryType === "point-relation" && referenceType === "point-relation") ||
    (queryType === "interval-relation" && referenceType === "interval-relation")
  );
}

function goldRunAtCut(testCase, cutIndex) {
  return createRunDocument(testCase.contract, [
    ...testCase.setupEvents,
    ...testCase.cuts
      .slice(0, cutIndex + 1)
      .flatMap(({ goldEvents }) => goldEvents),
  ]);
}

function stateAtoms(states) {
  return new Set(
    states.flatMap((state) =>
      ["coordinates", "constraints", "facts"].flatMap((kind) =>
        state[kind].map((assertion) =>
          canonicalJson({
            contextId: state.contextId,
            kind,
            assertion,
          }),
        ),
      ),
    ),
  );
}

function deltaAtoms(events, priorRun) {
  return new Set(
    events.map((event) => canonicalJson(normalizeDeltaEvent(event, priorRun))),
  );
}

function normalizeDeltaEvent(event, priorRun) {
  if (event.type === "assertion.retracted") {
    return {
      type: event.type,
      target: assertionSemantics(priorRun, event.assertionId),
      evidenceRefs: [...event.evidenceRefs].sort(),
    };
  }
  const {
    id: _id,
    supersedes = [],
    evidenceRefs,
    ...assertion
  } = event.assertion;
  return {
    type: event.type,
    assertion: {
      ...assertion,
      evidenceRefs: [...evidenceRefs].sort(),
    },
    revision:
      supersedes.length === 0
        ? "keep"
        : supersedes
            .map((id) => assertionSemantics(priorRun, id))
            .sort(compareJson),
  };
}

function assertionSemantics(run, assertionId) {
  for (const event of run.events) {
    if (event.assertion?.id !== assertionId) continue;
    const {
      id: _id,
      supersedes: _supersedes,
      evidenceRefs,
      ...body
    } = event.assertion;
    return {
      type: event.type,
      body: {
        ...body,
        evidenceRefs: [...evidenceRefs].sort(),
      },
    };
  }
  return { missing: true };
}

function setMetrics(actual, expected) {
  let matches = 0;
  for (const value of actual) {
    if (expected.has(value)) matches += 1;
  }
  const precision =
    actual.size === 0 ? (expected.size === 0 ? 1 : 0) : matches / actual.size;
  const recall =
    expected.size === 0 ? (actual.size === 0 ? 1 : 0) : matches / expected.size;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function compareJson(left, right) {
  return canonicalJson(left).localeCompare(canonicalJson(right), "en");
}

function entityLabel(testCase, id) {
  const label = testCase.entities[id];
  if (typeof label === "string" && label.length > 0) return label;
  throw new ModelProposalBoundaryError(
    `benchmark entity ${id} has no model-visible label`,
  );
}

function pairKey(left, right) {
  return `${left}\u0000${right}`;
}

function assertionHandle(index) {
  return `assertion-${String(index).padStart(3, "0")}`;
}

function cutHandle(index) {
  return `cut-${String(index + 1).padStart(3, "0")}`;
}

function boundedMessage(value) {
  const sanitized = String(value).replace(/[\u0000-\u001f\u007f]/gu, " ");
  return sanitized.length <= MAX_ERROR_MESSAGE_LENGTH
    ? sanitized
    : `${sanitized.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3)}...`;
}

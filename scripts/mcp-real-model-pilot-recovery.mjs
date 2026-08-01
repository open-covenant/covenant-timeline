import {
  REAL_MODEL_PILOT_PROPOSAL_LIMITS,
  createAdapterRequest,
  createProposalScope,
  parseAdapterExecution,
  redactAdapterRequest,
  validateProposalSemantics,
  validateProviderProposal,
} from "./mcp-real-model-pilot-lib.mjs";
import {
  createAdapterExecutionDocumentV2,
  expectedRecoveryFailureV2,
  phaseFailureRecordV2,
  recoveryDispositionV2,
} from "./mcp-real-model-pilot-failure.mjs";

export function createAdapterExecutionDocument({
  phase,
  input,
  binding,
  runtime,
  admissionPolicy,
  invocation,
  mcpInvocation,
  request,
  scope,
  baseRun,
  baseAudit,
  execution,
}) {
  const { evidence, request: redactedRequest } = redactAdapterRequest(request);
  return createAdapterExecutionDocumentV2({
    phase,
    input,
    binding,
    runtime,
    policy: admissionPolicy,
    invocation,
    mcpInvocation,
    request,
    redactedRequest,
    catalogs: {
      evidence,
      references: scope.host.referenceCatalog,
      assertions: scope.host.assertionCatalog,
      knowledgeCuts: scope.host.knowledgeCutCatalog,
    },
    baseRun,
    baseAudit,
    execution,
  });
}

export function validateAdapterCaptureBinding({
  adapterBundle,
  started,
  binding,
  input,
  modelConfig,
  runtime,
  policy,
}) {
  const adapter = adapterBundle.document;
  const publication = adapter.baseRun.events.find(
    (event) =>
      event.type === "coordinate.asserted" &&
      event.assertion.pointId === "artifacts-published",
  );
  const scope = createProposalScope({
    phase: adapter.phase,
    input,
    run: adapter.baseRun,
    initialAssertionId:
      adapter.phase === "correction" ? publication?.assertion.id : undefined,
  });
  const expected = createAdapterRequest({
    input,
    scope,
    config: modelConfig.config,
  });
  const expectedDocument = createAdapterExecutionDocument({
    phase: adapter.phase,
    input,
    binding,
    runtime: runtime.identity,
    admissionPolicy: policy.document,
    invocation: started.invocation,
    mcpInvocation: started.mcpInvocation,
    request: expected.request,
    scope,
    baseRun: adapter.baseRun,
    baseAudit: adapter.baseAudit,
    execution: adapter.execution,
  });
  if (
    input.timeline.canonicalJson(expectedDocument) !==
      input.timeline.canonicalJson(adapter) ||
    adapter.requestDigest !== started.requestDigest ||
    adapter.baseRun.events.length !== started.baseRevision ||
    input.timeline.contentDigest(adapter.baseRun) !== started.baseRunDigest
  ) {
    throw new Error(`${adapter.phase} adapter capture binding changed`);
  }
  return { ...expected, scope };
}

export function validateProposalReadyBinding({
  proposalReadyBundle,
  adapterBundle,
  captureBinding,
  input,
  policy,
}) {
  const ready = proposalReadyBundle.document;
  const adapter = adapterBundle.document;
  const expectedInput = {
    runId: input.contract.id,
    expectedRevision: adapter.baseRun.events.length,
    expectedRunDigest: input.timeline.contentDigest(adapter.baseRun),
    expectedRequestId: captureBinding.scope.host.expectedRequestId,
    proposal: ready.proposal,
    evidenceCatalog: captureBinding.scope.host.evidenceCatalog,
    referenceCatalog: captureBinding.scope.host.referenceCatalog,
    assertionCatalog: captureBinding.scope.host.assertionCatalog,
    knowledgeCutCatalog: captureBinding.scope.host.knowledgeCutCatalog,
  };
  const replayed = replayLocalFailure({
    adapter,
    input,
    outputSchema: captureBinding.outputSchema,
  });
  const parsed = parseAdapterExecution(adapter.execution, input.timeline);
  const { proposal } = validateProviderProposal(
    parsed.response,
    captureBinding.outputSchema,
  );
  if (
    replayed ||
    ready.adapterExecutionDigest !== adapterBundle.digest ||
    ready.requestDigest !== adapter.requestDigest ||
    ready.baseRevision !== adapter.baseRun.events.length ||
    ready.baseRunDigest !== input.timeline.contentDigest(adapter.baseRun) ||
    ready.admissionPolicyDigest !== policy.digest ||
    input.timeline.canonicalJson(ready.proposal) !==
      input.timeline.canonicalJson(proposal) ||
    input.timeline.canonicalJson(ready.proposalInput) !==
      input.timeline.canonicalJson(expectedInput)
  ) {
    throw new Error(`${adapter.phase} proposal-ready binding changed`);
  }
  verifyProposalPreview({
    preview: ready.preview,
    proposal: ready.proposal,
    scope: captureBinding.scope,
    run: adapter.baseRun,
    input,
    runDigest: ready.baseRunDigest,
  });
}

export function validateRecoveredFailure({
  adapterBundle,
  failureBundle,
  started,
  binding,
  input,
  modelConfig,
  runtime,
  policy,
  proposalReadyBundle,
  phaseDecisionBundle,
  recoveryObservationBundle,
}) {
  const adapter = adapterBundle.document;
  const failure = failureBundle.document;
  const captureBinding = validateAdapterCaptureBinding({
    adapterBundle,
    started,
    binding,
    input,
    modelConfig,
    runtime,
    policy,
  });
  const replayedFailure = replayLocalFailure({
    adapter,
    input,
    outputSchema: captureBinding.outputSchema,
  });
  const localStage = [
    "adapter-execution",
    "adapter-output",
    "proposal-schema",
    "proposal-semantics",
  ].includes(failure.failure.stage);
  const postAdmissionFailure =
    failure.failure.stage === "post-admission-verification" &&
    proposalReadyBundle !== null &&
    recoveryDispositionV2({
      adapter,
      ready: proposalReadyBundle.document,
      mcpRun: failure.mcpRun,
      mcpAudit: failure.mcpAudit,
      timeline: input.timeline,
    }) === "exact-admission";
  const recoveryClassification = recoveryObservationBundle
    ? postAdmissionFailure &&
      recoveryObservationBundle.document.disposition === "exact-admission"
      ? failure.failure
      : expectedRecoveryFailureV2({
          observation: recoveryObservationBundle.document,
          hasProposalReady: proposalReadyBundle !== null,
          replayedFailure,
        })
    : null;
  if (
    failure.adapterExecutionDigest !== adapterBundle.digest ||
    failure.proposalReadyDigest !== (proposalReadyBundle?.digest ?? null) ||
    failure.phaseDecisionDigest !== (phaseDecisionBundle?.digest ?? null) ||
    failure.recoveryObservationDigest !==
      (recoveryObservationBundle?.digest ?? null) ||
    (recoveryClassification &&
      (failure.failure.stage !== recoveryClassification.stage ||
        failure.failure.code !== recoveryClassification.code)) ||
    (localStage &&
      (!replayedFailure ||
        replayedFailure.stage !== failure.failure.stage ||
        replayedFailure.code !== failure.failure.code)) ||
    (localStage &&
      (input.timeline.canonicalJson(failure.mcpRun) !==
        input.timeline.canonicalJson(adapter.baseRun) ||
        input.timeline.canonicalJson(failure.mcpAudit) !==
          input.timeline.canonicalJson(adapter.baseAudit))) ||
    (failure.failure.stage === "post-admission-verification" &&
      !postAdmissionFailure) ||
    (postAdmissionFailure &&
      phaseDecisionBundle?.document.decision !== "admission-authorized") ||
    (recoveryObservationBundle &&
      (input.timeline.canonicalJson(failure.mcpRun) !==
        input.timeline.canonicalJson(
          recoveryObservationBundle.document.mcpRun,
        ) ||
        input.timeline.canonicalJson(failure.mcpAudit) !==
          input.timeline.canonicalJson(
            recoveryObservationBundle.document.mcpAudit,
          )))
  ) {
    throw new Error(`${adapter.phase} failed phase evidence binding changed`);
  }
}

export function replayLocalFailure({ adapter, input, outputSchema }) {
  let stage = "adapter-output";
  try {
    const parsed = parseAdapterExecution(adapter.execution, input.timeline);
    stage = "proposal-schema";
    const { proposal } = validateProviderProposal(
      parsed.response,
      outputSchema,
    );
    stage = "proposal-semantics";
    validateProposalSemantics(adapter.phase, proposal, input.pilot.expected);
    return null;
  } catch (error) {
    return phaseFailureRecordV2(error, stage);
  }
}

export function verifyProposalPreview({
  preview,
  proposal,
  scope,
  run,
  input,
  runDigest,
}) {
  const timeline = input.timeline;
  const candidate = timeline.compileTemporalModelProposalV1(
    proposal,
    scope.host,
    REAL_MODEL_PILOT_PROPOSAL_LIMITS,
  );
  const returnedCandidate = {
    ...candidate,
    candidateEvents: preview.events,
    candidateQuery: preview.query,
    provenance: preview.provenance,
  };
  const candidateRun = timeline.parseRunDocumentV0Alpha3({
    ...run,
    events: [...run.events, ...preview.events],
  });
  if (
    preview.verified !== true ||
    preview.persistence !== "not-admitted" ||
    preview.candidateDigest !== timeline.contentDigest(candidate) ||
    preview.proposalDigest !== timeline.contentDigest(proposal) ||
    preview.baseRevision !== run.events.length ||
    preview.baseRunDigest !== runDigest ||
    preview.timeline?.revision !== run.events.length ||
    preview.timeline?.runDigest !== runDigest ||
    timeline.canonicalJson(candidate) !==
      timeline.canonicalJson(returnedCandidate) ||
    !timeline.verifyTemporalConclusionV0Alpha3(
      candidateRun,
      preview.query,
      preview.conclusion,
    )
  ) {
    throw new Error("model proposal preview did not verify");
  }
}

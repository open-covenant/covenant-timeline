import { randomUUID } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { decodeUtf8, readBoundedExactFile } from "./mcp-agent-pilot-lib.mjs";
import {
  isAdapterFailure,
  validateAdapterExecution,
  validateMcpWriterTrajectory,
} from "./mcp-real-model-pilot-lib.mjs";

export const FAILURE_STATE_BYTES = 16 * 1024 * 1024;

const ADAPTER_CAPTURE_SCHEMA =
  "covenant.timeline.real-model-pilot.adapter-execution.v2";
const PROPOSAL_READY_SCHEMA =
  "covenant.timeline.real-model-pilot.proposal-ready.v2";
const PHASE_FAILURE_SCHEMA =
  "covenant.timeline.real-model-pilot.phase-failure.v2";
const RECOVERY_OBSERVATION_SCHEMA =
  "covenant.timeline.real-model-pilot.recovery-observation.v2";
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PHASES = new Set(["initial", "correction"]);
const FAILURE_CODES = new Map([
  ["adapter-execution", new Set(["adapter.nonzero-exit"])],
  [
    "adapter-output",
    new Set([
      "adapter.error-envelope",
      "adapter.invalid-framing",
      "adapter.invalid-json",
      "adapter.invalid-utf8",
      "adapter.output-limit",
    ]),
  ],
  ["capture-recovery", new Set(["adapter.interrupted-before-proposal-ready"])],
  ["proposal-schema", new Set(["proposal.schema"])],
  ["proposal-preview", new Set(["proposal.preview"])],
  ["proposal-semantics", new Set(["proposal.semantics"])],
  ["proposal-admission", new Set(["proposal.admission"])],
  [
    "admission-recovery",
    new Set([
      "proposal.interrupted-before-admission",
      "proposal.mcp-state-diverged",
    ]),
  ],
  ["post-admission-verification", new Set(["proposal.post-admission"])],
]);
const HOST_FAILURE_CODE = Object.freeze({
  "proposal-schema": "proposal.schema",
  "proposal-preview": "proposal.preview",
  "proposal-semantics": "proposal.semantics",
  "proposal-admission": "proposal.admission",
  "post-admission-verification": "proposal.post-admission",
});

export function createAdapterExecutionDocumentV2({
  phase,
  input,
  binding,
  runtime,
  policy,
  invocation,
  mcpInvocation,
  request,
  redactedRequest,
  catalogs,
  baseRun,
  baseAudit,
  execution,
}) {
  const document = {
    schema: ADAPTER_CAPTURE_SCHEMA,
    phase,
    binding,
    runtime,
    admissionPolicy: policy,
    invocation,
    mcpInvocation,
    requestDigest: input.timeline.contentDigest(request),
    redactedRequest,
    catalogs,
    baseRun,
    baseAudit,
    execution,
  };
  return validateAdapterExecutionDocumentV2(document, input.timeline);
}

export function createProposalReadyDocumentV2({
  phase,
  adapterExecutionDigest,
  requestDigest,
  baseRun,
  proposal,
  usage,
  proposalInput,
  preview,
  admissionPolicyDigest,
  timeline,
}) {
  const document = {
    schema: PROPOSAL_READY_SCHEMA,
    phase,
    adapterExecutionDigest,
    requestDigest,
    baseRevision: baseRun.events.length,
    baseRunDigest: timeline.contentDigest(baseRun),
    proposal,
    proposalDigest: timeline.contentDigest(proposal),
    usage,
    proposalInput,
    preview,
    admissionPolicyDigest,
  };
  return validateProposalReadyDocumentV2(document, timeline);
}

export function createPhaseFailureDocumentV2({
  phase,
  adapterExecutionDigest,
  proposalReadyDigest = null,
  phaseDecisionDigest = null,
  failure,
  mcpObservation,
  observerInvocation = null,
  recoveryObservationDigest = null,
  mcpRun,
  mcpAudit,
  timeline,
}) {
  const document = {
    schema: PHASE_FAILURE_SCHEMA,
    phase,
    adapterExecutionDigest,
    proposalReadyDigest,
    phaseDecisionDigest,
    failure,
    mcpObservation,
    observerInvocation,
    recoveryObservationDigest,
    mcpRun,
    mcpRunDigest: timeline.contentDigest(mcpRun),
    mcpAudit,
    mcpAuditDigest: timeline.contentDigest(mcpAudit),
  };
  return validatePhaseFailureDocumentV2(document, timeline);
}

export function createRecoveryObservationDocumentV2({
  phase,
  adapterExecutionDigest,
  proposalReadyDigest,
  invocation,
  disposition,
  mcpRun,
  mcpAudit,
  timeline,
}) {
  const document = {
    schema: RECOVERY_OBSERVATION_SCHEMA,
    phase,
    adapterExecutionDigest,
    proposalReadyDigest,
    invocation,
    disposition,
    mcpRun,
    mcpRunDigest: timeline.contentDigest(mcpRun),
    mcpAudit,
    mcpAuditDigest: timeline.contentDigest(mcpAudit),
  };
  return validateRecoveryObservationDocumentV2(document, timeline);
}

export function phaseFailureRecordV2(error, stage) {
  const classifiedStage = isAdapterFailure(error) ? error.stage : stage;
  const code = isAdapterFailure(error)
    ? error.code
    : HOST_FAILURE_CODE[classifiedStage];
  const failure = { stage: classifiedStage, code };
  validatePhaseFailureRecordV2(failure);
  return failure;
}

export function recoveryFailureRecordV2(stage, code) {
  const failure = { stage, code };
  validatePhaseFailureRecordV2(failure);
  return failure;
}

export function recoveryDispositionV2({
  adapter,
  ready,
  mcpRun,
  mcpAudit,
  timeline,
}) {
  if (
    sameState(adapter.baseRun, adapter.baseAudit, mcpRun, mcpAudit, timeline)
  ) {
    return "exact-base";
  }
  if (
    ready &&
    exactAdmittedState({ adapter, ready, mcpRun, mcpAudit, timeline })
  ) {
    return "exact-admission";
  }
  if (exactRecoveryFenceState({ adapter, mcpRun, mcpAudit, timeline })) {
    return "exact-recovery-fence";
  }
  return "state-diverged";
}

export function recoveryFenceDraftV2(phase) {
  if (!PHASES.has(phase)) {
    throw new Error("recovery fence phase is invalid");
  }
  return {
    id: `event-${phase}-admission-recovery-fenced`,
    type: "point.declared",
    point: {
      id: `${phase}-admission-recovery-fence`,
      contextId: "actual",
      axisId: "unix-milliseconds",
    },
  };
}

export function expectedRecoveryFailureV2({
  observation,
  hasProposalReady,
  replayedFailure,
}) {
  if (observation.disposition === "state-diverged") {
    return recoveryFailureRecordV2(
      "admission-recovery",
      "proposal.mcp-state-diverged",
    );
  }
  if (observation.disposition === "exact-recovery-fence") {
    return hasProposalReady
      ? recoveryFailureRecordV2(
          "admission-recovery",
          "proposal.interrupted-before-admission",
        )
      : recoveryFailureRecordV2(
          "capture-recovery",
          "adapter.interrupted-before-proposal-ready",
        );
  }
  if (observation.disposition !== "exact-base") {
    throw new Error("a recovered exact admission cannot be terminally failed");
  }
  if (hasProposalReady) {
    return recoveryFailureRecordV2(
      "admission-recovery",
      "proposal.interrupted-before-admission",
    );
  }
  return (
    replayedFailure ??
    recoveryFailureRecordV2(
      "capture-recovery",
      "adapter.interrupted-before-proposal-ready",
    )
  );
}

export function terminalPhaseFailureV2(failure) {
  validatePhaseFailureRecordV2(failure);
  const error = new Error(
    `model phase failed at ${failure.stage} (${failure.code}); private evidence retained in pilot state`,
  );
  error.name = "TimelinePilotTerminalFailure";
  return error;
}

export function validateAdapterExecutionDocumentV2(document, timeline) {
  if (
    !record(document) ||
    keys(document) !==
      "admissionPolicy,baseAudit,baseRun,binding,catalogs,execution,invocation,mcpInvocation,phase,redactedRequest,requestDigest,runtime,schema" ||
    document.schema !== ADAPTER_CAPTURE_SCHEMA ||
    !PHASES.has(document.phase) ||
    !digest(document.requestDigest) ||
    !record(document.binding) ||
    !record(document.runtime) ||
    !record(document.admissionPolicy) ||
    timeline.contentDigest(document.runtime) !==
      document.binding.runtimeDigest ||
    timeline.byteDigest(
      Buffer.from(`${timeline.canonicalJson(document.admissionPolicy)}\n`),
    ) !== document.binding.admissionPolicyDigest ||
    timeline.contentDigest(document.baseRun) !== document.baseAudit.runDigest ||
    timeline.canonicalJson(document.baseAudit.run) !==
      timeline.canonicalJson(document.baseRun)
  ) {
    throw new Error("adapter execution capture is invalid");
  }
  validateAdapterExecution(document.execution);
  validateMcpWriterTrajectory(document.baseAudit);
  return document;
}

export function validateProposalReadyDocumentV2(document, timeline) {
  if (
    !record(document) ||
    keys(document) !==
      "adapterExecutionDigest,admissionPolicyDigest,baseRevision,baseRunDigest,phase,preview,proposal,proposalDigest,proposalInput,requestDigest,schema,usage" ||
    document.schema !== PROPOSAL_READY_SCHEMA ||
    !PHASES.has(document.phase) ||
    !digest(document.adapterExecutionDigest) ||
    !digest(document.admissionPolicyDigest) ||
    !digest(document.baseRunDigest) ||
    !digest(document.requestDigest) ||
    !Number.isSafeInteger(document.baseRevision) ||
    document.baseRevision < 0 ||
    !record(document.proposal) ||
    timeline.contentDigest(document.proposal) !== document.proposalDigest ||
    !record(document.proposalInput) ||
    timeline.canonicalJson(document.proposalInput.proposal) !==
      timeline.canonicalJson(document.proposal) ||
    !record(document.preview) ||
    document.preview.persistence !== "not-admitted" ||
    document.preview.verified !== true ||
    document.preview.proposalDigest !== document.proposalDigest ||
    document.preview.baseRevision !== document.baseRevision ||
    document.preview.baseRunDigest !== document.baseRunDigest ||
    !digest(document.preview.candidateDigest)
  ) {
    throw new Error("proposal-ready receipt is invalid");
  }
  return document;
}

export function validatePhaseFailureDocumentV2(document, timeline) {
  if (
    !record(document) ||
    keys(document) !==
      "adapterExecutionDigest,failure,mcpAudit,mcpAuditDigest,mcpObservation,mcpRun,mcpRunDigest,observerInvocation,phase,phaseDecisionDigest,proposalReadyDigest,recoveryObservationDigest,schema" ||
    document.schema !== PHASE_FAILURE_SCHEMA ||
    !PHASES.has(document.phase) ||
    !digest(document.adapterExecutionDigest) ||
    (document.proposalReadyDigest !== null &&
      !digest(document.proposalReadyDigest)) ||
    (document.phaseDecisionDigest !== null &&
      !digest(document.phaseDecisionDigest)) ||
    (document.proposalReadyDigest === null) !==
      (document.phaseDecisionDigest === null) ||
    (document.recoveryObservationDigest !== null &&
      !digest(document.recoveryObservationDigest)) ||
    !["base-verified", "observed-after-failure", "recovery-observed"].includes(
      document.mcpObservation,
    ) ||
    (document.recoveryObservationDigest === null) !==
      (document.mcpObservation !== "recovery-observed") ||
    timeline.contentDigest(document.mcpRun) !== document.mcpRunDigest ||
    timeline.contentDigest(document.mcpAudit) !== document.mcpAuditDigest ||
    document.mcpAudit.runDigest !== document.mcpRunDigest ||
    timeline.canonicalJson(document.mcpAudit.run) !==
      timeline.canonicalJson(document.mcpRun)
  ) {
    throw new Error("phase failure bundle is invalid");
  }
  try {
    validateObserverInvocation(
      document.observerInvocation,
      document.phase,
      document.mcpObservation,
    );
  } catch {
    throw new Error("phase failure bundle is invalid");
  }
  validateMcpWriterTrajectory(document.mcpAudit);
  validatePhaseFailureRecordV2(document.failure);
  return document;
}

export function validateRecoveryObservationDocumentV2(document, timeline) {
  if (
    !record(document) ||
    keys(document) !==
      "adapterExecutionDigest,disposition,invocation,mcpAudit,mcpAuditDigest,mcpRun,mcpRunDigest,phase,proposalReadyDigest,schema" ||
    document.schema !== RECOVERY_OBSERVATION_SCHEMA ||
    !PHASES.has(document.phase) ||
    !digest(document.adapterExecutionDigest) ||
    (document.proposalReadyDigest !== null &&
      !digest(document.proposalReadyDigest)) ||
    ![
      "exact-admission",
      "exact-base",
      "exact-recovery-fence",
      "state-diverged",
    ].includes(document.disposition) ||
    timeline.contentDigest(document.mcpRun) !== document.mcpRunDigest ||
    timeline.contentDigest(document.mcpAudit) !== document.mcpAuditDigest ||
    document.mcpAudit.runDigest !== document.mcpRunDigest ||
    timeline.canonicalJson(document.mcpAudit.run) !==
      timeline.canonicalJson(document.mcpRun)
  ) {
    throw new Error("recovery observation is invalid");
  }
  try {
    validateMcpInvocation(document.invocation, document.phase, "model");
  } catch {
    throw new Error("recovery observation is invalid");
  }
  validateMcpWriterTrajectory(document.mcpAudit);
  return document;
}

export function validatePhaseFailureRecordV2(failure) {
  const allowed = FAILURE_CODES.get(failure?.stage);
  if (
    !record(failure) ||
    keys(failure) !== "code,stage" ||
    !allowed?.has(failure.code)
  ) {
    throw new Error("phase failure classification is invalid");
  }
  return failure;
}

export async function writeAdapterExecutionBundleV2(context) {
  validateAdapterExecutionDocumentV2(context.document, context.timeline);
  return writeStateDocument({
    ...context,
    kind: "adapter-execution",
    label: "adapter execution capture",
  });
}

export async function readAdapterExecutionBundleV2(context) {
  return readStateDocument({
    ...context,
    kind: "adapter-execution",
    label: "adapter execution capture",
    validate: validateAdapterExecutionDocumentV2,
  });
}

export async function writeProposalReadyBundleV2(context) {
  validateProposalReadyDocumentV2(context.document, context.timeline);
  return writeStateDocument({
    ...context,
    kind: "proposal-ready",
    label: "proposal-ready receipt",
  });
}

export async function readProposalReadyBundleV2(context) {
  return readStateDocument({
    ...context,
    kind: "proposal-ready",
    label: "proposal-ready receipt",
    validate: validateProposalReadyDocumentV2,
  });
}

export async function writePhaseFailureBundleV2(context) {
  validatePhaseFailureDocumentV2(context.document, context.timeline);
  return writeStateDocument({
    ...context,
    kind: "failure",
    label: "phase failure bundle",
  });
}

export async function readPhaseFailureBundleV2(context) {
  return readStateDocument({
    ...context,
    kind: "failure",
    label: "phase failure bundle",
    validate: validatePhaseFailureDocumentV2,
  });
}

export async function writeRecoveryObservationBundleV2(context) {
  validateRecoveryObservationDocumentV2(context.document, context.timeline);
  return writeStateDocument({
    ...context,
    kind: "recovery-observation",
    label: "recovery observation",
  });
}

export async function readRecoveryObservationBundleV2(context) {
  return readStateDocument({
    ...context,
    kind: "recovery-observation",
    label: "recovery observation",
    validate: validateRecoveryObservationDocumentV2,
  });
}

async function writeStateDocument({
  state,
  document,
  timeline,
  staging,
  kind,
  label,
  injectFailure = () => {},
  syncDirectory,
}) {
  const path = join(state, `${document.phase}-${kind}.json`);
  const bytes = Buffer.from(`${timeline.canonicalJson(document)}\n`);
  if (bytes.byteLength === 0 || bytes.byteLength > FAILURE_STATE_BYTES) {
    throw new Error(`${label} exceeds its byte limit`);
  }
  const temporary = join(
    staging,
    `${document.phase}-${kind}-${randomUUID()}.json`,
  );
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    injectFailure(`before-${document.phase}-${kind}-sync`);
    await file.sync();
  } finally {
    await file.close();
  }
  let installed = false;
  try {
    await link(temporary, path);
    installed = true;
    injectFailure(`after-${document.phase}-${kind}-install`);
    await syncDirectory(state);
  } catch (error) {
    if (installed) throw durabilityUncertain(error);
    throw error;
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw installed ? durabilityUncertain(error) : error;
      }
    });
    await syncDirectory(staging).catch((error) => {
      throw installed ? durabilityUncertain(error) : error;
    });
  }
  return { document, digest: timeline.contentDigest(document) };
}

async function readStateDocument({
  state,
  phase,
  timeline,
  kind,
  label,
  validate,
  sync = false,
}) {
  let document;
  await readBoundedExactFile(
    join(state, `${phase}-${kind}.json`),
    FAILURE_STATE_BYTES,
    `${phase} ${label}`,
    {
      root: state,
      scope: "the pilot state",
      sync,
      validate(bytes) {
        if (bytes.byteLength === 0) throw new Error(`${label} is empty`);
        const text = decodeUtf8(bytes, `${phase} ${label}`);
        document = timeline.parseJson(text);
        if (text !== `${timeline.canonicalJson(document)}\n`) {
          throw new Error(`${label} is not canonical JSON`);
        }
        validate(document, timeline);
      },
    },
  );
  return { document, digest: timeline.contentDigest(document) };
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(value) {
  return Object.keys(value).sort().join(",");
}

function digest(value) {
  return typeof value === "string" && DIGEST.test(value);
}

function durabilityUncertain(error) {
  const failure =
    error instanceof Error
      ? error
      : new Error("pilot failure-state durability is uncertain");
  failure.name = "TimelinePilotDurabilityUncertain";
  return failure;
}

function sameState(expectedRun, expectedAudit, run, audit, timeline) {
  return (
    timeline.canonicalJson(expectedRun) === timeline.canonicalJson(run) &&
    timeline.canonicalJson(expectedAudit) === timeline.canonicalJson(audit)
  );
}

function exactAdmittedState({ adapter, ready, mcpRun, mcpAudit, timeline }) {
  let expectedRun;
  try {
    expectedRun = timeline.parseRunDocumentV0Alpha3({
      ...adapter.baseRun,
      events: [...adapter.baseRun.events, ...ready.preview.events],
    });
  } catch {
    return false;
  }
  const baseAdmissions = adapter.baseAudit.admissions;
  const admission = mcpAudit.admissions.at(-1);
  return (
    timeline.canonicalJson(expectedRun) === timeline.canonicalJson(mcpRun) &&
    mcpAudit.admissions.length === baseAdmissions.length + 1 &&
    timeline.canonicalJson(mcpAudit.admissions.slice(0, -1)) ===
      timeline.canonicalJson(baseAdmissions) &&
    admission?.kind === "model-proposal" &&
    admission.schema === "covenant.timeline.mcp-admission.v0alpha1" &&
    admission.decision === "admitted" &&
    admission.baseRevision === ready.baseRevision &&
    admission.baseRunDigest === ready.baseRunDigest &&
    admission.baseRunDigest === ready.baseRunDigest &&
    admission.proposalDigest === ready.proposalDigest &&
    admission.candidateDigest === ready.preview.candidateDigest &&
    timeline.canonicalJson(admission.eventIds) ===
      timeline.canonicalJson(ready.preview.events.map(({ id }) => id)) &&
    admission.authorityId === adapter.admissionPolicy.authorityId &&
    admission.policyRef === adapter.admissionPolicy.policyRef &&
    admission.policyDigest === ready.admissionPolicyDigest &&
    validAdmissionRecordDigest(admission, timeline)
  );
}

function exactRecoveryFenceState({ adapter, mcpRun, mcpAudit, timeline }) {
  const draft = recoveryFenceDraftV2(adapter.phase);
  const event = {
    schema: "covenant.timeline.event.v0alpha3",
    sequence: adapter.baseRun.events.length,
    ...draft,
  };
  let expectedRun;
  try {
    expectedRun = timeline.parseRunDocumentV0Alpha3({
      ...adapter.baseRun,
      events: [...adapter.baseRun.events, event],
    });
  } catch {
    return false;
  }
  const baseAdmissions = adapter.baseAudit.admissions;
  const admission = mcpAudit.admissions.at(-1);
  return (
    timeline.canonicalJson(expectedRun) === timeline.canonicalJson(mcpRun) &&
    mcpAudit.admissions.length === baseAdmissions.length + 1 &&
    timeline.canonicalJson(mcpAudit.admissions.slice(0, -1)) ===
      timeline.canonicalJson(baseAdmissions) &&
    admission?.schema === "covenant.timeline.mcp-admission.v0alpha1" &&
    admission.kind === "direct-event" &&
    admission.decision === "admitted" &&
    admission.baseRevision === adapter.baseRun.events.length &&
    admission.baseRunDigest === timeline.contentDigest(adapter.baseRun) &&
    timeline.canonicalJson(admission.eventIds) ===
      timeline.canonicalJson([draft.id]) &&
    admission.authorityId === adapter.admissionPolicy.authorityId &&
    admission.policyRef === adapter.admissionPolicy.policyRef &&
    admission.policyDigest === adapter.binding.admissionPolicyDigest &&
    validAdmissionRecordDigest(admission, timeline)
  );
}

function validAdmissionRecordDigest(admission, timeline) {
  if (!record(admission)) return false;
  const { recordDigest, ...unsigned } = admission;
  return (
    digest(recordDigest) && timeline.contentDigest(unsigned) === recordDigest
  );
}

function validateObserverInvocation(invocation, phase, observation) {
  if (observation === "base-verified") {
    if (invocation !== null) {
      throw new Error("base-verified failure cannot name an observer");
    }
    return;
  }
  validateMcpInvocation(
    invocation,
    phase,
    observation === "recovery-observed" ? "model" : "operator",
  );
}

function validateMcpInvocation(invocation, phase, role) {
  if (
    !record(invocation) ||
    keys(invocation) !==
      "executableDigest,invocationId,phase,processId,provenance,role,script,scriptDigest" ||
    invocation.phase !== phase ||
    invocation.role !== role ||
    invocation.provenance !== "driver-observed-maintainer-attested" ||
    invocation.script !== "packages/mcp-server/dist/cli.js" ||
    !uuid(invocation.invocationId) ||
    !Number.isSafeInteger(invocation.processId) ||
    invocation.processId < 1 ||
    !digest(invocation.executableDigest) ||
    !digest(invocation.scriptDigest)
  ) {
    throw new Error("failure observation invocation is invalid");
  }
}

function uuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

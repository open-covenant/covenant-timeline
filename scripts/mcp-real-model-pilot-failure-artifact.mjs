import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  failedAttemptLedgerSnapshotV2,
  loadAttemptLedger,
  validateFailedAttemptLedgerDocumentV2,
} from "./formal-attempt-ledger.mjs";
import {
  decodeUtf8,
  loadTimeline,
  readBoundedExactFile,
  sha256,
} from "./mcp-agent-pilot-lib.mjs";
import {
  expectedRecoveryFailureV2,
  readAdapterExecutionBundleV2,
  readPhaseFailureBundleV2,
  readProposalReadyBundleV2,
  readRecoveryObservationBundleV2,
  recoveryDispositionV2,
  validatePhaseFailureDocumentV2,
  validateRecoveryObservationDocumentV2,
} from "./mcp-real-model-pilot-failure.mjs";
import {
  REAL_MODEL_PILOT_LIMITS,
  validateRealModelPilotRuntime,
  validateMcpWriterTrajectory,
} from "./mcp-real-model-pilot-lib.mjs";
import {
  assertPhaseDecisionBindingV2,
  readPhaseDecisionV2,
  validatePhaseDecisionV2,
} from "./mcp-real-model-pilot-phase-decision.mjs";

const ARTIFACT_SCHEMA = "covenant.timeline.real-model-pilot.failed-attempt.v2";
const CAPTURE_SCHEMA =
  "covenant.timeline.real-model-pilot.adapter-execution-redacted.v2";
const READY_SCHEMA =
  "covenant.timeline.real-model-pilot.proposal-ready-redacted.v2";
const DECISION_SCHEMA =
  "covenant.timeline.real-model-pilot.phase-decision-redacted.v2";
const MANIFEST_SCHEMA =
  "covenant.timeline.real-model-pilot.failed-content-manifest.v2";
const PUBLICATION_CLAIM_SCHEMA =
  "covenant.timeline.real-model-pilot.failed-publication-claim.v2";
const INCOMPLETE_PUBLICATION_SCHEMA =
  "covenant.timeline.real-model-pilot.failed-publication-incomplete.v2";
const INCOMPLETE_PUBLICATION_FILE = ".publication-incomplete.json";
const ARTIFACT_BYTES = 16 * 1024 * 1024;
const CLAIM_BYTES = 4 * 1024;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LIMITATIONS = Object.freeze([
  "raw-adapter-streams-committed-but-not-disclosed",
  "hidden-adapter-bytes-not-replayed-by-portable-verifier",
  "evidence-authenticity-not-established",
]);
const LOCAL_FAILURE_STAGES = new Set([
  "adapter-execution",
  "adapter-output",
  "proposal-schema",
  "proposal-semantics",
]);
const CREDENTIAL_KEY =
  /(^|[_-])(?:api[_-]?(?:key|token)|access[_-]?(?:key|token)|auth(?:entication|orization)?(?:[_-]?(?:key|token))?|bearer(?:[_-]?token)?|client[_-]?secret|credentials?|password|passwd|private[_-]?key|refresh[_-]?token|secret(?:[_-]?(?:access[_-]?key|key|token))?|session[_-]?token|signing[_-]?key|token)([_-]|$)/u;
const CREDENTIAL_CONTAINER_KEY =
  /(^|[_-])(?:client[_-]?secret|credentials?|password|passwd|private[_-]?key|secret(?:[_-]?(?:access[_-]?key|key|token))?|signing[_-]?key)([_-]|$)/u;
const CREDENTIAL_VALUE =
  /(?:npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{20,}|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}|\bAccountKey=[A-Za-z0-9+/]{20,}={0,2}|(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?):\/\/[^\s/:@]+:[^\s/@]+@|(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|GOOGLE_API_KEY|NPM_TOKEN|GITHUB_TOKEN)|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Z]:\\Users\\[^\\\s]+\\)/iu;
const CREDENTIAL_SCAN_NODES = 200_000;
const REQUIRED_RUNTIME_FILES = new Set([
  "scripts/mcp-real-model-pilot-failure-artifact.mjs",
  "scripts/mcp-real-model-pilot-phase-decision.mjs",
]);

export async function exportFailedAttempt({
  state,
  output,
  injectFailure = () => {},
}) {
  const timeline = await loadTimeline();
  const stateRoot = await realDirectory(state, "pilot state");
  const ledger = await loadAttemptLedger(stateRoot, timeline);
  const ledgerSnapshot = failedAttemptLedgerSnapshotV2(ledger);
  const terminal = ledgerSnapshot.document.entries.at(-1);
  const phase = terminal.phase;
  const adapter = await readAdapterExecutionBundleV2({
    state: stateRoot,
    phase,
    timeline,
    sync: true,
  });
  const failure = await readPhaseFailureBundleV2({
    state: stateRoot,
    phase,
    timeline,
    sync: true,
  });
  const ready = failure.document.proposalReadyDigest
    ? await readProposalReadyBundleV2({
        state: stateRoot,
        phase,
        timeline,
        sync: true,
      })
    : null;
  const recovery = failure.document.recoveryObservationDigest
    ? await readRecoveryObservationBundleV2({
        state: stateRoot,
        phase,
        timeline,
        sync: true,
      })
    : null;
  const decision = ready
    ? await readPhaseDecisionV2({
        state: stateRoot,
        phase,
        timeline,
        sync: true,
      })
    : null;
  validatePrivateBindings({
    started: ledgerSnapshot.document.entries.at(-2),
    terminal,
    adapter,
    failure,
    ready,
    recovery,
    decision,
    timeline,
  });

  const target = resolve(output);
  const parent = await realDirectory(dirname(target), "artifact parent");
  const destination = join(parent, basename(target));
  if (pathWithin(stateRoot, destination)) {
    throw new Error("failed-attempt artifact must be outside pilot state");
  }
  const publication = {
    phase,
    failure: failure.document.failure,
    binding: adapter.document.binding,
    attemptLedgerDigest: ledgerSnapshot.digest,
  };
  const recovered = await recoverPublishedFailedAttempt({
    destination,
    publication,
    timeline,
  });
  if (recovered) return recovered;
  const claimId = randomUUID();
  const staging = join(parent, `.failed-attempt-${claimId}`);
  const claim = await acquirePublicationClaim({
    parent,
    destination,
    staging,
    claimId,
    attemptLedgerDigest: ledgerSnapshot.digest,
    timeline,
  });
  injectFailure("after-failed-attempt-publication-claim");
  let installed = false;
  let reserved = false;
  try {
    await assertDestinationAbsent(destination);
    await mkdir(staging, { mode: 0o700 });
    const captureDocument = redactedCapture(adapter, timeline);
    const readyDocument = ready ? redactedReady(ready) : null;
    const decisionDocument = decision ? redactedDecision(decision) : null;
    const files = new Map([
      ["attempt-ledger.json", ledgerSnapshot.document],
      ["adapter-execution.json", captureDocument],
      ["phase-failure.json", failure.document],
      ...(readyDocument ? [["proposal-ready.json", readyDocument]] : []),
      ...(decisionDocument ? [["phase-decision.json", decisionDocument]] : []),
      ...(recovery ? [["recovery-observation.json", recovery.document]] : []),
    ]);
    const descriptors = [];
    for (const [name, document] of files) {
      const bytes = await writeCanonical(staging, name, document, timeline);
      descriptors.push(descriptor(name, bytes));
    }
    const artifact = {
      schema: ARTIFACT_SCHEMA,
      phase,
      failure: failure.document.failure,
      binding: adapter.document.binding,
      source: adapter.document.binding.source,
      attemptLedger: fileReference(
        "attempt-ledger.json",
        ledgerSnapshot.document,
        timeline,
      ),
      adapterExecution: fileReference(
        "adapter-execution.json",
        captureDocument,
        timeline,
      ),
      phaseFailure: fileReference(
        "phase-failure.json",
        failure.document,
        timeline,
      ),
      proposalReady: readyDocument
        ? fileReference("proposal-ready.json", readyDocument, timeline)
        : null,
      phaseDecision: decisionDocument
        ? fileReference("phase-decision.json", decisionDocument, timeline)
        : null,
      recoveryObservation: recovery
        ? fileReference(
            "recovery-observation.json",
            recovery.document,
            timeline,
          )
        : null,
      contentManifest: "content-manifest.json",
      limitations: LIMITATIONS,
    };
    const artifactBytes = await writeCanonical(
      staging,
      "failed-attempt.json",
      artifact,
      timeline,
    );
    descriptors.push(descriptor("failed-attempt.json", artifactBytes));
    descriptors.sort((left, right) => left.path.localeCompare(right.path));
    await writeCanonical(
      staging,
      "content-manifest.json",
      {
        schema: MANIFEST_SCHEMA,
        algorithm: "sha256",
        excluded: ["content-manifest.json"],
        entries: descriptors,
      },
      timeline,
    );
    await assertCredentialSafe(staging, timeline);
    await verifyFailedAttempt(staging);
    await syncDirectory(staging);
    injectFailure("after-failed-attempt-staging-sync");
    await assertPublicationClaim(claim, timeline);
    await assertDestinationAbsent(destination);
    await installStagedPublication({
      staging,
      destination,
      claim,
      timeline,
      injectFailure,
      onReserved() {
        reserved = true;
      },
    });
    installed = true;
    injectFailure("after-failed-attempt-install");
    injectFailure("before-failed-attempt-parent-sync");
    await syncDirectory(parent);
    injectFailure("after-failed-attempt-parent-sync");
    await releasePublicationClaim(claim, timeline);
    return publicationResult(destination, publication);
  } catch (error) {
    if (!installed && !reserved) {
      await rm(staging, { recursive: true, force: true });
      await releasePublicationClaim(claim, timeline);
    }
    throw error;
  }
}

export async function verifyFailedAttempt(directory) {
  const timeline = await loadTimeline();
  const root = await realDirectory(directory, "failed-attempt artifact");
  const artifact = await readCanonical(root, "failed-attempt.json", timeline);
  validateArtifact(artifact);
  const manifest = await readCanonical(
    root,
    artifact.contentManifest,
    timeline,
  );
  await verifyManifest(root, manifest, artifact, timeline);
  const ledger = await readReferenced(root, artifact.attemptLedger, timeline);
  const capture = await readReferenced(
    root,
    artifact.adapterExecution,
    timeline,
  );
  const failure = await readReferenced(root, artifact.phaseFailure, timeline);
  const ready = artifact.proposalReady
    ? await readReferenced(root, artifact.proposalReady, timeline)
    : null;
  const decision = artifact.phaseDecision
    ? await readReferenced(root, artifact.phaseDecision, timeline)
    : null;
  const recovery = artifact.recoveryObservation
    ? await readReferenced(root, artifact.recoveryObservation, timeline)
    : null;

  validateFailedAttemptLedgerDocumentV2(ledger, timeline);
  validateRedactedCapture(capture, timeline);
  validatePhaseFailureDocumentV2(failure, timeline);
  if (ready) validateRedactedReady(ready, capture, timeline);
  if (decision) validateRedactedDecision(decision, timeline);
  if (recovery) validateRecoveryObservationDocumentV2(recovery, timeline);
  validatePublicBindings({
    artifact,
    ledger,
    capture,
    failure,
    ready,
    recovery,
    decision,
    timeline,
  });
  await assertCredentialSafe(root, timeline);
  return {
    verified: true,
    schema: ARTIFACT_SCHEMA,
    phase: artifact.phase,
    failure: artifact.failure,
    rawAdapterStreams: "committed-not-disclosed",
  };
}

function redactedCapture(bundle, timeline) {
  const capture = bundle.document;
  return {
    schema: CAPTURE_SCHEMA,
    privateDocumentDigest: bundle.digest,
    phase: capture.phase,
    binding: capture.binding,
    runtime: capture.runtime,
    admissionPolicy: capture.admissionPolicy,
    invocation: capture.invocation,
    mcpInvocation: capture.mcpInvocation,
    requestDigest: capture.requestDigest,
    redactedRequest: capture.redactedRequest,
    catalogs: capture.catalogs,
    baseRun: capture.baseRun,
    baseRunDigest: timeline.contentDigest(capture.baseRun),
    baseAudit: capture.baseAudit,
    baseAuditDigest: timeline.contentDigest(capture.baseAudit),
    execution: {
      status: capture.execution.status,
      signal: capture.execution.signal,
      error: capture.execution.error,
      stdout: streamCommitment(capture.execution.stdout),
      stderr: streamCommitment(capture.execution.stderr),
    },
  };
}

function redactedReady(bundle) {
  const ready = bundle.document;
  return {
    schema: READY_SCHEMA,
    privateDocumentDigest: bundle.digest,
    phase: ready.phase,
    adapterExecutionDigest: ready.adapterExecutionDigest,
    requestDigest: ready.requestDigest,
    baseRevision: ready.baseRevision,
    baseRunDigest: ready.baseRunDigest,
    proposalDigest: ready.proposalDigest,
    candidateDigest: ready.preview.candidateDigest,
    admissionPolicyDigest: ready.admissionPolicyDigest,
    candidate: {
      events: ready.preview.events,
      query: ready.preview.query,
      provenance: ready.preview.provenance,
    },
  };
}

function redactedDecision(bundle) {
  const decision = bundle.document;
  return {
    schema: DECISION_SCHEMA,
    privateDocumentDigest: bundle.digest,
    phase: decision.phase,
    decision: decision.decision,
    adapterExecutionDigest: decision.adapterExecutionDigest,
    proposalReadyDigest: decision.proposalReadyDigest,
    requestDigest: decision.requestDigest,
    invocationId: decision.invocationId,
    candidateDigest: decision.candidateDigest,
  };
}

function streamCommitment(stream) {
  return {
    disclosure: "omitted",
    byteLength: stream.byteLength,
    digest: stream.digest,
    truncated: stream.truncated,
  };
}

function validatePrivateBindings({
  started,
  terminal,
  adapter,
  failure,
  ready,
  recovery,
  decision,
  timeline,
}) {
  if (decision) {
    assertPhaseDecisionBindingV2({
      decision: decision.document,
      adapterExecutionDigest: adapter.digest,
      proposalReadyDigest: ready.digest,
      requestDigest: started.requestDigest,
      invocationId: started.invocation.invocationId,
      candidateDigest: ready.document.preview.candidateDigest,
      timeline,
    });
  }
  if (
    terminal.adapterExecutionDigest !== adapter.digest ||
    terminal.failureBundleDigest !== failure.digest ||
    terminal.failureStage !== failure.document.failure.stage ||
    terminal.failureCode !== failure.document.failure.code ||
    adapter.document.phase !== terminal.phase ||
    failure.document.phase !== terminal.phase ||
    adapter.document.requestDigest !== terminal.requestDigest ||
    adapter.document.requestDigest !== started.requestDigest ||
    adapter.document.baseRun.events.length !== started.baseRevision ||
    timeline.contentDigest(adapter.document.baseRun) !==
      started.baseRunDigest ||
    timeline.canonicalJson(adapter.document.invocation) !==
      timeline.canonicalJson(started.invocation) ||
    timeline.canonicalJson(adapter.document.mcpInvocation) !==
      timeline.canonicalJson(started.mcpInvocation) ||
    failure.document.adapterExecutionDigest !== adapter.digest ||
    failure.document.proposalReadyDigest !== (ready?.digest ?? null) ||
    failure.document.phaseDecisionDigest !== (decision?.digest ?? null) ||
    failure.document.recoveryObservationDigest !== (recovery?.digest ?? null) ||
    (recovery &&
      (timeline.canonicalJson(recovery.document.mcpRun) !==
        timeline.canonicalJson(failure.document.mcpRun) ||
        timeline.canonicalJson(recovery.document.mcpAudit) !==
          timeline.canonicalJson(failure.document.mcpAudit)))
  ) {
    throw new Error("private failed-attempt evidence binding changed");
  }
}

function validatePublicBindings({
  artifact,
  ledger,
  capture,
  failure,
  ready,
  recovery,
  decision,
  timeline,
}) {
  const terminal = ledger.entries.at(-1);
  const started = ledger.entries.at(-2);
  const opened = ledger.entries[0];
  validateFailureState({
    capture,
    failure,
    ready,
    recovery,
    decision,
    timeline,
  });
  if (
    terminal.kind !== "phase-failed" ||
    terminal.phase !== artifact.phase ||
    capture.phase !== artifact.phase ||
    failure.phase !== artifact.phase ||
    (ready && ready.phase !== artifact.phase) ||
    (decision && decision.phase !== artifact.phase) ||
    (recovery && recovery.phase !== artifact.phase) ||
    timeline.canonicalJson(artifact.binding) !==
      timeline.canonicalJson(capture.binding) ||
    timeline.canonicalJson(artifact.source) !==
      timeline.canonicalJson(capture.binding.source) ||
    timeline.canonicalJson(capture.binding) !==
      timeline.canonicalJson(opened.binding) ||
    timeline.canonicalJson(artifact.failure) !==
      timeline.canonicalJson(failure.failure) ||
    terminal.failureStage !== artifact.failure.stage ||
    terminal.failureCode !== artifact.failure.code ||
    terminal.adapterExecutionDigest !== capture.privateDocumentDigest ||
    terminal.failureBundleDigest !== artifact.phaseFailure.digest ||
    started.requestDigest !== capture.requestDigest ||
    started.baseRevision !== capture.baseRun.events.length ||
    started.baseRunDigest !== capture.baseRunDigest ||
    timeline.canonicalJson(started.invocation) !==
      timeline.canonicalJson(capture.invocation) ||
    timeline.canonicalJson(started.mcpInvocation) !==
      timeline.canonicalJson(capture.mcpInvocation) ||
    failure.adapterExecutionDigest !== capture.privateDocumentDigest ||
    failure.proposalReadyDigest !== (ready?.privateDocumentDigest ?? null) ||
    failure.phaseDecisionDigest !== (decision?.privateDocumentDigest ?? null) ||
    failure.recoveryObservationDigest !==
      (recovery ? timeline.contentDigest(recovery) : null) ||
    (recovery &&
      (recovery.adapterExecutionDigest !== capture.privateDocumentDigest ||
        recovery.proposalReadyDigest !==
          (ready?.privateDocumentDigest ?? null) ||
        timeline.canonicalJson(recovery.mcpRun) !==
          timeline.canonicalJson(failure.mcpRun) ||
        timeline.canonicalJson(recovery.mcpAudit) !==
          timeline.canonicalJson(failure.mcpAudit))) ||
    (ready &&
      (ready.adapterExecutionDigest !== capture.privateDocumentDigest ||
        ready.requestDigest !== capture.requestDigest ||
        ready.baseRevision !== capture.baseRun.events.length ||
        ready.baseRunDigest !== capture.baseRunDigest ||
        ready.admissionPolicyDigest !==
          capture.binding.admissionPolicyDigest)) ||
    (decision &&
      (decision.adapterExecutionDigest !== capture.privateDocumentDigest ||
        decision.proposalReadyDigest !== ready?.privateDocumentDigest ||
        decision.requestDigest !== capture.requestDigest ||
        decision.invocationId !== capture.invocation.invocationId ||
        decision.candidateDigest !== ready?.candidateDigest))
  ) {
    throw new Error("failed-attempt artifact binding changed");
  }
}

function validateFailureState({
  capture,
  failure,
  ready,
  recovery,
  decision,
  timeline,
}) {
  const runtime = validateCaptureRuntime(capture, timeline);
  assertMcpInvocationRuntime(capture.mcpInvocation, runtime);
  if (failure.observerInvocation) {
    assertMcpInvocationRuntime(failure.observerInvocation, runtime);
  }
  if (recovery) assertMcpInvocationRuntime(recovery.invocation, runtime);
  if ((ready === null) !== (decision === null)) {
    throw new Error(
      "proposal-ready and phase-decision evidence must be paired",
    );
  }
  const sameAsBase =
    timeline.canonicalJson(failure.mcpRun) ===
      timeline.canonicalJson(capture.baseRun) &&
    timeline.canonicalJson(failure.mcpAudit) ===
      timeline.canonicalJson(capture.baseAudit);
  if (
    (failure.mcpObservation === "base-verified" ||
      LOCAL_FAILURE_STAGES.has(failure.failure.stage)) &&
    !sameAsBase
  ) {
    throw new Error("failed-attempt MCP state changed after a local failure");
  }
  const recoveryReady = ready
    ? {
        baseRevision: ready.baseRevision,
        baseRunDigest: ready.baseRunDigest,
        proposalDigest: ready.proposalDigest,
        admissionPolicyDigest: ready.admissionPolicyDigest,
        preview: {
          events: ready.candidate.events,
          candidateDigest: ready.candidateDigest,
        },
      }
    : null;
  if (!ready && !recovery) return;
  const disposition = recoveryDispositionV2({
    adapter: {
      phase: capture.phase,
      binding: capture.binding,
      baseRun: capture.baseRun,
      baseAudit: capture.baseAudit,
      admissionPolicy: capture.admissionPolicy,
    },
    ready: recoveryReady,
    mcpRun: recovery?.mcpRun ?? failure.mcpRun,
    mcpAudit: recovery?.mcpAudit ?? failure.mcpAudit,
    timeline,
  });
  if (recovery && recovery.disposition !== disposition) {
    throw new Error("failed-attempt recovery disposition did not reproduce");
  }
  if (disposition === "exact-admission") {
    if (
      failure.failure.stage !== "post-admission-verification" ||
      failure.failure.code !== "proposal.post-admission" ||
      decision?.decision !== "admission-authorized"
    ) {
      throw new Error(
        "an exact admission has the wrong failure classification",
      );
    }
    return;
  }
  if (!recovery) return;
  const expectedFailure = expectedRecoveryFailureV2({
    observation: { disposition },
    hasProposalReady: ready !== null,
    replayedFailure: ready === null ? failure.failure : null,
  });
  if (
    timeline.canonicalJson(failure.failure) !==
    timeline.canonicalJson(expectedFailure)
  ) {
    throw new Error("recovery has the wrong failure classification");
  }
}

function validateRedactedCapture(document, timeline) {
  if (
    !record(document) ||
    keys(document) !==
      "admissionPolicy,baseAudit,baseAuditDigest,baseRun,baseRunDigest,binding,catalogs,execution,invocation,mcpInvocation,phase,privateDocumentDigest,redactedRequest,requestDigest,runtime,schema" ||
    document.schema !== CAPTURE_SCHEMA ||
    !digest(document.privateDocumentDigest) ||
    !digest(document.requestDigest) ||
    !record(document.binding) ||
    !record(document.runtime) ||
    !record(document.admissionPolicy) ||
    !record(document.redactedRequest) ||
    !record(document.catalogs) ||
    !record(document.baseRun) ||
    !record(document.baseAudit) ||
    !record(document.invocation) ||
    !runtimeContainsRequiredFiles(document.runtime) ||
    timeline.contentDigest(document.baseRun) !== document.baseRunDigest ||
    timeline.contentDigest(document.baseAudit) !== document.baseAuditDigest ||
    timeline.canonicalJson(document.baseAudit.run) !==
      timeline.canonicalJson(document.baseRun) ||
    timeline.contentDigest(document.runtime) !==
      document.binding.runtimeDigest ||
    timeline.byteDigest(
      Buffer.from(`${timeline.canonicalJson(document.admissionPolicy)}\n`),
    ) !== document.binding.admissionPolicyDigest ||
    !record(document.execution) ||
    keys(document.execution) !== "error,signal,status,stderr,stdout"
  ) {
    throw new Error("redacted adapter capture is invalid");
  }
  validateCaptureRuntime(document, timeline);
  try {
    timeline.parseRunDocumentV0Alpha3(document.baseRun);
    validateMcpWriterTrajectory(document.baseAudit);
  } catch {
    throw new Error("redacted adapter capture is invalid");
  }
  validateStreamCommitment(document.execution.stdout);
  validateStreamCommitment(document.execution.stderr);
  if (
    (document.execution.status !== null &&
      (!Number.isSafeInteger(document.execution.status) ||
        document.execution.status < 0)) ||
    (document.execution.signal !== null &&
      (typeof document.execution.signal !== "string" ||
        !/^[A-Z0-9]{1,32}$/u.test(document.execution.signal))) ||
    (document.execution.error !== null &&
      (!record(document.execution.error) ||
        keys(document.execution.error) !== "code" ||
        !["eacces", "enobufs", "enoent", "etimedout", "spawn-error"].includes(
          document.execution.error.code,
        )))
  ) {
    throw new Error("redacted adapter execution is invalid");
  }
}

function validateCaptureRuntime(capture, timeline) {
  let runtime;
  try {
    runtime = validateRealModelPilotRuntime(
      {
        identity: capture.runtime,
        digest: capture.binding.runtimeDigest,
      },
      timeline,
    );
  } catch {
    throw new Error("redacted adapter runtime is invalid");
  }
  if (!runtimeContainsRequiredFiles(runtime.identity)) {
    throw new Error("redacted adapter runtime is incomplete");
  }
  return runtime.identity;
}

function assertMcpInvocationRuntime(invocation, runtime) {
  const script = runtime.files.find(
    ({ path }) => path === "packages/mcp-server/dist/cli.js",
  );
  if (
    !script ||
    invocation.executableDigest !== runtime.node.executableDigest ||
    invocation.script !== script.path ||
    invocation.scriptDigest !== script.digest
  ) {
    throw new Error("failed-attempt MCP invocation runtime binding changed");
  }
}

function validateRedactedDecision(document, timeline) {
  if (
    !record(document) ||
    keys(document) !==
      "adapterExecutionDigest,candidateDigest,decision,invocationId,phase,privateDocumentDigest,proposalReadyDigest,requestDigest,schema" ||
    document.schema !== DECISION_SCHEMA ||
    !["initial", "correction"].includes(document.phase) ||
    !["admission-authorized", "recovery-terminal"].includes(
      document.decision,
    ) ||
    !digest(document.privateDocumentDigest) ||
    !digest(document.adapterExecutionDigest) ||
    !digest(document.proposalReadyDigest) ||
    !digest(document.requestDigest) ||
    !digest(document.candidateDigest) ||
    !UUID.test(document.invocationId)
  ) {
    throw new Error("redacted phase decision is invalid");
  }
  const {
    privateDocumentDigest,
    schema: _schema,
    ...privateDecision
  } = document;
  const decision = {
    schema: "covenant.timeline.real-model-pilot.phase-decision.v2",
    ...privateDecision,
  };
  try {
    validatePhaseDecisionV2(decision);
  } catch {
    throw new Error("redacted phase decision is invalid");
  }
  if (timeline.contentDigest(decision) !== privateDocumentDigest) {
    throw new Error("redacted phase decision digest changed");
  }
}

function runtimeContainsRequiredFiles(runtime) {
  if (!Array.isArray(runtime.files)) return false;
  const paths = new Set();
  for (const file of runtime.files) {
    if (
      !record(file) ||
      keys(file) !== "byteLength,digest,path" ||
      typeof file.path !== "string" ||
      !digest(file.digest) ||
      !Number.isSafeInteger(file.byteLength) ||
      file.byteLength < 1 ||
      paths.has(file.path)
    ) {
      return false;
    }
    paths.add(file.path);
  }
  return [...REQUIRED_RUNTIME_FILES].every((path) => paths.has(path));
}

function validateRedactedReady(document, capture, timeline) {
  if (
    !record(document) ||
    keys(document) !==
      "adapterExecutionDigest,admissionPolicyDigest,baseRevision,baseRunDigest,candidate,candidateDigest,phase,privateDocumentDigest,proposalDigest,requestDigest,schema" ||
    document.schema !== READY_SCHEMA ||
    !digest(document.privateDocumentDigest) ||
    !digest(document.adapterExecutionDigest) ||
    !digest(document.admissionPolicyDigest) ||
    !digest(document.baseRunDigest) ||
    !digest(document.candidateDigest) ||
    !digest(document.proposalDigest) ||
    !digest(document.requestDigest) ||
    !Number.isSafeInteger(document.baseRevision) ||
    document.baseRevision < 0 ||
    !record(document.candidate) ||
    keys(document.candidate) !== "events,provenance,query" ||
    !Array.isArray(document.candidate.events) ||
    !Array.isArray(document.candidate.provenance) ||
    !record(document.candidate.query) ||
    !record(capture.redactedRequest) ||
    typeof capture.redactedRequest.requestId !== "string" ||
    capture.redactedRequest.requestId.length === 0 ||
    capture.redactedRequest.requestId.length > 128
  ) {
    throw new Error("redacted proposal-ready receipt is invalid");
  }
  const candidate = {
    schema: "covenant.timeline.model-proposal-candidate.v1",
    requestId: capture.redactedRequest.requestId,
    baseRunDigest: document.baseRunDigest,
    proposalDigest: document.proposalDigest,
    candidateEvents: document.candidate.events,
    candidateQuery: document.candidate.query,
    provenance: document.candidate.provenance,
  };
  if (timeline.contentDigest(candidate) !== document.candidateDigest) {
    throw new Error("redacted proposal-ready candidate digest changed");
  }
  let candidateRun;
  try {
    candidateRun = timeline.parseRunDocumentV0Alpha3({
      ...capture.baseRun,
      events: [...capture.baseRun.events, ...document.candidate.events],
    });
    timeline.parseQueryV0Alpha3(document.candidate.query, candidateRun);
  } catch {
    throw new Error("redacted proposal-ready candidate is invalid");
  }
}

function validateStreamCommitment(value) {
  if (
    !record(value) ||
    keys(value) !== "byteLength,digest,disclosure,truncated" ||
    value.disclosure !== "omitted" ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 0 ||
    value.byteLength > REAL_MODEL_PILOT_LIMITS.adapterBytes ||
    !digest(value.digest) ||
    typeof value.truncated !== "boolean" ||
    (value.truncated &&
      value.byteLength !== REAL_MODEL_PILOT_LIMITS.adapterBytes)
  ) {
    throw new Error("redacted adapter stream commitment is invalid");
  }
}

function validateArtifact(artifact) {
  if (
    !record(artifact) ||
    keys(artifact) !==
      "adapterExecution,attemptLedger,binding,contentManifest,failure,limitations,phase,phaseDecision,phaseFailure,proposalReady,recoveryObservation,schema,source" ||
    artifact.schema !== ARTIFACT_SCHEMA ||
    !["initial", "correction"].includes(artifact.phase) ||
    artifact.contentManifest !== "content-manifest.json" ||
    !record(artifact.binding) ||
    !record(artifact.source) ||
    !record(artifact.failure) ||
    !record(artifact.attemptLedger) ||
    !record(artifact.adapterExecution) ||
    !record(artifact.phaseFailure) ||
    !optionalReference(artifact.proposalReady) ||
    !optionalReference(artifact.phaseDecision) ||
    !optionalReference(artifact.recoveryObservation) ||
    (artifact.proposalReady === null) !== (artifact.phaseDecision === null) ||
    !Array.isArray(artifact.limitations) ||
    artifact.limitations.length !== LIMITATIONS.length ||
    artifact.limitations.some((value, index) => value !== LIMITATIONS[index])
  ) {
    throw new Error("failed-attempt artifact is invalid");
  }
}

function optionalReference(value) {
  return value === null || record(value);
}

async function verifyManifest(root, manifest, artifact, timeline) {
  if (
    !record(manifest) ||
    keys(manifest) !== "algorithm,entries,excluded,schema" ||
    manifest.schema !== MANIFEST_SCHEMA ||
    manifest.algorithm !== "sha256" ||
    timeline.canonicalJson(manifest.excluded) !==
      timeline.canonicalJson(["content-manifest.json"]) ||
    !Array.isArray(manifest.entries)
  ) {
    throw new Error("failed-attempt content manifest is invalid");
  }
  const expected = new Set([
    "adapter-execution.json",
    "attempt-ledger.json",
    "failed-attempt.json",
    "phase-failure.json",
  ]);
  if (artifact.proposalReady) expected.add("proposal-ready.json");
  if (artifact.phaseDecision) expected.add("phase-decision.json");
  if (artifact.recoveryObservation) expected.add("recovery-observation.json");
  const names = await directoryFiles(root);
  expected.add("content-manifest.json");
  if (
    timeline.canonicalJson([...names].sort()) !==
    timeline.canonicalJson([...expected].sort())
  ) {
    throw new Error("failed-attempt artifact contains unexpected files");
  }
  if (manifest.entries.length !== expected.size - 1) {
    throw new Error("failed-attempt manifest entry count is invalid");
  }
  const covered = new Set();
  for (const entry of manifest.entries) {
    if (
      !record(entry) ||
      keys(entry) !== "byteLength,digest,path" ||
      !expected.has(entry.path) ||
      entry.path === "content-manifest.json" ||
      !digest(entry.digest) ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 1
    ) {
      throw new Error("failed-attempt manifest entry is invalid");
    }
    if (covered.has(entry.path)) {
      throw new Error("failed-attempt manifest contains a duplicate path");
    }
    covered.add(entry.path);
    const bytes = await readExact(root, entry.path);
    if (
      bytes.byteLength !== entry.byteLength ||
      sha256(bytes) !== entry.digest
    ) {
      throw new Error("failed-attempt manifest digest changed");
    }
  }
  expected.delete("content-manifest.json");
  if (
    timeline.canonicalJson([...covered].sort()) !==
    timeline.canonicalJson([...expected].sort())
  ) {
    throw new Error("failed-attempt manifest coverage is incomplete");
  }
}

async function readReferenced(root, reference, timeline) {
  if (
    !record(reference) ||
    keys(reference) !== "digest,path" ||
    !digest(reference.digest)
  ) {
    throw new Error("failed-attempt file reference is invalid");
  }
  const document = await readCanonical(root, reference.path, timeline);
  if (timeline.contentDigest(document) !== reference.digest) {
    throw new Error("failed-attempt file reference digest changed");
  }
  return document;
}

async function readCanonical(root, name, timeline) {
  const bytes = await readExact(root, name);
  const text = decodeUtf8(bytes, "failed-attempt artifact file");
  const document = timeline.parseJson(text);
  if (text !== `${timeline.canonicalJson(document)}\n`) {
    throw new Error("failed-attempt file is not canonical JSON");
  }
  return document;
}

async function readExact(root, name) {
  if (!/^[a-z][a-z0-9-]*\.json$/u.test(name)) {
    throw new Error("failed-attempt path is invalid");
  }
  return readBoundedExactFile(
    join(root, name),
    ARTIFACT_BYTES,
    "failed-attempt artifact file",
    { root, scope: "the failed-attempt artifact" },
  );
}

async function writeCanonical(root, name, document, timeline) {
  const bytes = Buffer.from(`${timeline.canonicalJson(document)}\n`);
  if (bytes.byteLength === 0 || bytes.byteLength > ARTIFACT_BYTES) {
    throw new Error("failed-attempt artifact file exceeds its byte limit");
  }
  const handle = await open(join(root, name), "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return bytes;
}

function descriptor(path, bytes) {
  return { path, digest: sha256(bytes), byteLength: bytes.byteLength };
}

function fileReference(path, document, timeline) {
  return { path, digest: timeline.contentDigest(document) };
}

async function installStagedPublication({
  staging,
  destination,
  claim,
  timeline,
  injectFailure,
  onReserved,
}) {
  await mkdir(destination, { mode: 0o700 });
  onReserved();
  const marker = {
    schema: INCOMPLETE_PUBLICATION_SCHEMA,
    claimId: claim.document.claimId,
    staging: claim.document.staging,
    attemptLedgerDigest: claim.document.attemptLedgerDigest,
  };
  await writeCanonical(
    destination,
    INCOMPLETE_PUBLICATION_FILE,
    marker,
    timeline,
  );
  await syncDirectory(destination);
  await syncDirectory(dirname(destination));
  injectFailure("after-failed-attempt-destination-reserve");

  for (const name of await directoryFiles(staging)) {
    await link(join(staging, name), join(destination, name));
  }
  await syncDirectory(destination);
  injectFailure("after-failed-attempt-files-install");
  await unlink(join(destination, INCOMPLETE_PUBLICATION_FILE));
  await syncDirectory(destination);
  await rm(staging, { recursive: true });
}

async function acquirePublicationClaim({
  parent,
  destination,
  staging,
  claimId,
  attemptLedgerDigest,
  timeline,
}) {
  const path = publicationClaimPath(destination);
  const document = {
    schema: PUBLICATION_CLAIM_SCHEMA,
    claimId,
    output: basename(destination),
    processId: process.pid,
    staging: basename(staging),
    attemptLedgerDigest,
  };
  const bytes = Buffer.from(`${timeline.canonicalJson(document)}\n`);
  const temporary = join(
    parent,
    `.${basename(destination)}.failed-attempt-claim-${randomUUID()}`,
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
    await syncDirectory(parent);
    return { path, parent, bytes, document };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readPublicationClaim(destination, timeline);
    assertClaimMatches(existing, {
      output: basename(destination),
      attemptLedgerDigest,
    });
    if (processIsActive(existing.processId)) {
      throw new Error("failed-attempt artifact publication is already claimed");
    }
    await retirePublicationClaim({
      destination,
      claim: existing,
      timeline,
    });
    return acquirePublicationClaim({
      parent,
      destination,
      staging,
      claimId,
      attemptLedgerDigest,
      timeline,
    });
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function assertPublicationClaim(claim) {
  const bytes = await readBoundedExactFile(
    claim.path,
    CLAIM_BYTES,
    "failed-attempt publication claim",
    { root: claim.parent, scope: "the artifact parent" },
  );
  if (!bytes.equals(claim.bytes)) {
    throw new Error("failed-attempt publication claim changed");
  }
}

async function releasePublicationClaim(claim) {
  await assertPublicationClaim(claim);
  await unlink(claim.path);
  await syncDirectory(claim.parent);
}

async function recoverPublishedFailedAttempt({
  destination,
  publication,
  timeline,
}) {
  if (!(await pathExists(destination))) return null;
  if (await pathExists(join(destination, INCOMPLETE_PUBLICATION_FILE))) {
    await recoverIncompletePublication({ destination, publication, timeline });
    return null;
  }
  await verifyFailedAttempt(destination);
  const artifact = await readCanonical(
    destination,
    "failed-attempt.json",
    timeline,
  );
  if (
    artifact.phase !== publication.phase ||
    artifact.attemptLedger.digest !== publication.attemptLedgerDigest ||
    timeline.canonicalJson(artifact.failure) !==
      timeline.canonicalJson(publication.failure) ||
    timeline.canonicalJson(artifact.binding) !==
      timeline.canonicalJson(publication.binding)
  ) {
    throw new Error(
      "published failed-attempt artifact belongs to another attempt",
    );
  }
  await syncDirectory(destination);
  await syncDirectory(dirname(destination));
  await releaseRecoveredPublicationClaim({
    destination,
    attemptLedgerDigest: publication.attemptLedgerDigest,
    timeline,
  });
  return publicationResult(destination, publication);
}

async function recoverIncompletePublication({
  destination,
  publication,
  timeline,
}) {
  const [stat, canonical, claim] = await Promise.all([
    lstat(destination),
    realpath(destination),
    readPublicationClaim(destination, timeline),
  ]);
  if (!stat.isDirectory() || canonical !== destination) {
    throw new Error("incomplete failed-attempt output is not a real directory");
  }
  assertClaimMatches(claim, {
    output: basename(destination),
    attemptLedgerDigest: publication.attemptLedgerDigest,
  });
  if (processIsActive(claim.processId)) {
    throw new Error("failed-attempt artifact publication is already claimed");
  }
  const marker = await readIncompletePublication(destination, timeline);
  if (
    marker.claimId !== claim.claimId ||
    marker.staging !== claim.staging ||
    marker.attemptLedgerDigest !== claim.attemptLedgerDigest
  ) {
    throw new Error("incomplete failed-attempt publication claim changed");
  }

  const parent = dirname(destination);
  const staging = join(parent, claim.staging);
  const [stagingStat, stagingCanonical] = await Promise.all([
    lstat(staging),
    realpath(staging),
  ]);
  if (!stagingStat.isDirectory() || stagingCanonical !== staging) {
    throw new Error("incomplete failed-attempt staging is invalid");
  }
  const stagingNames = new Set(await directoryFiles(staging));
  const destinationNames = await directoryFiles(destination, 9);
  for (const name of destinationNames) {
    if (name === INCOMPLETE_PUBLICATION_FILE) continue;
    if (!stagingNames.has(name)) {
      throw new Error(
        "incomplete failed-attempt output contains unknown files",
      );
    }
    const [installed, source] = await Promise.all([
      readBoundedExactFile(
        join(destination, name),
        ARTIFACT_BYTES,
        "incomplete failed-attempt file",
        { root: destination, scope: "the incomplete failed-attempt output" },
      ),
      readBoundedExactFile(
        join(staging, name),
        ARTIFACT_BYTES,
        "staged failed-attempt file",
        { root: staging, scope: "the failed-attempt staging directory" },
      ),
    ]);
    if (!installed.equals(source)) {
      throw new Error("incomplete failed-attempt output changed");
    }
  }

  await rm(destination, { recursive: true });
  await syncDirectory(parent);
  await retirePublicationClaim({ destination, claim, timeline });
}

function validateIncompletePublication(document) {
  if (
    !record(document) ||
    keys(document) !== "attemptLedgerDigest,claimId,schema,staging" ||
    document.schema !== INCOMPLETE_PUBLICATION_SCHEMA ||
    !UUID.test(document.claimId) ||
    document.staging !== `.failed-attempt-${document.claimId}` ||
    !digest(document.attemptLedgerDigest)
  ) {
    throw new Error("incomplete failed-attempt publication is invalid");
  }
  return document;
}

async function readIncompletePublication(destination, timeline) {
  const bytes = await readBoundedExactFile(
    join(destination, INCOMPLETE_PUBLICATION_FILE),
    CLAIM_BYTES,
    "incomplete failed-attempt publication",
    { root: destination, scope: "the incomplete failed-attempt output" },
  );
  const text = decodeUtf8(bytes, "incomplete failed-attempt publication");
  const document = timeline.parseJson(text);
  if (text !== `${timeline.canonicalJson(document)}\n`) {
    throw new Error("incomplete failed-attempt publication is not canonical");
  }
  return validateIncompletePublication(document);
}

async function releaseRecoveredPublicationClaim({
  destination,
  attemptLedgerDigest,
  timeline,
}) {
  const path = publicationClaimPath(destination);
  if (!(await pathExists(path))) return;
  let claim;
  try {
    claim = await readPublicationClaim(destination, timeline);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  assertClaimMatches(claim, {
    output: basename(destination),
    attemptLedgerDigest,
  });
  await retirePublicationClaim({ destination, claim, timeline });
}

async function retirePublicationClaim({ destination, claim, timeline }) {
  const parent = dirname(destination);
  const path = publicationClaimPath(destination);
  let current;
  try {
    current = await readPublicationClaim(destination, timeline);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (timeline.canonicalJson(current) !== timeline.canonicalJson(claim)) {
    throw new Error("failed-attempt publication claim changed");
  }
  await removeClaimStaging({ parent, destination, claim });
  let final;
  try {
    final = await readPublicationClaim(destination, timeline);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (timeline.canonicalJson(final) !== timeline.canonicalJson(claim)) {
    throw new Error("failed-attempt publication claim changed");
  }
  await unlink(path).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await syncDirectory(parent);
}

async function removeClaimStaging({ parent, destination, claim }) {
  const expected = `.failed-attempt-${claim.claimId}`;
  if (claim.output !== basename(destination) || claim.staging !== expected) {
    throw new Error("failed-attempt publication staging claim is invalid");
  }
  const staging = join(parent, claim.staging);
  if (!(await pathExists(staging))) return;
  const [stat, canonical] = await Promise.all([
    lstat(staging),
    realpath(staging),
  ]);
  if (!stat.isDirectory() || canonical !== staging) {
    throw new Error(
      "failed-attempt publication staging is not a real directory",
    );
  }
  await rm(staging, { recursive: true });
  await syncDirectory(parent);
}

async function readPublicationClaim(destination, timeline) {
  const parent = dirname(destination);
  const path = publicationClaimPath(destination);
  const bytes = await readBoundedExactFile(
    path,
    CLAIM_BYTES,
    "failed-attempt publication claim",
    { root: parent, scope: "the artifact parent" },
  );
  const text = decodeUtf8(bytes, "failed-attempt publication claim");
  const document = timeline.parseJson(text);
  if (text !== `${timeline.canonicalJson(document)}\n`) {
    throw new Error("failed-attempt publication claim is not canonical JSON");
  }
  validatePublicationClaim(document);
  return document;
}

function validatePublicationClaim(document) {
  if (
    !record(document) ||
    keys(document) !==
      "attemptLedgerDigest,claimId,output,processId,schema,staging" ||
    document.schema !== PUBLICATION_CLAIM_SCHEMA ||
    !UUID.test(document.claimId) ||
    !/^[A-Za-z0-9._-]{1,255}$/u.test(document.output) ||
    document.staging !== `.failed-attempt-${document.claimId}` ||
    !Number.isSafeInteger(document.processId) ||
    document.processId < 1 ||
    !digest(document.attemptLedgerDigest)
  ) {
    throw new Error("failed-attempt publication claim is invalid");
  }
}

function assertClaimMatches(claim, expected) {
  if (
    claim.output !== expected.output ||
    claim.attemptLedgerDigest !== expected.attemptLedgerDigest
  ) {
    throw new Error("failed-attempt artifact is claimed by another attempt");
  }
}

function processIsActive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function publicationClaimPath(destination) {
  return join(
    dirname(destination),
    `.${basename(destination)}.failed-attempt-claim.json`,
  );
}

function publicationResult(destination, publication) {
  return {
    phase: publication.phase,
    failure: publication.failure,
    output: destination,
  };
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertDestinationAbsent(destination) {
  try {
    await lstat(destination);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error("failed-attempt artifact output already exists");
}

async function assertCredentialSafe(root, timeline) {
  for (const name of await directoryFiles(root)) {
    const bytes = await readBoundedExactFile(
      join(root, name),
      ARTIFACT_BYTES,
      "failed-attempt credential scan input",
      { root, scope: "the failed-attempt artifact" },
    );
    const text = decodeUtf8(bytes, "failed-attempt credential scan input");
    if (CREDENTIAL_VALUE.test(text)) {
      throw new Error("failed-attempt artifact contains credential-like data");
    }
    assertCredentialFreeKeys(timeline.parseJson(text));
  }
}

function assertCredentialFreeKeys(document) {
  const pending = [document];
  let nodes = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    nodes += 1;
    if (nodes > CREDENTIAL_SCAN_NODES) {
      throw new Error("failed-attempt credential scan exceeds its node limit");
    }
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!record(value)) continue;
    for (const [key, child] of Object.entries(value)) {
      const normalized = key
        .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replaceAll(/[^A-Za-z0-9]+/g, "_")
        .toLowerCase();
      if (
        CREDENTIAL_CONTAINER_KEY.test(normalized) ||
        (typeof child === "string" && CREDENTIAL_KEY.test(normalized))
      ) {
        throw new Error(
          "failed-attempt artifact contains a credential-like field",
        );
      }
      pending.push(child);
    }
  }
}

async function directoryFiles(root, maximum = 8) {
  const names = [];
  const handle = await opendir(root);
  for await (const entry of handle) {
    if (!entry.isFile()) {
      throw new Error("failed-attempt artifact entries must be real files");
    }
    names.push(entry.name);
    if (names.length > maximum) {
      throw new Error("failed-attempt artifact has too many entries");
    }
  }
  return names;
}

async function realDirectory(path, label) {
  const canonical = await realpath(resolve(path));
  const stat = await lstat(canonical);
  if (!stat.isDirectory()) throw new Error(`${label} must be a real directory`);
  return canonical;
}

async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function pathWithin(parent, candidate) {
  const path = relative(parent, candidate);
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
  );
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

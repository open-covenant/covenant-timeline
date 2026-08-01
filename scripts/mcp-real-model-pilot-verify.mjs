#!/usr/bin/env node

import { opendir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateAttemptLedgerDocument } from "./formal-attempt-ledger.mjs";
import {
  decodeUtf8,
  exactRecord,
  loadTimeline,
  canonicalArtifactRoot,
  assertArtifactDirectory,
  readBoundedArtifactFile,
  readBoundedExactFile,
  repositoryRoot,
  resolveInside,
  safeEvidenceName,
  sha256,
  sourceIdentity,
} from "./mcp-agent-pilot-lib.mjs";
import {
  REAL_MODEL_PILOT_LIMITS,
  REAL_MODEL_PILOT_SCHEMA,
  createRealModelPilotAdmissionPolicy,
  createAdapterRequest,
  createProposalScope,
  realModelPilotRuntimeMatches,
  redactAdapterRequest,
  validateRealModelPilotRuntime,
  validateProposalSemantics,
  validateMcpWriterIdentity,
  validateMcpWriterTrajectory,
} from "./mcp-real-model-pilot-lib.mjs";

const ARTIFACT_DIRECTORIES = new Set([
  "conclusions",
  "evidence",
  "model-calls",
  "phase-results",
  "queries",
]);
const CONTENT_MANIFEST = "content-manifest.json";
const VERIFICATION_REPORT = "verification.json";

export async function verifyRealModelPilot(
  directory,
  {
    allowDirty = false,
    requireRuntimeMatch = false,
    runtimeBinding: verifierRuntime,
  } = {},
) {
  const root = await canonicalArtifactRoot(resolve(directory));
  const timeline = await loadTimeline();
  const totalBudget = budget(
    REAL_MODEL_PILOT_LIMITS.artifactTotalBytes,
    "real-model pilot artifact",
  );
  const artifactValue = await readCanonical(
    root,
    join(root, "artifact.json"),
    timeline,
    "real-model pilot artifact manifest",
    REAL_MODEL_PILOT_LIMITS.artifactBytes,
    totalBudget,
  );
  await validateArtifactSchema(artifactValue, timeline);
  const artifact = exactRecord(
    artifactValue,
    [
      "schema",
      "id",
      "operator",
      "operation",
      "provenance",
      "workflow",
      "inputDigest",
      "pilotInput",
      "run",
      "runDigest",
      "audit",
      "auditDigest",
      "admissionPolicy",
      "admissionPolicyDigest",
      "attemptLedger",
      "attemptLedgerDigest",
      "evidenceManifest",
      "modelConfig",
      "modelConfigDigest",
      "prompt",
      "promptDigest",
      "contentManifest",
      "phaseResults",
      "expected",
      "modelCalls",
      "conclusions",
      "invocations",
      "mcpInvocations",
      "source",
      "runtime",
      "runtimeDigest",
      "limitations",
    ],
    "real-model pilot artifact",
  );
  if (
    artifact.schema !== REAL_MODEL_PILOT_SCHEMA ||
    artifact.operation !== "maintainer-operated" ||
    artifact.provenance.modelExecution !== "maintainer-attested" ||
    artifact.provenance.processRestart !== "maintainer-attested" ||
    artifact.provenance.externalEvidenceAuthenticity !==
      "maintainer-attested" ||
    artifact.provenance.mcpProcessIdentity !==
      "driver-observed-maintainer-attested" ||
    !artifact.limitations.includes("not-independent-adoption") ||
    !artifact.limitations.includes(
      "external-evidence-authenticity-not-cryptographically-proven",
    ) ||
    !artifact.limitations.includes(
      "model-proposals-untrusted-and-host-admitted-after-semantic-validation",
    )
  ) {
    throw new Error("real-model pilot scope is invalid");
  }
  if (
    artifact.invocations.length !== 2 ||
    artifact.invocations[0].phase !== "initial" ||
    artifact.invocations[1].phase !== "correction" ||
    artifact.invocations[0].processId === artifact.invocations[1].processId ||
    artifact.invocations[0].invocationId ===
      artifact.invocations[1].invocationId
  ) {
    throw new Error("pilot did not cross two host process invocations");
  }
  if (
    artifact.mcpInvocations.length !== 2 ||
    artifact.mcpInvocations[0].phase !== "initial" ||
    artifact.mcpInvocations[1].phase !== "correction" ||
    artifact.mcpInvocations[0].processId ===
      artifact.mcpInvocations[1].processId ||
    artifact.mcpInvocations[0].invocationId ===
      artifact.mcpInvocations[1].invocationId
  ) {
    throw new Error("pilot did not cross two observed MCP child invocations");
  }

  const verifierSource = sourceIdentity();
  if (
    artifact.source.revision !== verifierSource.revision ||
    artifact.source.dirty !== verifierSource.dirty
  ) {
    throw new Error("artifact source identity does not match this checkout");
  }
  if (!allowDirty && (artifact.source.dirty || verifierSource.dirty)) {
    throw new Error("formal verification requires a clean source checkout");
  }
  if (!allowDirty && artifact.runtime.profile !== "formal-openai") {
    throw new Error("formal verification requires the formal runtime profile");
  }
  const runtimeBinding = validateRealModelPilotRuntime(
    { identity: artifact.runtime, digest: artifact.runtimeDigest },
    timeline,
  );
  const mcpScript = artifact.runtime.files.find(
    ({ path }) => path === "packages/mcp-server/dist/cli.js",
  );
  if (
    !mcpScript ||
    artifact.mcpInvocations.some(
      (invocation) =>
        invocation.provenance !== "driver-observed-maintainer-attested" ||
        invocation.executableDigest !==
          artifact.runtime.node.executableDigest ||
        invocation.script !== mcpScript.path ||
        invocation.scriptDigest !== mcpScript.digest,
    )
  ) {
    throw new Error("MCP child invocation runtime binding changed");
  }
  let runtimeMatched = false;
  if (verifierRuntime) {
    validateRealModelPilotRuntime(verifierRuntime, timeline);
    runtimeMatched =
      runtimeBinding.digest === verifierRuntime.digest &&
      timeline.canonicalJson(runtimeBinding.identity) ===
        timeline.canonicalJson(verifierRuntime.identity);
  } else {
    try {
      runtimeMatched = await realModelPilotRuntimeMatches(
        runtimeBinding,
        timeline,
      );
    } catch (error) {
      if (requireRuntimeMatch) throw error;
    }
  }
  if (requireRuntimeMatch && !runtimeMatched) {
    throw new Error("real-model pilot runtime identity changed");
  }
  const content = await verifyContentManifest({
    root,
    path: artifact.contentManifest,
    timeline,
    totalBudget,
  });

  const policyBytes = await readBoundedArtifactFile(
    root,
    resolveInside(root, artifact.admissionPolicy, "admission policy path"),
    REAL_MODEL_PILOT_LIMITS.artifactBytes,
    "admission policy",
    (size) => consume(totalBudget, size),
  );
  const policy = parseCanonicalBytes(policyBytes, timeline, "admission policy");
  const expectedPolicy = createRealModelPilotAdmissionPolicy(timeline);
  if (
    artifact.admissionPolicy !== "admission-policy.json" ||
    timeline.byteDigest(policyBytes) !== artifact.admissionPolicyDigest ||
    !Buffer.from(policyBytes).equals(expectedPolicy.bytes) ||
    timeline.canonicalJson(policy) !==
      timeline.canonicalJson(expectedPolicy.document) ||
    artifact.admissionPolicyDigest !== expectedPolicy.digest
  ) {
    throw new Error("pilot admission policy did not reproduce");
  }
  const attemptLedger = validateAttemptLedgerDocument(
    await readCanonical(
      root,
      resolveInside(root, artifact.attemptLedger, "attempt ledger path"),
      timeline,
      "attempt ledger",
      REAL_MODEL_PILOT_LIMITS.artifactBytes,
      totalBudget,
    ),
    timeline,
  );
  if (
    artifact.attemptLedger !== "attempt-ledger.json" ||
    timeline.contentDigest(attemptLedger) !== artifact.attemptLedgerDigest
  ) {
    throw new Error("attempt ledger digest changed");
  }

  const run = timeline.parseRunDocumentV0Alpha3(
    await readCanonical(
      root,
      resolveInside(root, artifact.run, "pilot run path"),
      timeline,
      "pilot run",
      REAL_MODEL_PILOT_LIMITS.runBytes,
      totalBudget,
    ),
  );
  if (timeline.contentDigest(run) !== artifact.runDigest) {
    throw new Error("pilot run digest changed");
  }
  const audit = await readCanonical(
    root,
    resolveInside(root, artifact.audit, "pilot audit path"),
    timeline,
    "pilot audit",
    REAL_MODEL_PILOT_LIMITS.runBytes,
    totalBudget,
  );
  if (
    artifact.audit !== "audit.json" ||
    timeline.contentDigest(audit) !== artifact.auditDigest
  ) {
    throw new Error("pilot audit digest changed");
  }
  const config = await readCanonical(
    root,
    resolveInside(root, artifact.modelConfig, "model config path"),
    timeline,
    "model config",
    REAL_MODEL_PILOT_LIMITS.configBytes,
    totalBudget,
  );
  if (timeline.contentDigest(config) !== artifact.modelConfigDigest) {
    throw new Error("model config digest changed");
  }
  verifyModelConfig(config, artifact.source, { allowDirty });
  const promptBytes = await readBoundedArtifactFile(
    root,
    resolveInside(root, artifact.prompt, "pilot prompt path"),
    REAL_MODEL_PILOT_LIMITS.promptBytes,
    "pilot prompt",
    (size) => consume(totalBudget, size),
  );
  const prompt = decodeUtf8(promptBytes, "pilot prompt");
  if (timeline.contentDigest(prompt) !== artifact.promptDigest) {
    throw new Error("pilot prompt digest changed");
  }
  const evidence = await verifyEvidence(
    root,
    await readCanonical(
      root,
      resolveInside(root, artifact.evidenceManifest, "evidence manifest path"),
      timeline,
      "evidence manifest",
      REAL_MODEL_PILOT_LIMITS.artifactBytes,
      totalBudget,
    ),
    totalBudget,
  );
  const pilotInput = await readCanonical(
    root,
    resolveInside(root, artifact.pilotInput, "pilot input path"),
    timeline,
    "pilot input",
    REAL_MODEL_PILOT_LIMITS.pilotInputBytes,
    totalBudget,
  );
  verifyInputBinding({
    artifact,
    pilotInput,
    run,
    promptBytes,
    evidence,
    timeline,
  });
  const runText = timeline.canonicalJson(run);
  for (const entry of evidence.values()) {
    if (runText.includes(entry.text)) {
      throw new Error("source evidence text persisted in MCP run state");
    }
  }

  if (
    artifact.modelCalls.length !== 2 ||
    artifact.modelCalls[0] !== "model-calls/initial.json" ||
    artifact.modelCalls[1] !== "model-calls/correction.json"
  ) {
    throw new Error("pilot model-call manifest is invalid");
  }
  const calls = [];
  for (const path of artifact.modelCalls) {
    const call = await readCanonical(
      root,
      resolveInside(root, path, "model-call path"),
      timeline,
      "model call",
      REAL_MODEL_PILOT_LIMITS.modelCallBytes,
      totalBudget,
    );
    verifyModelCall({
      call,
      run,
      config,
      prompt,
      evidence,
      timeline,
      artifact,
      pilotInput,
      audit,
    });
    calls.push(call);
  }
  if (
    calls[0].phase !== "initial" ||
    calls[1].phase !== "correction" ||
    calls[0].admit.timeline.revision !== calls[1].admit.baseRevision ||
    calls[1].admit.timeline.revision !== run.events.length
  ) {
    throw new Error("model-call phases do not form one append-only trajectory");
  }
  verifyAttemptLedger({ attemptLedger, artifact, calls, timeline });
  verifyMcpAuditEnvelope({
    audit,
    run,
    calls,
    policy: expectedPolicy,
    timeline,
  });

  const conclusions = new Map();
  for (const entry of artifact.conclusions) {
    const query = timeline.parseQueryV0Alpha3(
      await readCanonical(
        root,
        resolveInside(root, entry.query, `${entry.name} query path`),
        timeline,
        `${entry.name} query`,
        REAL_MODEL_PILOT_LIMITS.queryBytes,
        totalBudget,
      ),
      run,
    );
    const conclusion = await readCanonical(
      root,
      resolveInside(root, entry.conclusion, `${entry.name} conclusion path`),
      timeline,
      `${entry.name} conclusion`,
      REAL_MODEL_PILOT_LIMITS.conclusionBytes,
      totalBudget,
    );
    if (!timeline.verifyTemporalConclusionV0Alpha3(run, query, conclusion)) {
      throw new Error(`${entry.name} proof receipt did not verify`);
    }
    const reproduced = timeline.reasonTemporalQueryV0Alpha3(run, query);
    if (
      timeline.canonicalJson(reproduced) !== timeline.canonicalJson(conclusion)
    ) {
      throw new Error(`${entry.name} conclusion did not reproduce`);
    }
    conclusions.set(entry.name, { query, conclusion });
  }
  const initial = required(conclusions, "initial");
  const historical = required(conclusions, "historical");
  const current = required(conclusions, "current");
  assertDifference(initial.conclusion, artifact.expected.initialDifference);
  assertDifference(historical.conclusion, artifact.expected.initialDifference);
  assertDifference(current.conclusion, artifact.expected.correctedDifference);
  if (
    timeline.canonicalJson(calls[0].preview.conclusion) !==
      timeline.canonicalJson(initial.conclusion) ||
    timeline.canonicalJson(calls[1].preview.conclusion) !==
      timeline.canonicalJson(current.conclusion) ||
    initial.query.recordedThrough !== historical.query.recordedThrough ||
    initial.conclusion.receipt.stateDigest !==
      historical.conclusion.receipt.stateDigest ||
    timeline.canonicalJson(initial.conclusion.result) !==
      timeline.canonicalJson(historical.conclusion.result) ||
    timeline.canonicalJson(historical.conclusion.result) ===
      timeline.canonicalJson(current.conclusion.result)
  ) {
    throw new Error("historical cut was not preserved across the correction");
  }
  await verifyPhaseResultBundles({
    root,
    artifact,
    attemptLedger,
    calls,
    conclusions,
    run,
    audit,
    timeline,
    totalBudget,
  });

  const report = {
    schema: "covenant.timeline.real-model-pilot.verification.v1",
    verified: true,
    operation: artifact.operation,
    runDigest: artifact.runDigest,
    model: config.model,
    modelConfigDigest: artifact.modelConfigDigest,
    runtimeDigest: artifact.runtimeDigest,
    runtimeMatched,
    contentManifestDigest: content.digest,
    auditDigest: artifact.auditDigest,
    admissionPolicyDigest: artifact.admissionPolicyDigest,
    attemptLedgerDigest: artifact.attemptLedgerDigest,
    formalAttemptLedgerVerified: true,
    providerInvocationReservationCount: 2,
    phaseResultBundleCount: 2,
    admissionRecordCount: audit.admissions.length,
    untrustedProposalsHostAdmitted: true,
    requestDigests: calls.map(({ requestDigest }) => requestDigest),
    responseDigests: calls.map(({ responseDigest }) => responseDigest),
    crossedHostProcessRestart: true,
    crossedMcpProcessRestart: true,
    modelExecutionProvenance: artifact.provenance.modelExecution,
    processRestartProvenance: artifact.provenance.processRestart,
    mcpProcessIdentityProvenance: artifact.provenance.mcpProcessIdentity,
    externalEvidenceAuthenticityProvenance:
      artifact.provenance.externalEvidenceAuthenticity,
    historicalCutPreserved: true,
    sourceTextAbsentFromMcpState: true,
    receiptCount: conclusions.size,
    initialDifference: artifact.expected.initialDifference,
    correctedDifference: artifact.expected.correctedDifference,
  };
  if (content.hasVerificationReport) {
    const retained = await readCanonical(
      root,
      join(root, VERIFICATION_REPORT),
      timeline,
      "retained verification report",
      REAL_MODEL_PILOT_LIMITS.artifactBytes,
      totalBudget,
    );
    if (
      retained.runtimeMatched !== true ||
      timeline.canonicalJson(withoutRuntimeMatch(retained)) !==
        timeline.canonicalJson(withoutRuntimeMatch(report))
    ) {
      throw new Error("retained verification report does not reproduce");
    }
  }
  return report;
}

function verifyInputBinding({
  artifact,
  pilotInput,
  run,
  promptBytes,
  evidence,
  timeline,
}) {
  if (
    pilotInput.id !== artifact.id ||
    pilotInput.operator !== artifact.operator ||
    pilotInput.workflow !== artifact.workflow ||
    timeline.canonicalJson(pilotInput.expected) !==
      timeline.canonicalJson(artifact.expected)
  ) {
    throw new Error("pilot input metadata changed");
  }
  const names = [
    ...pilotInput.initialEvidence,
    ...pilotInput.correctionEvidence,
  ];
  const evidenceIdentity = names.map((name) => {
    const entry = evidence.get(name);
    if (!entry) throw new Error("pilot input references missing evidence");
    return { name, digest: entry.digest };
  });
  const inputDigest = timeline.contentDigest({
    pilot: pilotInput,
    contract: run.contract,
    promptDigest: sha256(promptBytes),
    evidence: evidenceIdentity,
  });
  if (inputDigest !== artifact.inputDigest) {
    throw new Error("pilot input digest did not reproduce");
  }
}

async function validateArtifactSchema(value, timeline) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const common = timeline.parseJson(
    decodeUtf8(
      await readBoundedExactFile(
        join(repositoryRoot, "schemas/v0alpha3/common.schema.json"),
        REAL_MODEL_PILOT_LIMITS.configBytes,
        "common schema",
      ),
      "common schema",
    ),
  );
  const schema = timeline.parseJson(
    decodeUtf8(
      await readBoundedExactFile(
        join(repositoryRoot, "schemas/mcp-real-model-pilot.v1.schema.json"),
        REAL_MODEL_PILOT_LIMITS.configBytes,
        "real-model pilot schema",
      ),
      "real-model pilot schema",
    ),
  );
  ajv.addSchema(common);
  if (!ajv.compile(schema)(value)) {
    throw new Error("real-model pilot artifact failed its JSON Schema");
  }
}

function verifyModelConfig(config, source, { allowDirty }) {
  exactRecord(
    config,
    ["schema", "id", "benchmarkRevision", "adapter", "model", "generation"],
    "model config",
  );
  exactRecord(config.adapter, ["id", "version"], "model config adapter");
  exactRecord(
    config.model,
    ["provider", "id", "revision"],
    "model config model",
  );
  exactRecord(
    config.generation,
    ["temperature", "seed", "maxOutputTokens", "parameters"],
    "model config generation",
  );
  const allowedParameters = new Set([
    "reasoningEffort",
    "structuredOutput",
    "topP",
    "verbosity",
  ]);
  if (
    config.generation.parameters === null ||
    typeof config.generation.parameters !== "object" ||
    Array.isArray(config.generation.parameters) ||
    Object.keys(config.generation.parameters).some(
      (name) => !allowedParameters.has(name),
    ) ||
    config.generation.parameters.structuredOutput !== true
  ) {
    throw new Error("model config generation parameters are invalid");
  }
  if (config.benchmarkRevision !== source.revision) {
    throw new Error(
      "model config is not bound to the artifact source revision",
    );
  }
  if (
    !allowDirty &&
    (config.schema !== "covenant.timeline.model-proposal-eval.config.v1" ||
      config.adapter?.id !== "openai-responses" ||
      config.adapter?.version !== "1" ||
      config.model?.provider !== "openai")
  ) {
    throw new Error("formal verification requires the OpenAI Responses config");
  }
}

async function verifyContentManifest({ root, path, timeline, totalBudget }) {
  if (path !== CONTENT_MANIFEST) {
    throw new Error("content manifest path is invalid");
  }
  const manifestBytes = await readBoundedArtifactFile(
    root,
    join(root, CONTENT_MANIFEST),
    REAL_MODEL_PILOT_LIMITS.contentManifestBytes,
    "content manifest",
    (size) => consume(totalBudget, size),
  );
  const manifest = parseCanonicalBytes(
    manifestBytes,
    timeline,
    "content manifest",
  );
  exactRecord(
    manifest,
    ["schema", "algorithm", "excluded", "entries"],
    "content manifest",
  );
  if (
    manifest.schema !==
      "covenant.timeline.real-model-pilot.content-manifest.v1" ||
    manifest.algorithm !== "sha256" ||
    !Array.isArray(manifest.excluded) ||
    manifest.excluded.length !== 2 ||
    manifest.excluded[0] !== CONTENT_MANIFEST ||
    manifest.excluded[1] !== VERIFICATION_REPORT ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length === 0 ||
    manifest.entries.length > REAL_MODEL_PILOT_LIMITS.artifactFiles
  ) {
    throw new Error("content manifest is invalid");
  }

  const actual = await collectArtifactFiles(
    root,
    REAL_MODEL_PILOT_LIMITS.artifactFiles + 2,
  );
  const hasVerificationReport = actual.includes(VERIFICATION_REPORT);
  const covered = actual.filter(
    (candidate) =>
      candidate !== CONTENT_MANIFEST && candidate !== VERIFICATION_REPORT,
  );
  const entries = manifest.entries.map((value, index) => {
    const entry = exactRecord(
      value,
      ["path", "digest", "byteLength"],
      `content manifest entry ${index}`,
    );
    const maxBytes = artifactFileLimit(entry.path);
    if (
      maxBytes === undefined ||
      typeof entry.digest !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(entry.digest) ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0
    ) {
      throw new Error("content manifest entry is invalid");
    }
    return { ...entry, maxBytes };
  });
  const declared = entries.map(({ path: entryPath }) => entryPath);
  if (
    declared.some(
      (entryPath, index) => entryPath !== [...declared].sort()[index],
    ) ||
    new Set(declared).size !== declared.length ||
    covered.length !== declared.length ||
    covered.some((entryPath, index) => entryPath !== declared[index])
  ) {
    throw new Error("content manifest does not cover the complete artifact");
  }
  for (const entry of entries) {
    const bytes = await readBoundedArtifactFile(
      root,
      resolveInside(root, entry.path, "content manifest entry path"),
      entry.maxBytes,
      `content manifest entry ${entry.path}`,
      (size) => consume(totalBudget, size),
    );
    if (
      bytes.byteLength !== entry.byteLength ||
      sha256(bytes) !== entry.digest
    ) {
      throw new Error(`content manifest entry ${entry.path} changed`);
    }
  }
  return { digest: sha256(manifestBytes), hasVerificationReport };
}

async function collectArtifactFiles(root, maxFiles) {
  const files = [];
  const append = (path) => {
    files.push(path);
    if (files.length > maxFiles) {
      throw new Error("artifact contains too many files");
    }
  };
  const directories = new Set();
  const rootHandle = await opendir(root);
  for await (const entry of rootHandle) {
    if (entry.isDirectory()) {
      if (!ARTIFACT_DIRECTORIES.has(entry.name)) {
        throw new Error("artifact contains an unexpected directory");
      }
      directories.add(entry.name);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        "artifact root entries must be real files or directories",
      );
    }
    append(entry.name);
  }
  if (
    directories.size !== ARTIFACT_DIRECTORIES.size ||
    [...ARTIFACT_DIRECTORIES].some((name) => !directories.has(name))
  ) {
    throw new Error("artifact directories are incomplete");
  }
  for (const name of ARTIFACT_DIRECTORIES) {
    const directory = join(root, name);
    await assertArtifactDirectory(root, directory, `${name} directory`);
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (!entry.isFile()) {
        throw new Error(`${name} entries must be real files`);
      }
      append(`${name}/${entry.name}`);
    }
  }
  return files.sort();
}

function artifactFileLimit(path) {
  if (
    path === "artifact.json" ||
    path === "evidence-manifest.json" ||
    path === "admission-policy.json" ||
    path === "attempt-ledger.json"
  ) {
    return REAL_MODEL_PILOT_LIMITS.artifactBytes;
  }
  if (path === "README.md") return REAL_MODEL_PILOT_LIMITS.readmeBytes;
  if (path === "pilot-input.json") {
    return REAL_MODEL_PILOT_LIMITS.pilotInputBytes;
  }
  if (path === "run.json") return REAL_MODEL_PILOT_LIMITS.runBytes;
  if (path === "audit.json") return REAL_MODEL_PILOT_LIMITS.runBytes;
  if (path === "prompt.md") return REAL_MODEL_PILOT_LIMITS.promptBytes;
  if (path === "model-config.json") {
    return REAL_MODEL_PILOT_LIMITS.configBytes;
  }
  if (/^model-calls\/(?:initial|correction)\.json$/u.test(path)) {
    return REAL_MODEL_PILOT_LIMITS.modelCallBytes;
  }
  if (/^phase-results\/(?:initial|correction)\.json$/u.test(path)) {
    return 16 * 1024 * 1024;
  }
  if (/^queries\/(?:initial|historical|current)\.json$/u.test(path)) {
    return REAL_MODEL_PILOT_LIMITS.queryBytes;
  }
  if (/^conclusions\/(?:initial|historical|current)\.json$/u.test(path)) {
    return REAL_MODEL_PILOT_LIMITS.conclusionBytes;
  }
  if (/^evidence\/[a-z0-9][a-z0-9._-]{0,127}$/u.test(path)) {
    return REAL_MODEL_PILOT_LIMITS.evidenceBytes;
  }
  return undefined;
}

function verifyModelCall({
  call,
  run,
  config,
  prompt,
  evidence,
  timeline,
  artifact,
  pilotInput,
  audit,
}) {
  exactRecord(
    call,
    [
      "schema",
      "phase",
      "config",
      "configDigest",
      "requestDigest",
      "responseDigest",
      "responseText",
      "outputSchema",
      "outputSchemaDigest",
      "redactedRequest",
      "proposal",
      "usage",
      "catalogs",
      "preview",
      "admit",
    ],
    "real-model call",
  );
  if (
    call.schema !== "covenant.timeline.real-model-call.v1" ||
    !["initial", "correction"].includes(call.phase) ||
    timeline.canonicalJson(call.config) !== timeline.canonicalJson(config) ||
    call.configDigest !== artifact.modelConfigDigest
  ) {
    throw new Error("model-call identity changed");
  }
  exactRecord(
    call.preview,
    [
      "candidateDigest",
      "requestId",
      "proposalDigest",
      "baseRevision",
      "baseRunDigest",
      "events",
      "query",
      "provenance",
      "timeline",
      "conclusion",
      "persistence",
      "verified",
    ],
    "model proposal preview output",
  );
  exactRecord(
    call.admit,
    [
      "candidateDigest",
      "requestId",
      "proposalDigest",
      "baseRevision",
      "baseRunDigest",
      "events",
      "query",
      "provenance",
      "admissionStatus",
      "timeline",
      "admissionRecord",
    ],
    "model proposal admission output",
  );
  const baseRevision = call.preview.baseRevision;
  if (
    !Number.isSafeInteger(baseRevision) ||
    baseRevision < 0 ||
    baseRevision > run.events.length
  ) {
    throw new Error("model call has an invalid base revision");
  }
  const prefix = timeline.parseRunDocumentV0Alpha3({
    schema: run.schema,
    contract: run.contract,
    events: run.events.slice(0, baseRevision),
  });
  if (
    timeline.contentDigest(prefix) !== call.preview.baseRunDigest ||
    call.admit.baseRevision !== baseRevision ||
    call.admit.baseRunDigest !== call.preview.baseRunDigest
  ) {
    throw new Error("model call does not bind its run prefix");
  }
  const publicationAssertions = prefix.events.filter(
    (event) =>
      event.type === "coordinate.asserted" &&
      event.assertion.pointId === "artifacts-published",
  );
  if (
    (call.phase === "initial" && publicationAssertions.length !== 0) ||
    (call.phase === "correction" && publicationAssertions.length !== 1)
  ) {
    throw new Error("model-call run prefix has an invalid publication state");
  }
  const input = {
    timeline,
    pilot: pilotInput,
    prompt,
    evidence,
  };
  const scope = createProposalScope({
    phase: call.phase,
    input,
    run: prefix,
    initialAssertionId:
      call.phase === "correction"
        ? publicationAssertions[0].assertion.id
        : undefined,
  });
  const expected = createAdapterRequest({ input, scope, config });
  const redacted = redactAdapterRequest(expected.request);
  const expectedCatalogs = {
    evidence: redacted.evidence,
    references: scope.host.referenceCatalog,
    assertions: scope.host.assertionCatalog,
    knowledgeCuts: scope.host.knowledgeCutCatalog,
  };
  if (
    timeline.canonicalJson(call.outputSchema) !==
      timeline.canonicalJson(expected.outputSchema) ||
    call.outputSchemaDigest !== expected.request.outputSchemaDigest ||
    timeline.canonicalJson(call.redactedRequest) !==
      timeline.canonicalJson(redacted.request) ||
    timeline.canonicalJson(call.catalogs) !==
      timeline.canonicalJson(expectedCatalogs)
  ) {
    throw new Error("model-call phase inputs did not reproduce");
  }
  validateProposalSemantics(call.phase, call.proposal, artifact.expected);
  const candidate = timeline.compileTemporalModelProposalV1(
    call.proposal,
    scope.host,
    {
      maxChanges: 4,
      maxSupportsPerChange: 2,
    },
  );
  if (
    !timeline.verifyTemporalModelProposalCandidateV1(
      candidate,
      call.proposal,
      scope.host,
      { maxChanges: 4, maxSupportsPerChange: 2 },
    )
  ) {
    throw new Error("model proposal candidate did not verify");
  }
  const previewCandidate = {
    ...candidate,
    candidateEvents: call.preview.events,
    candidateQuery: call.preview.query,
    provenance: call.preview.provenance,
  };
  if (
    call.preview.verified !== true ||
    call.preview.persistence !== "not-admitted" ||
    call.preview.candidateDigest !== timeline.contentDigest(candidate) ||
    call.preview.proposalDigest !== timeline.contentDigest(call.proposal) ||
    timeline.canonicalJson(candidate) !==
      timeline.canonicalJson(previewCandidate) ||
    timeline.canonicalJson(proposalResultCandidate(call.preview)) !==
      timeline.canonicalJson(proposalResultCandidate(call.admit))
  ) {
    throw new Error(
      "stored model candidate differs from the preview or admission result",
    );
  }
  const candidateRun = timeline.parseRunDocumentV0Alpha3({
    schema: run.schema,
    contract: run.contract,
    events: [...prefix.events, ...call.preview.events],
  });
  if (
    !timeline.verifyTemporalConclusionV0Alpha3(
      candidateRun,
      call.preview.query,
      call.preview.conclusion,
    ) ||
    timeline.canonicalJson(
      timeline.reasonTemporalQueryV0Alpha3(candidateRun, call.preview.query),
    ) !== timeline.canonicalJson(call.preview.conclusion)
  ) {
    throw new Error("stored model proposal preview conclusion did not verify");
  }
  const endRevision = baseRevision + call.admit.events.length;
  const previewMetadata = metadataAtRevision({
    run,
    audit,
    revision: baseRevision,
    timeline,
  });
  const admittedMetadata = metadataAtRevision({
    run,
    audit,
    revision: endRevision,
    timeline,
  });
  if (
    timeline.canonicalJson(call.preview.timeline) !==
      timeline.canonicalJson(previewMetadata) ||
    timeline.canonicalJson(call.admit.timeline) !==
      timeline.canonicalJson(admittedMetadata)
  ) {
    throw new Error("model-call timeline metadata did not reproduce");
  }
  if (
    call.admit.admissionStatus !== "admitted" ||
    endRevision > run.events.length ||
    timeline.canonicalJson(call.admit.events) !==
      timeline.canonicalJson(run.events.slice(baseRevision, endRevision))
  ) {
    throw new Error("model-call events do not match the admitted run slice");
  }
  const admittedPrefix = timeline.parseRunDocumentV0Alpha3({
    schema: run.schema,
    contract: run.contract,
    events: run.events.slice(0, endRevision),
  });
  if (
    call.admit.timeline.runDigest !== timeline.contentDigest(admittedPrefix)
  ) {
    throw new Error("model-call result does not bind the admitted run prefix");
  }
  if (timeline.contentDigest(expected.request) !== call.requestDigest) {
    throw new Error("model request digest did not reproduce");
  }
  const response =
    call.usage === null
      ? call.proposal
      : { ...call.proposal, usage: call.usage };
  if (sha256(Buffer.from(call.responseText)) !== call.responseDigest) {
    throw new Error("model response digest did not reproduce");
  }
  const decodedResponse = timeline.parseJson(call.responseText);
  if (
    timeline.canonicalJson(decodedResponse) !== timeline.canonicalJson(response)
  ) {
    throw new Error(
      "stored model response does not match the admitted proposal",
    );
  }
}

function metadataAtRevision({ run, audit, revision, timeline }) {
  const prefix = timeline.parseRunDocumentV0Alpha3({
    schema: run.schema,
    contract: run.contract,
    events: run.events.slice(0, revision),
  });
  const admissions = [];
  let covered = 0;
  for (const admission of audit.admissions) {
    if (covered === revision) break;
    if (covered + admission.eventIds.length > revision) {
      throw new Error(
        "MCP admission records do not align with a model-call prefix",
      );
    }
    admissions.push(admission);
    covered += admission.eventIds.length;
  }
  if (covered !== revision) {
    throw new Error("MCP admissions do not cover a model-call prefix");
  }
  const envelope = {
    schema: audit.schema,
    runId: run.contract.id,
    revision,
    runDigest: timeline.contentDigest(prefix),
    admissions,
    lastWriter: audit.lastWriter,
    run: prefix,
  };
  return {
    runId: envelope.runId,
    revision,
    auditDigest: timeline.contentDigest(envelope),
    subject: run.contract.subject,
    contexts: run.contract.contexts,
    eventCount: revision,
    admissionCount: admissions.length,
    latestRecordedThrough: revision === 0 ? null : revision - 1,
    runDigest: envelope.runDigest,
  };
}

async function verifyPhaseResultBundles({
  root,
  artifact,
  attemptLedger,
  calls,
  conclusions,
  run,
  audit,
  timeline,
  totalBudget,
}) {
  if (
    artifact.phaseResults.length !== 2 ||
    artifact.phaseResults[0].phase !== "initial" ||
    artifact.phaseResults[0].path !== "phase-results/initial.json" ||
    artifact.phaseResults[1].phase !== "correction" ||
    artifact.phaseResults[1].path !== "phase-results/correction.json"
  ) {
    throw new Error("phase result manifest is invalid");
  }
  const bundles = [];
  for (const [index, descriptor] of artifact.phaseResults.entries()) {
    exactRecord(
      descriptor,
      ["phase", "path", "digest"],
      `phase result descriptor ${index}`,
    );
    const bundle = await readCanonical(
      root,
      resolveInside(root, descriptor.path, "phase result path"),
      timeline,
      `${descriptor.phase} phase result bundle`,
      16 * 1024 * 1024,
      totalBudget,
    );
    if (timeline.contentDigest(bundle) !== descriptor.digest) {
      throw new Error("phase result bundle digest changed");
    }
    bundles.push(bundle);
  }
  const [initial, correction] = bundles;
  const binding = attemptLedger.entries[0].binding;
  const commonKeys = [
    "schema",
    "phase",
    "binding",
    "invocation",
    "mcpInvocation",
    "runtime",
    "resultRevision",
    "resultRunDigest",
    "recordedThrough",
    "modelCall",
    "baseRun",
    "run",
    "audit",
  ];
  exactRecord(
    initial,
    [...commonKeys, "conclusion"],
    "initial phase result bundle",
  );
  exactRecord(
    correction,
    [...commonKeys, "historical", "current"],
    "correction phase result bundle",
  );
  if (
    initial.schema !== "covenant.timeline.real-model-pilot.phase-result.v1" ||
    correction.schema !==
      "covenant.timeline.real-model-pilot.phase-result.v1" ||
    initial.phase !== "initial" ||
    correction.phase !== "correction" ||
    timeline.canonicalJson(initial.binding) !==
      timeline.canonicalJson(binding) ||
    timeline.canonicalJson(correction.binding) !==
      timeline.canonicalJson(binding) ||
    timeline.canonicalJson(initial.runtime) !==
      timeline.canonicalJson(artifact.runtime) ||
    timeline.canonicalJson(correction.runtime) !==
      timeline.canonicalJson(artifact.runtime)
  ) {
    throw new Error("phase result execution binding changed");
  }
  for (const [index, bundle] of bundles.entries()) {
    const call = calls[index];
    const completed = attemptLedger.entries[index === 0 ? 2 : 4];
    if (
      timeline.canonicalJson(bundle.invocation) !==
        timeline.canonicalJson(artifact.invocations[index]) ||
      timeline.canonicalJson(bundle.mcpInvocation) !==
        timeline.canonicalJson(artifact.mcpInvocations[index]) ||
      timeline.canonicalJson(bundle.modelCall) !==
        timeline.canonicalJson(call) ||
      timeline.contentDigest(bundle.baseRun) !== call.preview.baseRunDigest ||
      bundle.baseRun.events.length !== call.preview.baseRevision ||
      timeline.contentDigest(bundle.run) !== bundle.resultRunDigest ||
      bundle.resultRevision !== call.admit.timeline.revision ||
      bundle.resultRunDigest !== call.admit.timeline.runDigest ||
      bundle.recordedThrough !== call.admit.query.recordedThrough ||
      completed.resultBundleDigest !== artifact.phaseResults[index].digest
    ) {
      throw new Error("phase result bundle does not bind its completed phase");
    }
  }
  const initialRun = timeline.parseRunDocumentV0Alpha3({
    schema: run.schema,
    contract: run.contract,
    events: run.events.slice(0, calls[0].admit.timeline.revision),
  });
  const initialAudit = {
    schema: audit.schema,
    runId: audit.runId,
    revision: initialRun.events.length,
    runDigest: timeline.contentDigest(initialRun),
    admissions: audit.admissions.slice(0, 3),
    lastWriter: audit.lastWriter,
    run: initialRun,
  };
  for (const [label, response, expected, metadata] of [
    [
      "initial",
      initial.conclusion,
      required(conclusions, "initial"),
      calls[0].admit.timeline,
    ],
    [
      "historical",
      correction.historical,
      required(conclusions, "historical"),
      calls[1].admit.timeline,
    ],
    [
      "current",
      correction.current,
      required(conclusions, "current"),
      calls[1].admit.timeline,
    ],
  ]) {
    exactRecord(
      response,
      ["timeline", "query", "conclusion", "verified"],
      `${label} phase result conclusion`,
    );
    if (
      response.verified !== true ||
      timeline.canonicalJson(response.timeline) !==
        timeline.canonicalJson(metadata) ||
      timeline.canonicalJson(response.query) !==
        timeline.canonicalJson(expected.query) ||
      timeline.canonicalJson(response.conclusion) !==
        timeline.canonicalJson(expected.conclusion)
    ) {
      throw new Error("phase result conclusion changed");
    }
  }
  if (
    timeline.canonicalJson(initial.run) !==
      timeline.canonicalJson(initialRun) ||
    timeline.canonicalJson(initial.audit) !==
      timeline.canonicalJson(initialAudit) ||
    timeline.canonicalJson(correction.run) !== timeline.canonicalJson(run) ||
    timeline.canonicalJson(correction.audit) !== timeline.canonicalJson(audit)
  ) {
    throw new Error("correction phase result run or audit changed");
  }
}

function verifyAttemptLedger({ attemptLedger, artifact, calls, timeline }) {
  const [
    opened,
    initialStarted,
    initialCompleted,
    correctionStarted,
    correctionCompleted,
  ] = attemptLedger.entries;
  const binding = opened.binding;
  if (
    binding.inputDigest !== artifact.inputDigest ||
    binding.modelConfigDigest !== artifact.modelConfigDigest ||
    binding.admissionPolicyDigest !== artifact.admissionPolicyDigest ||
    binding.runtimeDigest !== artifact.runtimeDigest ||
    timeline.canonicalJson(binding.source) !==
      timeline.canonicalJson(artifact.source)
  ) {
    throw new Error("attempt ledger execution binding changed");
  }
  for (const [index, [started, completed, call]] of [
    [initialStarted, initialCompleted, calls[0]],
    [correctionStarted, correctionCompleted, calls[1]],
  ].entries()) {
    const invocation = artifact.invocations[index];
    const mcpInvocation = artifact.mcpInvocations[index];
    if (
      timeline.canonicalJson(started.invocation) !==
        timeline.canonicalJson(invocation) ||
      timeline.canonicalJson(started.mcpInvocation) !==
        timeline.canonicalJson(mcpInvocation) ||
      started.requestDigest !== call.requestDigest ||
      started.baseRevision !== call.admit.baseRevision ||
      started.baseRunDigest !== call.admit.baseRunDigest ||
      completed.invocationId !== invocation.invocationId ||
      completed.requestDigest !== call.requestDigest ||
      completed.responseDigest !== call.responseDigest ||
      completed.proposalDigest !== call.preview.proposalDigest ||
      completed.proposalDigest !== timeline.contentDigest(call.proposal) ||
      completed.candidateDigest !== call.preview.candidateDigest ||
      completed.candidateDigest !== call.admit.candidateDigest ||
      completed.resultRevision !== call.admit.timeline.revision ||
      completed.resultRunDigest !== call.admit.timeline.runDigest
    ) {
      throw new Error("attempt ledger phase binding changed");
    }
  }
}

function verifyMcpAuditEnvelope({ audit, run, calls, policy, timeline }) {
  exactRecord(
    audit,
    [
      "schema",
      "runId",
      "revision",
      "runDigest",
      "admissions",
      "lastWriter",
      "run",
    ],
    "MCP audit envelope",
  );
  exactRecord(
    audit.lastWriter,
    [
      "timelinePackage",
      "timelineVersion",
      "reasoner",
      "serverPackage",
      "serverVersion",
    ],
    "MCP audit last writer",
  );
  if (
    audit.schema !== "covenant.timeline.mcp-run.v0alpha2" ||
    audit.runId !== run.contract.id ||
    audit.revision !== run.events.length ||
    audit.runDigest !== timeline.contentDigest(run) ||
    timeline.canonicalJson(audit.run) !== timeline.canonicalJson(run) ||
    audit.lastWriter.timelinePackage !== "@covenant-org/timeline" ||
    audit.lastWriter.timelineVersion !== "0.0.0-alpha.3" ||
    audit.lastWriter.reasoner !== "covenant.timeline.stn.v0alpha1" ||
    audit.lastWriter.serverPackage !== "@covenant-org/timeline-mcp" ||
    audit.lastWriter.serverVersion !== "0.0.0-alpha.1" ||
    !Array.isArray(audit.admissions) ||
    audit.admissions.length !== 4
  ) {
    throw new Error("MCP v0alpha2 audit envelope is invalid");
  }

  const expectedKinds = [
    "direct-event",
    "direct-event",
    "model-proposal",
    "model-proposal",
  ];
  let revision = 0;
  let modelIndex = 0;
  for (const [index, value] of audit.admissions.entries()) {
    const modelProposal = value?.kind === "model-proposal";
    const record = exactRecord(
      value,
      [
        "schema",
        "kind",
        "decision",
        "authorityId",
        "policyRef",
        "policyDigest",
        "writer",
        "baseRevision",
        "baseRunDigest",
        "eventIds",
        ...(modelProposal ? ["candidateDigest", "proposalDigest"] : []),
        "recordDigest",
      ],
      `MCP admission record ${index}`,
    );
    const { recordDigest, ...unsigned } = record;
    exactRecord(
      record.writer,
      [
        "timelinePackage",
        "timelineVersion",
        "reasoner",
        "serverPackage",
        "serverVersion",
      ],
      `MCP admission writer ${index}`,
    );
    validateMcpWriterIdentity(record.writer);
    const eventIds = run.events
      .slice(revision, revision + record.eventIds.length)
      .map(({ id }) => id);
    const prefix = {
      schema: run.schema,
      contract: run.contract,
      events: run.events.slice(0, revision),
    };
    if (
      record.schema !== "covenant.timeline.mcp-admission.v0alpha1" ||
      record.kind !== expectedKinds[index] ||
      record.decision !== "admitted" ||
      record.authorityId !== policy.decision.authorityId ||
      record.policyRef !== policy.decision.policyRef ||
      record.policyDigest !== policy.digest ||
      record.baseRevision !== revision ||
      record.baseRunDigest !== timeline.contentDigest(prefix) ||
      timeline.canonicalJson(record.eventIds) !==
        timeline.canonicalJson(eventIds) ||
      timeline.contentDigest(unsigned) !== recordDigest
    ) {
      throw new Error("MCP admission record did not reproduce");
    }
    if (modelProposal) {
      const call = calls[modelIndex++];
      if (
        !call ||
        record.candidateDigest !== call.preview.candidateDigest ||
        record.proposalDigest !== call.preview.proposalDigest ||
        timeline.canonicalJson(record) !==
          timeline.canonicalJson(call.admit.admissionRecord)
      ) {
        throw new Error("MCP model admission does not bind its proposal");
      }
    } else if (record.eventIds.length !== 1) {
      throw new Error("MCP direct admission must cover one event");
    }
    revision += record.eventIds.length;
  }
  if (revision !== run.events.length || modelIndex !== calls.length) {
    throw new Error("MCP admissions do not cover the exact event trajectory");
  }
  validateMcpWriterTrajectory(audit);
}

function proposalResultCandidate(value) {
  return {
    candidateDigest: value.candidateDigest,
    requestId: value.requestId,
    proposalDigest: value.proposalDigest,
    baseRevision: value.baseRevision,
    baseRunDigest: value.baseRunDigest,
    events: value.events,
    query: value.query,
    provenance: value.provenance,
  };
}

async function verifyEvidence(root, manifest, totalBudget) {
  exactRecord(
    manifest,
    ["schema", "redaction", "entries"],
    "real-model pilot evidence manifest",
  );
  if (
    manifest.schema !== "covenant.timeline.real-model-pilot.evidence.v1" ||
    manifest.redaction !== "public-fields-allowlisted" ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length !== 3
  ) {
    throw new Error("real-model pilot evidence manifest is invalid");
  }
  const evidenceDirectory = join(root, "evidence");
  await assertArtifactDirectory(root, evidenceDirectory, "evidence directory");
  const actualFiles = [];
  const handle = await opendir(evidenceDirectory);
  for await (const entry of handle) {
    if (!entry.isFile()) throw new Error("evidence entries must be real files");
    safeEvidenceName(entry.name, "evidence filename");
    actualFiles.push(entry.name);
  }
  actualFiles.sort();
  const expectedFiles = manifest.entries
    .map(({ path }) => path.replace(/^evidence\//u, ""))
    .sort();
  if (actualFiles.join("\0") !== expectedFiles.join("\0")) {
    throw new Error("evidence directory and manifest disagree");
  }
  const evidence = new Map();
  for (const item of manifest.entries) {
    exactRecord(
      item,
      ["path", "digest", "byteLength"],
      "evidence manifest entry",
    );
    const name = item.path.replace(/^evidence\//u, "");
    safeEvidenceName(name, "evidence filename");
    if (item.path !== `evidence/${name}`) {
      throw new Error("evidence path is invalid");
    }
    const bytes = await readBoundedArtifactFile(
      root,
      resolveInside(root, item.path, "evidence path"),
      REAL_MODEL_PILOT_LIMITS.evidenceBytes,
      `evidence ${name}`,
      (size) => consume(totalBudget, size),
    );
    if (
      !Number.isSafeInteger(item.byteLength) ||
      item.byteLength < 0 ||
      typeof item.digest !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(item.digest) ||
      bytes.byteLength !== item.byteLength ||
      sha256(bytes) !== item.digest
    ) {
      throw new Error("evidence bytes changed");
    }
    evidence.set(name, {
      id: name.replace(/\.[^.]+$/u, ""),
      name,
      bytes,
      text: decodeUtf8(bytes, `evidence ${name}`),
      digest: item.digest,
    });
  }
  return evidence;
}

async function readCanonical(
  root,
  path,
  timeline,
  label,
  maxBytes,
  totalBudget,
) {
  const bytes = await readBoundedArtifactFile(
    root,
    path,
    maxBytes,
    label,
    (size) => consume(totalBudget, size),
  );
  return parseCanonicalBytes(bytes, timeline, label);
}

function parseCanonicalBytes(bytes, timeline, label) {
  const text = decodeUtf8(bytes, label);
  const value = timeline.parseJson(text);
  if (text !== `${timeline.canonicalJson(value)}\n`) {
    throw new Error(`${label} is not canonical JSON`);
  }
  return value;
}

function budget(limit, label) {
  return { limit, label, used: 0 };
}

function consume(value, size) {
  value.used += size;
  if (value.used > value.limit) {
    throw new Error(`${value.label} exceeds its aggregate byte limit`);
  }
}

function assertDifference(conclusion, value) {
  const result = conclusion.result;
  if (
    result.type !== "difference.bounds" ||
    result.status !== "bounded" ||
    result.minimum !== value ||
    result.maximum !== value
  ) {
    throw new Error("pilot conclusion has the wrong semantic result");
  }
}

function required(map, name) {
  const value = map.get(name);
  if (!value) throw new Error(`pilot is missing ${name} conclusion`);
  return value;
}

function withoutRuntimeMatch({ runtimeMatched: _runtimeMatched, ...value }) {
  return value;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  const directory = process.argv[2];
  const flags = new Set(process.argv.slice(3));
  const allowDirty = flags.has("--allow-dirty");
  const requireRuntimeMatch = flags.has("--require-runtime-match");
  if (
    !directory ||
    process.argv.length < 3 ||
    process.argv.length > 5 ||
    flags.size !== process.argv.length - 3 ||
    [...flags].some(
      (flag) => flag !== "--allow-dirty" && flag !== "--require-runtime-match",
    )
  ) {
    process.stderr.write(
      "usage: mcp-real-model-pilot-verify <artifact> [--allow-dirty] [--require-runtime-match]\n",
    );
    process.exitCode = 1;
  } else {
    verifyRealModelPilot(directory, { allowDirty, requireRuntimeMatch })
      .then((report) => process.stdout.write(`${JSON.stringify(report)}\n`))
      .catch((error) => {
        process.stderr.write(
          `mcp-real-model-pilot-verify: ${error instanceof Error ? error.message : "failed"}\n`,
        );
        process.exitCode = 1;
      });
  }
}

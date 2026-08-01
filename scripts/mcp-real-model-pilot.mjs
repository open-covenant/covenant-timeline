#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
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
import { fileURLToPath } from "node:url";
import { connectMcpClient } from "./mcp-agent-pilot.mjs";
import {
  assertAttemptLedgerBinding,
  claimProviderInvocation,
  completeAttemptPhase,
  completedAttemptLedger,
  createAttemptLedger,
  failAttemptPhase,
  loadAttemptLedger,
} from "./formal-attempt-ledger.mjs";
import {
  decodeUtf8,
  credentialFreeEnvironment,
  loadMcpClient,
  readBoundedExactFile,
  repositoryRoot,
  sha256,
  writeCanonicalJson,
} from "./mcp-agent-pilot-lib.mjs";
import {
  REAL_MODEL_PILOT_SCHEMA,
  assertRealModelPilotRuntime,
  captureRealModelPilotRuntime,
  createAdapterRequest,
  createProposalScope,
  createRealModelPilotAdmissionPolicy,
  invocationRecord,
  invokeAdapter,
  loadModelConfig,
  loadPilotInput,
  redactedModelCall,
  validateMcpWriterTrajectory,
  validateProposalSemantics,
  validateProviderProposal,
} from "./mcp-real-model-pilot-lib.mjs";

const DECLARATIONS = [
  {
    id: "event-artifacts-published-declared",
    type: "point.declared",
    point: {
      id: "artifacts-published",
      contextId: "actual",
      axisId: "unix-milliseconds",
    },
  },
  {
    id: "event-tagged-readiness-declared",
    type: "point.declared",
    point: {
      id: "tagged-readiness-recorded",
      contextId: "actual",
      axisId: "unix-milliseconds",
    },
  },
];
const PHASE_RESULT_BYTES = 16 * 1024 * 1024;
const PHASE_RESULT_STAGING = ".phase-result-staging";

export async function runStart(options) {
  validateAdapterSelection(options.adapter, options.allowDirty);
  const input = await loadPilotInput(options.input);
  const modelConfig = await loadModelConfig(options.config, {
    allowDirty: options.allowDirty,
  });
  const runtime = await phaseRuntime(options, input.timeline);
  const policy = createRealModelPilotAdmissionPolicy(input.timeline);
  const requestedState = resolve(options.state);
  await assertOutsideCheckout(requestedState);
  await mkdir(requestedState, { mode: 0o700 });
  await mkdir(join(requestedState, "mcp"), { mode: 0o700 });
  await mkdir(join(requestedState, PHASE_RESULT_STAGING), { mode: 0o700 });

  const invocation = invocationRecord("initial");
  const binding = attemptBinding({ input, modelConfig, policy, runtime });
  const ledger = await createAttemptLedger(
    requestedState,
    binding,
    input.timeline,
    { allowFailureInjection: options.allowDirty },
  );
  const state = await assertStateLayout(requestedState);
  await syncDirectory(state);
  let providerClaimed = false;
  let phaseCompleted = false;
  let requestDigest;
  const session = await connectServer(join(state, "mcp"), "initial", runtime);
  try {
    const created = await session.call("timeline_create_run", {
      contract: input.contract,
    });
    let runDigest = created.timeline.runDigest;
    for (const event of DECLARATIONS) {
      const result = await session.call("timeline_append_event", {
        runId: input.contract.id,
        expectedRunDigest: runDigest,
        event,
        admission: policy.decision,
      });
      runDigest = result.timeline.runDigest;
    }
    const run = await readRun(
      session.client,
      input.contract.id,
      input.timeline,
    );
    const scope = createProposalScope({ phase: "initial", input, run });
    const { request, outputSchema } = createAdapterRequest({
      input,
      scope,
      config: modelConfig.config,
    });
    requestDigest = input.timeline.contentDigest(request);
    await claimProviderInvocation(ledger, {
      phase: "initial",
      invocation,
      mcpInvocation: session.invocation,
      requestDigest,
      baseRevision: run.events.length,
      baseRunDigest: runDigest,
    });
    providerClaimed = true;
    const adapter = invokeAdapter(
      options.adapter.command,
      options.adapter.args,
      request,
      input.timeline,
    );
    const { proposal, usage } = validateProviderProposal(
      adapter.response,
      outputSchema,
    );
    const { preview, admit } = await previewAndAdmitProposal({
      session,
      phase: "initial",
      input,
      scope,
      run,
      runDigest,
      proposal,
      policy,
    });
    if (admit.events.length !== 2) {
      throw new Error("initial model proposal did not append two assertions");
    }
    const conclusion = await session.call("timeline_reason", {
      runId: input.contract.id,
      query: omitSchema(admit.query),
    });
    assertDifference(
      conclusion.conclusion,
      input.pilot.expected.initialDifference,
      "initial",
    );
    const call = redactedModelCall({
      phase: "initial",
      input,
      modelConfig,
      request,
      responseText: adapter.responseText,
      proposal,
      usage,
      scope,
      preview,
      admit,
    });
    const resultRun = input.timeline.parseRunDocumentV0Alpha3({
      schema: run.schema,
      contract: run.contract,
      events: [...run.events, ...admit.events],
    });
    const audit = await readAudit(
      session.client,
      input.contract.id,
      input.timeline,
    );
    await assertRealModelPilotRuntime(runtime, input.timeline);
    const resultBundle = await writePhaseResultBundle(
      state,
      {
        schema: "covenant.timeline.real-model-pilot.phase-result.v1",
        phase: "initial",
        binding,
        invocation,
        mcpInvocation: session.invocation,
        runtime: runtime.identity,
        resultRevision: admit.timeline.revision,
        resultRunDigest: admit.timeline.runDigest,
        recordedThrough: admit.query.recordedThrough,
        modelCall: call,
        baseRun: run,
        run: resultRun,
        audit,
        conclusion,
      },
      input.timeline,
      options,
    );
    injectFailure(options, "before-initial-phase-completion");
    await completeAttemptPhase(ledger, {
      phase: "initial",
      invocation,
      requestDigest,
      responseDigest: call.responseDigest,
      proposalDigest: preview.proposalDigest,
      candidateDigest: preview.candidateDigest,
      resultBundleDigest: resultBundle.digest,
      resultRevision: admit.timeline.revision,
      resultRunDigest: admit.timeline.runDigest,
    });
    phaseCompleted = true;
    injectFailure(options, "after-initial-phase-completion");
    return {
      phase: "initial-complete",
      runDigest: admit.timeline.runDigest,
      recordedThrough: admit.query.recordedThrough,
    };
  } catch (error) {
    if (providerClaimed && !phaseCompleted && !isInjectedCrash(error)) {
      await failAttemptPhase(ledger, {
        phase: "initial",
        invocation,
        requestDigest,
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    await session.client.close();
  }
}

export async function runResume(options) {
  validateAdapterSelection(options.adapter, options.allowDirty);
  const input = await loadPilotInput(options.input);
  const modelConfig = await loadModelConfig(options.config, {
    allowDirty: options.allowDirty,
  });
  const policy = createRealModelPilotAdmissionPolicy(input.timeline);
  const state = await assertStateLayout(resolve(options.state));
  await assertOutsideCheckout(state);
  const requestedOutput = resolve(options.out);
  const output = join(
    await realpath(dirname(requestedOutput)),
    basename(requestedOutput),
  );
  await assertOutsideCheckout(output);
  const ledger = await loadAttemptLedger(state, input.timeline, {
    allowFailureInjection: options.allowDirty,
  });
  const initialBundle = await readPhaseResultBundle(
    state,
    "initial",
    input.timeline,
  );
  const runtime = await assertRealModelPilotRuntime(
    {
      identity: initialBundle.document.runtime,
      digest: initialBundle.document.binding.runtimeDigest,
    },
    input.timeline,
  );
  await assertBootstrapRuntime(options, runtime, input.timeline);
  const binding = attemptBinding({ input, modelConfig, policy, runtime });
  assertAttemptLedgerBinding(ledger, binding);
  const initialStarted = ledger.document.entries[1];
  let initialCompleted = ledger.document.entries[2];
  validatePhaseResultBundle({
    bundle: initialBundle.document,
    binding,
    started: initialStarted,
    completed: initialCompleted,
    timeline: input.timeline,
    phase: "initial",
    input,
    modelConfig,
    policy,
  });
  if (
    ledger.document.entries.length === 2 &&
    initialStarted?.kind === "provider-invocation-reserved" &&
    initialStarted.phase === "initial"
  ) {
    await resyncAcceptedPhaseBundle(
      state,
      "initial",
      input.timeline,
      initialBundle.digest,
    );
    await completeAttemptPhase(
      ledger,
      completionFromBundle(initialBundle, initialStarted),
    );
    initialCompleted = ledger.document.entries[2];
  }
  if (
    initialCompleted?.kind !== "phase-completed" ||
    initialCompleted.phase !== "initial" ||
    initialCompleted.resultBundleDigest !== initialBundle.digest
  ) {
    throw new Error("initial phase result is not durably completed");
  }

  if (ledger.document.entries.length !== 3) {
    const correctionBundle = await completedCorrectionBundle({
      state,
      ledger,
      binding,
      timeline: input.timeline,
      input,
      modelConfig,
      policy,
    });
    return publishCompletedAttempt({
      output,
      input,
      modelConfig,
      policy,
      runtime,
      attemptLedger: completedAttemptLedger(ledger),
      initialBundle,
      correctionBundle,
      options,
    });
  }

  if (initialBundle.document.invocation.processId === process.pid) {
    throw new Error("resume must use a separate host process");
  }
  const initialCall = initialBundle.document.modelCall;
  const initialConclusion = initialBundle.document.conclusion;
  const invocation = invocationRecord("correction");
  let providerClaimed = false;
  let phaseCompleted = false;
  let requestDigest;
  let correctionBundle;
  const session = await connectServer(
    join(state, "mcp"),
    "correction",
    runtime,
  );
  try {
    if (
      initialBundle.document.mcpInvocation.processId ===
        session.invocation.processId ||
      initialBundle.document.mcpInvocation.invocationId ===
        session.invocation.invocationId
    ) {
      throw new Error("resume did not start a distinct MCP child process");
    }
    const listed = await session.call("timeline_list_runs", {});
    const recovered = listed.timelines.find(
      ({ runId }) => runId === input.contract.id,
    );
    const recoveredRun = await readRun(
      session.client,
      input.contract.id,
      input.timeline,
    );
    const recoveredAudit = await readAudit(
      session.client,
      input.contract.id,
      input.timeline,
    );
    if (
      !recovered ||
      recovered.runDigest !== initialBundle.document.resultRunDigest ||
      recovered.revision !== initialBundle.document.resultRevision ||
      recovered.auditDigest !==
        input.timeline.contentDigest(initialBundle.document.audit) ||
      recovered.admissionCount !==
        initialBundle.document.audit.admissions.length ||
      input.timeline.canonicalJson(recoveredRun) !==
        input.timeline.canonicalJson(initialBundle.document.run) ||
      input.timeline.canonicalJson(recoveredAudit) !==
        input.timeline.canonicalJson(initialBundle.document.audit)
    ) {
      throw new Error("MCP state did not recover at the recorded prefix");
    }
    const run = recoveredRun;
    const initialAssertion = run.events.find(
      (event) =>
        event.type === "coordinate.asserted" &&
        event.assertion.pointId === "artifacts-published",
    );
    if (!initialAssertion) {
      throw new Error("initial publication assertion is missing");
    }
    const scope = createProposalScope({
      phase: "correction",
      input,
      run,
      initialAssertionId: initialAssertion.assertion.id,
    });
    const { request, outputSchema } = createAdapterRequest({
      input,
      scope,
      config: modelConfig.config,
    });
    requestDigest = input.timeline.contentDigest(request);
    await claimProviderInvocation(ledger, {
      phase: "correction",
      invocation,
      mcpInvocation: session.invocation,
      requestDigest,
      baseRevision: run.events.length,
      baseRunDigest: recovered.runDigest,
    });
    providerClaimed = true;
    const adapter = invokeAdapter(
      options.adapter.command,
      options.adapter.args,
      request,
      input.timeline,
    );
    const { proposal, usage } = validateProviderProposal(
      adapter.response,
      outputSchema,
    );
    const { preview, admit } = await previewAndAdmitProposal({
      session,
      phase: "correction",
      input,
      scope,
      run,
      runDigest: recovered.runDigest,
      proposal,
      policy,
    });
    if (admit.events.length !== 1) {
      throw new Error("correction model proposal did not append one assertion");
    }
    const historicalQuery = {
      ...omitSchema(admit.query),
      id: "query-readiness-minus-publication-before-correction",
      recordedThrough: initialCall.admit.query.recordedThrough,
    };
    const historical = await session.call("timeline_reason", {
      runId: input.contract.id,
      query: historicalQuery,
    });
    const current = await session.call("timeline_reason", {
      runId: input.contract.id,
      query: omitSchema(admit.query),
    });
    assertDifference(
      historical.conclusion,
      input.pilot.expected.initialDifference,
      "historical",
    );
    assertDifference(
      current.conclusion,
      input.pilot.expected.correctedDifference,
      "corrected",
    );
    const finalRun = await readRun(
      session.client,
      input.contract.id,
      input.timeline,
    );
    const audit = await readAudit(
      session.client,
      input.contract.id,
      input.timeline,
    );
    const correctionCall = redactedModelCall({
      phase: "correction",
      input,
      modelConfig,
      request,
      responseText: adapter.responseText,
      proposal,
      usage,
      scope,
      preview,
      admit,
    });
    await assertRealModelPilotRuntime(runtime, input.timeline);
    correctionBundle = await writePhaseResultBundle(
      state,
      {
        schema: "covenant.timeline.real-model-pilot.phase-result.v1",
        phase: "correction",
        binding,
        invocation,
        mcpInvocation: session.invocation,
        runtime: runtime.identity,
        resultRevision: admit.timeline.revision,
        resultRunDigest: admit.timeline.runDigest,
        recordedThrough: admit.query.recordedThrough,
        modelCall: correctionCall,
        baseRun: run,
        historical,
        current,
        run: finalRun,
        audit,
      },
      input.timeline,
      options,
    );
    injectFailure(options, "before-correction-phase-completion");
    await completeAttemptPhase(ledger, {
      phase: "correction",
      invocation,
      requestDigest,
      responseDigest: correctionCall.responseDigest,
      proposalDigest: preview.proposalDigest,
      candidateDigest: preview.candidateDigest,
      resultBundleDigest: correctionBundle.digest,
      resultRevision: admit.timeline.revision,
      resultRunDigest: admit.timeline.runDigest,
    });
    phaseCompleted = true;
    injectFailure(options, "after-correction-phase-completion");
  } catch (error) {
    if (providerClaimed && !phaseCompleted && !isInjectedCrash(error)) {
      await failAttemptPhase(ledger, {
        phase: "correction",
        invocation,
        requestDigest,
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    await session.client.close();
  }
  return publishCompletedAttempt({
    output,
    input,
    modelConfig,
    policy,
    runtime,
    attemptLedger: completedAttemptLedger(ledger),
    initialBundle,
    correctionBundle,
    options,
  });
}

async function completedCorrectionBundle({
  state,
  ledger,
  binding,
  timeline,
  input,
  modelConfig,
  policy,
}) {
  const started = ledger.document.entries[3];
  let completed = ledger.document.entries[4];
  if (completed && completed.kind !== "phase-completed") {
    throw new Error(
      "correction was attempted but does not have a completed result bundle",
    );
  }
  if (
    ![4, 5].includes(ledger.document.entries.length) ||
    started?.kind !== "provider-invocation-reserved" ||
    started.phase !== "correction"
  ) {
    throw new Error(
      "correction was attempted but does not have a completed result bundle",
    );
  }
  const bundle = await readPhaseResultBundle(state, "correction", timeline);
  if (completed && completed.resultBundleDigest !== bundle.digest) {
    throw new Error("correction phase result bundle digest changed");
  }
  validatePhaseResultBundle({
    bundle: bundle.document,
    binding,
    started,
    completed,
    timeline,
    phase: "correction",
    input,
    modelConfig,
    policy,
  });
  if (!completed && ledger.document.entries.length === 4) {
    await resyncAcceptedPhaseBundle(
      state,
      "correction",
      timeline,
      bundle.digest,
    );
    await completeAttemptPhase(ledger, completionFromBundle(bundle, started));
    completed = ledger.document.entries[4];
  }
  if (
    completed?.kind !== "phase-completed" ||
    completed.phase !== "correction" ||
    completed.resultBundleDigest !== bundle.digest
  ) {
    throw new Error(
      "correction was attempted but does not have a completed result bundle",
    );
  }
  return bundle;
}

async function publishCompletedAttempt({
  output,
  input,
  modelConfig,
  policy,
  runtime,
  attemptLedger,
  initialBundle,
  correctionBundle,
  options,
}) {
  const recovered = await recoverPublishedArtifact(output, attemptLedger, {
    allowDirty: options.allowDirty,
  });
  if (recovered) return recovered;
  const publication = await claimArtifactPublication(
    output,
    attemptLedger,
    input.timeline,
  );
  const staging = join(dirname(output), publication.staging);
  await mkdir(staging, { mode: 0o700 });
  await exportArtifact({
    output: staging,
    input,
    modelConfig,
    initialCall: initialBundle.document.modelCall,
    correctionCall: correctionBundle.document.modelCall,
    initialConclusion: initialBundle.document.conclusion,
    historical: correctionBundle.document.historical,
    current: correctionBundle.document.current,
    finalRun: correctionBundle.document.run,
    audit: correctionBundle.document.audit,
    policy,
    runtime,
    attemptLedger,
    phaseResults: [initialBundle, correctionBundle],
    invocations: [
      initialBundle.document.invocation,
      correctionBundle.document.invocation,
    ],
    mcpInvocations: [
      initialBundle.document.mcpInvocation,
      correctionBundle.document.mcpInvocation,
    ],
    options,
  });
  const verification = verifyInSeparateProcess(staging, {
    allowDirty: options.allowDirty,
  });
  await writeCanonicalJson(
    join(staging, "verification.json"),
    verification,
    input.timeline.canonicalJson,
  );
  await syncTree(staging);
  try {
    await rename(staging, output);
  } catch (error) {
    if (!["EEXIST", "ENOTEMPTY"].includes(error?.code)) throw error;
    const existing = await recoverPublishedArtifact(output, attemptLedger, {
      allowDirty: options.allowDirty,
    });
    if (existing) return existing;
    throw error;
  }
  injectFailure(options, "after-artifact-install");
  injectFailure(options, "before-artifact-parent-sync");
  await syncDirectory(dirname(output));
  await releaseArtifactPublicationClaim(output);
  return verification;
}

async function exportArtifact({
  output,
  input,
  modelConfig,
  initialCall,
  correctionCall,
  initialConclusion,
  historical,
  current,
  finalRun,
  audit,
  policy,
  runtime,
  attemptLedger,
  phaseResults,
  invocations,
  mcpInvocations,
  options,
}) {
  await Promise.all([
    mkdir(join(output, "evidence"), { mode: 0o700 }),
    mkdir(join(output, "model-calls"), { mode: 0o700 }),
    mkdir(join(output, "queries"), { mode: 0o700 }),
    mkdir(join(output, "conclusions"), { mode: 0o700 }),
    mkdir(join(output, "phase-results"), { mode: 0o700 }),
  ]);
  for (const entry of input.evidence.values()) {
    await writeFile(join(output, "evidence", entry.name), entry.bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
  const calls = [initialCall, correctionCall];
  const conclusions = [
    ["initial", initialConclusion],
    ["historical", historical],
    ["current", current],
  ];
  const artifactPaths = [
    ...calls.map((call) => `model-calls/${call.phase}.json`),
    ...conclusions.flatMap(([name]) => [
      `queries/${name}.json`,
      `conclusions/${name}.json`,
    ]),
    ...[...input.evidence.values()].map(({ name }) => `evidence/${name}`),
    ...phaseResults.map(
      ({ document }) => `phase-results/${document.phase}.json`,
    ),
    "README.md",
    "admission-policy.json",
    "attempt-ledger.json",
    "artifact.json",
    "audit.json",
    "evidence-manifest.json",
    "model-config.json",
    "pilot-input.json",
    "prompt.md",
    "run.json",
  ].sort();
  await Promise.all([
    ...calls.map((call) =>
      writeCanonicalJson(
        join(output, "model-calls", `${call.phase}.json`),
        call,
        input.timeline.canonicalJson,
      ),
    ),
    ...conclusions.flatMap(([name, result]) => [
      writeCanonicalJson(
        join(output, "queries", `${name}.json`),
        result.query,
        input.timeline.canonicalJson,
      ),
      writeCanonicalJson(
        join(output, "conclusions", `${name}.json`),
        result.conclusion,
        input.timeline.canonicalJson,
      ),
    ]),
    writeCanonicalJson(
      join(output, "run.json"),
      finalRun,
      input.timeline.canonicalJson,
    ),
    writeCanonicalJson(
      join(output, "audit.json"),
      audit,
      input.timeline.canonicalJson,
    ),
    writeFile(join(output, "admission-policy.json"), policy.bytes, {
      flag: "wx",
      mode: 0o600,
    }),
    writeCanonicalJson(
      join(output, "attempt-ledger.json"),
      attemptLedger.document,
      input.timeline.canonicalJson,
    ),
    ...phaseResults.map(({ document }) =>
      writeCanonicalJson(
        join(output, "phase-results", `${document.phase}.json`),
        document,
        input.timeline.canonicalJson,
      ),
    ),
    writeCanonicalJson(
      join(output, "pilot-input.json"),
      input.pilot,
      input.timeline.canonicalJson,
    ),
    writeCanonicalJson(
      join(output, "model-config.json"),
      modelConfig.config,
      input.timeline.canonicalJson,
    ),
    writeCanonicalJson(
      join(output, "evidence-manifest.json"),
      {
        schema: "covenant.timeline.real-model-pilot.evidence.v1",
        redaction: "public-fields-allowlisted",
        entries: [...input.evidence.values()].map(
          ({ name, digest, bytes }) => ({
            path: `evidence/${name}`,
            digest,
            byteLength: bytes.byteLength,
          }),
        ),
      },
      input.timeline.canonicalJson,
    ),
    writeCanonicalJson(
      join(output, "artifact.json"),
      {
        schema: REAL_MODEL_PILOT_SCHEMA,
        id: input.pilot.id,
        operator: input.pilot.operator,
        operation: "maintainer-operated",
        provenance: {
          modelExecution: "maintainer-attested",
          processRestart: "maintainer-attested",
          externalEvidenceAuthenticity: "maintainer-attested",
          mcpProcessIdentity: "driver-observed-maintainer-attested",
        },
        workflow: input.pilot.workflow,
        inputDigest: input.inputDigest,
        pilotInput: "pilot-input.json",
        run: "run.json",
        runDigest: input.timeline.contentDigest(finalRun),
        audit: "audit.json",
        auditDigest: input.timeline.contentDigest(audit),
        admissionPolicy: "admission-policy.json",
        admissionPolicyDigest: policy.digest,
        attemptLedger: "attempt-ledger.json",
        attemptLedgerDigest: attemptLedger.digest,
        evidenceManifest: "evidence-manifest.json",
        modelConfig: "model-config.json",
        modelConfigDigest: modelConfig.digest,
        prompt: "prompt.md",
        promptDigest: input.timeline.contentDigest(input.prompt),
        contentManifest: "content-manifest.json",
        phaseResults: phaseResults.map(({ document, digest }) => ({
          phase: document.phase,
          path: `phase-results/${document.phase}.json`,
          digest,
        })),
        expected: input.pilot.expected,
        modelCalls: ["model-calls/initial.json", "model-calls/correction.json"],
        conclusions: conclusions.map(([name]) => ({
          name,
          query: `queries/${name}.json`,
          conclusion: `conclusions/${name}.json`,
        })),
        invocations,
        mcpInvocations,
        source: modelConfig.source,
        runtime: runtime.identity,
        runtimeDigest: runtime.digest,
        limitations: [
          "not-independent-adoption",
          "public-evidence-normalized-by-host",
          "external-evidence-authenticity-not-cryptographically-proven",
          "model-proposals-untrusted-and-host-admitted-after-semantic-validation",
        ],
      },
      input.timeline.canonicalJson,
    ),
    writeFile(join(output, "README.md"), artifactReadme(input.pilot.title), {
      flag: "wx",
      mode: 0o600,
    }),
    writeFile(join(output, "prompt.md"), input.prompt, {
      flag: "wx",
      mode: 0o600,
    }),
  ]);
  injectFailure(options, "during-artifact-export");
  const entries = await Promise.all(
    artifactPaths.map(async (path) => {
      const bytes = await readBoundedExactFile(
        join(output, path),
        PHASE_RESULT_BYTES,
        `artifact staging file ${path}`,
        { root: output, scope: "the artifact staging directory" },
      );
      return {
        path,
        digest: sha256(bytes),
        byteLength: bytes.byteLength,
      };
    }),
  );
  await writeCanonicalJson(
    join(output, "content-manifest.json"),
    {
      schema: "covenant.timeline.real-model-pilot.content-manifest.v1",
      algorithm: "sha256",
      excluded: ["content-manifest.json", "verification.json"],
      entries,
    },
    input.timeline.canonicalJson,
  );
}

async function writePhaseResultBundle(state, document, timeline, options) {
  validatePhaseResultShape(document);
  const path = join(state, `${document.phase}-result.json`);
  const bytes = Buffer.from(`${timeline.canonicalJson(document)}\n`);
  if (bytes.byteLength === 0 || bytes.byteLength > PHASE_RESULT_BYTES) {
    throw new Error("phase result bundle exceeds its byte limit");
  }
  const staging = join(state, PHASE_RESULT_STAGING);
  const temporary = join(staging, `${document.phase}-${randomUUID()}.json`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    injectFailure(options, `before-${document.phase}-result-sync`);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, path);
    injectFailure(options, `after-${document.phase}-result-install`);
    try {
      await syncDirectory(state);
    } catch (error) {
      throw recoverableDurabilityError(error);
    }
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw recoverableDurabilityError(error);
    });
    await syncDirectory(staging).catch((error) => {
      throw recoverableDurabilityError(error);
    });
  }
  return { document, digest: timeline.contentDigest(document) };
}

async function readPhaseResultBundle(
  state,
  phase,
  timeline,
  { sync = false } = {},
) {
  const path = join(state, `${phase}-result.json`);
  let document;
  const bytes = await readBoundedExactFile(
    path,
    PHASE_RESULT_BYTES,
    `${phase} phase result bundle`,
    {
      root: state,
      scope: "the pilot state",
      sync,
      validate(value) {
        if (value.byteLength === 0) {
          throw new Error("phase result bundle has an invalid byte length");
        }
        const text = decodeUtf8(value, `${phase} phase result bundle`);
        document = timeline.parseJson(text);
        if (text !== `${timeline.canonicalJson(document)}\n`) {
          throw new Error("phase result bundle is not canonical JSON");
        }
        validatePhaseResultShape(document);
      },
    },
  );
  return { document, digest: timeline.contentDigest(document) };
}

async function resyncAcceptedPhaseBundle(state, phase, timeline, digest) {
  const accepted = await readPhaseResultBundle(state, phase, timeline, {
    sync: true,
  });
  if (accepted.digest !== digest) {
    throw new Error(`${phase} phase result bundle changed before recovery`);
  }
  await syncDirectory(state);
}

function validatePhaseResultShape(bundle) {
  if (bundle === null || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error("phase result bundle is invalid");
  }
  const common = [
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
  const expected =
    bundle.phase === "initial"
      ? [...common, "conclusion"]
      : bundle.phase === "correction"
        ? [...common, "historical", "current"]
        : [];
  if (
    bundle.schema !== "covenant.timeline.real-model-pilot.phase-result.v1" ||
    Object.keys(bundle).sort().join(",") !== expected.sort().join(",")
  ) {
    throw new Error("phase result bundle shape is invalid");
  }
}

function validatePhaseResultBundle({
  bundle,
  binding,
  started,
  completed,
  timeline,
  phase,
  input,
  modelConfig,
  policy,
}) {
  validatePhaseResultShape(bundle);
  if (
    started?.kind !== "provider-invocation-reserved" ||
    started.phase !== phase ||
    bundle.phase !== phase ||
    timeline.canonicalJson(bundle.binding) !==
      timeline.canonicalJson(binding) ||
    timeline.contentDigest(bundle.runtime) !== binding.runtimeDigest ||
    timeline.canonicalJson(bundle.invocation) !==
      timeline.canonicalJson(started.invocation) ||
    timeline.canonicalJson(bundle.mcpInvocation) !==
      timeline.canonicalJson(started.mcpInvocation) ||
    bundle.modelCall.phase !== phase ||
    bundle.modelCall.requestDigest !== started.requestDigest ||
    bundle.modelCall.admit.timeline.revision !== bundle.resultRevision ||
    bundle.modelCall.admit.timeline.runDigest !== bundle.resultRunDigest ||
    bundle.modelCall.admit.query.recordedThrough !== bundle.recordedThrough ||
    timeline.contentDigest(bundle.baseRun) !== started.baseRunDigest ||
    bundle.baseRun.events.length !== started.baseRevision ||
    timeline.contentDigest(bundle.run) !== bundle.resultRunDigest ||
    timeline.canonicalJson(bundle.modelCall.config) !==
      timeline.canonicalJson(modelConfig.config) ||
    bundle.modelCall.configDigest !== modelConfig.digest ||
    sha256(Buffer.from(bundle.modelCall.responseText)) !==
      bundle.modelCall.responseDigest ||
    bundle.modelCall.preview.proposalDigest !==
      timeline.contentDigest(bundle.modelCall.proposal)
  ) {
    throw new Error(`${phase} phase result bundle binding changed`);
  }
  if (
    completed &&
    (completed.kind !== "phase-completed" ||
      completed.phase !== phase ||
      bundle.resultRevision !== completed.resultRevision ||
      bundle.resultRunDigest !== completed.resultRunDigest ||
      bundle.modelCall.requestDigest !== completed.requestDigest ||
      bundle.modelCall.responseDigest !== completed.responseDigest ||
      bundle.modelCall.preview.proposalDigest !== completed.proposalDigest ||
      bundle.modelCall.preview.candidateDigest !== completed.candidateDigest)
  ) {
    throw new Error(`${phase} phase completion binding changed`);
  }
  const publication = bundle.baseRun.events.find(
    (event) =>
      event.type === "coordinate.asserted" &&
      event.assertion.pointId === "artifacts-published",
  );
  const scope = createProposalScope({
    phase,
    input,
    run: bundle.baseRun,
    initialAssertionId:
      phase === "correction" ? publication?.assertion.id : undefined,
  });
  const expectedRequest = createAdapterRequest({
    input,
    scope,
    config: modelConfig.config,
  });
  if (
    timeline.contentDigest(expectedRequest.request) !== started.requestDigest ||
    timeline.canonicalJson(bundle.modelCall.outputSchema) !==
      timeline.canonicalJson(expectedRequest.outputSchema)
  ) {
    throw new Error(`${phase} phase result request changed`);
  }
  verifyProposalPreview({
    preview: bundle.modelCall.preview,
    proposal: bundle.modelCall.proposal,
    scope,
    run: bundle.baseRun,
    input,
    runDigest: started.baseRunDigest,
  });
  validateProposalSemantics(
    phase,
    bundle.modelCall.proposal,
    input.pilot.expected,
  );
  verifyProposalAdmission({
    preview: bundle.modelCall.preview,
    admit: bundle.modelCall.admit,
    policy,
    input,
  });
  const expectedRun = timeline.parseRunDocumentV0Alpha3({
    schema: bundle.baseRun.schema,
    contract: bundle.baseRun.contract,
    events: [...bundle.baseRun.events, ...bundle.modelCall.admit.events],
  });
  if (
    timeline.canonicalJson(expectedRun) !== timeline.canonicalJson(bundle.run)
  ) {
    throw new Error(`${phase} phase result run changed`);
  }
  const response =
    bundle.modelCall.usage === null
      ? bundle.modelCall.proposal
      : { ...bundle.modelCall.proposal, usage: bundle.modelCall.usage };
  if (
    timeline.canonicalJson(
      timeline.parseJson(bundle.modelCall.responseText),
    ) !== timeline.canonicalJson(response)
  ) {
    throw new Error(`${phase} phase result response changed`);
  }
  if (
    timeline.canonicalJson(bundle.audit.run) !==
    timeline.canonicalJson(bundle.run)
  ) {
    throw new Error(`${phase} phase result audit binding changed`);
  }
  validateBundleAudit(bundle, policy, timeline);
  const previewMetadata = bundleMetadataAtRevision(
    bundle,
    started.baseRevision,
    timeline,
  );
  const admittedMetadata = bundleMetadataAtRevision(
    bundle,
    bundle.resultRevision,
    timeline,
  );
  if (
    timeline.canonicalJson(bundle.modelCall.preview.timeline) !==
      timeline.canonicalJson(previewMetadata) ||
    timeline.canonicalJson(bundle.modelCall.admit.timeline) !==
      timeline.canonicalJson(admittedMetadata)
  ) {
    throw new Error(`${phase} phase result timeline metadata changed`);
  }
  const conclusions =
    phase === "initial"
      ? [bundle.conclusion]
      : [bundle.historical, bundle.current];
  for (const result of conclusions) {
    if (
      result.verified !== true ||
      !timeline.verifyTemporalConclusionV0Alpha3(
        bundle.run,
        result.query,
        result.conclusion,
      )
    ) {
      throw new Error(`${phase} phase result conclusion did not verify`);
    }
  }
}

function completionFromBundle(bundle, started) {
  return {
    phase: bundle.document.phase,
    invocation: bundle.document.invocation,
    requestDigest: started.requestDigest,
    responseDigest: bundle.document.modelCall.responseDigest,
    proposalDigest: bundle.document.modelCall.preview.proposalDigest,
    candidateDigest: bundle.document.modelCall.preview.candidateDigest,
    resultBundleDigest: bundle.digest,
    resultRevision: bundle.document.resultRevision,
    resultRunDigest: bundle.document.resultRunDigest,
  };
}

function validateBundleAudit(bundle, policy, timeline) {
  const audit = bundle.audit;
  if (
    audit.schema !== "covenant.timeline.mcp-run.v0alpha2" ||
    audit.runId !== bundle.run.contract.id ||
    audit.revision !== bundle.run.events.length ||
    audit.runDigest !== timeline.contentDigest(bundle.run) ||
    audit.lastWriter?.timelinePackage !== "@covenant-org/timeline" ||
    audit.lastWriter?.timelineVersion !== "0.0.0-alpha.3" ||
    audit.lastWriter?.reasoner !== "covenant.timeline.stn.v0alpha1" ||
    audit.lastWriter?.serverPackage !== "@covenant-org/timeline-mcp" ||
    audit.lastWriter?.serverVersion !== "0.0.0-alpha.1" ||
    !Array.isArray(audit.admissions)
  ) {
    throw new Error(`${bundle.phase} phase result audit is invalid`);
  }
  let revision = 0;
  for (const record of audit.admissions) {
    const { recordDigest, ...unsigned } = record;
    const eventIds = bundle.run.events
      .slice(revision, revision + record.eventIds.length)
      .map(({ id }) => id);
    if (
      record.schema !== "covenant.timeline.mcp-admission.v0alpha1" ||
      record.decision !== "admitted" ||
      record.authorityId !== policy.decision.authorityId ||
      record.policyRef !== policy.decision.policyRef ||
      record.policyDigest !== policy.digest ||
      record.baseRevision !== revision ||
      timeline.canonicalJson(record.eventIds) !==
        timeline.canonicalJson(eventIds) ||
      timeline.contentDigest(unsigned) !== recordDigest
    ) {
      throw new Error(`${bundle.phase} phase result admission is invalid`);
    }
    revision += record.eventIds.length;
  }
  if (revision !== bundle.run.events.length) {
    throw new Error(`${bundle.phase} phase result admissions are incomplete`);
  }
  validateMcpWriterTrajectory(audit);
  if (
    timeline.canonicalJson(audit.admissions.at(-1)) !==
    timeline.canonicalJson(bundle.modelCall.admit.admissionRecord)
  ) {
    throw new Error(`${bundle.phase} phase result admission binding changed`);
  }
}

function bundleMetadataAtRevision(bundle, revision, timeline) {
  const run = timeline.parseRunDocumentV0Alpha3({
    schema: bundle.run.schema,
    contract: bundle.run.contract,
    events: bundle.run.events.slice(0, revision),
  });
  const admissions = [];
  let covered = 0;
  for (const admission of bundle.audit.admissions) {
    if (covered === revision) break;
    if (covered + admission.eventIds.length > revision) {
      throw new Error(
        "phase result admissions do not align with the run prefix",
      );
    }
    admissions.push(admission);
    covered += admission.eventIds.length;
  }
  if (covered !== revision) {
    throw new Error("phase result admissions do not cover the run prefix");
  }
  const envelope = {
    schema: bundle.audit.schema,
    runId: bundle.audit.runId,
    revision,
    runDigest: timeline.contentDigest(run),
    admissions,
    lastWriter: bundle.audit.lastWriter,
    run,
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

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function recoverPublishedArtifact(output, attemptLedger, options) {
  if (!(await pathExists(output))) return null;
  const [stat, canonical] = await Promise.all([
    lstat(output),
    realpath(output),
  ]);
  if (!stat.isDirectory() || canonical !== output) {
    throw new Error("pilot artifact output must be a real directory");
  }
  const report = verifyInSeparateProcess(output, options);
  if (report.attemptLedgerDigest !== attemptLedger.digest) {
    throw new Error("published pilot artifact belongs to another attempt");
  }
  await syncDirectory(output);
  await syncDirectory(dirname(output));
  await releaseArtifactPublicationClaim(output);
  return report;
}

async function claimArtifactPublication(output, attemptLedger, timeline) {
  const parent = dirname(output);
  const claim = publicationClaimPath(output);
  const claimId = randomUUID();
  const document = {
    schema: "covenant.timeline.real-model-pilot.publication-claim.v1",
    output: basename(output),
    attemptLedgerDigest: attemptLedger.digest,
    claimId,
    processId: process.pid,
    staging: `.${basename(output)}.staging-${claimId}`,
  };
  const bytes = Buffer.from(`${timeline.canonicalJson(document)}\n`);
  const temporary = join(parent, `.${basename(output)}.claim-${randomUUID()}`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, claim);
    await syncDirectory(parent);
    return document;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readPublicationClaim(output, timeline);
    if (
      existing.schema !== document.schema ||
      existing.output !== document.output ||
      existing.attemptLedgerDigest !== document.attemptLedgerDigest ||
      typeof existing.claimId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        existing.claimId,
      ) ||
      Object.keys(existing).sort().join(",") !==
        "attemptLedgerDigest,claimId,output,processId,schema,staging" ||
      existing.staging !== `.${basename(output)}.staging-${existing.claimId}` ||
      !Number.isSafeInteger(existing.processId) ||
      existing.processId < 1
    ) {
      throw new Error(
        "pilot artifact publication is claimed by another attempt",
      );
    }
    if (processIsActive(existing.processId)) {
      throw new Error("pilot artifact publication is already in progress");
    }
    const stale = join(
      parent,
      `.${basename(output)}.stale-claim-${existing.claimId}.json`,
    );
    try {
      await rename(claim, stale);
    } catch (replacementError) {
      if (replacementError?.code === "ENOENT") {
        return claimArtifactPublication(output, attemptLedger, timeline);
      }
      throw replacementError;
    }
    await syncDirectory(parent);
    await removeClaimStaging(output, existing.staging, existing.claimId);
    await unlink(stale);
    await syncDirectory(parent);
    return claimArtifactPublication(output, attemptLedger, timeline);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function processIsActive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

async function readPublicationClaim(output, timeline) {
  const path = publicationClaimPath(output);
  const bytes = await readBoundedExactFile(
    path,
    16 * 1024,
    "pilot artifact publication claim",
    { root: dirname(output), scope: "the artifact parent" },
  );
  const text = decodeUtf8(bytes, "pilot artifact publication claim");
  const document = timeline.parseJson(text);
  if (text !== `${timeline.canonicalJson(document)}\n`) {
    throw new Error("pilot artifact publication claim is not canonical JSON");
  }
  return document;
}

async function releaseArtifactPublicationClaim(output) {
  await unlink(publicationClaimPath(output)).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await syncDirectory(dirname(output));
}

function publicationClaimPath(output) {
  return join(dirname(output), `.${basename(output)}.publication-claim.json`);
}

async function removeClaimStaging(output, name, claimId) {
  const parent = dirname(output);
  if (name !== `.${basename(output)}.staging-${claimId}`) {
    throw new Error("pilot artifact staging claim is invalid");
  }
  const path = join(parent, name);
  if (!(await pathExists(path))) return;
  const [stat, canonical] = await Promise.all([lstat(path), realpath(path)]);
  if (!stat.isDirectory() || canonical !== path) {
    throw new Error("pilot artifact staging directory is not real");
  }
  await rm(path, { recursive: true });
  await syncDirectory(parent);
}

async function syncTree(root) {
  const handle = await opendir(root);
  for await (const entry of handle) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await syncTree(path);
    else if (entry.isFile()) await syncFile(path);
    else throw new Error("artifact staging contains a non-file entry");
  }
  await syncDirectory(root);
}

async function syncFile(path) {
  const file = await open(path, process.platform === "win32" ? "r+" : "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function injectFailure(options, point) {
  if (options.allowDirty && process.env.TIMELINE_PILOT_TEST_FAILURE === point) {
    const error = new Error(`injected pilot failure: ${point}`);
    error.name = "TimelinePilotInjectedCrash";
    throw error;
  }
}

function isInjectedCrash(error) {
  return (
    error instanceof Error &&
    ["TimelinePilotInjectedCrash", "TimelinePilotDurabilityUncertain"].includes(
      error.name,
    )
  );
}

function recoverableDurabilityError(error) {
  const failure =
    error instanceof Error ? error : new Error("pilot durability sync failed");
  failure.name = "TimelinePilotDurabilityUncertain";
  return failure;
}

async function connectServer(dataDirectory, phase, runtime) {
  const { Client, StdioClientTransport } = await loadMcpClient();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(repositoryRoot, "packages/mcp-server/dist/cli.js"),
      "--data-dir",
      dataDirectory,
      "--role",
      "operator",
    ],
    env: credentialFreeEnvironment(),
    stderr: "pipe",
  });
  let diagnostics = "";
  transport.stderr?.on("data", (chunk) => {
    diagnostics += chunk.toString("utf8");
  });
  const client = new Client({
    name: "timeline-real-model-pilot",
    version: "1.0.0",
  });
  await connectMcpClient(client, transport);
  const processId = transport.pid;
  const serverScript = runtime.identity.files.find(
    ({ path }) => path === "packages/mcp-server/dist/cli.js",
  );
  if (!Number.isSafeInteger(processId) || processId < 1 || !serverScript) {
    await client.close();
    throw new Error("MCP child process identity is unavailable");
  }
  return {
    client,
    invocation: {
      phase,
      invocationId: randomUUID(),
      processId,
      provenance: "driver-observed-maintainer-attested",
      executableDigest: runtime.identity.node.executableDigest,
      script: serverScript.path,
      scriptDigest: serverScript.digest,
    },
    async call(name, args) {
      const response = await client.callTool({ name, arguments: args });
      if (
        response.isError ||
        response.structuredContent === undefined ||
        diagnostics !== ""
      ) {
        throw new Error(`MCP ${name} failed`);
      }
      return response.structuredContent;
    },
  };
}

async function readRun(client, runId, timeline) {
  const resource = await client.readResource({
    uri: `timeline://run/${encodeURIComponent(runId)}`,
  });
  const content = resource.contents[0];
  if (!content || !("text" in content)) {
    throw new Error("MCP run resource is missing");
  }
  return timeline.parseRunDocumentV0Alpha3(timeline.parseJson(content.text));
}

async function readAudit(client, runId, timeline) {
  const resource = await client.readResource({
    uri: `timeline://audit/${encodeURIComponent(runId)}`,
  });
  const content = resource.contents[0];
  if (!content || !("text" in content)) {
    throw new Error("MCP audit resource is missing");
  }
  return timeline.parseJson(content.text);
}

async function previewAndAdmitProposal({
  session,
  phase,
  input,
  scope,
  run,
  runDigest,
  proposal,
  policy,
}) {
  const proposalInput = {
    runId: input.contract.id,
    expectedRevision: run.events.length,
    expectedRunDigest: runDigest,
    expectedRequestId: scope.host.expectedRequestId,
    proposal,
    evidenceCatalog: scope.host.evidenceCatalog,
    referenceCatalog: scope.host.referenceCatalog,
    assertionCatalog: scope.host.assertionCatalog,
    knowledgeCutCatalog: scope.host.knowledgeCutCatalog,
  };
  const preview = await session.call(
    "timeline_preview_model_proposal",
    proposalInput,
  );
  verifyProposalPreview({ preview, proposal, scope, run, input, runDigest });
  const afterPreview = await readRun(
    session.client,
    input.contract.id,
    input.timeline,
  );
  if (
    input.timeline.contentDigest(afterPreview) !== runDigest ||
    input.timeline.canonicalJson(afterPreview) !==
      input.timeline.canonicalJson(run)
  ) {
    throw new Error("model proposal preview mutated the run");
  }

  validateProposalSemantics(phase, proposal, input.pilot.expected);
  const admit = await session.call("timeline_admit_model_proposal", {
    ...proposalInput,
    candidateDigest: preview.candidateDigest,
    admission: policy.decision,
  });
  verifyProposalAdmission({ preview, admit, policy, input });
  return { preview, admit };
}

function verifyProposalPreview({
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
    { maxChanges: 4, maxSupportsPerChange: 2 },
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

function verifyProposalAdmission({ preview, admit, policy, input }) {
  const timeline = input.timeline;
  const previewCandidate = proposalResultCandidate(preview);
  const admittedCandidate = proposalResultCandidate(admit);
  if (
    admit.admissionStatus !== "admitted" ||
    timeline.canonicalJson(previewCandidate) !==
      timeline.canonicalJson(admittedCandidate) ||
    admit.admissionRecord?.authorityId !== policy.decision.authorityId ||
    admit.admissionRecord?.policyRef !== policy.decision.policyRef ||
    admit.admissionRecord?.policyDigest !== policy.decision.policyDigest ||
    admit.admissionRecord?.candidateDigest !== preview.candidateDigest ||
    admit.admissionRecord?.proposalDigest !== preview.proposalDigest
  ) {
    throw new Error(
      "model proposal admission differs from its verified preview",
    );
  }
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

function assertDifference(conclusion, value, label) {
  const result = conclusion?.result;
  if (
    result?.type !== "difference.bounds" ||
    result.status !== "bounded" ||
    result.minimum !== value ||
    result.maximum !== value
  ) {
    throw new Error(
      `${label} conclusion does not match the expected difference`,
    );
  }
}

function omitSchema({ schema: _schema, ...value }) {
  return value;
}

async function assertOutsideCheckout(path) {
  const checkout = await realpath(repositoryRoot);
  const parent = await realpath(dirname(path));
  const fromCheckout = relative(checkout, join(parent, basename(path)));
  if (
    fromCheckout === "" ||
    (!fromCheckout.startsWith(`..${sep}`) && !isAbsolute(fromCheckout))
  ) {
    throw new Error(
      "pilot state and output must be outside the source checkout",
    );
  }
}

async function assertStateLayout(path) {
  const state = await realpath(resolve(path));
  const stateStat = await lstat(state);
  if (!stateStat.isDirectory()) {
    throw new Error("pilot state must be a real directory");
  }
  for (const name of [
    "mcp",
    "attempt-ledger",
    ".attempt-ledger-staging",
    PHASE_RESULT_STAGING,
  ]) {
    const directory = join(state, name);
    const [stat, canonical] = await Promise.all([
      lstat(directory),
      realpath(directory),
    ]);
    if (!stat.isDirectory() || canonical !== directory) {
      throw new Error(`pilot state ${name} must be a real directory`);
    }
  }
  await validatePhaseResultStaging(state);
  return state;
}

async function validatePhaseResultStaging(state) {
  const directory = join(state, PHASE_RESULT_STAGING);
  let count = 0;
  const handle = await opendir(directory);
  for await (const entry of handle) {
    if (
      !entry.isFile() ||
      !/^(?:initial|correction)-[0-9a-f-]{36}\.json$/u.test(entry.name) ||
      count >= 4
    ) {
      throw new Error("phase result staging directory is invalid");
    }
    count += 1;
  }
}

function verifyInSeparateProcess(output, { allowDirty }) {
  const result = spawnSync(
    process.execPath,
    [
      join(repositoryRoot, "scripts/mcp-real-model-pilot-verify-bootstrap.mjs"),
      output,
      ...(allowDirty ? ["--allow-dirty"] : []),
      "--require-runtime-match",
    ],
    {
      cwd: output,
      encoding: "utf8",
      env: credentialFreeEnvironment(),
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `credential-free pilot verification failed: ${result.stderr.trim()}`,
    );
  }
  return JSON.parse(result.stdout);
}

function artifactReadme(title) {
  return `# ${title}

This is a maintainer-operated historical staged evidence-disclosure replay. It is not independent adoption or a live delayed-evidence observation.

The artifact retains allowlisted public evidence, redacted model requests, exact model configuration, untrusted model proposals, their verified non-mutating previews, the host's explicit admission records, a portable run, and verified conclusions before and after a process restart and publication-time correction. The host admitted each proposal only after the scenario-specific semantic validator accepted its normalized coordinates and source support. MCP state contains evidence digests, not source text. Model execution, external evidence authenticity, and process restart provenance are maintainer-attested, not cryptographically proven by the artifact.

The admission policy file contains the exact canonical policy bytes whose digest is recorded on every declaration and proposal admission. The audit envelope binds those admission records to the complete event order, proposal and candidate digests, authority, policy, and run prefixes.

The attempt ledger reserves each provider invocation durably before it can begin. It binds the source, model configuration, runtime, host invocation, driver-observed MCP child identity, requests, responses, admitted candidates, synchronized phase-result bundles, and resulting run prefixes. Each sequence has one exclusive filesystem slot, so recovery and the original process cannot record contradictory outcomes. A validated bundle can complete after a crash without another provider call. An incomplete phase without that bundle, or a failed phase, cannot invoke the provider again from the same state directory. MCP child PIDs and launch identities are driver-observed and maintainer-attested, not cryptographic process attestation.

Artifact publication uses an exclusive attempt-bound claim and an atomically installed staging tree. Recovery accepts an already installed output only when the credential-free verifier proves that it belongs to this completed attempt.

The recorded runtime identity binds the Node executable, compiled core and MCP server, pilot and adapter scripts, resolved workspace targets, and transitive runtime package bytes used by the formal path. Stable logical package IDs keep local checkout and package-store paths out of the artifact. The content manifest covers every primary artifact file. It excludes itself and the derived verification report to avoid a checksum cycle; the verifier rejects every other unlisted file.

Verify from a clean checkout at the recorded source revision. The credential-free verifier performs no network requests and reports whether the local runtime matches the recorded operator runtime:

\`\`\`sh
node scripts/mcp-real-model-pilot-verify-bootstrap.mjs /path/to/artifact
\`\`\`

Require bit-for-bit runtime reproduction when the recorded runtime bytes are available:

\`\`\`sh
node scripts/mcp-real-model-pilot-verify-bootstrap.mjs /path/to/artifact --require-runtime-match
\`\`\`
`;
}

export function validateAdapterSelection(adapter, allowDirty) {
  if (allowDirty) return;
  const expectedAdapter = join(
    repositoryRoot,
    "scripts/openai-responses-model-eval-adapter.mjs",
  );
  if (
    !isAbsolute(adapter.command) ||
    resolve(adapter.command) !== resolve(process.execPath) ||
    adapter.args.length !== 1 ||
    !isAbsolute(adapter.args[0]) ||
    resolve(adapter.args[0]) !== resolve(expectedAdapter)
  ) {
    throw new Error(
      "formal model pilot requires the source-bound OpenAI Responses adapter",
    );
  }
}

function runtimeProfile(allowDirty) {
  return allowDirty ? "development-unbound-adapter" : "formal-openai";
}

function attemptBinding({ input, modelConfig, policy, runtime }) {
  return {
    inputDigest: input.inputDigest,
    modelConfigDigest: modelConfig.digest,
    admissionPolicyDigest: policy.digest,
    source: modelConfig.source,
    runtimeDigest: runtime.digest,
  };
}

async function phaseRuntime(options, timeline) {
  if (options.runtimeBinding) {
    await assertBootstrapRuntime(options, options.runtimeBinding, timeline);
    return options.runtimeBinding;
  }
  if (!options.allowDirty) {
    throw new Error(
      "formal model pilot must run through the runtime bootstrap",
    );
  }
  return captureRealModelPilotRuntime(timeline, {
    profile: runtimeProfile(options.allowDirty),
  });
}

async function assertBootstrapRuntime(options, expected, timeline) {
  if (!options.runtimeBinding) {
    if (options.allowDirty) return;
    throw new Error(
      "formal model pilot must run through the runtime bootstrap",
    );
  }
  if (
    options.runtimeBinding.digest !== expected.digest ||
    timeline.canonicalJson(options.runtimeBinding.identity) !==
      timeline.canonicalJson(expected.identity)
  ) {
    throw new Error("bootstrap runtime does not match the retained phase");
  }
  await assertRealModelPilotRuntime(options.runtimeBinding, timeline);
}

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("pilot requires an adapter command after --");
  }
  const [mode, ...raw] = argv.slice(0, separator);
  const adapter = argv.slice(separator + 1);
  const options = {
    mode,
    adapter: { command: adapter[0], args: adapter.slice(1) },
    allowDirty: false,
  };
  for (let index = 0; index < raw.length; ) {
    const option = raw[index];
    if (option === "--allow-dirty") {
      options.allowDirty = true;
      index += 1;
      continue;
    }
    const value = raw[index + 1];
    if (!value) throw new Error(`missing value for ${option}`);
    if (option === "--input") options.input = value;
    else if (option === "--state") options.state = value;
    else if (option === "--config") options.config = value;
    else if (option === "--out") options.out = value;
    else throw new Error(`unknown option ${option}`);
    index += 2;
  }
  if (
    !["start", "resume"].includes(mode) ||
    !options.input ||
    !options.state ||
    !options.config ||
    (mode === "resume" && !options.out)
  ) {
    throw new Error(
      "usage: mcp-real-model-pilot <start|resume> --input <dir> --state <dir> --config <file> [--out <dir>] [--allow-dirty] -- <adapter> [args...]",
    );
  }
  return options;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report =
      options.mode === "start"
        ? await runStart(options)
        : await runResume(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(
      `mcp-real-model-pilot: ${error instanceof Error ? error.message : "failed"}\n`,
    );
    process.exitCode = 1;
  }
}

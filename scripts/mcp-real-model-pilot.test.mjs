import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  cp,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  REAL_MODEL_PILOT_LIMITS,
  REAL_MODEL_PILOT_PROPOSAL_LIMITS,
  assertRealModelPilotRuntime,
  captureRealModelPilotRuntime,
  validateMcpWriterTrajectory,
  validateProposalSemantics,
} from "./mcp-real-model-pilot-lib.mjs";
import { loadBoundPilot } from "./mcp-real-model-pilot-bootstrap.mjs";
import {
  assertPilotRuntime,
  capturePilotRuntime,
} from "./mcp-real-model-pilot-runtime.mjs";
import { validateAdapterSelection } from "./mcp-real-model-pilot.mjs";
import {
  credentialFreeEnvironment as productionCredentialFreeEnvironment,
  loadTimeline,
  readBoundedExactFile,
  sha256,
} from "./mcp-agent-pilot-lib.mjs";
import {
  claimProviderInvocation,
  completeAttemptPhase,
  createAttemptLedger,
  failAttemptPhase,
  loadAttemptLedger,
} from "./formal-attempt-ledger.mjs";
import {
  validatePhaseFailureDocumentV2,
  validateRecoveryObservationDocumentV2,
} from "./mcp-real-model-pilot-failure.mjs";
import { exportFailedAttempt } from "./mcp-real-model-pilot-failure-artifact.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const driver = join(root, "scripts/mcp-real-model-pilot-bootstrap.mjs");
const verifier = join(
  root,
  "scripts/mcp-real-model-pilot-verify-bootstrap.mjs",
);
const failureExporter = join(
  root,
  "scripts/mcp-real-model-pilot-failure-export.mjs",
);
const failureVerifier = join(
  root,
  "scripts/mcp-real-model-pilot-failure-verify.mjs",
);
const fixture = join(root, "examples/mcp-real-model-pilot");
const sourceRevision = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).stdout.trim();

test("bounded exact reads reject hostile and replaced inputs", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-exact-read-"));
  try {
    const oversized = join(temporary, "oversized.json");
    await writeFile(oversized, Buffer.alloc(17));
    await assert.rejects(
      readBoundedExactFile(oversized, 16, "oversized input"),
      /byte limit/u,
    );

    const original = join(temporary, "replaced.json");
    const replacement = join(temporary, "replacement.json");
    await writeFile(original, "first\n");
    await writeFile(replacement, "other\n");
    await assert.rejects(
      readBoundedExactFile(original, 64, "replaced input", {
        async validate() {
          await rename(replacement, original);
        },
      }),
      (error) =>
        /changed while being validated/u.test(String(error?.message)) ||
        (process.platform === "win32" && error?.code === "EPERM"),
    );

    const mutated = join(temporary, "mutated.json");
    await writeFile(mutated, "first\n");
    await assert.rejects(
      readBoundedExactFile(mutated, 64, "mutated input", {
        async validate() {
          await writeFile(mutated, "other\n");
        },
      }),
      /changed while being validated/u,
    );

    if (process.platform === "win32") {
      t.diagnostic("symlink and FIFO checks are POSIX-only");
      return;
    }
    const target = join(temporary, "target.json");
    const linked = join(temporary, "linked.json");
    await writeFile(target, "{}\n");
    await symlink(target, linked);
    await assert.rejects(
      readBoundedExactFile(linked, 64, "linked input"),
      /real file/u,
    );

    const fifo = join(temporary, "input.fifo");
    const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    await assert.rejects(
      readBoundedExactFile(fifo, 64, "FIFO input"),
      /real file/u,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("credential-free child environment strips ambient secrets", () => {
  const environment = productionCredentialFreeEnvironment({
    PATH: process.env.PATH,
    LANG: "C",
    OPENAI_API_KEY: "sentinel-openai-key",
    TIMELINE_PILOT_SENTINEL_SECRET: "sentinel",
    NODE_OPTIONS: "--inspect",
  });
  assert.equal(environment.PATH, process.env.PATH);
  assert.equal(environment.LANG, "C");
  assert.equal(Object.hasOwn(environment, "OPENAI_API_KEY"), false);
  assert.equal(
    Object.hasOwn(environment, "TIMELINE_PILOT_SENTINEL_SECRET"),
    false,
  );
  assert.equal(Object.hasOwn(environment, "NODE_OPTIONS"), false);
});

test("pilot support validation matches its request-bound limit", async () => {
  const expected = {
    tagCommit: "94e7af53c2224aa40762c2061ac96cab34950b71",
    provisionalPublication: 1779957192000,
    authoritativePublication: 1779957345000,
    readinessRecorded: 1779957705698,
    initialDifference: 513698,
    correctedDifference: 360698,
  };
  const timestampOnly = "1779957345000 Unix milliseconds";
  const evidence = await readFile(
    join(fixture, "evidence/release-published.txt"),
    "utf8",
  );
  assert.notEqual(evidence.indexOf(timestampOnly), -1);
  assert.equal(
    evidence.indexOf(timestampOnly),
    evidence.lastIndexOf(timestampOnly),
  );
  assert.deepEqual(REAL_MODEL_PILOT_PROPOSAL_LIMITS, {
    maxChanges: 4,
    maxSupportsPerChange: 1,
  });

  const proposal = {
    schema: "covenant.timeline.model-proposal.v1",
    requestId: "covenant-release-correction-v1",
    changes: [
      {
        type: "coordinate",
        pointHandle: "point-publication",
        bounds: { type: "exact", value: expected.authoritativePublication },
        supports: [{ evidenceId: "release-published", quote: timestampOnly }],
        revision: {
          type: "supersede",
          assertionHandle: "assertion-provisional-publication",
        },
      },
    ],
    query: {
      type: "difference",
      targetHandle: "difference-readiness-minus-publication",
      knowledgeCut: { type: "current" },
    },
  };

  assert.doesNotThrow(() =>
    validateProposalSemantics("correction", proposal, expected),
  );

  const wrongEvidence = structuredClone(proposal);
  wrongEvidence.changes[0].supports[0].evidenceId = "readiness-recorded";
  assert.throws(
    () => validateProposalSemantics("correction", wrongEvidence, expected),
    /model proposal support uses unexpected evidence/u,
  );

  const missingCoordinate = structuredClone(proposal);
  missingCoordinate.changes[0].supports[0].quote =
    "GitHub authoritatively reports";
  assert.throws(
    () => validateProposalSemantics("correction", missingCoordinate, expected),
    /model proposal support quote does not contain the expected coordinate/u,
  );

  const multipleSupports = structuredClone(proposal);
  multipleSupports.changes[0].supports.push({
    evidenceId: "release-published",
    quote: "This replaces the provisional creation-time proxy.",
  });
  assert.throws(
    () => validateProposalSemantics("correction", multipleSupports, expected),
    /model proposal change must contain exactly one support/u,
  );
});

test("MCP child does not inherit ambient Node preload hooks", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-mcp-env-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const preload = join(temporary, "sentinel.cjs");
  const marker = join(temporary, "mcp-inherited-node-options.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter());
    await writeFile(
      preload,
      `if (process.argv.some((value) => value.includes("packages/mcp-server/dist/cli.js"))) require("node:fs").writeFileSync(${JSON.stringify(marker)}, "inherited\\n");\n`,
    );
    const result = run(
      [
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ],
      { environment: { NODE_OPTIONS: `--require=${preload}` } },
    );
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(lstat(marker), /ENOENT/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Git source identity does not inherit ambient secrets", async (t) => {
  if (process.platform === "win32") {
    t.skip("executable wrapper check is POSIX-only");
    return;
  }
  const temporary = await mkdtemp(join(tmpdir(), "timeline-git-env-"));
  try {
    const resolvedGit = spawnSync("sh", ["-c", "command -v git"], {
      encoding: "utf8",
      env: credentialFreeEnvironment(),
    }).stdout.trim();
    assert.ok(resolvedGit.startsWith("/"));
    const wrapper = join(temporary, "git");
    await writeFile(
      wrapper,
      `#!/bin/sh\nif [ -n "$TIMELINE_PILOT_SENTINEL_SECRET" ]; then exit 77; fi\nexec ${JSON.stringify(resolvedGit)} "$@"\n`,
    );
    await chmod(wrapper, 0o700);
    const module = pathToFileURL(
      join(root, "scripts/mcp-agent-pilot-lib.mjs"),
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const { sourceIdentity } = await import(${JSON.stringify(module)}); process.stdout.write(sourceIdentity().revision);`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${temporary}:${process.env.PATH}`,
          TIMELINE_PILOT_SENTINEL_SECRET: "must-not-reach-git",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, sourceRevision);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("concurrent provider reservations produce one durable winner", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-ledger-claim-"));
  try {
    const timeline = await loadTimeline();
    const digest = sha256(Buffer.from("formal attempt binding"));
    const binding = {
      source: { revision: sourceRevision, dirty: true },
      inputDigest: digest,
      modelConfigDigest: digest,
      admissionPolicyDigest: digest,
      runtimeDigest: digest,
    };
    await createAttemptLedger(temporary, binding, timeline);
    await writeFile(
      join(temporary, ".attempt-ledger-staging", `${randomUUID()}.json`),
      '{"partial":',
    );
    const [first, second] = await Promise.all([
      loadAttemptLedger(temporary, timeline),
      loadAttemptLedger(temporary, timeline),
    ]);
    const reservation = (ledger) =>
      claimProviderInvocation(ledger, {
        phase: "initial",
        invocation: {
          phase: "initial",
          invocationId: randomUUID(),
          processId: process.pid,
        },
        mcpInvocation: {
          phase: "initial",
          invocationId: randomUUID(),
          processId: process.pid,
          provenance: "driver-observed-maintainer-attested",
          executableDigest: digest,
          script: "packages/mcp-server/dist/cli.js",
          scriptDigest: digest,
        },
        requestDigest: digest,
        baseRevision: 0,
        baseRunDigest: digest,
      });
    const results = await Promise.allSettled([
      reservation(first),
      reservation(second),
    ]);
    assert.equal(
      results.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter(({ status }) => status === "rejected").length,
      1,
    );
    const recovered = await loadAttemptLedger(temporary, timeline);
    assert.deepEqual(
      recovered.document.entries.map(({ kind }) => kind),
      ["attempt-opened", "provider-invocation-reserved"],
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a completed phase cannot be overwritten by a losing failure path", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-ledger-outcome-"));
  try {
    const timeline = await loadTimeline();
    const digest = sha256(Buffer.from("formal attempt outcome"));
    const binding = {
      source: { revision: sourceRevision, dirty: true },
      inputDigest: digest,
      modelConfigDigest: digest,
      admissionPolicyDigest: digest,
      runtimeDigest: digest,
    };
    const original = await createAttemptLedger(temporary, binding, timeline);
    const invocation = {
      phase: "initial",
      invocationId: randomUUID(),
      processId: process.pid,
    };
    const mcpInvocation = {
      phase: "initial",
      invocationId: randomUUID(),
      processId: process.pid,
      provenance: "driver-observed-maintainer-attested",
      executableDigest: digest,
      script: "packages/mcp-server/dist/cli.js",
      scriptDigest: digest,
    };
    await claimProviderInvocation(original, {
      phase: "initial",
      invocation,
      mcpInvocation,
      requestDigest: digest,
      baseRevision: 0,
      baseRunDigest: digest,
    });
    const [resumed, losingFailure] = await Promise.all([
      loadAttemptLedger(temporary, timeline),
      loadAttemptLedger(temporary, timeline),
    ]);
    const completion = {
      phase: "initial",
      invocation,
      requestDigest: digest,
      responseDigest: digest,
      proposalDigest: digest,
      candidateDigest: digest,
      resultBundleDigest: digest,
      resultRevision: 0,
      resultRunDigest: digest,
    };

    const completed = await completeAttemptPhase(resumed, completion);
    const converged = await completeAttemptPhase(original, completion);
    assert.equal(converged.recordDigest, completed.recordDigest);
    await assert.rejects(
      failAttemptPhase(losingFailure, {
        phase: "initial",
        invocation,
        requestDigest: digest,
        adapterExecutionDigest: digest,
        failureBundleDigest: digest,
        failureStage: "proposal-semantics",
        failureCode: "proposal.semantics",
      }),
      /attempt ledger entry changed under concurrency/u,
    );

    assert.deepEqual(
      (await readdir(join(temporary, "attempt-ledger"))).sort(),
      ["000.json", "001.json", "002.json"],
    );
    const recovered = await loadAttemptLedger(temporary, timeline);
    assert.deepEqual(
      recovered.document.entries.map(({ kind }) => kind),
      ["attempt-opened", "provider-invocation-reserved", "phase-completed"],
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("accepts compatible historical MCP writers", () => {
  const previousWriter = {
    timelinePackage: "@covenant-org/timeline",
    timelineVersion: "0.0.0-alpha.3",
    reasoner: "covenant.timeline.stn.v0alpha1",
    serverPackage: "@covenant-org/timeline-mcp",
    serverVersion: "0.0.0-alpha.0",
  };
  const currentWriter = {
    ...previousWriter,
    serverVersion: "0.0.0-alpha.1",
  };

  assert.doesNotThrow(() =>
    validateMcpWriterTrajectory({
      lastWriter: currentWriter,
      admissions: [{ writer: previousWriter }, { writer: currentWriter }],
    }),
  );
  assert.throws(
    () =>
      validateMcpWriterTrajectory({
        lastWriter: previousWriter,
        admissions: [{ writer: previousWriter }, { writer: currentWriter }],
      }),
    /last writer does not match the final admission/u,
  );
  assert.throws(
    () =>
      validateMcpWriterTrajectory({
        lastWriter: currentWriter,
        admissions: [
          {
            writer: {
              ...previousWriter,
              timelineVersion: "0.0.0-alpha.2",
            },
          },
          { writer: currentWriter },
        ],
      }),
    /writer identity is unsupported/u,
  );
});

test("runs model proposals across separate host and MCP processes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-real-model-pilot-"));
  const input = join(temporary, "input");
  const state = join(temporary, "state");
  const output = join(temporary, "artifact");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  try {
    await cp(fixture, input, { recursive: true });
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter());
    const started = run([
      "start",
      "--input",
      input,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.equal(started.status, 0, started.stderr);
    const resumed = run([
      "resume",
      "--input",
      input,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.equal(resumed.status, 0, resumed.stderr);
    const report = JSON.parse(resumed.stdout);
    assert.equal(report.verified, true);
    assert.equal(report.crossedHostProcessRestart, true);
    assert.equal(report.crossedMcpProcessRestart, true);
    assert.equal(report.modelExecutionProvenance, "maintainer-attested");
    assert.equal(report.processRestartProvenance, "maintainer-attested");
    assert.equal(
      report.mcpProcessIdentityProvenance,
      "driver-observed-maintainer-attested",
    );
    assert.match(report.contentManifestDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(report.runtimeDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(report.runtimeMatched, true);
    assert.equal(report.historicalCutPreserved, true);
    assert.equal(report.sourceTextAbsentFromMcpState, true);
    assert.equal(report.receiptCount, 3);
    assert.equal(report.admissionRecordCount, 4);
    assert.equal(report.untrustedProposalsHostAdmitted, true);
    assert.equal(report.formalAttemptLedgerVerified, true);
    assert.equal(report.providerInvocationReservationCount, 2);
    assert.equal(report.phaseResultBundleCount, 2);
    assert.match(report.attemptLedgerDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(
      report.externalEvidenceAuthenticityProvenance,
      "maintainer-attested",
    );
    assert.match(report.auditDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(report.admissionPolicyDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(report.initialDifference, 513698);
    assert.equal(report.correctedDifference, 360698);

    const artifact = JSON.parse(
      await readFile(join(output, "artifact.json"), "utf8"),
    );
    assert.equal(artifact.operation, "maintainer-operated");
    assert.equal(
      artifact.provenance.externalEvidenceAuthenticity,
      "maintainer-attested",
    );
    assert.ok(artifact.limitations.includes("not-independent-adoption"));
    assert.ok(
      artifact.limitations.includes(
        "model-proposals-untrusted-and-host-admitted-after-semantic-validation",
      ),
    );
    assert.ok(
      artifact.limitations.includes(
        "external-evidence-authenticity-not-cryptographically-proven",
      ),
    );
    const attemptLedger = JSON.parse(
      await readFile(join(output, "attempt-ledger.json"), "utf8"),
    );
    assert.equal(attemptLedger.entries.length, 5);
    assert.deepEqual(
      attemptLedger.entries.map(({ kind, phase }) => [kind, phase]),
      [
        ["attempt-opened", undefined],
        ["provider-invocation-reserved", "initial"],
        ["phase-completed", "initial"],
        ["provider-invocation-reserved", "correction"],
        ["phase-completed", "correction"],
      ],
    );
    assert.deepEqual(
      artifact.phaseResults.map(({ phase, digest }) => [phase, digest]),
      [
        ["initial", attemptLedger.entries[2].resultBundleDigest],
        ["correction", attemptLedger.entries[4].resultBundleDigest],
      ],
    );
    assert.notEqual(
      artifact.invocations[0].processId,
      artifact.invocations[1].processId,
    );
    assert.notEqual(
      artifact.mcpInvocations[0].processId,
      artifact.mcpInvocations[1].processId,
    );
    assert.notEqual(
      artifact.mcpInvocations[0].invocationId,
      artifact.mcpInvocations[1].invocationId,
    );
    for (const invocation of artifact.mcpInvocations) {
      assert.equal(
        invocation.provenance,
        "driver-observed-maintainer-attested",
      );
      assert.equal(
        invocation.executableDigest,
        artifact.runtime.node.executableDigest,
      );
      const script = artifact.runtime.files.find(
        ({ path }) => path === invocation.script,
      );
      assert.equal(invocation.scriptDigest, script?.digest);
    }
    const runText = await readFile(join(output, "run.json"), "utf8");
    const finalRun = JSON.parse(runText);
    const audit = JSON.parse(
      await readFile(join(output, "audit.json"), "utf8"),
    );
    const policyBytes = await readFile(join(output, "admission-policy.json"));
    assert.equal(
      artifact.auditDigest,
      (await loadTimeline()).contentDigest(audit),
    );
    assert.equal(artifact.admissionPolicyDigest, sha256(policyBytes));
    assert.deepEqual(audit.run, finalRun);
    assert.deepEqual(audit.lastWriter, {
      timelinePackage: "@covenant-org/timeline",
      timelineVersion: "0.0.0-alpha.3",
      reasoner: "covenant.timeline.stn.v0alpha1",
      serverPackage: "@covenant-org/timeline-mcp",
      serverVersion: "0.0.0-alpha.1",
    });
    assert.deepEqual(
      audit.admissions.map(({ kind, eventIds }) => [kind, eventIds.length]),
      [
        ["direct-event", 1],
        ["direct-event", 1],
        ["model-proposal", 2],
        ["model-proposal", 1],
      ],
    );
    assert.deepEqual(
      audit.admissions.flatMap(({ eventIds }) => eventIds),
      finalRun.events.map(({ id }) => id),
    );
    assert.equal(
      new Set(audit.admissions.map(({ authorityId }) => authorityId)).size,
      1,
    );
    assert.equal(
      new Set(audit.admissions.map(({ policyDigest }) => policyDigest)).size,
      1,
    );
    for (const admission of audit.admissions) {
      assert.deepEqual(admission.writer, audit.lastWriter);
    }
    for (const name of [
      "release-created.txt",
      "readiness-recorded.txt",
      "release-published.txt",
    ]) {
      const source = await readFile(join(output, "evidence", name), "utf8");
      assert.equal(runText.includes(source), false);
    }
    const initialCall = JSON.parse(
      await readFile(join(output, "model-calls/initial.json"), "utf8"),
    );
    assert.equal(
      Object.hasOwn(initialCall.redactedRequest.input.evidence[0], "text"),
      false,
    );
    assert.equal(Object.hasOwn(initialCall, "apply"), false);
    assert.equal(initialCall.preview.verified, true);
    assert.equal(initialCall.preview.persistence, "not-admitted");
    assert.equal(initialCall.admit.admissionStatus, "admitted");
    assert.equal(
      initialCall.preview.candidateDigest,
      initialCall.admit.candidateDigest,
    );
    assert.equal(
      initialCall.preview.proposalDigest,
      initialCall.admit.proposalDigest,
    );

    await rm(state, { recursive: true, force: true });
    await rm(input, { recursive: true, force: true });
    const credentialFree = spawnSync(
      process.execPath,
      [verifier, output, "--allow-dirty"],
      {
        cwd: temporary,
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.equal(credentialFree.status, 0, credentialFree.stderr);
    assert.deepEqual(JSON.parse(credentialFree.stdout), report);

    const timeline = await loadTimeline();

    const substitutedRun = join(temporary, "substituted-run-artifact");
    await cp(output, substitutedRun, { recursive: true });
    const substitutedRunPath = join(substitutedRun, "run.json");
    const substitutedRunValue = JSON.parse(
      await readFile(substitutedRunPath, "utf8"),
    );
    substitutedRunValue.events[2].assertion.evidenceRefs[0] = sha256(
      Buffer.from("substituted evidence reference"),
    );
    const substitutedRunBytes = Buffer.from(
      `${JSON.stringify(substitutedRunValue)}\n`,
    );
    await writeFile(substitutedRunPath, substitutedRunBytes);
    await rewriteManifestEntry(substitutedRun, "run.json", substitutedRunBytes);
    const substitutedArtifactPath = join(substitutedRun, "artifact.json");
    const substitutedArtifact = JSON.parse(
      await readFile(substitutedArtifactPath, "utf8"),
    );
    substitutedArtifact.runDigest = timeline.contentDigest(substitutedRunValue);
    const substitutedArtifactBytes = Buffer.from(
      `${JSON.stringify(substitutedArtifact)}\n`,
    );
    await writeFile(substitutedArtifactPath, substitutedArtifactBytes);
    await rewriteManifestEntry(
      substitutedRun,
      "artifact.json",
      substitutedArtifactBytes,
    );
    const substitutedRunCheck = verify(substitutedRun, temporary);
    assert.notEqual(substitutedRunCheck.status, 0);
    assert.match(
      substitutedRunCheck.stderr,
      /model-call timeline metadata did not reproduce/,
    );

    const alteredPolicy = join(temporary, "altered-policy-artifact");
    await cp(output, alteredPolicy, { recursive: true });
    const policyPath = join(alteredPolicy, "admission-policy.json");
    const policy = JSON.parse(await readFile(policyPath, "utf8"));
    policy.proposalRule = "admit-model-output-without-host-review";
    const alteredPolicyBytes = Buffer.from(`${JSON.stringify(policy)}\n`);
    await writeFile(policyPath, alteredPolicyBytes);
    await rewriteManifestEntry(
      alteredPolicy,
      "admission-policy.json",
      alteredPolicyBytes,
    );
    const alteredPolicyArtifactPath = join(alteredPolicy, "artifact.json");
    const alteredPolicyArtifact = JSON.parse(
      await readFile(alteredPolicyArtifactPath, "utf8"),
    );
    alteredPolicyArtifact.admissionPolicyDigest = sha256(alteredPolicyBytes);
    const alteredPolicyArtifactBytes = Buffer.from(
      `${JSON.stringify(alteredPolicyArtifact)}\n`,
    );
    await writeFile(alteredPolicyArtifactPath, alteredPolicyArtifactBytes);
    await rewriteManifestEntry(
      alteredPolicy,
      "artifact.json",
      alteredPolicyArtifactBytes,
    );
    const alteredPolicyCheck = verify(alteredPolicy, temporary);
    assert.notEqual(alteredPolicyCheck.status, 0);
    assert.match(
      alteredPolicyCheck.stderr,
      /admission policy did not reproduce/,
    );

    const reboundAttempt = join(temporary, "rebound-attempt-artifact");
    await cp(output, reboundAttempt, { recursive: true });
    const reboundArtifactPath = join(reboundAttempt, "artifact.json");
    const reboundArtifact = JSON.parse(
      await readFile(reboundArtifactPath, "utf8"),
    );
    reboundArtifact.attemptLedgerDigest = await rewriteAttemptLedgerBinding(
      reboundAttempt,
      timeline,
      (binding) => {
        binding.modelConfigDigest = `sha256:${"0".repeat(64)}`;
      },
    );
    const reboundArtifactBytes = Buffer.from(
      `${JSON.stringify(reboundArtifact)}\n`,
    );
    await writeFile(reboundArtifactPath, reboundArtifactBytes);
    await rewriteManifestEntry(
      reboundAttempt,
      "artifact.json",
      reboundArtifactBytes,
    );
    const reboundAttemptCheck = verify(reboundAttempt, temporary);
    assert.notEqual(reboundAttemptCheck.status, 0);
    assert.match(
      reboundAttemptCheck.stderr,
      /attempt ledger execution binding changed/,
    );

    const reusedMcpIdentity = join(temporary, "reused-mcp-identity-artifact");
    await cp(output, reusedMcpIdentity, { recursive: true });
    const reusedMcpArtifactPath = join(reusedMcpIdentity, "artifact.json");
    const reusedMcpArtifact = JSON.parse(
      await readFile(reusedMcpArtifactPath, "utf8"),
    );
    reusedMcpArtifact.mcpInvocations[1].processId =
      reusedMcpArtifact.mcpInvocations[0].processId;
    const reusedMcpArtifactBytes = Buffer.from(
      `${JSON.stringify(reusedMcpArtifact)}\n`,
    );
    await writeFile(reusedMcpArtifactPath, reusedMcpArtifactBytes);
    await rewriteManifestEntry(
      reusedMcpIdentity,
      "artifact.json",
      reusedMcpArtifactBytes,
    );
    const reusedMcpCheck = verify(reusedMcpIdentity, temporary);
    assert.notEqual(reusedMcpCheck.status, 0);
    assert.match(
      reusedMcpCheck.stderr,
      /did not cross two observed MCP child invocations/,
    );

    const alteredMcpDigest = join(temporary, "altered-mcp-digest-artifact");
    await cp(output, alteredMcpDigest, { recursive: true });
    const alteredMcpArtifactPath = join(alteredMcpDigest, "artifact.json");
    const alteredMcpArtifact = JSON.parse(
      await readFile(alteredMcpArtifactPath, "utf8"),
    );
    alteredMcpArtifact.mcpInvocations[0].scriptDigest = `sha256:${"0".repeat(64)}`;
    const alteredMcpArtifactBytes = Buffer.from(
      `${JSON.stringify(alteredMcpArtifact)}\n`,
    );
    await writeFile(alteredMcpArtifactPath, alteredMcpArtifactBytes);
    await rewriteManifestEntry(
      alteredMcpDigest,
      "artifact.json",
      alteredMcpArtifactBytes,
    );
    const alteredMcpDigestCheck = verify(alteredMcpDigest, temporary);
    assert.notEqual(alteredMcpDigestCheck.status, 0);
    assert.match(
      alteredMcpDigestCheck.stderr,
      /MCP child invocation runtime binding changed/,
    );

    const alteredAudit = join(temporary, "altered-audit-artifact");
    await cp(output, alteredAudit, { recursive: true });
    const alteredAuditPath = join(alteredAudit, "audit.json");
    const alteredAuditValue = JSON.parse(
      await readFile(alteredAuditPath, "utf8"),
    );
    alteredAuditValue.admissions[0].recordDigest = `sha256:${"0".repeat(64)}`;
    const alteredAuditBytes = Buffer.from(
      `${JSON.stringify(alteredAuditValue)}\n`,
    );
    await writeFile(alteredAuditPath, alteredAuditBytes);
    await rewriteManifestEntry(alteredAudit, "audit.json", alteredAuditBytes);
    const alteredAuditArtifactPath = join(alteredAudit, "artifact.json");
    const alteredAuditArtifact = JSON.parse(
      await readFile(alteredAuditArtifactPath, "utf8"),
    );
    alteredAuditArtifact.auditDigest =
      timeline.contentDigest(alteredAuditValue);
    const alteredAuditArtifactBytes = Buffer.from(
      `${JSON.stringify(alteredAuditArtifact)}\n`,
    );
    await writeFile(alteredAuditArtifactPath, alteredAuditArtifactBytes);
    await rewriteManifestEntry(
      alteredAudit,
      "artifact.json",
      alteredAuditArtifactBytes,
    );
    const alteredAuditCheck = verify(alteredAudit, temporary);
    assert.notEqual(alteredAuditCheck.status, 0);
    assert.match(
      alteredAuditCheck.stderr,
      /model-call timeline metadata did not reproduce/,
    );

    const alteredPreview = join(temporary, "altered-preview-artifact");
    await cp(output, alteredPreview, { recursive: true });
    const alteredPreviewPath = join(alteredPreview, "model-calls/initial.json");
    const alteredPreviewCall = JSON.parse(
      await readFile(alteredPreviewPath, "utf8"),
    );
    alteredPreviewCall.preview.candidateDigest = `sha256:${"0".repeat(64)}`;
    const alteredPreviewBytes = Buffer.from(
      `${JSON.stringify(alteredPreviewCall)}\n`,
    );
    await writeFile(alteredPreviewPath, alteredPreviewBytes);
    await rewriteManifestEntry(
      alteredPreview,
      "model-calls/initial.json",
      alteredPreviewBytes,
    );
    const alteredPreviewCheck = verify(alteredPreview, temporary);
    assert.notEqual(alteredPreviewCheck.status, 0);
    assert.match(
      alteredPreviewCheck.stderr,
      /candidate differs from the preview or admission result/,
    );

    for (const [name, mutate, message] of [
      [
        "preview-persistence",
        (call) => {
          call.preview.persistence = "admitted";
        },
        /candidate differs from the preview or admission result/,
      ],
      [
        "admission-status",
        (call) => {
          call.admit.admissionStatus = "already-admitted";
        },
        /events do not match the admitted run slice/,
      ],
      [
        "legacy-admitted-field",
        (call) => {
          call.admit.admitted = true;
        },
        /model call is not canonical JSON|model proposal admission output has unexpected fields/,
      ],
    ]) {
      const alteredStatus = join(temporary, `${name}-artifact`);
      await cp(output, alteredStatus, { recursive: true });
      const callPath = join(alteredStatus, "model-calls/initial.json");
      const call = JSON.parse(await readFile(callPath, "utf8"));
      mutate(call);
      const bytes = Buffer.from(`${timeline.canonicalJson(call)}\n`);
      await writeFile(callPath, bytes);
      await rewriteManifestEntry(
        alteredStatus,
        "model-calls/initial.json",
        bytes,
      );
      const check = verify(alteredStatus, temporary);
      assert.notEqual(check.status, 0);
      assert.match(check.stderr, message);
    }

    for (const [name, mutate] of [
      [
        "audit-digest",
        (call) => {
          call.preview.timeline.auditDigest = `sha256:${"0".repeat(64)}`;
        },
      ],
      [
        "admission-count",
        (call) => {
          call.admit.timeline.admissionCount += 1;
        },
      ],
    ]) {
      const alteredMetadata = join(
        temporary,
        `altered-${name}-metadata-artifact`,
      );
      await cp(output, alteredMetadata, { recursive: true });
      const callPath = join(alteredMetadata, "model-calls/initial.json");
      const call = JSON.parse(await readFile(callPath, "utf8"));
      mutate(call);
      const bytes = Buffer.from(`${JSON.stringify(call)}\n`);
      await writeFile(callPath, bytes);
      await rewriteManifestEntry(
        alteredMetadata,
        "model-calls/initial.json",
        bytes,
      );
      const check = verify(alteredMetadata, temporary);
      assert.notEqual(check.status, 0);
      assert.match(
        check.stderr,
        /model-call timeline metadata did not reproduce/,
      );
    }

    const widenedPhase = join(temporary, "widened-phase-artifact");
    await cp(output, widenedPhase, { recursive: true });
    const widenedInputPath = join(widenedPhase, "pilot-input.json");
    const widenedInput = JSON.parse(await readFile(widenedInputPath, "utf8"));
    widenedInput.initialEvidence.reverse();
    const widenedInputBytes = Buffer.from(`${JSON.stringify(widenedInput)}\n`);
    await writeFile(widenedInputPath, widenedInputBytes);
    await rewriteManifestEntry(
      widenedPhase,
      "pilot-input.json",
      widenedInputBytes,
    );
    const widenedArtifactPath = join(widenedPhase, "artifact.json");
    const widenedArtifact = JSON.parse(
      await readFile(widenedArtifactPath, "utf8"),
    );
    const widenedRun = JSON.parse(
      await readFile(join(widenedPhase, "run.json"), "utf8"),
    );
    const widenedPrompt = await readFile(join(widenedPhase, "prompt.md"));
    const widenedEvidenceManifest = JSON.parse(
      await readFile(join(widenedPhase, "evidence-manifest.json"), "utf8"),
    );
    const evidenceDigests = new Map(
      widenedEvidenceManifest.entries.map(({ path, digest }) => [
        path.replace(/^evidence\//u, ""),
        digest,
      ]),
    );
    widenedArtifact.inputDigest = timeline.contentDigest({
      pilot: widenedInput,
      contract: widenedRun.contract,
      promptDigest: sha256(widenedPrompt),
      evidence: [
        ...widenedInput.initialEvidence,
        ...widenedInput.correctionEvidence,
      ].map((name) => ({ name, digest: evidenceDigests.get(name) })),
    });
    const widenedArtifactBytes = Buffer.from(
      `${JSON.stringify(widenedArtifact)}\n`,
    );
    await writeFile(widenedArtifactPath, widenedArtifactBytes);
    await rewriteManifestEntry(
      widenedPhase,
      "artifact.json",
      widenedArtifactBytes,
    );
    const widenedPhaseCheck = verify(widenedPhase, temporary);
    assert.notEqual(widenedPhaseCheck.status, 0);
    assert.match(widenedPhaseCheck.stderr, /phase inputs did not reproduce/);

    const runtimeMismatch = join(temporary, "runtime-mismatch-artifact");
    await cp(output, runtimeMismatch, { recursive: true });
    const runtimeArtifactPath = join(runtimeMismatch, "artifact.json");
    const runtimeArtifact = JSON.parse(
      await readFile(runtimeArtifactPath, "utf8"),
    );
    runtimeArtifact.runtime.node.version = "v99.0.0";
    runtimeArtifact.runtimeDigest = timeline.contentDigest(
      runtimeArtifact.runtime,
    );
    const phaseResultDigests = await rewritePhaseResultRuntime(
      runtimeMismatch,
      timeline,
      runtimeArtifact.runtime,
      runtimeArtifact.runtimeDigest,
    );
    for (const descriptor of runtimeArtifact.phaseResults) {
      descriptor.digest = phaseResultDigests[descriptor.phase];
    }
    runtimeArtifact.attemptLedgerDigest = await rewriteAttemptLedgerBinding(
      runtimeMismatch,
      timeline,
      (binding) => {
        binding.runtimeDigest = runtimeArtifact.runtimeDigest;
      },
      phaseResultDigests,
    );
    const runtimeArtifactBytes = Buffer.from(
      `${JSON.stringify(runtimeArtifact)}\n`,
    );
    await writeFile(runtimeArtifactPath, runtimeArtifactBytes);
    await rewriteManifestEntry(
      runtimeMismatch,
      "artifact.json",
      runtimeArtifactBytes,
    );
    const retainedRuntimePath = join(runtimeMismatch, "verification.json");
    const retainedRuntime = JSON.parse(
      await readFile(retainedRuntimePath, "utf8"),
    );
    retainedRuntime.runtimeDigest = runtimeArtifact.runtimeDigest;
    retainedRuntime.attemptLedgerDigest = runtimeArtifact.attemptLedgerDigest;
    retainedRuntime.runtimeMatched = true;
    retainedRuntime.contentManifestDigest = sha256(
      await readFile(join(runtimeMismatch, "content-manifest.json")),
    );
    await writeFile(
      retainedRuntimePath,
      `${JSON.stringify(retainedRuntime)}\n`,
    );
    const portableRuntimeCheck = verify(runtimeMismatch, temporary);
    assert.equal(portableRuntimeCheck.status, 0, portableRuntimeCheck.stderr);
    const portableRuntimeReport = JSON.parse(portableRuntimeCheck.stdout);
    assert.equal(portableRuntimeReport.runtimeMatched, false);
    assert.equal(portableRuntimeReport.receiptCount, 3);
    assert.equal(portableRuntimeReport.historicalCutPreserved, true);
    const runtimeMismatchCheck = verify(runtimeMismatch, temporary, {
      requireRuntimeMatch: true,
    });
    assert.notEqual(runtimeMismatchCheck.status, 0);
    assert.match(runtimeMismatchCheck.stderr, /runtime identity changed/);

    const corruptRuntime = join(temporary, "corrupt-runtime-artifact");
    await cp(output, corruptRuntime, { recursive: true });
    const corruptRuntimePath = join(corruptRuntime, "artifact.json");
    const corruptRuntimeArtifact = JSON.parse(
      await readFile(corruptRuntimePath, "utf8"),
    );
    corruptRuntimeArtifact.runtimeDigest = `sha256:${"0".repeat(64)}`;
    const corruptRuntimeBytes = Buffer.from(
      `${JSON.stringify(corruptRuntimeArtifact)}\n`,
    );
    await writeFile(corruptRuntimePath, corruptRuntimeBytes);
    await rewriteManifestEntry(
      corruptRuntime,
      "artifact.json",
      corruptRuntimeBytes,
    );
    const corruptRuntimeCheck = verify(corruptRuntime, temporary);
    assert.notEqual(corruptRuntimeCheck.status, 0);
    assert.match(
      corruptRuntimeCheck.stderr,
      /runtime digest did not reproduce/,
    );

    for (const [name, mutate] of [
      ["prompt", (call) => (call.redactedRequest.prompt.byteLength += 1)],
      [
        "evidence",
        (call) => (call.redactedRequest.input.evidence[0].byteLength += 1),
      ],
    ]) {
      const redacted = join(temporary, `redacted-${name}-artifact`);
      await cp(output, redacted, { recursive: true });
      const callPath = join(redacted, "model-calls/initial.json");
      const call = JSON.parse(await readFile(callPath, "utf8"));
      mutate(call);
      const bytes = Buffer.from(`${JSON.stringify(call)}\n`);
      await writeFile(callPath, bytes);
      await rewriteManifestEntry(redacted, "model-calls/initial.json", bytes);
      const check = verify(redacted, temporary);
      assert.notEqual(check.status, 0);
      assert.match(check.stderr, /phase inputs did not reproduce/);
    }

    const crowded = join(temporary, "crowded-artifact");
    await cp(output, crowded, { recursive: true });
    for (
      let index = 0;
      index < REAL_MODEL_PILOT_LIMITS.artifactFiles;
      index++
    ) {
      await writeFile(join(crowded, "evidence", `unexpected-${index}.txt`), "");
    }
    const crowdedCheck = verify(crowded, temporary);
    assert.notEqual(crowdedCheck.status, 0);
    assert.match(crowdedCheck.stderr, /artifact contains too many files/);

    const dirty = join(temporary, "dirty-artifact");
    await cp(output, dirty, { recursive: true });
    const dirtyArtifactPath = join(dirty, "artifact.json");
    const dirtyArtifact = JSON.parse(await readFile(dirtyArtifactPath, "utf8"));
    dirtyArtifact.source.dirty = true;
    const dirtyBytes = Buffer.from(`${JSON.stringify(dirtyArtifact)}\n`);
    await writeFile(dirtyArtifactPath, dirtyBytes);
    await rewriteManifestEntry(dirty, "artifact.json", dirtyBytes);
    const dirtyCheck = spawnSync(process.execPath, [verifier, dirty], {
      cwd: temporary,
      encoding: "utf8",
      env: credentialFreeEnvironment(),
    });
    assert.notEqual(dirtyCheck.status, 0);
    assert.match(
      dirtyCheck.stderr,
      /source identity does not match|requires a clean source checkout/,
    );

    const altered = join(temporary, "altered-artifact");
    await cp(output, altered, { recursive: true });
    const correctionPath = join(altered, "model-calls/correction.json");
    const correctionCall = JSON.parse(await readFile(correctionPath, "utf8"));
    correctionCall.proposal.changes[0].bounds.value += 1;
    const correctionBytes = Buffer.from(`${JSON.stringify(correctionCall)}\n`);
    await writeFile(correctionPath, correctionBytes);
    await rewriteManifestEntry(
      altered,
      "model-calls/correction.json",
      correctionBytes,
    );
    const alteredCheck = spawnSync(
      process.execPath,
      [verifier, altered, "--allow-dirty"],
      {
        cwd: temporary,
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.notEqual(alteredCheck.status, 0);
    assert.match(
      alteredCheck.stderr,
      /coordinate does not match normalized evidence/,
    );

    const oversized = join(temporary, "oversized-artifact");
    await cp(output, oversized, { recursive: true });
    await writeFile(
      join(oversized, "artifact.json"),
      Buffer.alloc(REAL_MODEL_PILOT_LIMITS.artifactBytes + 1),
    );
    const oversizedCheck = spawnSync(
      process.execPath,
      [verifier, oversized, "--allow-dirty"],
      {
        cwd: temporary,
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.notEqual(oversizedCheck.status, 0);
    assert.match(oversizedCheck.stderr, /exceeds its byte limit/);

    if (process.platform !== "win32") {
      const linked = join(temporary, "symlink-artifact");
      const outside = join(temporary, "outside-evidence.txt");
      await cp(output, linked, { recursive: true });
      const linkedEvidence = join(linked, "evidence/release-created.txt");
      await cp(linkedEvidence, outside);
      await rm(linkedEvidence);
      await symlink(outside, linkedEvidence);
      const linkedCheck = spawnSync(
        process.execPath,
        [verifier, linked, "--allow-dirty"],
        {
          cwd: temporary,
          encoding: "utf8",
          env: credentialFreeEnvironment(),
        },
      );
      assert.notEqual(linkedCheck.status, 0);
      assert.match(linkedCheck.stderr, /entries must be real files/);
    }

    await writeFile(
      join(output, "evidence/release-published.txt"),
      "tampered\n",
    );
    const tampered = spawnSync(
      process.execPath,
      [verifier, output, "--allow-dirty"],
      {
        cwd: temporary,
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /content manifest entry .* changed/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("rejects a model coordinate that disagrees with normalized evidence", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "timeline-real-model-invalid-"),
  );
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(
      adapter,
      fixtureAdapter({ wrongInitialCoordinate: true, counterPath: counter }),
    );
    const result = run([
      "start",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /proposal-semantics \(proposal\.semantics\)/);
    const timeline = await loadTimeline();
    const runId = "pilot.covenant-release-correction";
    const stored = JSON.parse(
      await readFile(
        join(state, "mcp", `${timeline.contentDigest(runId).slice(7)}.json`),
        "utf8",
      ),
    );
    assert.equal(stored.revision, 2);
    assert.equal(stored.run.events.length, 2);
    assert.equal(stored.admissions.length, 2);
    assert.deepEqual(
      stored.admissions.map(({ kind }) => kind),
      ["direct-event", "direct-event"],
    );
    const entries = await readStateAttemptEntries(state);
    assert.deepEqual(
      entries.map(({ kind, phase }) => [kind, phase]),
      [
        ["attempt-opened", undefined],
        ["provider-invocation-reserved", "initial"],
        ["phase-failed", "initial"],
      ],
    );
    await assertFailedPhaseEvidence({
      state,
      phase: "initial",
      stage: "proposal-semantics",
      code: "proposal.semantics",
    });
    const repeated = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      join(temporary, "artifact"),
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /proposal-semantics/);
    assert.equal((await readStateAttemptEntries(state)).length, 3);
    assert.equal(await providerInvocationCount(counter), 1);
    await assert.rejects(lstat(join(temporary, "artifact")), /ENOENT/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

for (const failureCase of [
  {
    mode: "schema",
    stage: "proposal-schema",
    code: "proposal.schema",
    stdout: Buffer.from("{}\n"),
  },
  {
    mode: "null-json",
    stage: "proposal-schema",
    code: "proposal.schema",
    stdout: Buffer.from("null\n"),
  },
  {
    mode: "malformed-json",
    stage: "adapter-output",
    code: "adapter.invalid-json",
    stdout: Buffer.from("{\n"),
  },
  {
    mode: "invalid-framing",
    stage: "adapter-output",
    code: "adapter.invalid-framing",
    stdout: Buffer.from("{}\n{}\n"),
  },
  {
    mode: "error-envelope",
    stage: "adapter-output",
    code: "adapter.error-envelope",
    stdout: Buffer.from(
      '{"schema":"covenant.timeline.model-eval.adapter-error.v1","error":{"message":"private-envelope-secret"}}\n',
    ),
  },
  {
    mode: "invalid-utf8",
    stage: "adapter-output",
    code: "adapter.invalid-utf8",
    stdout: Buffer.from([0xff, 0x0a]),
  },
  {
    mode: "nonzero-exit",
    stage: "adapter-execution",
    code: "adapter.nonzero-exit",
    stdout: Buffer.from("private-provider-stdout\n"),
  },
  {
    mode: "exact-stdout-boundary",
    stage: "adapter-output",
    code: "adapter.invalid-json",
    stdout: Buffer.alloc(REAL_MODEL_PILOT_LIMITS.adapterBytes, 0x61),
  },
  {
    mode: "exact-stderr-boundary",
    stage: "proposal-schema",
    code: "proposal.schema",
    stdout: Buffer.from("{}\n"),
    stderr: Buffer.alloc(REAL_MODEL_PILOT_LIMITS.adapterBytes, 0x62),
  },
  {
    mode: "oversized-stdout",
    stage: "adapter-output",
    code: "adapter.output-limit",
    stdout: Buffer.alloc(REAL_MODEL_PILOT_LIMITS.adapterBytes, 0x61),
    stdoutTruncated: true,
  },
  {
    mode: "oversized-stderr",
    stage: "adapter-output",
    code: "adapter.output-limit",
    stdout: Buffer.from("{}\n"),
    stderr: Buffer.alloc(REAL_MODEL_PILOT_LIMITS.adapterBytes, 0x62),
    stderrTruncated: true,
  },
  {
    mode: "aggregate-output-limit",
    stage: "adapter-output",
    code: "adapter.output-limit",
    executionError: "enobufs",
    assertStreamTruncation: false,
    captureShapeNondeterministic: true,
  },
]) {
  test(`retains a terminal ${failureCase.mode} adapter failure`, async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), `timeline-pilot-${failureCase.mode}-`),
    );
    const state = join(temporary, "state");
    const config = join(temporary, "config.json");
    const adapter = join(temporary, "adapter.mjs");
    const counter = join(temporary, "provider-invocations.txt");
    const output = join(temporary, "artifact");
    try {
      await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
      await writeFile(adapter, rawFailureAdapter(failureCase.mode, counter));
      const startArguments = [
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ];
      const failed = run(startArguments);
      assert.notEqual(failed.status, 0);
      assert.match(
        failed.stderr,
        new RegExp(
          `${failureCase.stage} \\(${failureCase.code.replace(".", "\\.")}\\)`,
        ),
      );
      assert.doesNotMatch(
        failed.stderr,
        /private-(?:envelope-secret|provider-(?:stdout|stderr))|must-not-reach-adapter/u,
      );
      const retained = await assertFailedPhaseEvidence({
        state,
        phase: "initial",
        stage: failureCase.stage,
        code: failureCase.code,
      });
      if (failureCase.stdout) {
        assert.deepEqual(
          Buffer.from(retained.capture.execution.stdout.base64, "base64"),
          failureCase.stdout,
        );
      }
      if (!failureCase.captureShapeNondeterministic) {
        if (failureCase.assertStreamTruncation !== false) {
          assert.equal(
            retained.capture.execution.stdout.truncated,
            failureCase.stdoutTruncated ?? false,
          );
        }
      }
      if (failureCase.stderr) {
        assert.deepEqual(
          Buffer.from(retained.capture.execution.stderr.base64, "base64"),
          failureCase.stderr,
        );
      }
      if (!failureCase.captureShapeNondeterministic) {
        if (failureCase.assertStreamTruncation !== false) {
          assert.equal(
            retained.capture.execution.stderr.truncated,
            failureCase.stderrTruncated ?? false,
          );
        }
      }
      assert.equal(
        retained.capture.execution.error?.code ?? null,
        failureCase.executionError ?? null,
      );
      if (failureCase.mode === "invalid-utf8") {
        assert.equal(
          retained.capture.execution.stdout.base64,
          failureCase.stdout.toString("base64"),
        );
        assert.equal(Object.hasOwn(retained.failure.failure, "detail"), false);
      }
      if (failureCase.mode === "nonzero-exit") {
        assert.equal(retained.capture.execution.status, 23);
        assert.match(
          Buffer.from(
            retained.capture.execution.stderr.base64,
            "base64",
          ).toString("utf8"),
          /private-provider-stderr/,
        );
      }
      if (failureCase.mode.startsWith("oversized-")) {
        const stream = failureCase.mode.endsWith("stdout")
          ? retained.capture.execution.stdout
          : retained.capture.execution.stderr;
        assert.equal(stream.byteLength, REAL_MODEL_PILOT_LIMITS.adapterBytes);
      }
      assert.equal(await providerInvocationCount(counter), 1);
      const stored = retained.failure.mcpAudit;
      assert.equal(stored.revision, 2);
      assert.deepEqual(
        stored.admissions.map(({ kind }) => kind),
        ["direct-event", "direct-event"],
      );

      const repeated = run([
        "resume",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--out",
        output,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ]);
      assert.notEqual(repeated.status, 0);
      assert.equal(await providerInvocationCount(counter), 1);
      await assert.rejects(lstat(output), /ENOENT/u);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

test("exports and verifies a credential-safe failed-attempt receipt", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-failure-export-"));
  const state = join(temporary, "state");
  const output = join(temporary, "failed-attempt");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, rawFailureAdapter("error-envelope", counter));
    const failed = run([
      "start",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(failed.status, 0);
    assert.equal(await providerInvocationCount(counter), 1);

    const exported = spawnSync(
      process.execPath,
      [failureExporter, state, output],
      {
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.equal(exported.status, 0, exported.stderr);
    await assert.rejects(lstat(join(output, "artifact.json")), /ENOENT/u);
    const capture = JSON.parse(
      await readFile(join(output, "adapter-execution.json"), "utf8"),
    );
    assert.equal(capture.execution.stdout.disclosure, "omitted");
    assert.equal(Object.hasOwn(capture.execution.stdout, "base64"), false);
    assert.equal(Object.hasOwn(capture.execution.stderr, "base64"), false);
    const publicBytes = Buffer.concat(
      await Promise.all(
        (await readdir(output)).map((name) => readFile(join(output, name))),
      ),
    ).toString("utf8");
    assert.equal(publicBytes.includes("private-envelope-secret"), false);
    assert.equal(publicBytes.includes("OPENAI_API_KEY"), false);

    const verified = spawnSync(process.execPath, [failureVerifier, output], {
      encoding: "utf8",
      env: credentialFreeEnvironment(),
    });
    assert.equal(verified.status, 0, verified.stderr);
    assert.deepEqual(JSON.parse(verified.stdout), {
      verified: true,
      schema: "covenant.timeline.real-model-pilot.failed-attempt.v2",
      phase: "initial",
      failure: {
        stage: "adapter-output",
        code: "adapter.error-envelope",
      },
      rawAdapterStreams: "committed-not-disclosed",
    });

    const racedOutput = join(temporary, "raced-failed-attempt");
    await assert.rejects(
      exportFailedAttempt({
        state,
        output: racedOutput,
        injectFailure(point) {
          if (point !== "after-failed-attempt-staging-sync") return;
          mkdirSync(racedOutput, { mode: 0o700 });
          writeFileSync(join(racedOutput, "external-owner"), "preserve\n", {
            mode: 0o600,
          });
        },
      }),
      /output already exists/u,
    );
    assert.equal(
      await readFile(join(racedOutput, "external-owner"), "utf8"),
      "preserve\n",
    );

    const crashOutput = join(temporary, "crash-recovered-failed-attempt");
    const crashRunner = join(temporary, "failure-export-crash.mjs");
    await writeFile(
      crashRunner,
      `import { exportFailedAttempt } from ${JSON.stringify(
        pathToFileURL(
          join(root, "scripts/mcp-real-model-pilot-failure-artifact.mjs"),
        ).href,
      )};
await exportFailedAttempt({
  state: process.argv[2],
  output: process.argv[3],
  injectFailure(point) {
    if (point === "after-failed-attempt-destination-reserve") process.exit(71);
  },
});
`,
    );
    const crashed = spawnSync(
      process.execPath,
      [crashRunner, state, crashOutput],
      {
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.equal(crashed.status, 71, crashed.stderr);
    assert.equal(
      (await lstat(join(crashOutput, ".publication-incomplete.json"))).isFile(),
      true,
    );
    await exportFailedAttempt({ state, output: crashOutput });
    const recoveredVerification = spawnSync(
      process.execPath,
      [failureVerifier, crashOutput],
      {
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.equal(recoveredVerification.status, 0, recoveredVerification.stderr);

    const occupied = join(temporary, "occupied-failed-attempt");
    await mkdir(occupied);
    const occupiedExport = spawnSync(
      process.execPath,
      [failureExporter, state, occupied],
      {
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.notEqual(occupiedExport.status, 0);
    assert.equal((await lstat(occupied)).isDirectory(), true);
    assert.deepEqual(await readdir(occupied), []);
    if (process.platform !== "win32") {
      const linkedTarget = join(temporary, "linked-target");
      const linkedOutput = join(temporary, "linked-failed-attempt");
      await mkdir(linkedTarget);
      await symlink(linkedTarget, linkedOutput);
      const linkedExport = spawnSync(
        process.execPath,
        [failureExporter, state, linkedOutput],
        {
          encoding: "utf8",
          env: credentialFreeEnvironment(),
        },
      );
      assert.notEqual(linkedExport.status, 0);
      assert.equal((await lstat(linkedOutput)).isSymbolicLink(), true);
      assert.deepEqual(await readdir(linkedTarget), []);
    }

    const timeline = await loadTimeline();
    const metadataTampered = join(
      temporary,
      "failed-attempt-metadata-tampered",
    );
    await cp(output, metadataTampered, { recursive: true });
    const artifactPath = join(metadataTampered, "failed-attempt.json");
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    artifact.binding.source.revision = "0".repeat(40);
    artifact.source.revision = "0".repeat(40);
    artifact.failure.code = "adapter.invalid-json";
    const artifactBytes = Buffer.from(`${timeline.canonicalJson(artifact)}\n`);
    await writeFile(artifactPath, artifactBytes);
    await rewriteManifestEntry(
      metadataTampered,
      "failed-attempt.json",
      artifactBytes,
    );
    const metadataRejected = spawnSync(
      process.execPath,
      [failureVerifier, metadataTampered],
      {
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.notEqual(metadataRejected.status, 0);

    const streamTampered = join(temporary, "failed-attempt-stream-tampered");
    await cp(output, streamTampered, { recursive: true });
    const capturePath = join(streamTampered, "adapter-execution.json");
    const captureDocument = JSON.parse(await readFile(capturePath, "utf8"));
    captureDocument.execution.stdout.truncated = true;
    const captureBytes = Buffer.from(
      `${timeline.canonicalJson(captureDocument)}\n`,
    );
    await writeFile(capturePath, captureBytes);
    await rewriteManifestEntry(
      streamTampered,
      "adapter-execution.json",
      captureBytes,
    );
    const streamRejected = spawnSync(
      process.execPath,
      [failureVerifier, streamTampered],
      {
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.notEqual(streamRejected.status, 0);

    const tampered = join(temporary, "failed-attempt-tampered");
    await cp(output, tampered, { recursive: true });
    const failurePath = join(tampered, "phase-failure.json");
    const failure = JSON.parse(await readFile(failurePath, "utf8"));
    failure.failure.code = "adapter.invalid-json";
    await writeFile(failurePath, `${timeline.canonicalJson(failure)}\n`);
    const rejected = spawnSync(process.execPath, [failureVerifier, tampered], {
      encoding: "utf8",
      env: credentialFreeEnvironment(),
    });
    assert.notEqual(rejected.status, 0);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("rejects tampered failed-attempt evidence without another provider call", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-failure-tamper-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(
      adapter,
      fixtureAdapter({ wrongInitialCoordinate: true, counterPath: counter }),
    );
    const failed = run([
      "start",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(failed.status, 0);
    assert.equal(await providerInvocationCount(counter), 1);
    const timeline = await loadTimeline();

    for (const [name, mutate] of [
      [
        "raw-stream",
        async (copy) => {
          const path = join(copy, "initial-adapter-execution.json");
          const document = JSON.parse(await readFile(path, "utf8"));
          document.execution.stdout.base64 =
            Buffer.from("{}\n").toString("base64");
          await writeFile(path, `${timeline.canonicalJson(document)}\n`);
        },
      ],
      [
        "failure-code",
        async (copy) => {
          const path = join(copy, "initial-failure.json");
          const document = JSON.parse(await readFile(path, "utf8"));
          document.failure.code = "proposal.schema";
          await writeFile(path, `${timeline.canonicalJson(document)}\n`);
        },
      ],
      [
        "ledger-binding",
        async (copy) => {
          const path = join(copy, "attempt-ledger/002.json");
          const entry = JSON.parse(await readFile(path, "utf8"));
          entry.failureBundleDigest = `sha256:${"0".repeat(64)}`;
          const { recordDigest: _recordDigest, ...unsigned } = entry;
          entry.recordDigest = timeline.contentDigest(unsigned);
          await writeFile(path, `${timeline.canonicalJson(entry)}\n`);
        },
      ],
      [
        "noncanonical",
        async (copy) => {
          const path = join(copy, "initial-failure.json");
          await writeFile(path, `${await readFile(path, "utf8")}\n`);
        },
      ],
      [
        "symlink",
        async (copy) => {
          const path = join(copy, "initial-failure.json");
          await rm(path);
          await symlink(join(state, "initial-failure.json"), path);
        },
      ],
    ]) {
      const copy = join(temporary, `state-${name}`);
      await cp(state, copy, { recursive: true });
      await mutate(copy);
      const output = join(temporary, `artifact-${name}`);
      const resumed = run([
        "resume",
        "--input",
        fixture,
        "--state",
        copy,
        "--config",
        config,
        "--out",
        output,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ]);
      assert.notEqual(resumed.status, 0, name);
      assert.equal(await providerInvocationCount(counter), 1, name);
      await assert.rejects(lstat(output), /ENOENT/u);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

for (const failurePoint of [
  "after-initial-adapter-execution-install",
  "before-initial-failure-completion",
  "after-initial-phase-failed-ledger-install",
]) {
  test(`${failurePoint} recovers as a terminal failure without retry`, async () => {
    const temporary = await mkdtemp(join(tmpdir(), "timeline-failure-crash-"));
    const state = join(temporary, "state");
    const config = join(temporary, "config.json");
    const adapter = join(temporary, "adapter.mjs");
    const counter = join(temporary, "provider-invocations.txt");
    const output = join(temporary, "artifact");
    try {
      await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
      await writeFile(
        adapter,
        fixtureAdapter({ wrongInitialCoordinate: true, counterPath: counter }),
      );
      const interrupted = run(
        [
          "start",
          "--input",
          fixture,
          "--state",
          state,
          "--config",
          config,
          "--allow-dirty",
          "--",
          process.execPath,
          adapter,
        ],
        { failurePoint },
      );
      assert.notEqual(interrupted.status, 0);
      assert.equal(await providerInvocationCount(counter), 1);

      const recovered = run([
        "resume",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--out",
        output,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ]);
      assert.notEqual(recovered.status, 0);
      assert.match(recovered.stderr, /proposal-semantics/);
      assert.equal(await providerInvocationCount(counter), 1);
      const entries = await readStateAttemptEntries(state);
      assert.deepEqual(
        entries.map(({ kind }) => kind),
        ["attempt-opened", "provider-invocation-reserved", "phase-failed"],
      );
      await assertFailedPhaseEvidence({
        state,
        phase: "initial",
        stage: "proposal-semantics",
        code: "proposal.semantics",
      });
      await assert.rejects(lstat(output), /ENOENT/u);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

test("a crash before admission is fenced and closed without model admission", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-before-admit-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  const output = join(temporary, "artifact");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const interrupted = run(
      [
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ],
      { failurePoint: "before-initial-admission" },
    );
    assert.notEqual(interrupted.status, 0);
    assert.equal(await providerInvocationCount(counter), 1);

    const resumed = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(resumed.status, 0);
    assert.match(
      resumed.stderr,
      /admission-recovery \(proposal\.interrupted-before-admission\)/,
    );
    assert.equal(await providerInvocationCount(counter), 1);
    const retained = await assertFailedPhaseEvidence({
      state,
      phase: "initial",
      stage: "admission-recovery",
      code: "proposal.interrupted-before-admission",
    });
    assert.equal(retained.failure.mcpAudit.admissions.length, 3);
    assert.equal(
      retained.failure.mcpAudit.admissions.at(-1).kind,
      "direct-event",
    );
    const observation = JSON.parse(
      await readFile(join(state, "initial-recovery-observation.json"), "utf8"),
    );
    assert.equal(observation.disposition, "exact-recovery-fence");
    assert.equal(observation.invocation.role, "model");
    const timeline = await loadTimeline();
    const openObservation = structuredClone(observation);
    openObservation.invocation.detail = "uncontrolled";
    assert.throws(
      () => validateRecoveryObservationDocumentV2(openObservation, timeline),
      /recovery observation is invalid/u,
    );
    const openFailure = structuredClone(retained.failure);
    openFailure.observerInvocation.detail = "uncontrolled";
    assert.throws(
      () => validatePhaseFailureDocumentV2(openFailure, timeline),
      /phase failure bundle is invalid/u,
    );
    await assert.rejects(lstat(output), /ENOENT/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("recovery CAS-fences a live admission owner before terminalizing", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-live-admit-owner-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  const output = join(temporary, "artifact");
  const barrier = join(temporary, "admission-barrier");
  let originalRun;
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const startArguments = [
      "start",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    originalRun = runAsync(startArguments, {
      environment: {
        TIMELINE_PILOT_TEST_PAUSE: "before-initial-admission",
        TIMELINE_PILOT_TEST_BARRIER: barrier,
      },
    });
    await waitForFile(`${barrier}.ready`);

    const concurrent = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(concurrent.status, 0);
    assert.match(
      concurrent.stderr,
      /admission-recovery \(proposal\.interrupted-before-admission\)/u,
    );
    const retained = await assertFailedPhaseEvidence({
      state,
      phase: "initial",
      stage: "admission-recovery",
      code: "proposal.interrupted-before-admission",
    });
    assert.equal(retained.failure.mcpAudit.admissions.length, 3);
    assert.equal(
      retained.failure.mcpAudit.admissions.at(-1).kind,
      "direct-event",
    );
    const observation = JSON.parse(
      await readFile(join(state, "initial-recovery-observation.json"), "utf8"),
    );
    assert.equal(observation.disposition, "exact-recovery-fence");
    assert.deepEqual(
      (await readStateAttemptEntries(state)).map(({ kind }) => kind),
      ["attempt-opened", "provider-invocation-reserved", "phase-failed"],
    );

    await writeFile(`${barrier}.release`, "release\n", {
      flag: "wx",
      mode: 0o600,
    });
    const original = await originalRun;
    assert.notEqual(original.status, 0);
    await assert.rejects(lstat(join(state, "initial-result.json")), /ENOENT/u);

    const repeated = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(repeated.status, 0);
    assert.match(
      repeated.stderr,
      /admission-recovery \(proposal\.interrupted-before-admission\)/u,
    );
    assert.equal(await providerInvocationCount(counter), 1);
    await assert.rejects(lstat(output), /ENOENT/u);
  } finally {
    await writeFile(`${barrier}.release`, "release\n", {
      flag: "wx",
      mode: 0o600,
    }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    await originalRun?.catch(() => {});
    await rm(temporary, { recursive: true, force: true });
  }
});

test("recovery CAS-fences a live preview before terminalizing", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-live-preview-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  const output = join(temporary, "artifact");
  const barrier = join(temporary, "preview-barrier");
  let originalRun;
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const startArguments = [
      "start",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    originalRun = runAsync(startArguments, {
      environment: {
        TIMELINE_PILOT_TEST_PAUSE: "after-initial-adapter-capture",
        TIMELINE_PILOT_TEST_BARRIER: barrier,
      },
    });
    await waitForFile(`${barrier}.ready`);

    const resumeArguments = [
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    const concurrent = run(resumeArguments);
    assert.notEqual(concurrent.status, 0);
    assert.match(
      concurrent.stderr,
      /capture-recovery \(adapter\.interrupted-before-proposal-ready\)/u,
    );
    const retained = await assertFailedPhaseEvidence({
      state,
      phase: "initial",
      stage: "capture-recovery",
      code: "adapter.interrupted-before-proposal-ready",
    });
    assert.equal(retained.failure.proposalReadyDigest, null);
    assert.equal(retained.failure.phaseDecisionDigest, null);
    assert.equal(retained.failure.mcpAudit.admissions.length, 3);
    const observation = JSON.parse(
      await readFile(join(state, "initial-recovery-observation.json"), "utf8"),
    );
    assert.equal(observation.disposition, "exact-recovery-fence");

    await writeFile(`${barrier}.release`, "release\n", {
      flag: "wx",
      mode: 0o600,
    });
    const original = await originalRun;
    assert.notEqual(original.status, 0);
    await assert.rejects(lstat(join(state, "initial-result.json")), /ENOENT/u);

    const repeated = run(resumeArguments);
    assert.notEqual(repeated.status, 0);
    assert.match(
      repeated.stderr,
      /capture-recovery \(adapter\.interrupted-before-proposal-ready\)/u,
    );
    assert.equal(await providerInvocationCount(counter), 1);
    assert.deepEqual(
      (await readStateAttemptEntries(state)).map(({ kind }) => kind),
      ["attempt-opened", "provider-invocation-reserved", "phase-failed"],
    );
    await assert.rejects(lstat(output), /ENOENT/u);
  } finally {
    await writeFile(`${barrier}.release`, "release\n", {
      flag: "wx",
      mode: 0o600,
    }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    await originalRun?.catch(() => {});
    await rm(temporary, { recursive: true, force: true });
  }
});

test("an original admission can win a live pre-ready recovery race", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-live-preview-win-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  const output = join(temporary, "artifact");
  const previewBarrier = join(temporary, "preview-barrier");
  const recoveryBarrier = join(temporary, "recovery-barrier");
  let originalRun;
  let recoveryRun;
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const startArguments = [
      "start",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    originalRun = runAsync(startArguments, {
      environment: {
        TIMELINE_PILOT_TEST_PAUSE: "after-initial-adapter-capture",
        TIMELINE_PILOT_TEST_BARRIER: previewBarrier,
      },
    });
    await waitForFile(`${previewBarrier}.ready`);

    const resumeArguments = [
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    recoveryRun = runAsync(resumeArguments, {
      environment: {
        TIMELINE_PILOT_TEST_PAUSE: "before-initial-recovery-fence",
        TIMELINE_PILOT_TEST_BARRIER: recoveryBarrier,
      },
    });
    await waitForFile(`${recoveryBarrier}.ready`);

    await writeFile(`${previewBarrier}.release`, "release\n", {
      flag: "wx",
      mode: 0o600,
    });
    await waitForFile(join(state, "initial-result.json"));
    await writeFile(`${recoveryBarrier}.release`, "release\n", {
      flag: "wx",
      mode: 0o600,
    });

    const [original, recovered] = await Promise.all([originalRun, recoveryRun]);
    assert.equal(original.status, 0, original.stderr);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(await providerInvocationCount(counter), 2);
    const observation = JSON.parse(
      await readFile(join(state, "initial-recovery-observation.json"), "utf8"),
    );
    assert.equal(observation.disposition, "exact-admission");
    assert.match(observation.proposalReadyDigest, /^sha256:[0-9a-f]{64}$/u);
    const decision = JSON.parse(
      await readFile(join(state, "initial-decision.json"), "utf8"),
    );
    assert.equal(decision.decision, "admission-authorized");
    assert.deepEqual(
      (await readStateAttemptEntries(state)).map(({ kind }) => kind),
      [
        "attempt-opened",
        "provider-invocation-reserved",
        "phase-completed",
        "provider-invocation-reserved",
        "phase-completed",
      ],
    );
    assert.equal(JSON.parse(recovered.stdout).verified, true);
  } finally {
    for (const barrier of [previewBarrier, recoveryBarrier]) {
      await writeFile(`${barrier}.release`, "release\n", {
        flag: "wx",
        mode: 0o600,
      }).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
    }
    await Promise.allSettled([originalRun, recoveryRun].filter(Boolean));
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a crash after admission completes from the exact MCP state", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-after-admit-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  const output = join(temporary, "artifact");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const interrupted = run(
      [
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ],
      { failurePoint: "after-initial-admission" },
    );
    assert.notEqual(interrupted.status, 0);
    assert.equal(await providerInvocationCount(counter), 1);

    const resumed = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(await providerInvocationCount(counter), 2);
    const calls = (await readFile(counter, "utf8")).trim().split("\n");
    assert.equal(calls.filter((id) => id.includes("initial")).length, 1);
    assert.equal(calls.filter((id) => id.includes("correction")).length, 1);
    const observation = JSON.parse(
      await readFile(join(state, "initial-recovery-observation.json"), "utf8"),
    );
    assert.equal(observation.disposition, "exact-admission");
    assert.equal(observation.invocation.role, "model");
    const audit = JSON.parse(
      await readFile(join(output, "audit.json"), "utf8"),
    );
    assert.equal(audit.admissions.length, 4);
    assert.deepEqual(
      audit.admissions.map(({ kind }) => kind),
      ["direct-event", "direct-event", "model-proposal", "model-proposal"],
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("recovery retains a deterministic post-admission verification failure", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "timeline-post-admission-failure-"),
  );
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  const output = join(temporary, "artifact");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const interrupted = run(
      [
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ],
      { failurePoint: "after-initial-admission" },
    );
    assert.notEqual(interrupted.status, 0);
    assert.equal(await providerInvocationCount(counter), 1);

    const resumeArguments = [
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    const failed = run(resumeArguments, {
      failurePoint: "during-initial-post-admission-verification",
    });
    assert.notEqual(failed.status, 0);
    assert.match(
      failed.stderr,
      /post-admission-verification \(proposal\.post-admission\)/u,
    );
    const retained = await assertFailedPhaseEvidence({
      state,
      phase: "initial",
      stage: "post-admission-verification",
      code: "proposal.post-admission",
    });
    assert.equal(retained.failure.mcpAudit.admissions.length, 3);
    const observation = JSON.parse(
      await readFile(join(state, "initial-recovery-observation.json"), "utf8"),
    );
    assert.equal(observation.disposition, "exact-admission");
    assert.equal(await providerInvocationCount(counter), 1);

    const repeated = run(resumeArguments);
    assert.notEqual(repeated.status, 0);
    assert.match(
      repeated.stderr,
      /post-admission-verification \(proposal\.post-admission\)/u,
    );
    assert.equal(await providerInvocationCount(counter), 1);
    await assert.rejects(lstat(output), /ENOENT/u);

    const timeline = await loadTimeline();
    const decisionTamperedState = join(temporary, "decision-tampered-state");
    await cp(state, decisionTamperedState, { recursive: true });
    const decisionPath = join(decisionTamperedState, "initial-decision.json");
    const decision = JSON.parse(await readFile(decisionPath, "utf8"));
    decision.decision = "recovery-terminal";
    await writeFile(decisionPath, `${timeline.canonicalJson(decision)}\n`);
    const privateFailurePath = join(
      decisionTamperedState,
      "initial-failure.json",
    );
    const privateFailure = JSON.parse(
      await readFile(privateFailurePath, "utf8"),
    );
    privateFailure.phaseDecisionDigest = timeline.contentDigest(decision);
    await writeFile(
      privateFailurePath,
      `${timeline.canonicalJson(privateFailure)}\n`,
    );
    const terminalPath = join(decisionTamperedState, "attempt-ledger/002.json");
    const terminal = JSON.parse(await readFile(terminalPath, "utf8"));
    terminal.failureBundleDigest = timeline.contentDigest(privateFailure);
    const { recordDigest: _recordDigest, ...unsignedTerminal } = terminal;
    terminal.recordDigest = timeline.contentDigest(unsignedTerminal);
    await writeFile(terminalPath, `${timeline.canonicalJson(terminal)}\n`);
    const decisionRejected = run([
      "resume",
      "--input",
      fixture,
      "--state",
      decisionTamperedState,
      "--config",
      config,
      "--out",
      join(temporary, "decision-tampered-artifact"),
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(decisionRejected.status, 0);
    assert.match(
      decisionRejected.stderr,
      /failed phase evidence binding changed/u,
    );
    assert.equal(await providerInvocationCount(counter), 1);

    const receipt = join(temporary, "failed-receipt");
    await exportFailedAttempt({ state, output: receipt });
    const verified = spawnSync(process.execPath, [failureVerifier, receipt], {
      encoding: "utf8",
      env: credentialFreeEnvironment(),
    });
    assert.equal(verified.status, 0, verified.stderr);

    const candidateTampered = join(temporary, "candidate-tampered-receipt");
    await cp(receipt, candidateTampered, { recursive: true });
    const readyPath = join(candidateTampered, "proposal-ready.json");
    const ready = JSON.parse(await readFile(readyPath, "utf8"));
    ready.candidate.events[0].id = "event-tampered-candidate";
    await rewriteArtifactReference({
      directory: candidateTampered,
      field: "proposalReady",
      path: "proposal-ready.json",
      document: ready,
      timeline,
    });
    const candidateRejected = spawnSync(
      process.execPath,
      [failureVerifier, candidateTampered],
      {
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.notEqual(candidateRejected.status, 0);

    const recoveryTampered = join(temporary, "recovery-tampered-receipt");
    await cp(receipt, recoveryTampered, { recursive: true });
    const recoveryPath = join(recoveryTampered, "recovery-observation.json");
    const recovery = JSON.parse(await readFile(recoveryPath, "utf8"));
    recovery.disposition = "exact-base";
    await rewriteArtifactReference({
      directory: recoveryTampered,
      field: "recoveryObservation",
      path: "recovery-observation.json",
      document: recovery,
      timeline,
    });
    const recoveryRejected = spawnSync(
      process.execPath,
      [failureVerifier, recoveryTampered],
      {
        encoding: "utf8",
        env: credentialFreeEnvironment(),
      },
    );
    assert.notEqual(recoveryRejected.status, 0);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a lost admission response recovers the exact admitted state", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "timeline-lost-admit-response-"),
  );
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  const output = join(temporary, "artifact");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const interrupted = run(
      [
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ],
      { failurePoint: "after-initial-admission-response-lost" },
    );
    assert.notEqual(interrupted.status, 0);
    assert.equal(await providerInvocationCount(counter), 1);
    await assert.rejects(lstat(join(state, "initial-failure.json")), /ENOENT/u);
    assert.deepEqual(
      (await readStateAttemptEntries(state)).map(({ kind }) => kind),
      ["attempt-opened", "provider-invocation-reserved"],
    );

    const resumed = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(await providerInvocationCount(counter), 2);
    const observation = JSON.parse(
      await readFile(join(state, "initial-recovery-observation.json"), "utf8"),
    );
    assert.equal(observation.disposition, "exact-admission");
    assert.equal(JSON.parse(resumed.stdout).verified, true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("recovery quarantines a valid but unexpected MCP mutation", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-diverged-mcp-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const interrupted = run(
      [
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ],
      { failurePoint: "before-initial-admission" },
    );
    assert.notEqual(interrupted.status, 0);
    const capture = JSON.parse(
      await readFile(join(state, "initial-adapter-execution.json"), "utf8"),
    );
    const { FileMcpRunStore } =
      await import("../packages/mcp-server/dist/store.js");
    const store = new FileMcpRunStore(join(state, "mcp"));
    await store.append(
      capture.baseRun.contract.id,
      {
        id: "event-unexpected-recovery-mutation",
        type: "point.declared",
        point: {
          id: "unexpected-recovery-point",
          contextId: "actual",
          axisId: "unix-milliseconds",
        },
      },
      capture.baseAudit.runDigest,
      {
        authorityId: capture.admissionPolicy.authorityId,
        policyRef: capture.admissionPolicy.policyRef,
        policyDigest: capture.binding.admissionPolicyDigest,
      },
    );

    const resumed = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      join(temporary, "artifact"),
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(resumed.status, 0);
    assert.match(
      resumed.stderr,
      /admission-recovery \(proposal\.mcp-state-diverged\)/,
    );
    assert.equal(await providerInvocationCount(counter), 1);
    const retained = await assertFailedPhaseEvidence({
      state,
      phase: "initial",
      stage: "admission-recovery",
      code: "proposal.mcp-state-diverged",
    });
    assert.equal(retained.failure.mcpAudit.admissions.length, 3);
    const observation = JSON.parse(
      await readFile(join(state, "initial-recovery-observation.json"), "utf8"),
    );
    assert.equal(observation.disposition, "state-diverged");
    assert.equal(observation.invocation.role, "model");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("concurrent failure recovery installs one terminal outcome", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-failure-race-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(
      adapter,
      fixtureAdapter({ wrongInitialCoordinate: true, counterPath: counter }),
    );
    const interrupted = run(
      [
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ],
      { failurePoint: "before-initial-failure-completion" },
    );
    assert.notEqual(interrupted.status, 0);
    const resumeArguments = (suffix) => [
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      join(temporary, `artifact-${suffix}`),
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    const results = await Promise.all([
      runAsync(resumeArguments("one")),
      runAsync(resumeArguments("two")),
    ]);
    for (const result of results) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /proposal-semantics/);
    }
    assert.equal(await providerInvocationCount(counter), 1);
    assert.deepEqual(
      (await readStateAttemptEntries(state)).map(({ kind }) => kind),
      ["attempt-opened", "provider-invocation-reserved", "phase-failed"],
    );
    await assertFailedPhaseEvidence({
      state,
      phase: "initial",
      stage: "proposal-semantics",
      code: "proposal.semantics",
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a failed correction attempt cannot invoke the provider again", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-rerun-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(
      adapter,
      fixtureAdapter({ counterPath: counter, failCorrection: true }),
    );
    const started = run([
      "start",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.equal(started.status, 0, started.stderr);

    const resumeArguments = [
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      join(temporary, "artifact"),
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    const failed = run(resumeArguments);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /adapter-execution \(adapter\.nonzero-exit\)/);
    assert.equal(
      (await readFile(counter, "utf8")).trim().split("\n").length,
      2,
    );
    assert.deepEqual(
      (await readStateAttemptEntries(state)).map(({ kind, phase }) => [
        kind,
        phase,
      ]),
      [
        ["attempt-opened", undefined],
        ["provider-invocation-reserved", "initial"],
        ["phase-completed", "initial"],
        ["provider-invocation-reserved", "correction"],
        ["phase-failed", "correction"],
      ],
    );
    const retainedFailure = await assertFailedPhaseEvidence({
      state,
      phase: "correction",
      stage: "adapter-execution",
      code: "adapter.nonzero-exit",
    });
    assert.match(
      Buffer.from(
        retainedFailure.capture.execution.stderr.base64,
        "base64",
      ).toString("utf8"),
      /fixture correction failure/,
    );
    assert.doesNotMatch(failed.stderr, /fixture correction failure/);
    assert.deepEqual(
      retainedFailure.failure.mcpAudit.admissions.map(({ kind }) => kind),
      ["direct-event", "direct-event", "model-proposal"],
    );

    const repeated = run(resumeArguments);
    assert.notEqual(repeated.status, 0);
    assert.match(
      repeated.stderr,
      /adapter-execution \(adapter\.nonzero-exit\)/,
    );
    assert.equal(
      (await readFile(counter, "utf8")).trim().split("\n").length,
      2,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("resume rejects rehashed admission policy and writer tampering before provider use", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-tamper-"));
  const state = join(temporary, "state");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    assert.equal(
      run([
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ]).status,
      0,
    );
    assert.equal(await providerInvocationCount(counter), 1);

    const timeline = await loadTimeline();
    const runId = "pilot.covenant-release-correction";
    const storedPath = join(
      state,
      "mcp",
      `${timeline.contentDigest(runId).slice(7)}.json`,
    );
    const stored = JSON.parse(await readFile(storedPath, "utf8"));
    const record = stored.admissions[0];
    record.policyRef = "covenant.timeline/tampered-policy/v1";
    record.writer.serverVersion = "0.0.0-alpha.0";
    const { recordDigest: _recordDigest, ...unsigned } = record;
    record.recordDigest = timeline.contentDigest(unsigned);
    await writeFile(storedPath, `${timeline.canonicalJson(stored)}\n`);

    const resumed = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      join(temporary, "artifact"),
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(resumed.status, 0);
    assert.match(resumed.stderr, /MCP .*failed|did not recover/u);
    assert.equal(await providerInvocationCount(counter), 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("pilot state inside the source checkout is rejected before creation", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-location-"));
  const state = join(root, `.timeline-pilot-state-${randomUUID()}`);
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter());
    const result = run([
      "start",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the source checkout/u);
    await assert.rejects(lstat(state), /ENOENT/u);
  } finally {
    await rm(state, { recursive: true, force: true });
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a pre-sync phase result recovers from the exact admitted MCP state", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-presync-"));
  const state = join(temporary, "state");
  const output = join(temporary, "artifact");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const common = [
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    const interrupted = run(["start", ...common], {
      failurePoint: "before-initial-result-sync",
    });
    assert.notEqual(interrupted.status, 0);
    assert.equal(await providerInvocationCount(counter), 1);
    await assert.rejects(lstat(join(state, "initial-result.json")), /ENOENT/u);
    assert.deepEqual(
      (await readStateAttemptEntries(state)).map(({ kind }) => kind),
      ["attempt-opened", "provider-invocation-reserved"],
    );

    const resumed = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(await providerInvocationCount(counter), 2);
    const calls = (await readFile(counter, "utf8")).trim().split("\n");
    assert.equal(calls.filter((id) => id.includes("initial")).length, 1);
    assert.equal(calls.filter((id) => id.includes("correction")).length, 1);
    const observation = JSON.parse(
      await readFile(join(state, "initial-recovery-observation.json"), "utf8"),
    );
    assert.equal(observation.disposition, "exact-admission");
    assert.equal(JSON.parse(resumed.stdout).verified, true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

for (const failurePoint of [
  "after-initial-result-install",
  "after-initial-phase-completed-ledger-install",
]) {
  test(`${failurePoint} recovers without repeating the initial provider call`, async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "timeline-pilot-postinstall-"),
    );
    const state = join(temporary, "state");
    const output = join(temporary, "artifact");
    const config = join(temporary, "config.json");
    const adapter = join(temporary, "adapter.mjs");
    const counter = join(temporary, "provider-invocations.txt");
    try {
      await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
      await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
      const interrupted = run(
        [
          "start",
          "--input",
          fixture,
          "--state",
          state,
          "--config",
          config,
          "--allow-dirty",
          "--",
          process.execPath,
          adapter,
        ],
        { failurePoint },
      );
      assert.notEqual(interrupted.status, 0);
      assert.equal(await providerInvocationCount(counter), 1);
      assert.ok(
        JSON.parse(await readFile(join(state, "initial-result.json"), "utf8")),
      );

      const resumed = run([
        "resume",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--out",
        output,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ]);
      assert.equal(resumed.status, 0, resumed.stderr);
      assert.equal(JSON.parse(resumed.stdout).verified, true);
      assert.equal(await providerInvocationCount(counter), 2);
      const entries = await readStateAttemptEntries(state);
      assert.equal(entries.filter(({ sequence }) => sequence === 2).length, 1);
      assert.equal(entries[2].kind, "phase-completed");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

test("resume completes a retained initial bundle without repeating its provider call", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "timeline-pilot-initial-crash-"),
  );
  const state = join(temporary, "state");
  const output = join(temporary, "artifact");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const startArguments = [
      "start",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    const interrupted = run(startArguments, {
      failurePoint: "before-initial-phase-completion",
    });
    assert.notEqual(interrupted.status, 0);
    assert.match(interrupted.stderr, /before-initial-phase-completion/);
    assert.equal(await providerInvocationCount(counter), 1);
    assert.equal(
      (await readStateAttemptEntries(state))[1].kind,
      "provider-invocation-reserved",
    );
    assert.ok(
      JSON.parse(await readFile(join(state, "initial-result.json"), "utf8")),
    );

    const resumed = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).verified, true);
    assert.equal(await providerInvocationCount(counter), 2);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("resume finalizes a completed correction bundle without another provider call", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-finalize-"));
  const state = join(temporary, "state");
  const output = join(temporary, "artifact");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    assert.equal(
      run([
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ]).status,
      0,
    );
    const resumeArguments = [
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    const interrupted = run(resumeArguments, {
      failurePoint: "after-correction-phase-completion",
    });
    assert.notEqual(interrupted.status, 0);
    assert.match(interrupted.stderr, /after-correction-phase-completion/);
    assert.equal(await providerInvocationCount(counter), 2);
    await assert.rejects(lstat(output), /ENOENT/);
    assert.equal(
      (await readStateAttemptEntries(state))[4].kind,
      "phase-completed",
    );

    const finalized = run(resumeArguments);
    assert.equal(finalized.status, 0, finalized.stderr);
    assert.equal(JSON.parse(finalized.stdout).verified, true);
    assert.equal(await providerInvocationCount(counter), 2);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("resume completes a retained correction bundle without another provider call", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "timeline-pilot-correction-bundle-"),
  );
  const state = join(temporary, "state");
  const output = join(temporary, "artifact");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    const common = [
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    assert.equal(run(["start", ...common]).status, 0);
    const resumeArguments = [
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    const interrupted = run(resumeArguments, {
      failurePoint: "before-correction-phase-completion",
    });
    assert.notEqual(interrupted.status, 0);
    assert.match(interrupted.stderr, /before-correction-phase-completion/);
    assert.equal(await providerInvocationCount(counter), 2);
    assert.equal(
      (await readStateAttemptEntries(state))[3].kind,
      "provider-invocation-reserved",
    );
    assert.ok(
      JSON.parse(await readFile(join(state, "correction-result.json"), "utf8")),
    );

    const finalized = run(resumeArguments);
    assert.equal(finalized.status, 0, finalized.stderr);
    assert.equal(JSON.parse(finalized.stdout).verified, true);
    assert.equal(await providerInvocationCount(counter), 2);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("an interrupted staged export leaves the target absent and can be finalized", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "timeline-pilot-export-crash-"),
  );
  const state = join(temporary, "state");
  const output = join(temporary, "artifact");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    assert.equal(
      run([
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ]).status,
      0,
    );
    const resumeArguments = [
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    const interrupted = run(resumeArguments, {
      failurePoint: "during-artifact-export",
    });
    assert.notEqual(interrupted.status, 0);
    assert.match(interrupted.stderr, /during-artifact-export/);
    await assert.rejects(lstat(output), /ENOENT/);
    assert.ok(
      (await readdir(temporary)).some((name) =>
        name.startsWith(".artifact.staging-"),
      ),
    );
    assert.equal(await providerInvocationCount(counter), 2);

    const finalized = run(resumeArguments);
    assert.equal(finalized.status, 0, finalized.stderr);
    assert.equal(JSON.parse(finalized.stdout).verified, true);
    assert.equal(await providerInvocationCount(counter), 2);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

for (const failurePoint of [
  "after-artifact-install",
  "before-artifact-parent-sync",
]) {
  test(`${failurePoint} recovers the installed artifact without another provider call`, async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "timeline-pilot-publish-sync-"),
    );
    const state = join(temporary, "state");
    const output = join(temporary, "artifact");
    const config = join(temporary, "config.json");
    const adapter = join(temporary, "adapter.mjs");
    const counter = join(temporary, "provider-invocations.txt");
    try {
      await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
      await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
      assert.equal(
        run([
          "start",
          "--input",
          fixture,
          "--state",
          state,
          "--config",
          config,
          "--allow-dirty",
          "--",
          process.execPath,
          adapter,
        ]).status,
        0,
      );
      const resumeArguments = [
        "resume",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--out",
        output,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ];
      const interrupted = run(resumeArguments, { failurePoint });
      assert.notEqual(interrupted.status, 0);
      assert.ok((await lstat(output)).isDirectory());
      assert.equal(await providerInvocationCount(counter), 2);

      const recovered = run(resumeArguments);
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(JSON.parse(recovered.stdout).verified, true);
      assert.equal(await providerInvocationCount(counter), 2);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

test("concurrent publication recovery never removes an active staging tree", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "timeline-pilot-publish-race-"),
  );
  const state = join(temporary, "state");
  const output = join(temporary, "artifact");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ counterPath: counter }));
    assert.equal(
      run([
        "start",
        "--input",
        fixture,
        "--state",
        state,
        "--config",
        config,
        "--allow-dirty",
        "--",
        process.execPath,
        adapter,
      ]).status,
      0,
    );
    const resumeArguments = [
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      output,
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ];
    const completed = run(resumeArguments, {
      failurePoint: "after-correction-phase-completion",
    });
    assert.notEqual(completed.status, 0);
    assert.equal(await providerInvocationCount(counter), 2);

    const results = await Promise.all([
      runAsync(resumeArguments),
      runAsync(resumeArguments),
    ]);
    assert.ok(results.some(({ status }) => status === 0));
    assert.equal(await providerInvocationCount(counter), 2);
    const verification = verify(output, temporary);
    assert.equal(verification.status, 0, verification.stderr);
    assert.equal(JSON.parse(verification.stdout).verified, true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("formal mode requires exact executable and adapter paths", () => {
  const adapter = join(root, "scripts/openai-responses-model-eval-adapter.mjs");
  assert.doesNotThrow(() =>
    validateAdapterSelection(
      { command: process.execPath, args: [adapter] },
      false,
    ),
  );
  assert.throws(
    () =>
      validateAdapterSelection(
        { command: join(tmpdir(), "node"), args: [adapter] },
        false,
      ),
    /source-bound OpenAI Responses adapter/,
  );
  assert.throws(
    () =>
      validateAdapterSelection(
        {
          command: process.execPath,
          args: ["scripts/openai-responses-model-eval-adapter.mjs"],
        },
        false,
      ),
    /source-bound OpenAI Responses adapter/,
  );
});

test("runtime binding detects changed compiled bytes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-runtime-"));
  try {
    await copyRuntimeRoot(temporary);
    const timeline = await loadTimeline();
    const binding = await captureRealModelPilotRuntime(timeline, {
      profile: "development-unbound-adapter",
      root: temporary,
    });
    assert.ok(
      binding.identity.files.some(
        ({ path }) => path === "scripts/mcp-real-model-pilot-recovery.mjs",
      ),
    );
    for (const path of [
      "scripts/mcp-real-model-pilot-phase-decision.mjs",
      "scripts/model-eval-output-schema.mjs",
    ]) {
      assert.ok(binding.identity.files.some((file) => file.path === path));
    }
    assert.ok(
      binding.identity.packages.some(({ name }) => name === "typescript"),
    );
    assert.ok(
      binding.identity.resolutions.some(
        ({ from, specifier }) =>
          from === "application" && specifier === "typescript",
      ),
    );
    const compiled = join(temporary, "packages/prototype/dist/index.js");
    await writeFile(compiled, `${await readFile(compiled, "utf8")}\n`);
    await assert.rejects(
      assertRealModelPilotRuntime(binding, timeline, { root: temporary }),
      /runtime identity changed/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("runtime binding rejects unbound module-loading syntax", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-closure-"));
  try {
    await copyRuntimeRoot(temporary);
    const sourcePath = join(temporary, "scripts/strict-json.mjs");
    const source = await readFile(sourcePath, "utf8");
    const cases = [
      {
        name: "compact ESM import",
        source:
          'import{missing}from"./runtime-closure-bypass.mjs"; void missing;',
        error: /imports unbound local module/u,
      },
      {
        name: "createRequire loader",
        source: [
          'import{createRequire as makeRequire}from"node:module";',
          "const localLoader = makeRequire(import.meta.url);",
          'localLoader("./runtime-closure-bypass.mjs");',
        ].join("\n"),
        error: /imports unbound local module/u,
      },
      {
        name: "computed CommonJS require",
        source: [
          'import{createRequire as makeRequire}from"node:module";',
          "const localLoader = makeRequire(import.meta.url);",
          'const localPath = "./runtime-closure-bypass.mjs";',
          "localLoader(localPath);",
        ].join("\n"),
        error: /computed CommonJS require/u,
      },
      {
        name: "computed dynamic import",
        source: [
          'const localPath = "./runtime-closure-bypass.mjs";',
          "await import(localPath);",
        ].join("\n"),
        error: /unsupported computed dynamic import/u,
      },
    ];

    for (const item of cases) {
      await writeFile(sourcePath, `${source}\n${item.source}\n`);
      await assert.rejects(
        capturePilotRuntime({
          profile: "development-unbound-adapter",
          root: temporary,
        }),
        item.error,
        item.name,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("runtime binding follows the resolved workspace package target", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink test is POSIX-only");
    return;
  }
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-resolve-"));
  try {
    const runtimeRoot = join(temporary, "runtime");
    const resolutionRoot = join(temporary, "resolution");
    await copyRuntimeRoot(runtimeRoot);
    const first = await fakePackage(
      temporary,
      "timeline-first",
      "@covenant-org/timeline",
      "export const marker = 'first';\n",
    );
    const second = await fakePackage(
      temporary,
      "timeline-second",
      "@covenant-org/timeline",
      "export const marker = 'second';\n",
    );
    const link = join(resolutionRoot, "node_modules/@covenant-org/timeline");
    await mkdir(join(resolutionRoot, "node_modules/@covenant-org"), {
      recursive: true,
    });
    await writeFile(join(resolutionRoot, "package.json"), '{"private":true}\n');
    await symlink(first, link, "dir");
    const binding = await capturePilotRuntime({
      profile: "development-unbound-adapter",
      root: runtimeRoot,
      resolutionRoot,
      dependencies: ["@covenant-org/timeline"],
    });
    await rm(link);
    await symlink(second, link, "dir");

    await assert.rejects(
      assertPilotRuntime(binding, { root: runtimeRoot, resolutionRoot }),
      /runtime identity changed/u,
    );
    assert.equal(JSON.stringify(binding).includes(temporary), false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("runtime binding detects changed transitive dependency bytes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-dependency-"));
  try {
    const runtimeRoot = join(temporary, "runtime");
    const resolutionRoot = join(temporary, "resolution");
    await copyRuntimeRoot(runtimeRoot);
    const dependency = await fakePackage(
      resolutionRoot,
      "node_modules/example-runtime",
      "example-runtime",
      "export const value = 1;\n",
    );
    await writeFile(join(resolutionRoot, "package.json"), '{"private":true}\n');
    const binding = await capturePilotRuntime({
      profile: "development-unbound-adapter",
      root: runtimeRoot,
      resolutionRoot,
      dependencies: ["example-runtime"],
    });
    await writeFile(join(dependency, "index.js"), "export const value = 2;\n");

    await assert.rejects(
      assertPilotRuntime(binding, { root: runtimeRoot, resolutionRoot }),
      /runtime identity changed/u,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("runtime binding detects changed verifier schema bytes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-schema-"));
  try {
    await copyRuntimeRoot(temporary);
    const binding = await capturePilotRuntime({
      profile: "development-unbound-adapter",
      root: temporary,
    });
    const schema = join(
      temporary,
      "schemas/mcp-real-model-pilot.v1.schema.json",
    );
    await writeFile(schema, `${await readFile(schema, "utf8")}\n`);

    await assert.rejects(
      assertPilotRuntime(binding, { root: temporary }),
      /runtime identity changed/u,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("bootstrap rejects a runtime mutation during dynamic loading", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-pilot-preload-"));
  try {
    const runtimeRoot = join(temporary, "runtime");
    const resolutionRoot = join(temporary, "resolution");
    await copyRuntimeRoot(runtimeRoot);
    await fakePackage(
      resolutionRoot,
      "node_modules/example-runtime",
      "example-runtime",
      "export const value = 1;\n",
    );
    await writeFile(join(resolutionRoot, "package.json"), '{"private":true}\n');
    const runtimeOptions = {
      profile: "development-unbound-adapter",
      root: runtimeRoot,
      resolutionRoot,
      dependencies: ["example-runtime"],
    };
    const binding = await capturePilotRuntime(runtimeOptions);
    const compiled = join(runtimeRoot, "packages/prototype/dist/index.js");

    await assert.rejects(
      loadBoundPilot(binding, {
        runtimeOptions,
        load: async () => {
          await writeFile(compiled, `${await readFile(compiled, "utf8")}\n`);
          return {};
        },
      }),
      /runtime identity changed/u,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

async function copyRuntimeRoot(destination) {
  await mkdir(destination, { recursive: true });
  await Promise.all([
    mkdir(join(destination, "packages/prototype"), { recursive: true }),
    mkdir(join(destination, "packages/mcp-server"), { recursive: true }),
    mkdir(join(destination, "schemas/v0alpha3"), { recursive: true }),
  ]);
  await Promise.all([
    cp(join(root, "scripts"), join(destination, "scripts"), {
      recursive: true,
    }),
    cp(
      join(root, "schemas/mcp-real-model-pilot.v1.schema.json"),
      join(destination, "schemas/mcp-real-model-pilot.v1.schema.json"),
    ),
    cp(
      join(root, "schemas/v0alpha3/common.schema.json"),
      join(destination, "schemas/v0alpha3/common.schema.json"),
    ),
    cp(
      join(root, "packages/prototype/package.json"),
      join(destination, "packages/prototype/package.json"),
    ),
    cp(
      join(root, "packages/mcp-server/package.json"),
      join(destination, "packages/mcp-server/package.json"),
    ),
    cp(
      join(root, "packages/prototype/dist"),
      join(destination, "packages/prototype/dist"),
      { recursive: true },
    ),
    cp(
      join(root, "packages/mcp-server/dist"),
      join(destination, "packages/mcp-server/dist"),
      { recursive: true },
    ),
  ]);
}

async function fakePackage(rootPath, relativePath, name, source) {
  const directory = join(rootPath, relativePath);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js" })}\n`,
    ),
    writeFile(join(directory, "index.js"), source),
  ]);
  return directory;
}

function run(args, { failurePoint, environment = {} } = {}) {
  return spawnSync(process.execPath, [driver, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      TIMELINE_PILOT_SENTINEL_SECRET: "must-not-reach-adapter",
      ...(failurePoint ? { TIMELINE_PILOT_TEST_FAILURE: failurePoint } : {}),
      ...environment,
    },
    timeout: 120_000,
  });
}

function runAsync(args, { environment = {} } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [driver, ...args], {
      cwd: root,
      env: {
        ...process.env,
        TIMELINE_PILOT_SENTINEL_SECRET: "must-not-reach-adapter",
        ...environment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status, signal) => {
      resolveResult({ status, signal, stdout, stderr });
    });
  });
}

async function waitForFile(file) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      await lstat(file);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`timed out waiting for ${file}`);
}

function verify(directory, cwd, { requireRuntimeMatch = false } = {}) {
  return spawnSync(
    process.execPath,
    [
      verifier,
      directory,
      "--allow-dirty",
      ...(requireRuntimeMatch ? ["--require-runtime-match"] : []),
    ],
    {
      cwd,
      encoding: "utf8",
      env: credentialFreeEnvironment(),
    },
  );
}

function modelConfig() {
  return {
    schema: "covenant.timeline.model-proposal-eval.config.v1",
    id: "real-model-pilot-test",
    benchmarkRevision: sourceRevision,
    adapter: { id: "fixture-adapter", version: "1" },
    model: {
      provider: "fixture",
      id: "fixture-model",
      revision: "fixture-model-r1",
    },
    generation: {
      temperature: 0,
      seed: 1,
      maxOutputTokens: 1024,
      parameters: { structuredOutput: true },
    },
  };
}

function fixtureAdapter({
  wrongInitialCoordinate = false,
  counterPath,
  failCorrection = false,
} = {}) {
  return `
import { appendFileSync, readFileSync } from "node:fs";
const request = JSON.parse(readFileSync(0, "utf8"));
if (process.env.TIMELINE_PILOT_SENTINEL_SECRET) {
  throw new Error("ambient secret reached fixture adapter");
}
${counterPath ? `appendFileSync(${JSON.stringify(counterPath)}, request.requestId + "\\n");` : ""}
const commit = "94e7af53c2224aa40762c2061ac96cab34950b71";
const initial = request.requestId.endsWith("initial-v1");
if (!initial && ${failCorrection}) throw new Error("fixture correction failure");
const proposal = initial
  ? {
      schema: "covenant.timeline.model-proposal.v1",
      requestId: request.requestId,
      changes: [
        {
          type: "coordinate",
          pointHandle: "point-publication",
          bounds: { type: "exact", value: ${wrongInitialCoordinate ? 1779957192001 : 1779957192000} },
          supports: [{
            evidenceId: "release-created",
            quote: "Covenant release v0.1.0-alpha.1 at tagged commit " + commit + " was created at 1779957192000 Unix milliseconds."
          }],
          revision: { type: "keep" }
        },
        {
          type: "coordinate",
          pointHandle: "point-readiness",
          bounds: { type: "exact", value: 1779957705698 },
          supports: [{
            evidenceId: "readiness-recorded",
            quote: "Covenant readiness evidence for tagged commit " + commit + " was generated at 1779957705698 Unix milliseconds."
          }],
          revision: { type: "keep" }
        }
      ],
      query: {
        type: "difference",
        targetHandle: "difference-readiness-minus-publication",
        knowledgeCut: { type: "current" }
      }
    }
  : {
      schema: "covenant.timeline.model-proposal.v1",
      requestId: request.requestId,
      changes: [{
        type: "coordinate",
        pointHandle: "point-publication",
        bounds: { type: "exact", value: 1779957345000 },
        supports: [{
          evidenceId: "release-published",
          quote: "GitHub authoritatively reports that Covenant release v0.1.0-alpha.1 at tagged commit " + commit + " was published at 1779957345000 Unix milliseconds."
        }],
        revision: {
          type: "supersede",
          assertionHandle: "assertion-provisional-publication"
        }
      }],
      query: {
        type: "difference",
        targetHandle: "difference-readiness-minus-publication",
        knowledgeCut: { type: "current" }
      }
    };
process.stdout.write(JSON.stringify(proposal) + "\\n");
`;
}

function rawFailureAdapter(mode, counterPath) {
  const behavior = {
    schema: 'process.stdout.write("{}\\n");',
    "null-json": 'process.stdout.write("null\\n");',
    "malformed-json": 'process.stdout.write("{\\n");',
    "invalid-framing": 'process.stdout.write("{}\\n{}\\n");',
    "error-envelope":
      'process.stdout.write(JSON.stringify({ schema: "covenant.timeline.model-eval.adapter-error.v1", error: { message: "private-envelope-secret" } }) + "\\n");',
    "invalid-utf8": "process.stdout.write(Buffer.from([0xff, 0x0a]));",
    "nonzero-exit": `
process.stdout.write("private-provider-stdout\\n");
process.stderr.write("private-provider-stderr\\n");
process.exitCode = 23;`,
    "exact-stdout-boundary": `process.stdout.write(Buffer.alloc(${REAL_MODEL_PILOT_LIMITS.adapterBytes}, 0x61));`,
    "exact-stderr-boundary": `
process.stdout.write("{}\\n");
process.stderr.write(Buffer.alloc(${REAL_MODEL_PILOT_LIMITS.adapterBytes}, 0x62));`,
    "oversized-stdout": `process.stdout.write(Buffer.alloc(${REAL_MODEL_PILOT_LIMITS.adapterBytes + 64 * 1024}, 0x61));`,
    "oversized-stderr": `
process.stdout.write("{}\\n");
process.stderr.write(Buffer.alloc(${REAL_MODEL_PILOT_LIMITS.adapterBytes + 64 * 1024}, 0x62));`,
    "aggregate-output-limit": `
process.stdout.write(Buffer.alloc(${REAL_MODEL_PILOT_LIMITS.adapterBytes + 128 * 1024}, 0x61));
process.stderr.write(Buffer.alloc(${REAL_MODEL_PILOT_LIMITS.adapterBytes + 128 * 1024}, 0x62));`,
  }[mode];
  if (!behavior) throw new Error("unknown raw adapter failure mode");
  return `
import { appendFileSync, readFileSync } from "node:fs";
const request = JSON.parse(readFileSync(0, "utf8"));
if (process.env.TIMELINE_PILOT_SENTINEL_SECRET) {
  throw new Error("must-not-reach-adapter");
}
appendFileSync(${JSON.stringify(counterPath)}, request.requestId + "\\n");
${behavior}
`;
}

function credentialFreeEnvironment() {
  const environment = {};
  for (const name of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

async function rewriteManifestEntry(directory, path, bytes) {
  const manifestPath = join(directory, "content-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entry = manifest.entries.find((candidate) => candidate.path === path);
  assert.ok(entry);
  entry.digest = sha256(bytes);
  entry.byteLength = bytes.byteLength;
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
}

async function rewriteArtifactReference({
  directory,
  field,
  path,
  document,
  timeline,
}) {
  const documentBytes = Buffer.from(`${timeline.canonicalJson(document)}\n`);
  await writeFile(join(directory, path), documentBytes);
  await rewriteManifestEntry(directory, path, documentBytes);

  const artifactPath = join(directory, "failed-attempt.json");
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  artifact[field].digest = timeline.contentDigest(document);
  const artifactBytes = Buffer.from(`${timeline.canonicalJson(artifact)}\n`);
  await writeFile(artifactPath, artifactBytes);
  await rewriteManifestEntry(directory, "failed-attempt.json", artifactBytes);
}

async function readStateAttemptEntries(state) {
  const directory = join(state, "attempt-ledger");
  const names = (await readdir(directory)).sort();
  return Promise.all(
    names.map(async (name) =>
      JSON.parse(await readFile(join(directory, name), "utf8")),
    ),
  );
}

async function assertFailedPhaseEvidence({ state, phase, stage, code }) {
  const timeline = await loadTimeline();
  const capturePath = join(state, `${phase}-adapter-execution.json`);
  const failurePath = join(state, `${phase}-failure.json`);
  const captureText = await readFile(capturePath, "utf8");
  const failureText = await readFile(failurePath, "utf8");
  const capture = JSON.parse(captureText);
  const failure = JSON.parse(failureText);
  assert.equal(captureText, `${timeline.canonicalJson(capture)}\n`);
  assert.equal(failureText, `${timeline.canonicalJson(failure)}\n`);
  assert.equal(capture.phase, phase);
  assert.equal(failure.phase, phase);
  assert.equal(failure.failure.stage, stage);
  assert.equal(failure.failure.code, code);
  assert.equal(failure.adapterExecutionDigest, timeline.contentDigest(capture));
  assert.equal(
    capture.schema,
    "covenant.timeline.real-model-pilot.adapter-execution.v2",
  );
  assert.equal(
    failure.schema,
    "covenant.timeline.real-model-pilot.phase-failure.v2",
  );
  assert.deepEqual(Object.keys(failure.failure).sort(), ["code", "stage"]);
  assert.equal(
    capture.redactedRequest.input.evidence.every(
      (entry) => !Object.hasOwn(entry, "text"),
    ),
    true,
  );
  assert.equal(typeof capture.redactedRequest.prompt.digest, "string");
  for (const stream of [capture.execution.stdout, capture.execution.stderr]) {
    const bytes = Buffer.from(stream.base64, "base64");
    assert.equal(bytes.byteLength, stream.byteLength);
    assert.equal(sha256(bytes), stream.digest);
  }
  const entries = await readStateAttemptEntries(state);
  const terminal = entries.at(-1);
  assert.equal(terminal.kind, "phase-failed");
  assert.equal(
    terminal.schema,
    "covenant.timeline.formal-attempt-ledger.entry.v2",
  );
  assert.equal(terminal.failureStage, stage);
  assert.equal(terminal.failureCode, code);
  assert.equal(
    terminal.adapterExecutionDigest,
    timeline.contentDigest(capture),
  );
  assert.equal(terminal.failureBundleDigest, timeline.contentDigest(failure));
  assert.equal((await lstat(capturePath)).mode & 0o777, 0o600);
  assert.equal((await lstat(failurePath)).mode & 0o777, 0o600);
  await assert.rejects(lstat(join(state, `${phase}-result.json`)), /ENOENT/u);
  return { capture, failure, terminal };
}

async function providerInvocationCount(path) {
  return (await readFile(path, "utf8")).trim().split("\n").length;
}

async function rewriteAttemptLedgerBinding(
  directory,
  timeline,
  mutate,
  phaseResultDigests,
) {
  const path = join(directory, "attempt-ledger.json");
  const ledger = JSON.parse(await readFile(path, "utf8"));
  mutate(ledger.entries[0].binding);
  if (phaseResultDigests) {
    ledger.entries[2].resultBundleDigest = phaseResultDigests.initial;
    ledger.entries[4].resultBundleDigest = phaseResultDigests.correction;
  }
  for (const [index, entry] of ledger.entries.entries()) {
    entry.previousEntryDigest =
      index === 0 ? null : ledger.entries[index - 1].recordDigest;
    const { recordDigest: _recordDigest, ...unsigned } = entry;
    entry.recordDigest = timeline.contentDigest(unsigned);
  }
  const bytes = Buffer.from(`${JSON.stringify(ledger)}\n`);
  await writeFile(path, bytes);
  await rewriteManifestEntry(directory, "attempt-ledger.json", bytes);
  return timeline.contentDigest(ledger);
}

async function rewritePhaseResultRuntime(
  directory,
  timeline,
  runtime,
  runtimeDigest,
) {
  const digests = {};
  for (const phase of ["initial", "correction"]) {
    const relative = `phase-results/${phase}.json`;
    const path = join(directory, relative);
    const bundle = JSON.parse(await readFile(path, "utf8"));
    bundle.binding.runtimeDigest = runtimeDigest;
    bundle.runtime = runtime;
    const bytes = Buffer.from(`${JSON.stringify(bundle)}\n`);
    await writeFile(path, bytes);
    await rewriteManifestEntry(directory, relative, bytes);
    digests[phase] = timeline.contentDigest(bundle);
  }
  return digests;
}

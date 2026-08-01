import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  exportFailedAttempt,
  verifyFailedAttempt,
} from "./mcp-real-model-pilot-failure-artifact.mjs";
import { loadTimeline, sha256 } from "./mcp-agent-pilot-lib.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const driver = join(root, "scripts/mcp-real-model-pilot-bootstrap.mjs");
const fixture = join(root, "examples/mcp-real-model-pilot");
const sourceRevision = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).stdout.trim();

test("exports and verifies a reconstructed proposal failure", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "timeline-reconstructed-fence-"),
  );
  const state = join(temporary, "state");
  const output = join(temporary, "failed-attempt");
  const config = join(temporary, "config.json");
  const adapter = join(temporary, "adapter.mjs");
  const counter = join(temporary, "provider-invocations.txt");
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, adapterSource(counter));

    const started = run(
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
      { failurePoint: "after-initial-proposal-preview" },
    );
    assert.notEqual(started.status, 0);

    const resumed = run([
      "resume",
      "--input",
      fixture,
      "--state",
      state,
      "--config",
      config,
      "--out",
      join(temporary, "successful-attempt"),
      "--allow-dirty",
      "--",
      process.execPath,
      adapter,
    ]);
    assert.notEqual(resumed.status, 0);
    assert.equal(
      (await readFile(counter, "utf8")).trim().split("\n").length,
      1,
    );

    const exported = await exportFailedAttempt({ state, output });
    assert.deepEqual(exported.failure, {
      stage: "admission-recovery",
      code: "proposal.interrupted-before-admission",
    });
    assert.deepEqual(await verifyFailedAttempt(output), {
      verified: true,
      schema: "covenant.timeline.real-model-pilot.failed-attempt.v2",
      phase: "initial",
      failure: exported.failure,
      rawAdapterStreams: "committed-not-disclosed",
    });

    const artifact = await readJson(join(output, "failed-attempt.json"));
    const failure = await readJson(join(output, "phase-failure.json"));
    const recovery = await readJson(join(output, "recovery-observation.json"));
    const decision = await readJson(join(output, "phase-decision.json"));
    assert.equal(artifact.proposalReady.path, "proposal-ready.json");
    assert.equal(artifact.phaseDecision.path, "phase-decision.json");
    assert.match(failure.proposalReadyDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(failure.phaseDecisionDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(decision.decision, "recovery-terminal");
    assert.equal(recovery.disposition, "exact-recovery-fence");
    assert.equal(
      recovery.mcpRun.events.at(-1).id,
      "event-initial-admission-recovery-fenced",
    );
    assert.deepEqual((await readdir(output)).sort(), [
      "adapter-execution.json",
      "attempt-ledger.json",
      "content-manifest.json",
      "failed-attempt.json",
      "phase-decision.json",
      "phase-failure.json",
      "proposal-ready.json",
      "recovery-observation.json",
    ]);
    assert.equal(
      (await lstat(join(output, "proposal-ready.json"))).isFile(),
      true,
    );
    assert.equal(
      (await lstat(join(output, "phase-decision.json"))).isFile(),
      true,
    );

    const runtimeTamper = join(temporary, "failed-attempt-runtime-tamper");
    await cp(output, runtimeTamper, { recursive: true });
    await rehashMcpInvocationTamper(runtimeTamper);
    await assert.rejects(
      verifyFailedAttempt(runtimeTamper),
      /MCP invocation runtime binding changed/u,
    );

    const runtimeShapeTamper = join(
      temporary,
      "failed-attempt-runtime-shape-tamper",
    );
    await cp(output, runtimeShapeTamper, { recursive: true });
    await rehashArtifactTamper(
      runtimeShapeTamper,
      ({ artifact, capture, ledger, timeline }) => {
        capture.runtime.node.executableByteLength = 0;
        capture.binding.runtimeDigest = timeline.contentDigest(capture.runtime);
        artifact.binding.runtimeDigest = capture.binding.runtimeDigest;
        ledger.entries[0].binding.runtimeDigest = capture.binding.runtimeDigest;
      },
    );
    await assert.rejects(
      verifyFailedAttempt(runtimeShapeTamper),
      /redacted adapter runtime is invalid/u,
    );

    const utf8Tamper = join(temporary, "failed-attempt-utf8-tamper");
    await cp(output, utf8Tamper, { recursive: true });
    const artifactPath = join(utf8Tamper, "failed-attempt.json");
    const artifactBytes = await readFile(artifactPath);
    const marker = Buffer.from("raw-adapter-streams");
    const markerOffset = artifactBytes.indexOf(marker);
    assert.notEqual(markerOffset, -1);
    artifactBytes[markerOffset] = 0xff;
    await writeFile(artifactPath, artifactBytes);
    await assert.rejects(verifyFailedAttempt(utf8Tamper), /UTF-8/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function run(args, { failurePoint } = {}) {
  return spawnSync(process.execPath, [driver, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      TIMELINE_PILOT_SENTINEL_SECRET: "must-not-reach-adapter",
      ...(failurePoint ? { TIMELINE_PILOT_TEST_FAILURE: failurePoint } : {}),
    },
    timeout: 120_000,
  });
}

async function rehashMcpInvocationTamper(directory) {
  await rehashArtifactTamper(directory, ({ capture, ledger }) => {
    const replacement = `sha256:${"0".repeat(64)}`;
    assert.notEqual(capture.mcpInvocation.executableDigest, replacement);
    capture.mcpInvocation.executableDigest = replacement;
    ledger.entries.at(-2).mcpInvocation.executableDigest = replacement;
  });
}

async function rehashArtifactTamper(directory, mutate) {
  const timeline = await loadTimeline();
  const capturePath = join(directory, "adapter-execution.json");
  const ledgerPath = join(directory, "attempt-ledger.json");
  const artifactPath = join(directory, "failed-attempt.json");
  const manifestPath = join(directory, "content-manifest.json");
  const capture = await readJson(capturePath);
  const ledger = await readJson(ledgerPath);
  const artifact = await readJson(artifactPath);
  mutate({ artifact, capture, ledger, timeline });
  let previousEntryDigest = null;
  for (const entry of ledger.entries) {
    entry.previousEntryDigest = previousEntryDigest;
    const { recordDigest: _recordDigest, ...unsigned } = entry;
    entry.recordDigest = timeline.contentDigest(unsigned);
    previousEntryDigest = entry.recordDigest;
  }
  await writeJson(capturePath, capture, timeline);
  await writeJson(ledgerPath, ledger, timeline);
  artifact.adapterExecution.digest = timeline.contentDigest(capture);
  artifact.attemptLedger.digest = timeline.contentDigest(ledger);
  await writeJson(artifactPath, artifact, timeline);

  const manifest = await readJson(manifestPath);
  for (const entry of manifest.entries) {
    const bytes = await readFile(join(directory, entry.path));
    entry.byteLength = bytes.byteLength;
    entry.digest = sha256(bytes);
  }
  await writeJson(manifestPath, manifest, timeline);
}

async function writeJson(path, document, timeline) {
  await writeFile(path, `${timeline.canonicalJson(document)}\n`);
}

function modelConfig() {
  return {
    schema: "covenant.timeline.model-proposal-eval.config.v1",
    id: "failed-artifact-pre-ready-fence-test",
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

function adapterSource(counter) {
  return `
import { appendFileSync, readFileSync } from "node:fs";
const request = JSON.parse(readFileSync(0, "utf8"));
if (process.env.TIMELINE_PILOT_SENTINEL_SECRET) {
  throw new Error("ambient secret reached fixture adapter");
}
appendFileSync(${JSON.stringify(counter)}, request.requestId + "\\n");
const commit = "94e7af53c2224aa40762c2061ac96cab34950b71";
const proposal = {
  schema: "covenant.timeline.model-proposal.v1",
  requestId: request.requestId,
  changes: [
    {
      type: "coordinate",
      pointHandle: "point-publication",
      bounds: { type: "exact", value: 1779957192000 },
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
};
process.stdout.write(JSON.stringify(proposal) + "\\n");
`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

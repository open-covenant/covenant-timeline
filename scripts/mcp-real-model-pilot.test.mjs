import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  REAL_MODEL_PILOT_LIMITS,
  assertRealModelPilotRuntime,
  captureRealModelPilotRuntime,
} from "./mcp-real-model-pilot-lib.mjs";
import { loadBoundPilot } from "./mcp-real-model-pilot-bootstrap.mjs";
import {
  assertPilotRuntime,
  capturePilotRuntime,
} from "./mcp-real-model-pilot-runtime.mjs";
import { validateAdapterSelection } from "./mcp-real-model-pilot.mjs";
import { loadTimeline, sha256 } from "./mcp-agent-pilot-lib.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const driver = join(root, "scripts/mcp-real-model-pilot-bootstrap.mjs");
const verifier = join(
  root,
  "scripts/mcp-real-model-pilot-verify-bootstrap.mjs",
);
const fixture = join(root, "examples/mcp-real-model-pilot");
const sourceRevision = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).stdout.trim();

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
    assert.match(report.contentManifestDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(report.runtimeDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(report.runtimeMatched, true);
    assert.equal(report.historicalCutPreserved, true);
    assert.equal(report.sourceTextAbsentFromMcpState, true);
    assert.equal(report.receiptCount, 3);
    assert.equal(report.initialDifference, 513698);
    assert.equal(report.correctedDifference, 360698);

    const artifact = JSON.parse(
      await readFile(join(output, "artifact.json"), "utf8"),
    );
    assert.equal(artifact.operation, "maintainer-operated");
    assert.ok(artifact.limitations.includes("not-independent-adoption"));
    assert.notEqual(
      artifact.invocations[0].processId,
      artifact.invocations[1].processId,
    );
    const runText = await readFile(join(output, "run.json"), "utf8");
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
      /events do not match the admitted run slice/,
    );

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
  try {
    await writeFile(config, `${JSON.stringify(modelConfig())}\n`);
    await writeFile(adapter, fixtureAdapter({ wrongInitialCoordinate: true }));
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
    assert.match(
      result.stderr,
      /coordinate does not match normalized evidence/,
    );
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

function run(args) {
  return spawnSync(process.execPath, [driver, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      TIMELINE_PILOT_SENTINEL_SECRET: "must-not-reach-adapter",
    },
    timeout: 120_000,
  });
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

function fixtureAdapter({ wrongInitialCoordinate = false } = {}) {
  return `
import { readFileSync } from "node:fs";
const request = JSON.parse(readFileSync(0, "utf8"));
if (process.env.TIMELINE_PILOT_SENTINEL_SECRET) {
  throw new Error("ambient secret reached fixture adapter");
}
const commit = "94e7af53c2224aa40762c2061ac96cab34950b71";
const initial = request.requestId.endsWith("initial-v1");
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

import { opendir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertArtifactDirectory,
  canonicalArtifactRoot,
  decodeUtf8,
  exactRecord,
  loadTimeline,
  MCP_AGENT_PILOT_LIMITS,
  readBoundedArtifactFile,
  resolveInside,
  safeEvidenceName,
  safeName,
  sha256,
  sourceIdentity,
} from "./mcp-agent-pilot-lib.mjs";

const MCP_ADMISSION = Object.freeze({
  mode: "structural-only",
  assertionAuthority: "unverified",
  evidencePayloads: "external",
});
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export async function verifyMcpAgentPilot(directory) {
  const root = await canonicalArtifactRoot(directory);
  const timeline = await loadTimeline();
  const artifact = parseArtifact(
    await readCanonicalJson(
      root,
      join(root, "artifact.json"),
      timeline,
      "artifact manifest",
      MCP_AGENT_PILOT_LIMITS.maxArtifactBytes,
    ),
  );
  const run = timeline.parseRunDocumentV0Alpha3(
    await readCanonicalJson(
      root,
      resolveInside(root, artifact.run, "run path"),
      timeline,
      "run",
      MCP_AGENT_PILOT_LIMITS.maxRunBytes,
    ),
  );
  const runDigest = timeline.contentDigest(run);
  if (runDigest !== artifact.runDigest) {
    throw new Error("artifact run digest does not match the run");
  }

  const evidenceManifest = parseEvidenceManifest(
    await readCanonicalJson(
      root,
      resolveInside(root, artifact.evidenceManifest, "evidence manifest path"),
      timeline,
      "evidence manifest",
      MCP_AGENT_PILOT_LIMITS.maxEvidenceManifestBytes,
    ),
  );
  const evidenceDigests = await verifyEvidence(root, evidenceManifest);
  const referencedEvidence = collectEvidenceRefs(run);
  if (
    referencedEvidence.size !== evidenceDigests.size ||
    [...referencedEvidence].some((digest) => !evidenceDigests.has(digest))
  ) {
    throw new Error(
      "run and evidence manifest do not have exact digest coverage",
    );
  }

  const environment = await readCanonicalJson(
    root,
    resolveInside(root, artifact.environment, "environment path"),
    timeline,
    "environment",
    MCP_AGENT_PILOT_LIMITS.maxEnvironmentBytes,
  );
  const source = verifyEnvironment(environment);
  const transcript = await readTranscript(
    root,
    resolveInside(root, artifact.transcript, "transcript path"),
    timeline,
  );

  const verifiedConclusions = [];
  const queryBudget = budget(
    MCP_AGENT_PILOT_LIMITS.maxQueryTotalBytes,
    "queries",
  );
  const conclusionBudget = budget(
    MCP_AGENT_PILOT_LIMITS.maxConclusionTotalBytes,
    "conclusions",
  );
  for (const entry of artifact.conclusions) {
    const query = timeline.parseQueryV0Alpha3(
      await readCanonicalJson(
        root,
        resolveInside(root, entry.query, `${entry.name} query path`),
        timeline,
        `${entry.name} query`,
        MCP_AGENT_PILOT_LIMITS.maxQueryBytes,
        queryBudget,
      ),
      run,
    );
    const conclusion = await readCanonicalJson(
      root,
      resolveInside(root, entry.conclusion, `${entry.name} conclusion path`),
      timeline,
      `${entry.name} conclusion`,
      MCP_AGENT_PILOT_LIMITS.maxConclusionBytes,
      conclusionBudget,
    );
    if (!timeline.verifyTemporalConclusionV0Alpha3(run, query, conclusion)) {
      throw new Error(`${entry.name} conclusion proof did not verify`);
    }
    const recomputed = timeline.reasonTemporalQueryV0Alpha3(run, query);
    if (
      timeline.canonicalJson(recomputed) !== timeline.canonicalJson(conclusion)
    ) {
      throw new Error(`${entry.name} conclusion did not reproduce`);
    }
    verifiedConclusions.push({
      name: entry.name,
      query,
      conclusion,
    });
  }

  verifyCorrectionScenario(run, verifiedConclusions, timeline);
  verifyTranscriptBinding(transcript, run, verifiedConclusions, timeline);
  const verifierSource = sourceIdentity();

  const conclusions = verifiedConclusions.map(
    ({ name, query, conclusion }) => ({
      name,
      recordedThrough: query.recordedThrough,
      stateDigest: conclusion.receipt.stateDigest,
      resultDigest: conclusion.receipt.semanticResultDigest,
    }),
  );

  return {
    schema: "covenant.timeline.mcp-agent-pilot.verification.v1",
    verified: true,
    runDigest,
    eventCount: run.events.length,
    evidenceCount: evidenceDigests.size,
    toolCallCount: transcript.length,
    historicalCutVerified: true,
    generationSourceRevision: source.revision,
    generationSourceDirty: source.dirty,
    verifierSourceRevision: verifierSource.revision,
    verifierSourceDirty: verifierSource.dirty,
    generationSourceMatchesVerifier:
      source.revision === verifierSource.revision &&
      source.dirty === verifierSource.dirty,
    conclusions,
  };
}

async function readCanonicalJson(
  root,
  path,
  timeline,
  label,
  maxBytes,
  aggregate,
) {
  const bytes = await readBoundedArtifactFile(
    root,
    path,
    maxBytes,
    label,
    aggregate ? (byteLength) => consume(aggregate, byteLength) : undefined,
  );
  const text = decodeUtf8(bytes, label);
  const value = timeline.parseJson(text);
  if (text !== `${timeline.canonicalJson(value)}\n`) {
    throw new Error(`${label} is not canonical JSON`);
  }
  return value;
}

function parseArtifact(value) {
  const artifact = exactRecord(
    value,
    [
      "schema",
      "id",
      "run",
      "runDigest",
      "evidenceManifest",
      "environment",
      "transcript",
      "conclusions",
    ],
    "artifact manifest",
  );
  if (artifact.schema !== "covenant.timeline.mcp-agent-pilot.artifact.v1") {
    throw new Error("artifact schema is invalid");
  }
  safeName(artifact.id, "artifact ID");
  if (
    typeof artifact.runDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(artifact.runDigest) ||
    !Array.isArray(artifact.conclusions) ||
    artifact.conclusions.length < 2 ||
    artifact.conclusions.length > MCP_AGENT_PILOT_LIMITS.maxConclusions
  ) {
    throw new Error("artifact manifest is invalid");
  }
  const names = new Set();
  artifact.conclusions = artifact.conclusions.map((value, index) => {
    const entry = exactRecord(
      value,
      ["name", "query", "conclusion"],
      `conclusion ${index}`,
    );
    safeName(entry.name, `conclusion ${index} name`);
    if (names.has(entry.name))
      throw new Error("conclusion names are duplicated");
    names.add(entry.name);
    return entry;
  });
  return artifact;
}

function parseEvidenceManifest(value) {
  const manifest = exactRecord(
    value,
    ["schema", "entries"],
    "evidence manifest",
  );
  if (
    manifest.schema !== "covenant.timeline.mcp-agent-pilot.evidence.v1" ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length === 0 ||
    manifest.entries.length > MCP_AGENT_PILOT_LIMITS.maxEvidenceFiles
  ) {
    throw new Error("evidence manifest is invalid");
  }
  return manifest;
}

async function verifyEvidence(root, manifest) {
  const directory = join(root, "evidence");
  await assertArtifactDirectory(root, directory, "evidence directory");
  const files = [];
  const handle = await opendir(directory);
  for await (const entry of handle) {
    if (
      files.length >= MCP_AGENT_PILOT_LIMITS.maxEvidenceFiles ||
      !entry.isFile()
    ) {
      throw new Error(
        "evidence directory exceeds its file limit or is invalid",
      );
    }
    safeEvidenceName(entry.name, "evidence filename");
    files.push(entry.name);
  }
  files.sort();
  const entries = [...manifest.entries].sort((left, right) =>
    String(left.path).localeCompare(String(right.path)),
  );
  if (
    files.length !== entries.length ||
    files.some((name, index) => `evidence/${name}` !== entries[index]?.path)
  ) {
    throw new Error("evidence directory and manifest disagree");
  }

  const digests = new Set();
  const evidenceBudget = budget(
    MCP_AGENT_PILOT_LIMITS.maxEvidenceTotalBytes,
    "evidence",
  );
  for (const value of entries) {
    const entry = exactRecord(
      value,
      ["path", "digest", "byteLength"],
      "evidence entry",
    );
    if (typeof entry.path !== "string" || !entry.path.startsWith("evidence/")) {
      throw new Error("evidence path is invalid");
    }
    const name = entry.path.slice("evidence/".length);
    safeEvidenceName(name, "evidence filename");
    if (entry.path !== `evidence/${name}`) {
      throw new Error("evidence path is invalid");
    }
    const path = resolveInside(root, entry.path, "evidence path");
    const bytes = await readBoundedArtifactFile(
      root,
      path,
      MCP_AGENT_PILOT_LIMITS.maxEvidenceFileBytes,
      "evidence entry",
      (byteLength) => consume(evidenceBudget, byteLength),
    );
    if (
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0 ||
      bytes.byteLength !== entry.byteLength ||
      sha256(bytes) !== entry.digest ||
      digests.has(entry.digest)
    ) {
      throw new Error("evidence entry does not match its bytes");
    }
    digests.add(entry.digest);
  }
  return digests;
}

function collectEvidenceRefs(run) {
  const refs = new Set();
  for (const event of run.events) {
    const values =
      "assertion" in event
        ? event.assertion.evidenceRefs
        : "evidenceRefs" in event
          ? event.evidenceRefs
          : [];
    for (const ref of values) refs.add(ref);
  }
  return refs;
}

function verifyEnvironment(value) {
  const environment = exactRecord(
    value,
    [
      "schema",
      "platform",
      "architecture",
      "nodeVersion",
      "source",
      "timelinePackage",
      "mcpPackage",
      "serverRestarted",
      "serverSessions",
      "commandExitStatus",
    ],
    "environment",
  );
  if (
    environment.schema !== "covenant.timeline.mcp-agent-pilot.environment.v1" ||
    environment.serverRestarted !== true ||
    environment.serverSessions !== 2 ||
    environment.commandExitStatus !== 0
  ) {
    throw new Error("environment does not record a successful restart");
  }
  if (
    !boundedToken(environment.platform, 32) ||
    !boundedToken(environment.architecture, 32) ||
    typeof environment.nodeVersion !== "string" ||
    !environment.nodeVersion.startsWith("v") ||
    !isSemver(environment.nodeVersion.slice(1))
  ) {
    throw new Error("environment runtime identity is invalid");
  }
  const source = exactRecord(
    environment.source,
    ["revision", "dirty"],
    "source",
  );
  if (
    typeof source.revision !== "string" ||
    !/^[0-9a-f]{40}$/.test(source.revision) ||
    typeof source.dirty !== "boolean"
  ) {
    throw new Error("source identity is invalid");
  }
  verifyPackageIdentity(
    environment.timelinePackage,
    "@covenant-org/timeline",
    "Timeline package",
  );
  verifyPackageIdentity(
    environment.mcpPackage,
    "@covenant-org/timeline-mcp",
    "MCP package",
  );
  return source;
}

function verifyPackageIdentity(value, expectedName, label) {
  const identity = exactRecord(value, ["name", "version"], label);
  if (
    identity.name !== expectedName ||
    typeof identity.version !== "string" ||
    !isSemver(identity.version)
  ) {
    throw new Error(`${label} identity is invalid`);
  }
}

function boundedToken(value, maxLength) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^[a-z0-9][a-z0-9._-]*$/.test(value)
  );
}

function isSemver(value) {
  return typeof value === "string" && value.length <= 128 && SEMVER.test(value);
}

async function readTranscript(root, path, timeline) {
  const bytes = await readBoundedArtifactFile(
    root,
    path,
    MCP_AGENT_PILOT_LIMITS.maxTranscriptBytes,
    "tool transcript",
  );
  if (bytes.at(-1) !== 0x0a) throw new Error("tool transcript is truncated");
  let lineCount = 0;
  for (const byte of bytes) {
    if (byte === 0x0a) lineCount += 1;
    if (lineCount > MCP_AGENT_PILOT_LIMITS.maxTranscriptLines) {
      throw new Error("tool transcript exceeds its line limit");
    }
  }
  const text = decodeUtf8(bytes, "tool transcript");
  const lines = text.slice(0, -1).split("\n");
  if (lines.length === 0) throw new Error("tool transcript is empty");
  return lines.map((line, index) => {
    const value = timeline.parseJson(line);
    if (line !== timeline.canonicalJson(value)) {
      throw new Error("tool transcript is not canonical JSONL");
    }
    const entry = exactRecord(
      value,
      ["sequence", "session", "tool", "arguments", "result"],
      `tool call ${index}`,
    );
    if (
      entry.sequence !== index ||
      !Number.isSafeInteger(entry.session) ||
      (entry.session !== 1 && entry.session !== 2) ||
      typeof entry.tool !== "string"
    ) {
      throw new Error("tool transcript ordering is invalid");
    }
    return entry;
  });
}

function verifyCorrectionScenario(run, records, timeline) {
  const semanticQuery = querySemantics(records[0].query);
  for (const { query } of records.slice(1)) {
    assertSameJson(
      timeline,
      querySemantics(query),
      semanticQuery,
      "pilot queries do not ask the same semantic question",
    );
  }

  const latestCut = run.events.length - 1;
  const current = records.find(
    ({ query }) => query.recordedThrough === latestCut,
  );
  const historical = records.filter(
    ({ query }) =>
      typeof query.recordedThrough === "number" &&
      query.recordedThrough < latestCut,
  );
  if (historical.length === 0 || !current) {
    throw new Error(
      "pilot must verify both a historical cut and the corrected current cut",
    );
  }

  const candidates = historical.map((record) => ({
    record,
    hasCorrection: hasTargetingCorrection(run, record.query, timeline),
  }));
  if (
    candidates.some(
      ({ record, hasCorrection }) =>
        hasCorrection &&
        record.conclusion.receipt.stateDigest !==
          current.conclusion.receipt.stateDigest &&
        record.conclusion.receipt.semanticResultDigest !==
          current.conclusion.receipt.semanticResultDigest,
    )
  ) {
    return;
  }
  if (!candidates.some(({ hasCorrection }) => hasCorrection)) {
    throw new Error(
      "pilot requires a post-historical-cut retraction or supersession",
    );
  }
  throw new Error("pilot does not demonstrate a temporal state change");
}

function hasTargetingCorrection(run, query, timeline) {
  const historicalState = timeline.projectTemporalStateV0Alpha3(
    run,
    query.contextId,
    query.recordedThrough,
  );
  const activeAssertions = new Set(
    [
      ...historicalState.coordinates,
      ...historicalState.constraints,
      ...historicalState.facts,
    ].map(({ id }) => id),
  );
  return run.events.slice(query.recordedThrough + 1).some((event) => {
    if (event.type === "assertion.retracted") {
      return activeAssertions.has(event.assertionId);
    }
    return (
      "assertion" in event &&
      event.assertion.supersedes?.some((id) => activeAssertions.has(id)) ===
        true
    );
  });
}

function verifyTranscriptBinding(entries, run, records, timeline) {
  let callIndex = 0;
  let eventIndex = 0;
  const create = requireCall(entries, callIndex++, "timeline_create_run", 1);
  assertSameJson(
    timeline,
    create.arguments,
    { contract: run.contract },
    "create call does not match the exported contract",
  );
  assertSameJson(
    timeline,
    create.result,
    {
      created: true,
      timeline: timelineMetadata(run, 0, timeline),
      admission: MCP_ADMISSION,
    },
    "create result does not match the empty exported run",
  );

  while (entries[callIndex]?.session === 1) {
    verifyAppendCall(entries[callIndex], run, eventIndex, 1, timeline);
    callIndex += 1;
    eventIndex += 1;
  }
  if (eventIndex === 0 || eventIndex >= run.events.length) {
    throw new Error(
      "tool transcript does not contain a valid restart boundary",
    );
  }

  const listed = requireCall(entries, callIndex++, "timeline_list_runs", 2);
  assertSameJson(
    timeline,
    listed.arguments,
    {},
    "list call arguments are invalid",
  );
  assertSameJson(
    timeline,
    listed.result,
    {
      timelines: [timelineMetadata(run, eventIndex, timeline)],
      nextCursor: null,
    },
    "list result does not recover the pre-restart run",
  );

  while (eventIndex < run.events.length) {
    verifyAppendCall(entries[callIndex], run, eventIndex, 2, timeline);
    callIndex += 1;
    eventIndex += 1;
  }

  const finalTimeline = timelineMetadata(run, run.events.length, timeline);
  for (const { query, conclusion } of records) {
    const projected = requireCall(
      entries,
      callIndex++,
      "timeline_project_state",
      2,
    );
    assertSameJson(
      timeline,
      projected.arguments,
      {
        runId: run.contract.id,
        contextId: query.contextId,
        recordedThrough: query.recordedThrough,
      },
      "project call does not match its exported query",
    );
    assertSameJson(
      timeline,
      projected.result,
      {
        timeline: finalTimeline,
        state: timeline.projectTemporalStateV0Alpha3(
          run,
          query.contextId,
          query.recordedThrough,
        ),
      },
      "project result does not match the exported run and query",
    );

    const reasoned = requireCall(entries, callIndex++, "timeline_reason", 2);
    assertSameJson(
      timeline,
      reasoned.arguments,
      {
        runId: run.contract.id,
        query: queryDraft(query),
      },
      "reason call does not match its exported query",
    );
    assertSameJson(
      timeline,
      reasoned.result,
      {
        timeline: finalTimeline,
        query,
        conclusion,
        verified: true,
      },
      "reason result does not match its exported conclusion",
    );
  }

  if (callIndex !== entries.length) {
    throw new Error("tool transcript contains unexpected calls");
  }
}

function verifyAppendCall(entry, run, eventIndex, session, timeline) {
  const call = requireEntry(entry, "timeline_append_event", session);
  const event = run.events[eventIndex];
  if (!event) {
    throw new Error("tool transcript contains too many append calls");
  }
  const before = timelineMetadata(run, eventIndex, timeline);
  const after = timelineMetadata(run, eventIndex + 1, timeline);
  const draft = structuredClone(event);
  delete draft.schema;
  delete draft.sequence;
  assertSameJson(
    timeline,
    call.arguments,
    {
      runId: run.contract.id,
      expectedRunDigest: before.runDigest,
      event: draft,
    },
    `append call ${eventIndex} does not match the exported event or digest chain`,
  );
  assertSameJson(
    timeline,
    call.result,
    {
      appended: true,
      event,
      timeline: after,
      admission: MCP_ADMISSION,
    },
    `append result ${eventIndex} does not match the exported run`,
  );
}

function requireCall(entries, index, tool, session) {
  return requireEntry(entries[index], tool, session);
}

function requireEntry(entry, tool, session) {
  if (!entry || entry.tool !== tool || entry.session !== session) {
    throw new Error(
      `tool transcript expected ${tool} in server session ${session}`,
    );
  }
  return entry;
}

function timelineMetadata(run, eventCount, timeline) {
  const prefix = {
    schema: run.schema,
    contract: run.contract,
    events: run.events.slice(0, eventCount),
  };
  return {
    runId: run.contract.id,
    revision: eventCount,
    subject: run.contract.subject,
    contexts: run.contract.contexts,
    eventCount,
    latestRecordedThrough: eventCount === 0 ? null : eventCount - 1,
    runDigest: timeline.contentDigest(prefix),
  };
}

function queryDraft(query) {
  const draft = structuredClone(query);
  delete draft.schema;
  return draft;
}

function querySemantics(query) {
  const semantics = structuredClone(query);
  delete semantics.schema;
  delete semantics.id;
  delete semantics.recordedThrough;
  return semantics;
}

function assertSameJson(timeline, actual, expected, message) {
  if (timeline.canonicalJson(actual) !== timeline.canonicalJson(expected)) {
    throw new Error(message);
  }
}

function budget(maxBytes, label) {
  return { maxBytes, usedBytes: 0, label };
}

function consume(value, byteLength) {
  if (!value) return;
  value.usedBytes += byteLength;
  if (value.usedBytes > value.maxBytes) {
    throw new Error(`${value.label} exceed their aggregate byte limit`);
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  const directory = process.argv[2];
  if (!directory || process.argv.length !== 3) {
    process.stderr.write(
      "usage: mcp-agent-pilot-verify <artifact-directory>\n",
    );
    process.exitCode = 1;
  } else {
    verifyMcpAgentPilot(directory)
      .then((report) => {
        process.stdout.write(`${JSON.stringify(report)}\n`);
      })
      .catch((error) => {
        process.stderr.write(
          `mcp-agent-pilot-verify: ${
            error instanceof Error ? error.message : "failed"
          }\n`,
        );
        process.exitCode = 1;
      });
  }
}

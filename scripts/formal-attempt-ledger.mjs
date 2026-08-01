import { randomUUID } from "node:crypto";
import { link, mkdir, open, opendir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { readBoundedExactFile } from "./mcp-agent-pilot-lib.mjs";

const LEDGER_SCHEMA = "covenant.timeline.formal-attempt-ledger.v1";
const ENTRY_SCHEMA = "covenant.timeline.formal-attempt-ledger.entry.v1";
const LEDGER_DIRECTORY = "attempt-ledger";
const LEDGER_STAGING_DIRECTORY = ".attempt-ledger-staging";
const ENTRY_BYTES = 64 * 1024;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^[0-9a-f]{40}$/u;
const PHASES = new Set(["initial", "correction"]);

export async function createAttemptLedger(state, binding, timeline) {
  validateBinding(binding);
  const directory = join(state, LEDGER_DIRECTORY);
  const stagingDirectory = join(state, LEDGER_STAGING_DIRECTORY);
  await mkdir(directory, { mode: 0o700 });
  await mkdir(stagingDirectory, { mode: 0o700 });
  await syncDirectory(state);
  const ledger = {
    directory,
    stagingDirectory,
    timeline,
    document: {
      schema: LEDGER_SCHEMA,
      attemptId: randomUUID(),
      entries: [],
    },
  };
  await appendEntry(ledger, {
    kind: "attempt-opened",
    binding: structuredClone(binding),
  });
  return ledger;
}

export async function loadAttemptLedger(state, timeline) {
  const directory = join(state, LEDGER_DIRECTORY);
  const stagingDirectory = join(state, LEDGER_STAGING_DIRECTORY);
  await validateStagingDirectory(stagingDirectory);
  const names = [];
  const handle = await opendir(directory);
  for await (const entry of handle) {
    if (!entry.isFile() || !/^00[0-4]\.json$/u.test(entry.name)) {
      throw new Error("attempt ledger entries must be real files");
    }
    names.push(entry.name);
    if (names.length > 5) {
      throw new Error("attempt ledger has an invalid entry count");
    }
  }
  names.sort();
  if (names.length === 0 || names.length > 5) {
    throw new Error("attempt ledger has an invalid entry count");
  }
  const entries = [];
  for (const [index, name] of names.entries()) {
    const bytes = await readBoundedExactFile(
      join(directory, name),
      ENTRY_BYTES,
      "attempt ledger entry",
      { root: directory, scope: "the attempt ledger" },
    );
    if (bytes.byteLength === 0) {
      throw new Error("attempt ledger entry has an invalid byte length");
    }
    const text = bytes.toString("utf8");
    const entry = timeline.parseJson(text);
    if (text !== `${timeline.canonicalJson(entry)}\n`) {
      throw new Error("attempt ledger entry is not canonical JSON");
    }
    validateEntry(entry, entries, timeline);
    if (name !== entryFilename(entry)) {
      throw new Error("attempt ledger filename does not match its entry");
    }
    if (entry.sequence !== index) {
      throw new Error("attempt ledger sequence is not contiguous");
    }
    entries.push(entry);
  }
  validateTrajectory(entries);
  return {
    directory,
    stagingDirectory,
    timeline,
    document: {
      schema: LEDGER_SCHEMA,
      attemptId: entries[0].attemptId,
      entries,
    },
  };
}

export function attemptLedgerBinding(ledger) {
  return structuredClone(ledger.document.entries[0].binding);
}

export function assertAttemptLedgerBinding(ledger, expected) {
  validateBinding(expected);
  const actual = attemptLedgerBinding(ledger);
  if (
    ledger.timeline.canonicalJson(actual) !==
    ledger.timeline.canonicalJson(expected)
  ) {
    throw new Error("attempt ledger binding does not match this execution");
  }
}

export async function claimProviderInvocation(
  ledger,
  {
    phase,
    invocation,
    mcpInvocation,
    requestDigest,
    baseRevision,
    baseRunDigest,
  },
) {
  assertCanClaim(ledger.document.entries, phase);
  validateInvocation(invocation, phase);
  validateMcpInvocation(mcpInvocation, phase);
  validateDigest(requestDigest, "attempt request digest");
  validateDigest(baseRunDigest, "attempt base run digest");
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new Error("attempt base revision is invalid");
  }
  return appendEntry(ledger, {
    kind: "provider-invocation-reserved",
    phase,
    invocation: structuredClone(invocation),
    mcpInvocation: structuredClone(mcpInvocation),
    requestDigest,
    baseRevision,
    baseRunDigest,
  });
}

export async function completeAttemptPhase(
  ledger,
  {
    phase,
    invocation,
    requestDigest,
    responseDigest,
    proposalDigest,
    candidateDigest,
    resultBundleDigest,
    resultRevision,
    resultRunDigest,
  },
) {
  assertStarted(ledger.document.entries, phase, invocation, requestDigest);
  for (const [label, digest] of [
    ["response", responseDigest],
    ["proposal", proposalDigest],
    ["candidate", candidateDigest],
    ["result bundle", resultBundleDigest],
    ["result run", resultRunDigest],
  ]) {
    validateDigest(digest, `attempt ${label} digest`);
  }
  if (!Number.isSafeInteger(resultRevision) || resultRevision < 0) {
    throw new Error("attempt result revision is invalid");
  }
  return appendEntry(ledger, {
    kind: "phase-completed",
    phase,
    invocationId: invocation.invocationId,
    requestDigest,
    responseDigest,
    proposalDigest,
    candidateDigest,
    resultBundleDigest,
    resultRevision,
    resultRunDigest,
  });
}

export async function failAttemptPhase(
  ledger,
  { phase, invocation, requestDigest },
) {
  assertStarted(ledger.document.entries, phase, invocation, requestDigest);
  return appendEntry(ledger, {
    kind: "phase-failed",
    phase,
    invocationId: invocation.invocationId,
    requestDigest,
    failure: "phase-failed-after-provider-invocation",
  });
}

export function completedAttemptLedger(ledger) {
  validateTrajectory(ledger.document.entries);
  const entries = ledger.document.entries;
  if (
    entries.length !== 5 ||
    entries[2].kind !== "phase-completed" ||
    entries[4].kind !== "phase-completed"
  ) {
    throw new Error("attempt ledger does not contain two completed phases");
  }
  const document = structuredClone(ledger.document);
  return {
    document,
    digest: ledger.timeline.contentDigest(document),
  };
}

export function attemptLedgerSnapshot(ledger) {
  validateTrajectory(ledger.document.entries);
  const document = structuredClone(ledger.document);
  return {
    document,
    digest: ledger.timeline.contentDigest(document),
  };
}

export function validateAttemptLedgerDocument(document, timeline) {
  if (
    !record(document) ||
    keys(document) !== "attemptId,entries,schema" ||
    document.schema !== LEDGER_SCHEMA ||
    !uuid(document.attemptId) ||
    !Array.isArray(document.entries)
  ) {
    throw new Error("attempt ledger document is invalid");
  }
  const entries = [];
  for (const entry of document.entries) {
    validateEntry(entry, entries, timeline);
    entries.push(entry);
  }
  validateTrajectory(entries);
  if (
    entries.length !== 5 ||
    entries[0].attemptId !== document.attemptId ||
    entries[2].kind !== "phase-completed" ||
    entries[4].kind !== "phase-completed"
  ) {
    throw new Error("attempt ledger document is incomplete");
  }
  return document;
}

async function appendEntry(ledger, fields) {
  const entries = ledger.document.entries;
  const sequence = entries.length;
  const unsigned = {
    schema: ENTRY_SCHEMA,
    attemptId: ledger.document.attemptId,
    sequence,
    previousEntryDigest:
      sequence === 0 ? null : entries[sequence - 1].recordDigest,
    ...fields,
  };
  const entry = {
    ...unsigned,
    recordDigest: ledger.timeline.contentDigest(unsigned),
  };
  validateEntry(entry, entries, ledger.timeline);
  const bytes = Buffer.from(`${ledger.timeline.canonicalJson(entry)}\n`);
  if (bytes.byteLength === 0 || bytes.byteLength > ENTRY_BYTES) {
    throw new Error("attempt ledger entry has an invalid byte length");
  }
  const temporary = join(ledger.stagingDirectory, `${randomUUID()}.json`);
  const destination = join(ledger.directory, entryFilename(entry));
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  let installed = false;
  try {
    await link(temporary, destination);
    installed = true;
    injectLedgerFailure(ledger, entry);
    await syncDirectory(ledger.directory);
  } catch (error) {
    if (installed) throw durabilityUncertain(error);
    throw error;
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw installed ? durabilityUncertain(error) : error;
      }
    });
    await syncDirectory(ledger.stagingDirectory).catch((error) => {
      throw installed ? durabilityUncertain(error) : error;
    });
  }
  entries.push(entry);
  return entry;
}

function injectLedgerFailure(ledger, entry) {
  const point = `after-${entry.phase ?? "attempt"}-${entry.kind}-ledger-install`;
  if (
    ledger.document.entries[0]?.binding?.source?.dirty === true &&
    process.env.TIMELINE_PILOT_TEST_FAILURE === point
  ) {
    const error = new Error(`injected attempt ledger failure: ${point}`);
    error.name = "TimelinePilotDurabilityUncertain";
    throw error;
  }
}

function durabilityUncertain(error) {
  const failure =
    error instanceof Error
      ? error
      : new Error("attempt ledger durability is uncertain");
  failure.name = "TimelinePilotDurabilityUncertain";
  return failure;
}

function validateEntry(entry, previous, timeline) {
  if (
    !record(entry) ||
    entry.schema !== ENTRY_SCHEMA ||
    !uuid(entry.attemptId) ||
    !Number.isSafeInteger(entry.sequence) ||
    entry.sequence < 0 ||
    entry.sequence > 4 ||
    entry.sequence !== previous.length ||
    entry.attemptId !== (previous[0]?.attemptId ?? entry.attemptId) ||
    entry.previousEntryDigest !==
      (previous.length === 0 ? null : previous.at(-1).recordDigest)
  ) {
    throw new Error("attempt ledger entry identity is invalid");
  }
  const { recordDigest, ...unsigned } = entry;
  validateDigest(recordDigest, "attempt ledger record digest");
  if (timeline.contentDigest(unsigned) !== recordDigest) {
    throw new Error("attempt ledger record digest did not reproduce");
  }
  if (entry.kind === "attempt-opened") {
    if (
      keys(entry) !==
      "attemptId,binding,kind,previousEntryDigest,recordDigest,schema,sequence"
    ) {
      throw new Error("attempt-opened ledger entry has unexpected fields");
    }
    validateBinding(entry.binding);
    return;
  }
  if (!PHASES.has(entry.phase)) {
    throw new Error("attempt ledger phase is invalid");
  }
  if (entry.kind === "provider-invocation-reserved") {
    if (
      keys(entry) !==
      "attemptId,baseRevision,baseRunDigest,invocation,kind,mcpInvocation,phase,previousEntryDigest,recordDigest,requestDigest,schema,sequence"
    ) {
      throw new Error("provider invocation ledger entry has unexpected fields");
    }
    validateInvocation(entry.invocation, entry.phase);
    validateMcpInvocation(entry.mcpInvocation, entry.phase);
    validateDigest(entry.requestDigest, "attempt request digest");
    validateDigest(entry.baseRunDigest, "attempt base run digest");
    if (!Number.isSafeInteger(entry.baseRevision) || entry.baseRevision < 0) {
      throw new Error("attempt base revision is invalid");
    }
    return;
  }
  if (entry.kind === "phase-completed") {
    if (
      keys(entry) !==
      "attemptId,candidateDigest,invocationId,kind,phase,previousEntryDigest,proposalDigest,recordDigest,requestDigest,responseDigest,resultBundleDigest,resultRevision,resultRunDigest,schema,sequence"
    ) {
      throw new Error("completed phase ledger entry has unexpected fields");
    }
    if (!uuid(entry.invocationId)) {
      throw new Error("completed phase invocation is invalid");
    }
    for (const digest of [
      entry.requestDigest,
      entry.responseDigest,
      entry.proposalDigest,
      entry.candidateDigest,
      entry.resultBundleDigest,
      entry.resultRunDigest,
    ]) {
      validateDigest(digest, "completed phase digest");
    }
    if (
      !Number.isSafeInteger(entry.resultRevision) ||
      entry.resultRevision < 0
    ) {
      throw new Error("completed phase result revision is invalid");
    }
    return;
  }
  if (
    entry.kind !== "phase-failed" ||
    keys(entry) !==
      "attemptId,failure,invocationId,kind,phase,previousEntryDigest,recordDigest,requestDigest,schema,sequence" ||
    entry.failure !== "phase-failed-after-provider-invocation" ||
    !uuid(entry.invocationId)
  ) {
    throw new Error("failed phase ledger entry is invalid");
  }
  validateDigest(entry.requestDigest, "failed phase request digest");
}

function validateTrajectory(entries) {
  const expected = [
    ["attempt-opened", undefined],
    ["provider-invocation-reserved", "initial"],
    [["phase-completed", "phase-failed"], "initial"],
    ["provider-invocation-reserved", "correction"],
    [["phase-completed", "phase-failed"], "correction"],
  ];
  for (const [index, entry] of entries.entries()) {
    const [kinds, phase] = expected[index] ?? [];
    const allowed = Array.isArray(kinds) ? kinds : [kinds];
    if (!allowed.includes(entry.kind) || entry.phase !== phase) {
      throw new Error("attempt ledger trajectory is invalid");
    }
    if (entry.kind === "phase-completed" || entry.kind === "phase-failed") {
      const started = entries[index - 1];
      if (
        entry.invocationId !== started.invocation.invocationId ||
        entry.requestDigest !== started.requestDigest
      ) {
        throw new Error("attempt phase result does not bind its invocation");
      }
    }
  }
  if (
    (entries[2]?.kind === "phase-failed" && entries.length > 3) ||
    (entries[4]?.kind === "phase-failed" && entries.length > 5)
  ) {
    throw new Error("attempt ledger continued after a failed phase");
  }
}

function assertCanClaim(entries, phase) {
  validateTrajectory(entries);
  const valid =
    (phase === "initial" && entries.length === 1) ||
    (phase === "correction" &&
      entries.length === 3 &&
      entries[2].kind === "phase-completed");
  if (!valid) {
    throw new Error(
      `${phase} provider invocation was already attempted or is unavailable`,
    );
  }
}

function assertStarted(entries, phase, invocation, requestDigest) {
  validateInvocation(invocation, phase);
  validateDigest(requestDigest, "attempt request digest");
  const started = entries.at(-1);
  if (
    started?.kind !== "provider-invocation-reserved" ||
    started.phase !== phase ||
    started.invocation.invocationId !== invocation.invocationId ||
    started.invocation.processId !== invocation.processId ||
    started.requestDigest !== requestDigest
  ) {
    throw new Error("attempt phase does not match its provider invocation");
  }
}

function validateBinding(binding) {
  if (
    !record(binding) ||
    keys(binding) !==
      "admissionPolicyDigest,inputDigest,modelConfigDigest,runtimeDigest,source" ||
    !record(binding.source) ||
    keys(binding.source) !== "dirty,revision" ||
    !SOURCE_REVISION.test(binding.source.revision) ||
    typeof binding.source.dirty !== "boolean"
  ) {
    throw new Error("attempt ledger binding is invalid");
  }
  for (const digest of [
    binding.admissionPolicyDigest,
    binding.inputDigest,
    binding.modelConfigDigest,
    binding.runtimeDigest,
  ]) {
    validateDigest(digest, "attempt ledger binding digest");
  }
}

function validateInvocation(invocation, phase) {
  if (
    !record(invocation) ||
    keys(invocation) !== "invocationId,phase,processId" ||
    invocation.phase !== phase ||
    !uuid(invocation.invocationId) ||
    !Number.isSafeInteger(invocation.processId) ||
    invocation.processId < 1
  ) {
    throw new Error("attempt phase invocation is invalid");
  }
}

function validateMcpInvocation(invocation, phase) {
  if (
    !record(invocation) ||
    keys(invocation) !==
      "executableDigest,invocationId,phase,processId,provenance,script,scriptDigest" ||
    invocation.phase !== phase ||
    invocation.provenance !== "driver-observed-maintainer-attested" ||
    invocation.script !== "packages/mcp-server/dist/cli.js" ||
    !uuid(invocation.invocationId) ||
    !Number.isSafeInteger(invocation.processId) ||
    invocation.processId < 1
  ) {
    throw new Error("attempt MCP invocation is invalid");
  }
  validateDigest(invocation.executableDigest, "MCP executable digest");
  validateDigest(invocation.scriptDigest, "MCP script digest");
}

function entryFilename(entry) {
  return `${String(entry.sequence).padStart(3, "0")}.json`;
}

async function syncDirectory(directory) {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function validateStagingDirectory(directory) {
  let count = 0;
  const handle = await opendir(directory);
  for await (const entry of handle) {
    if (
      !entry.isFile() ||
      !/^[0-9a-f-]{36}\.json$/u.test(entry.name) ||
      count >= 8
    ) {
      throw new Error("attempt ledger staging directory is invalid");
    }
    count += 1;
  }
}

function validateDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(value) {
  return Object.keys(value).sort().join(",");
}

function uuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

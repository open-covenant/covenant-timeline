import { randomUUID } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { decodeUtf8, readBoundedExactFile } from "./mcp-agent-pilot-lib.mjs";

const SCHEMA = "covenant.timeline.real-model-pilot.phase-decision.v2";
const BYTES = 64 * 1024;
const PHASES = new Set(["initial", "correction"]);
const DECISIONS = new Set(["admission-authorized", "recovery-terminal"]);
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createPhaseDecisionV2({
  phase,
  decision,
  adapterExecutionDigest,
  proposalReadyDigest,
  requestDigest,
  invocationId,
  candidateDigest,
}) {
  return validatePhaseDecisionV2({
    schema: SCHEMA,
    phase,
    decision,
    adapterExecutionDigest,
    proposalReadyDigest,
    requestDigest,
    invocationId,
    candidateDigest,
  });
}

export function validatePhaseDecisionV2(document) {
  if (
    !record(document) ||
    keys(document) !==
      "adapterExecutionDigest,candidateDigest,decision,invocationId,phase,proposalReadyDigest,requestDigest,schema" ||
    document.schema !== SCHEMA ||
    !PHASES.has(document.phase) ||
    !DECISIONS.has(document.decision) ||
    !digest(document.adapterExecutionDigest) ||
    !digest(document.proposalReadyDigest) ||
    !digest(document.requestDigest) ||
    !digest(document.candidateDigest) ||
    typeof document.invocationId !== "string" ||
    !UUID.test(document.invocationId)
  ) {
    throw new Error("phase decision is invalid");
  }
  return document;
}

export async function claimPhaseDecisionV2({
  state,
  document,
  timeline,
  staging,
  injectFailure = () => {},
  syncDirectory,
}) {
  validatePhaseDecisionV2(document);
  try {
    const claimed = await writeDecision({
      state,
      document,
      timeline,
      staging,
      injectFailure,
      syncDirectory,
    });
    return { ...claimed, created: true };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readPhaseDecisionV2({
      state,
      phase: document.phase,
      timeline,
      sync: true,
    });
    if (!sameBinding(existing.document, document, timeline)) {
      throw new Error("phase decision binding changed under concurrency");
    }
    return { ...existing, created: false };
  }
}

export async function readPhaseDecisionV2({
  state,
  phase,
  timeline,
  sync = false,
}) {
  let document;
  await readBoundedExactFile(
    join(state, `${phase}-decision.json`),
    BYTES,
    `${phase} phase decision`,
    {
      root: state,
      scope: "the pilot state",
      sync,
      validate(bytes) {
        if (bytes.byteLength === 0) throw new Error("phase decision is empty");
        const text = decodeUtf8(bytes, `${phase} phase decision`);
        document = timeline.parseJson(text);
        if (text !== `${timeline.canonicalJson(document)}\n`) {
          throw new Error("phase decision is not canonical JSON");
        }
        validatePhaseDecisionV2(document);
        if (document.phase !== phase) {
          throw new Error("phase decision does not match its filename");
        }
      },
    },
  );
  return { document, digest: timeline.contentDigest(document) };
}

export function assertPhaseDecisionBindingV2({
  decision,
  adapterExecutionDigest,
  proposalReadyDigest,
  requestDigest,
  invocationId,
  candidateDigest,
  timeline,
}) {
  const expected = createPhaseDecisionV2({
    phase: decision.phase,
    decision: decision.decision,
    adapterExecutionDigest,
    proposalReadyDigest,
    requestDigest,
    invocationId,
    candidateDigest,
  });
  if (!sameBinding(decision, expected, timeline)) {
    throw new Error("phase decision binding changed");
  }
  return decision;
}

async function writeDecision({
  state,
  document,
  timeline,
  staging,
  injectFailure,
  syncDirectory,
}) {
  const destination = join(state, `${document.phase}-decision.json`);
  const bytes = Buffer.from(`${timeline.canonicalJson(document)}\n`);
  if (bytes.byteLength === 0 || bytes.byteLength > BYTES) {
    throw new Error("phase decision exceeds its byte limit");
  }
  const temporary = join(
    staging,
    `${document.phase}-decision-${randomUUID()}.json`,
  );
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    injectFailure(`before-${document.phase}-decision-sync`);
    await file.sync();
  } finally {
    await file.close();
  }
  let installed = false;
  try {
    await link(temporary, destination);
    installed = true;
    injectFailure(`after-${document.phase}-decision-install`);
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

function sameBinding(left, right, timeline) {
  const normalize = ({ decision: _decision, ...document }) => document;
  return (
    timeline.canonicalJson(normalize(left)) ===
    timeline.canonicalJson(normalize(right))
  );
}

function durabilityUncertain(error) {
  const failure =
    error instanceof Error
      ? error
      : new Error("pilot phase-decision durability is uncertain");
  failure.name = "TimelinePilotDurabilityUncertain";
  return failure;
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

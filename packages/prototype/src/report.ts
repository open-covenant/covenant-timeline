import { parseRunDocument, type TimelineRunDocument } from "./document.js";
import { contentDigest, type JsonValue } from "./identity.js";
import {
  replay,
  verifyRun,
  type RunState,
  type VerifyRunResult,
} from "./run.js";

export interface TimelineRunReport {
  schema: "covenant.timeline.report.v0alpha1";
  runId: string;
  contractDigest: `sha256:${string}`;
  eventsDigest: `sha256:${string}`;
  stateDigest: `sha256:${string}`;
  state: RunState;
  verification: VerifyRunResult;
}

export function evaluateRunDocument(value: unknown): TimelineRunReport {
  const document = parseRunDocument(value);
  return evaluateValidatedRun(document);
}

export function evaluateValidatedRun(
  document: TimelineRunDocument,
): TimelineRunReport {
  const state = replay(document.contract, document.runId, document.events);
  return {
    schema: "covenant.timeline.report.v0alpha1",
    runId: document.runId,
    contractDigest: digest(document.contract),
    eventsDigest: digest(document.events),
    stateDigest: digest(state),
    state,
    verification: verifyRun(state),
  };
}

function digest(value: unknown): `sha256:${string}` {
  return contentDigest(value as JsonValue);
}

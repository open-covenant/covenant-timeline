import { contentDigest, type JsonValue } from "../identity.js";
import {
  parseRunDocumentV0Alpha2,
  type TimelineRunDocumentV0Alpha2,
} from "./document.js";
import {
  replayV0Alpha2,
  verifyRunV0Alpha2,
  type RunStateV0Alpha2,
  type VerifyRunResultV0Alpha2,
} from "./run.js";

export interface TimelineRunReportV0Alpha2 {
  schema: "covenant.timeline.report.v0alpha2";
  runId: string;
  contractDigest: `sha256:${string}`;
  eventsDigest: `sha256:${string}`;
  stateDigest: `sha256:${string}`;
  state: RunStateV0Alpha2;
  verification: VerifyRunResultV0Alpha2;
}

export function evaluateRunDocumentV0Alpha2(
  value: unknown,
): TimelineRunReportV0Alpha2 {
  return evaluateValidatedRunV0Alpha2(parseRunDocumentV0Alpha2(value));
}

export function evaluateValidatedRunV0Alpha2(
  document: TimelineRunDocumentV0Alpha2,
): TimelineRunReportV0Alpha2 {
  const state = replayV0Alpha2(
    document.contract,
    document.runId,
    document.events,
  );
  return {
    schema: "covenant.timeline.report.v0alpha2",
    runId: document.runId,
    contractDigest: digest(document.contract),
    eventsDigest: digest(document.events),
    stateDigest: digest(state),
    state,
    verification: verifyRunV0Alpha2(state),
  };
}

function digest(value: unknown): `sha256:${string}` {
  return contentDigest(value as JsonValue);
}

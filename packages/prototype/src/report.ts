import { parseRunDocument, type TimelineRunDocument } from "./document.js";
import { contentDigest, type JsonValue } from "./identity.js";
import {
  replay,
  verifyRun,
  type RunState,
  type VerifyRunResult,
} from "./run.js";
import {
  evaluateRunDocumentV0Alpha2,
  type TimelineRunReportV0Alpha2,
} from "./v0alpha2/report.js";

export interface TimelineRunReportV0Alpha1 {
  schema: "covenant.timeline.report.v0alpha1";
  runId: string;
  contractDigest: `sha256:${string}`;
  eventsDigest: `sha256:${string}`;
  stateDigest: `sha256:${string}`;
  state: RunState;
  verification: VerifyRunResult;
}

export type TimelineRunReport =
  | TimelineRunReportV0Alpha1
  | TimelineRunReportV0Alpha2;

export function evaluateRunDocument(value: unknown): TimelineRunReport {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { schema?: unknown }).schema === "covenant.timeline.run.v0alpha2"
  ) {
    return evaluateRunDocumentV0Alpha2(value);
  }
  const document = parseRunDocument(value);
  return evaluateValidatedRun(document);
}

export function evaluateValidatedRun(
  document: TimelineRunDocument,
): TimelineRunReportV0Alpha1 {
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

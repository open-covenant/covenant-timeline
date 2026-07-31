import type {
  TemporalEventV0Alpha3,
  TimelineContractV0Alpha3,
  TimelineRunDocumentV0Alpha3,
} from "@covenant-org/timeline";
import type { MCP_ADMISSION } from "./constants.js";

type EventDraft<T> = T extends TemporalEventV0Alpha3
  ? Omit<T, "schema" | "sequence">
  : never;

export type TemporalEventDraftV0Alpha3 = EventDraft<TemporalEventV0Alpha3>;

export interface McpRunImplementationV0Alpha1 {
  timelinePackage: "@covenant-org/timeline";
  timelineVersion: "0.0.0-alpha.2";
  reasoner: "covenant.timeline.stn.v0alpha1";
  serverPackage: "@covenant-org/timeline-mcp";
  serverVersion: string;
}

export interface McpRunEnvelopeV0Alpha1 {
  schema: "covenant.timeline.mcp-run.v0alpha1";
  runId: string;
  revision: number;
  runDigest: `sha256:${string}`;
  admission: typeof MCP_ADMISSION;
  implementation: McpRunImplementationV0Alpha1;
  run: TimelineRunDocumentV0Alpha3;
}

export interface McpRunMetadataV0Alpha1 {
  runId: string;
  revision: number;
  subject: TimelineContractV0Alpha3["subject"];
  contexts: TimelineContractV0Alpha3["contexts"];
  eventCount: number;
  latestRecordedThrough: number | null;
  runDigest: `sha256:${string}`;
}

export interface McpRunListPageOptionsV0Alpha1 {
  cursor?: string;
  limit?: number;
}

export interface McpRunListPageV0Alpha1 {
  timelines: readonly McpRunMetadataV0Alpha1[];
  nextCursor: string | null;
}

export interface CreateRunResultV0Alpha1 {
  envelope: McpRunEnvelopeV0Alpha1;
  created: boolean;
}

export interface AppendEventResultV0Alpha1 {
  envelope: McpRunEnvelopeV0Alpha1;
  event: TemporalEventV0Alpha3;
  appended: boolean;
}

export interface AppendCompiledEventsResultV0Alpha1 {
  envelope: McpRunEnvelopeV0Alpha1;
  events: readonly TemporalEventV0Alpha3[];
  appended: boolean;
}

export interface ExpectedRunPrefixV0Alpha1 {
  revision: number;
  runDigest: string;
}

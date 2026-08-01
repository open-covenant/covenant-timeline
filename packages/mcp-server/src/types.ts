import type {
  TemporalEventV0Alpha3,
  TimelineContractV0Alpha3,
  TimelineRunDocumentV0Alpha3,
} from "@covenant-org/timeline";

type EventDraft<T> = T extends TemporalEventV0Alpha3
  ? Omit<T, "schema" | "sequence">
  : never;

export type TemporalEventDraftV0Alpha3 = EventDraft<TemporalEventV0Alpha3>;

export interface McpWriterIdentityV0Alpha1 {
  timelinePackage: "@covenant-org/timeline";
  timelineVersion: string;
  reasoner: "covenant.timeline.stn.v0alpha1";
  serverPackage: "@covenant-org/timeline-mcp";
  serverVersion: string;
}

export interface McpAdmissionDecisionV0Alpha1 {
  authorityId: string;
  policyRef: string;
  policyDigest: `sha256:${string}`;
}

interface McpAdmissionRecordBaseV0Alpha1 extends McpAdmissionDecisionV0Alpha1 {
  schema: "covenant.timeline.mcp-admission.v0alpha1";
  decision: "admitted";
  writer: McpWriterIdentityV0Alpha1;
  baseRevision: number;
  baseRunDigest: `sha256:${string}`;
  eventIds: readonly string[];
  recordDigest: `sha256:${string}`;
}

export interface McpDirectAdmissionRecordV0Alpha1 extends McpAdmissionRecordBaseV0Alpha1 {
  kind: "direct-event";
}

export interface McpModelProposalAdmissionRecordV0Alpha1 extends McpAdmissionRecordBaseV0Alpha1 {
  kind: "model-proposal";
  candidateDigest: `sha256:${string}`;
  proposalDigest: `sha256:${string}`;
}

export type McpAdmissionRecordV0Alpha1 =
  | McpDirectAdmissionRecordV0Alpha1
  | McpModelProposalAdmissionRecordV0Alpha1;

export interface McpRunEnvelopeV0Alpha2 {
  schema: "covenant.timeline.mcp-run.v0alpha2";
  runId: string;
  revision: number;
  runDigest: `sha256:${string}`;
  admissions: readonly McpAdmissionRecordV0Alpha1[];
  lastWriter: McpWriterIdentityV0Alpha1;
  run: TimelineRunDocumentV0Alpha3;
}

export interface McpRunMetadataV0Alpha2 {
  runId: string;
  revision: number;
  auditDigest: `sha256:${string}`;
  subject: TimelineContractV0Alpha3["subject"];
  contexts: TimelineContractV0Alpha3["contexts"];
  eventCount: number;
  admissionCount: number;
  latestRecordedThrough: number | null;
  runDigest: `sha256:${string}`;
}

export interface McpRunListPageOptionsV0Alpha2 {
  cursor?: string;
  limit?: number;
}

export interface McpRunListPageV0Alpha2 {
  timelines: readonly McpRunMetadataV0Alpha2[];
  nextCursor: string | null;
}

export interface CreateRunResultV0Alpha2 {
  envelope: McpRunEnvelopeV0Alpha2;
  created: boolean;
}

export interface AppendEventResultV0Alpha2 {
  envelope: McpRunEnvelopeV0Alpha2;
  event: TemporalEventV0Alpha3;
  admissionRecord: McpDirectAdmissionRecordV0Alpha1;
  appended: boolean;
}

export interface AdmitCompiledEventsResultV0Alpha2 {
  envelope: McpRunEnvelopeV0Alpha2;
  events: readonly TemporalEventV0Alpha3[];
  admissionRecord: McpModelProposalAdmissionRecordV0Alpha1 | null;
  admissionStatus: "admitted" | "already-admitted" | "empty-candidate";
}

export interface ExpectedRunPrefixV0Alpha2 {
  revision: number;
  runDigest: string;
}

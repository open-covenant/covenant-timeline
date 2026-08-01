import type {
  TemporalKernelLimitsV0Alpha3,
  TemporalModelProposalLimitsV1,
} from "@covenant-org/timeline";

export const MCP_SERVER_NAME = "covenant-timeline";
export const MCP_SERVER_VERSION = "0.0.0-alpha.1";
export const TIMELINE_PACKAGE_VERSION = "0.0.0-alpha.3";
export const TIMELINE_REASONER = "covenant.timeline.stn.v0alpha1";

export const DEFAULT_MAX_RUN_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_RUNS = 256;
export const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
export const MAX_LIST_PAGE_SIZE = 8;
export const MAX_MODEL_PROPOSAL_EVENTS = 8;

export const MCP_MODEL_PROPOSAL_LIMITS: Readonly<TemporalModelProposalLimitsV1> =
  Object.freeze({
    maxAssertionCatalogEntries: 128,
    maxChanges: MAX_MODEL_PROPOSAL_EVENTS,
    maxEvidenceBytes: 64 * 1024,
    maxEvidenceCatalogEntries: 32,
    maxKnowledgeCutCatalogEntries: 32,
    maxProposalBytes: 512 * 1024,
    maxProposalDepth: 12,
    maxProposalNodes: 2_048,
    maxQuoteBytes: 4 * 1024,
    maxReferenceCatalogEntries: 128,
    maxSupportsPerChange: 8,
    maxTotalEvidenceBytes: 256 * 1024,
  });

export const MCP_DOCUMENT_LIMITS = Object.freeze({
  maxCanonicalDepth: 64,
  maxCanonicalNodes: 200_000,
  maxCheckpoints: 32,
  maxEvents: 2_000,
  maxEvidenceRefs: 32,
});

export const MCP_KERNEL_LIMITS: Readonly<TemporalKernelLimitsV0Alpha3> =
  Object.freeze({
    maxAssertions: 1_024,
    maxAxes: 32,
    maxContexts: 32,
    maxEdges: 4_096,
    maxEvents: 2_000,
    maxEvidenceRefs: 32,
    maxIntervals: 256,
    maxOperations: 2_000_000,
    maxPoints: 512,
  });

export const MCP_ADMISSION = Object.freeze({
  mode: "structural-only" as const,
  assertionAuthority: "unverified" as const,
  evidencePayloads: "external" as const,
});

export const MCP_IMPLEMENTATION = Object.freeze({
  timelinePackage: "@covenant-org/timeline" as const,
  timelineVersion: TIMELINE_PACKAGE_VERSION,
  reasoner: TIMELINE_REASONER,
  serverPackage: "@covenant-org/timeline-mcp" as const,
  serverVersion: MCP_SERVER_VERSION,
});

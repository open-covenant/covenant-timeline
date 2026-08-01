import * as z from "zod/v4";
import type {
  StandardSchemaV1,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { contentDigest, type JsonValue } from "@covenant-org/timeline";
import {
  MAX_LIST_PAGE_SIZE,
  MCP_WRITER_IDENTITY,
  MCP_KERNEL_LIMITS,
  MCP_MODEL_PROPOSAL_LIMITS,
  MAX_MODEL_PROPOSAL_EVENTS,
} from "./constants.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PAGE_CURSOR = /^v1\.[0-9a-f]{64}\.[0-9a-f]{64}$/;
const POLICY_REFERENCE = /^[\x21-\x7e]{1,512}$/;
const SERVER_VERSION = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/;
const EVENT_ID_DESCRIPTION =
  "Unique event ID. Omit schema and sequence; the server assigns both.";
const ASSERTION_ID_DESCRIPTION =
  "Unique assertion identifier for the life of this run.";

export const identifierSchema = z
  .string()
  .regex(IDENTIFIER)
  .describe(
    "Portable lowercase identifier: 1-128 characters matching [a-z0-9][a-z0-9._:/-]*.",
  );
export const digestSchema = z
  .string()
  .regex(DIGEST)
  .describe("Lowercase SHA-256 content digest in sha256:<64 hex> form.");
export const safeIntegerSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
  .describe("Exact integer within the JavaScript safe-integer range.");
export const sequenceSchema = safeIntegerSchema
  .min(0)
  .describe("Zero-based event sequence assigned by the server.");
export const recordedThroughSchema = z
  .union([sequenceSchema, z.null()])
  .describe(
    "Explicit knowledge cut: an event sequence includes that event and every earlier event; null selects the empty prefix. There is no implicit latest value.",
  );

export const subjectSchema = z
  .object({
    kind: identifierSchema.describe(
      "Application-defined subject category, such as repository or workflow.",
    ),
    id: identifierSchema.describe(
      "Stable application-defined identifier for the subject.",
    ),
  })
  .strict();

export const axisSchema = z
  .object({
    id: identifierSchema.describe(
      "Axis identifier referenced by points in this contract.",
    ),
    kind: z
      .enum(["metric", "ordinal"])
      .describe(
        "metric means elapsed integer ticks; ordinal means ordered domain steps.",
      ),
    unit: identifierSchema.describe(
      "Unit for integer coordinates, such as second or build-step.",
    ),
    origin: identifierSchema.describe(
      "Opaque, application-pinned reference for coordinate zero. Normalize civil time and time zones before admission.",
    ),
  })
  .strict();

export const contextSchema = z
  .object({
    id: identifierSchema.describe(
      "Context identifier referenced by points, assertions, and queries.",
    ),
    mode: z
      .enum(["actual", "forecast", "hypothetical", "planned"])
      .describe(
        "Scenario class. Contexts are isolated; records in one context never constrain another.",
      ),
  })
  .strict();

export const contractSchema = z
  .object({
    schema: z
      .literal("covenant.timeline.contract.v0alpha3")
      .describe("Exact contract schema identifier."),
    id: identifierSchema.describe(
      "Immutable contract identifier. This also becomes the run ID.",
    ),
    subject: subjectSchema.describe(
      "Subject whose temporal state is recorded.",
    ),
    axes: z
      .array(axisSchema)
      .min(1)
      .max(MCP_KERNEL_LIMITS.maxAxes)
      .describe("Pinned integer coordinate systems available to this run."),
    contexts: z
      .array(contextSchema)
      .min(1)
      .max(MCP_KERNEL_LIMITS.maxContexts)
      .describe(
        "Isolated actual, planned, forecast, or hypothetical scenarios.",
      ),
  })
  .strict();

const pointSchema = z
  .object({
    id: identifierSchema.describe(
      "Unique point identifier for the life of this run.",
    ),
    contextId: identifierSchema.describe(
      "Existing contract context that owns this point.",
    ),
    axisId: identifierSchema.describe(
      "Existing contract axis used by this point.",
    ),
  })
  .strict();

const intervalSchema = z
  .object({
    id: identifierSchema.describe(
      "Unique interval identifier for the life of this run.",
    ),
    contextId: identifierSchema.describe(
      "Context shared by the interval and both endpoint declarations.",
    ),
    startPointId: identifierSchema.describe(
      "Earlier-declared start point. Both endpoints must use the same axis.",
    ),
    endPointId: identifierSchema.describe(
      "Earlier-declared end point. Timeline enforces end - start >= 1.",
    ),
  })
  .strict();

const coordinateSchema = z
  .union([
    z
      .object({
        minimum: safeIntegerSchema,
        maximum: safeIntegerSchema,
      })
      .strict(),
    z.object({ minimum: safeIntegerSchema }).strict(),
    z.object({ maximum: safeIntegerSchema }).strict(),
  ])
  .describe(
    "Inclusive integer coordinate bounds relative to the point's pinned axis origin. Supply minimum, maximum, or both.",
  );

const differencePointFields = {
  fromPointId: identifierSchema.describe(
    "Earlier-declared point subtracted from toPointId.",
  ),
  toPointId: identifierSchema.describe(
    "Earlier-declared point on the same context and axis.",
  ),
};

const differenceConstraintSchema = z
  .union([
    z
      .object({
        ...differencePointFields,
        minimum: safeIntegerSchema,
        maximum: safeIntegerSchema,
      })
      .strict(),
    z
      .object({
        ...differencePointFields,
        minimum: safeIntegerSchema,
      })
      .strict(),
    z
      .object({
        ...differencePointFields,
        maximum: safeIntegerSchema,
      })
      .strict(),
  ])
  .describe(
    "Inclusive integer bounds on toPointId - fromPointId. Supply minimum, maximum, or both.",
  );

const evidenceRefsSchema = z
  .array(digestSchema)
  .min(1)
  .max(MCP_KERNEL_LIMITS.maxEvidenceRefs)
  .describe(
    "SHA-256 digests of exact external evidence bytes. The server retains labels but does not retain or authenticate the evidence.",
  );
const supersedesSchema = z
  .array(identifierSchema)
  .min(1)
  .max(MCP_KERNEL_LIMITS.maxAssertions)
  .describe(
    "Earlier assertion IDs permanently suppressed by this replacement. Targets must have the same assertion kind and context; coordinate targets must concern the same point.",
  )
  .optional();

const coordinateAssertionSchema = z
  .object({
    id: identifierSchema.describe(ASSERTION_ID_DESCRIPTION),
    contextId: identifierSchema.describe(
      "Context shared by this assertion and its point.",
    ),
    pointId: identifierSchema.describe(
      "Earlier-declared point constrained against its axis origin.",
    ),
    coordinate: coordinateSchema,
    evidenceRefs: evidenceRefsSchema,
    supersedes: supersedesSchema,
  })
  .strict();

const constraintAssertionSchema = z
  .object({
    id: identifierSchema.describe(ASSERTION_ID_DESCRIPTION),
    contextId: identifierSchema.describe(
      "Context shared by this assertion and both referenced points.",
    ),
    constraint: differenceConstraintSchema,
    evidenceRefs: evidenceRefsSchema,
    supersedes: supersedesSchema,
  })
  .strict();

const factAssertionSchema = z
  .object({
    id: identifierSchema.describe(ASSERTION_ID_DESCRIPTION),
    contextId: identifierSchema.describe(
      "Context shared by this fact and any temporal references.",
    ),
    propositionRef: identifierSchema.describe(
      "Opaque application-defined reference to the proposition; the kernel does not infer its truth.",
    ),
    validDuring: identifierSchema
      .describe(
        "Optional earlier-declared interval during which the fact holds.",
      )
      .optional(),
    observedAt: identifierSchema
      .describe("Optional earlier-declared observation point.")
      .optional(),
    assertedAt: identifierSchema
      .describe("Optional earlier-declared assertion point.")
      .optional(),
    evidenceRefs: evidenceRefsSchema,
    supersedes: supersedesSchema,
  })
  .strict();

const pointDraftSchema = z
  .object({
    id: identifierSchema.describe(EVENT_ID_DESCRIPTION),
    type: z.literal("point.declared"),
    point: pointSchema,
  })
  .strict();

const intervalDraftSchema = z
  .object({
    id: identifierSchema.describe(EVENT_ID_DESCRIPTION),
    type: z.literal("interval.declared"),
    interval: intervalSchema,
  })
  .strict();

const constraintDraftSchema = z
  .object({
    id: identifierSchema.describe(EVENT_ID_DESCRIPTION),
    type: z.literal("constraint.asserted"),
    assertion: constraintAssertionSchema,
  })
  .strict();

const coordinateDraftSchema = z
  .object({
    id: identifierSchema.describe(EVENT_ID_DESCRIPTION),
    type: z.literal("coordinate.asserted"),
    assertion: coordinateAssertionSchema,
  })
  .strict();

const factDraftSchema = z
  .object({
    id: identifierSchema.describe(EVENT_ID_DESCRIPTION),
    type: z.literal("fact.asserted"),
    assertion: factAssertionSchema,
  })
  .strict();

const retractionDraftSchema = z
  .object({
    id: identifierSchema.describe(EVENT_ID_DESCRIPTION),
    type: z.literal("assertion.retracted"),
    assertionId: identifierSchema.describe(
      "Earlier coordinate, constraint, or fact assertion to deactivate. Retraction does not reactivate assertions it superseded.",
    ),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

export const eventDraftSchema = z.discriminatedUnion("type", [
  pointDraftSchema,
  intervalDraftSchema,
  constraintDraftSchema,
  coordinateDraftSchema,
  factDraftSchema,
  retractionDraftSchema,
]);

const eventRecordFields = {
  schema: z.literal("covenant.timeline.event.v0alpha3"),
  sequence: sequenceSchema,
};

export const eventSchema = z.discriminatedUnion("type", [
  pointDraftSchema.extend(eventRecordFields),
  intervalDraftSchema.extend(eventRecordFields),
  constraintDraftSchema.extend(eventRecordFields),
  coordinateDraftSchema.extend(eventRecordFields),
  factDraftSchema.extend(eventRecordFields),
  retractionDraftSchema.extend(eventRecordFields),
]);

const modelCandidateEventSchema = z.discriminatedUnion("type", [
  constraintDraftSchema.extend(eventRecordFields),
  coordinateDraftSchema.extend(eventRecordFields),
  retractionDraftSchema.extend(eventRecordFields),
]);

const modelProposalSupportSchema = z
  .object({
    evidenceId: identifierSchema.describe(
      "Caller-provided evidence handle. Timeline does not authenticate this handle.",
    ),
    quote: z
      .string()
      .min(1)
      .max(MCP_MODEL_PROPOSAL_LIMITS.maxQuoteBytes)
      .describe(
        "Exact supporting quote. Runtime validation applies the limit to UTF-8 bytes and requires one occurrence in the referenced evidence.",
      ),
  })
  .strict();

const modelProposalSupportsSchema = z
  .array(modelProposalSupportSchema)
  .min(1)
  .max(MCP_MODEL_PROPOSAL_LIMITS.maxSupportsPerChange);

const modelProposalBoundsSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("exact"),
      value: safeIntegerSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("lower-bound"),
      minimum: safeIntegerSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("upper-bound"),
      maximum: safeIntegerSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("closed-range"),
      minimum: safeIntegerSchema,
      maximum: safeIntegerSchema,
    })
    .strict(),
]);

const modelProposalRevisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("keep") }).strict(),
  z
    .object({
      type: z.literal("supersede"),
      assertionHandle: identifierSchema,
    })
    .strict(),
]);

const modelProposalChangeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("coordinate"),
      pointHandle: identifierSchema,
      bounds: modelProposalBoundsSchema,
      supports: modelProposalSupportsSchema,
      revision: modelProposalRevisionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("constraint"),
      differenceHandle: identifierSchema,
      bounds: modelProposalBoundsSchema,
      supports: modelProposalSupportsSchema,
      revision: modelProposalRevisionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("retraction"),
      assertionHandle: identifierSchema,
      supports: modelProposalSupportsSchema,
    })
    .strict(),
]);

const modelKnowledgeCutSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("current") }).strict(),
  z
    .object({
      type: z.literal("prior"),
      cutHandle: identifierSchema,
    })
    .strict(),
]);

const modelQueryIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("consistency"),
      targetHandle: identifierSchema,
      knowledgeCut: modelKnowledgeCutSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("difference"),
      targetHandle: identifierSchema,
      knowledgeCut: modelKnowledgeCutSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("point-relation"),
      targetHandle: identifierSchema,
      knowledgeCut: modelKnowledgeCutSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("interval-relation"),
      targetHandle: identifierSchema,
      knowledgeCut: modelKnowledgeCutSchema,
    })
    .strict(),
]);

export const modelProposalSchema = z
  .object({
    schema: z.literal("covenant.timeline.model-proposal.v1"),
    requestId: identifierSchema,
    changes: z
      .array(modelProposalChangeSchema)
      .max(MCP_MODEL_PROPOSAL_LIMITS.maxChanges),
    query: modelQueryIntentSchema,
  })
  .strict();

const modelEvidenceCatalogSchema = z
  .array(
    z
      .object({
        id: identifierSchema,
        status: z.enum(["current", "stale"]),
        text: z
          .string()
          .max(MCP_MODEL_PROPOSAL_LIMITS.maxEvidenceBytes)
          .describe(
            "Transient evidence text. Timeline hashes its UTF-8 bytes but does not write or return the text.",
          ),
      })
      .strict(),
  )
  .max(MCP_MODEL_PROPOSAL_LIMITS.maxEvidenceCatalogEntries);

const modelReferenceCatalogSchema = z
  .array(
    z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("context"),
          handle: identifierSchema,
          contextId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("point"),
          handle: identifierSchema,
          pointId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("difference"),
          handle: identifierSchema,
          fromPointId: identifierSchema,
          toPointId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("point-relation"),
          handle: identifierSchema,
          leftPointId: identifierSchema,
          rightPointId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("interval-relation"),
          handle: identifierSchema,
          leftIntervalId: identifierSchema,
          rightIntervalId: identifierSchema,
        })
        .strict(),
    ]),
  )
  .max(MCP_MODEL_PROPOSAL_LIMITS.maxReferenceCatalogEntries);

const modelAssertionCatalogSchema = z
  .array(
    z
      .object({
        handle: identifierSchema,
        assertionId: identifierSchema,
      })
      .strict(),
  )
  .max(MCP_MODEL_PROPOSAL_LIMITS.maxAssertionCatalogEntries);

const modelKnowledgeCutCatalogSchema = z
  .array(
    z
      .object({
        handle: identifierSchema,
        recordedThrough: recordedThroughSchema,
      })
      .strict(),
  )
  .max(MCP_MODEL_PROPOSAL_LIMITS.maxKnowledgeCutCatalogEntries);

const modelSupportReceiptSchema = z
  .object({
    evidenceId: identifierSchema,
    evidenceRef: digestSchema,
    quoteDigest: digestSchema,
    utf8StartByte: sequenceSchema,
    utf8EndByte: sequenceSchema,
  })
  .strict();

const modelCandidateProvenanceSchema = z
  .object({
    candidateEventId: identifierSchema,
    evidenceRefs: z
      .array(digestSchema)
      .min(1)
      .max(MCP_KERNEL_LIMITS.maxEvidenceRefs),
    supports: z
      .array(modelSupportReceiptSchema)
      .min(1)
      .max(MCP_MODEL_PROPOSAL_LIMITS.maxSupportsPerChange),
  })
  .strict();

const queryFields = {
  id: identifierSchema.describe("Stable identifier for this exact query."),
  contextId: identifierSchema.describe(
    "Contract context to project and reason over.",
  ),
  recordedThrough: recordedThroughSchema,
};

const consistencyQueryDraftSchema = z
  .object({
    ...queryFields,
    type: z.literal("context.consistency"),
  })
  .strict();

const differenceQueryDraftSchema = z
  .object({
    ...queryFields,
    type: z.literal("difference.bounds"),
    fromPointId: identifierSchema.describe(
      "Earlier-declared point subtracted from toPointId.",
    ),
    toPointId: identifierSchema.describe(
      "Earlier-declared point. The result bounds toPointId - fromPointId.",
    ),
  })
  .strict();

const pointQueryDraftSchema = z
  .object({
    ...queryFields,
    type: z.literal("point.relations"),
    leftPointId: identifierSchema.describe(
      "Earlier-declared point whose relation to rightPointId is requested.",
    ),
    rightPointId: identifierSchema.describe(
      "Earlier-declared comparison point on the same axis.",
    ),
  })
  .strict();

const intervalQueryDraftSchema = z
  .object({
    ...queryFields,
    type: z.literal("interval.relations"),
    leftIntervalId: identifierSchema.describe(
      "Earlier-declared interval whose Allen relation to rightIntervalId is requested.",
    ),
    rightIntervalId: identifierSchema.describe(
      "Earlier-declared comparison interval on the same axis.",
    ),
  })
  .strict();

export const queryDraftSchema = z.discriminatedUnion("type", [
  consistencyQueryDraftSchema,
  differenceQueryDraftSchema,
  pointQueryDraftSchema,
  intervalQueryDraftSchema,
]);

const queryRecordField = {
  schema: z.literal("covenant.timeline.query.v0alpha3"),
};

export const querySchema = z.discriminatedUnion("type", [
  consistencyQueryDraftSchema.extend(queryRecordField),
  differenceQueryDraftSchema.extend(queryRecordField),
  pointQueryDraftSchema.extend(queryRecordField),
  intervalQueryDraftSchema.extend(queryRecordField),
]);

const proofEdgeSchema = z
  .object({
    sourceId: z.string().min(1).max(256),
    fromNodeId: z.string().min(1).max(256),
    toNodeId: z.string().min(1).max(256),
    maximum: safeIntegerSchema,
  })
  .strict();

const scheduleProofSchema = z
  .object({
    kind: z.literal("schedule"),
    coordinates: z.record(z.string(), safeIntegerSchema),
  })
  .strict();

const negativeCycleProofSchema = z
  .object({
    kind: z.literal("negative-cycle"),
    edges: z.array(proofEdgeSchema).max(MCP_KERNEL_LIMITS.maxEdges),
  })
  .strict();

const boundsProofSchema = z
  .object({
    kind: z.literal("bounds"),
    lowerEdges: z.array(proofEdgeSchema).max(MCP_KERNEL_LIMITS.maxEdges),
    upperEdges: z.array(proofEdgeSchema).max(MCP_KERNEL_LIMITS.maxEdges),
  })
  .strict();

const relationCaseSchema = z
  .object({
    relation: z.enum([
      "after",
      "before",
      "contains",
      "during",
      "equal",
      "finished-by",
      "finishes",
      "meets",
      "met-by",
      "overlapped-by",
      "overlaps",
      "started-by",
      "starts",
    ]),
    possible: z.boolean(),
    witness: z.union([negativeCycleProofSchema, scheduleProofSchema]),
  })
  .strict();

const relationProofSchema = z
  .object({
    kind: z.literal("relation-cases"),
    cases: z.array(relationCaseSchema).max(13),
  })
  .strict();

const proofSchema = z.discriminatedUnion("kind", [
  scheduleProofSchema,
  negativeCycleProofSchema,
  boundsProofSchema,
  relationProofSchema,
]);

const consistencyResultSchema = z
  .object({
    type: z.literal("context.consistency"),
    status: z.enum(["consistent", "inconsistent"]),
  })
  .strict();

const differenceResultSchema = z
  .object({
    type: z.literal("difference.bounds"),
    status: z.enum([
      "bounded",
      "inconsistent",
      "partially-bounded",
      "unbounded",
    ]),
    minimum: z.union([safeIntegerSchema, z.null()]),
    maximum: z.union([safeIntegerSchema, z.null()]),
  })
  .strict();

const pointResultSchema = z
  .object({
    type: z.literal("point.relations"),
    status: z.enum(["inconsistent", "indeterminate", "resolved"]),
    possible: z.array(z.enum(["after", "before", "equal"])).max(3),
  })
  .strict();

const intervalResultSchema = z
  .object({
    type: z.literal("interval.relations"),
    status: z.enum(["inconsistent", "indeterminate", "resolved"]),
    possible: z
      .array(
        z.enum([
          "after",
          "before",
          "contains",
          "during",
          "equal",
          "finished-by",
          "finishes",
          "meets",
          "met-by",
          "overlapped-by",
          "overlaps",
          "started-by",
          "starts",
        ]),
      )
      .max(13),
  })
  .strict();

const conclusionSchema = z
  .object({
    schema: z.literal("covenant.timeline.conclusion.v0alpha3"),
    queryId: identifierSchema,
    result: z.discriminatedUnion("type", [
      consistencyResultSchema,
      differenceResultSchema,
      pointResultSchema,
      intervalResultSchema,
    ]),
    receipt: z
      .object({
        reasoner: z.literal("covenant.timeline.stn.v0alpha1"),
        stateDigest: digestSchema,
        queryDigest: digestSchema,
        semanticResultDigest: digestSchema,
        proof: proofSchema,
      })
      .strict(),
  })
  .strict();

const metadataSchema = z
  .object({
    runId: identifierSchema,
    revision: sequenceSchema,
    auditDigest: digestSchema,
    subject: subjectSchema,
    contexts: z.array(contextSchema).max(MCP_KERNEL_LIMITS.maxContexts),
    eventCount: sequenceSchema,
    admissionCount: sequenceSchema,
    latestRecordedThrough: recordedThroughSchema,
    runDigest: digestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.eventCount !== value.revision) {
      context.addIssue({
        code: "custom",
        message: "event count must match revision",
        path: ["eventCount"],
        input: value,
      });
    }
    const latest = value.eventCount === 0 ? null : value.eventCount - 1;
    if (value.latestRecordedThrough !== latest) {
      context.addIssue({
        code: "custom",
        message: "latest record cut must match event count",
        path: ["latestRecordedThrough"],
        input: value,
      });
    }
    if (value.admissionCount > value.eventCount) {
      context.addIssue({
        code: "custom",
        message: "admission count must not exceed event count",
        path: ["admissionCount"],
        input: value,
      });
    }
  });

export const admissionDecisionSchema = z
  .object({
    authorityId: identifierSchema.describe(
      "Neutral host-controlled authority identifier responsible for this admission decision.",
    ),
    policyRef: z
      .string()
      .regex(POLICY_REFERENCE)
      .describe("Stable reference for the admission policy bytes."),
    policyDigest: digestSchema.describe(
      "SHA-256 digest of the exact admission policy bytes.",
    ),
  })
  .strict();

export const writerIdentitySchema = z
  .object({
    timelinePackage: z.literal(MCP_WRITER_IDENTITY.timelinePackage),
    timelineVersion: z.literal(MCP_WRITER_IDENTITY.timelineVersion),
    reasoner: z.literal(MCP_WRITER_IDENTITY.reasoner),
    serverPackage: z.literal(MCP_WRITER_IDENTITY.serverPackage),
    serverVersion: z.string().regex(SERVER_VERSION).max(64),
  })
  .strict();

const admissionRecordFields = {
  schema: z.literal("covenant.timeline.mcp-admission.v0alpha1"),
  decision: z.literal("admitted"),
  authorityId: identifierSchema,
  policyRef: z.string().regex(POLICY_REFERENCE),
  policyDigest: digestSchema,
  writer: writerIdentitySchema,
  baseRevision: sequenceSchema,
  baseRunDigest: digestSchema,
  eventIds: z.array(identifierSchema).min(1).max(MAX_MODEL_PROPOSAL_EVENTS),
  recordDigest: digestSchema,
};

export const directAdmissionRecordSchema = z
  .object({
    ...admissionRecordFields,
    kind: z.literal("direct-event"),
    eventIds: z.array(identifierSchema).length(1),
  })
  .strict()
  .superRefine(validateAdmissionRecordDigest);

export const modelProposalAdmissionRecordSchema = z
  .object({
    ...admissionRecordFields,
    kind: z.literal("model-proposal"),
    candidateDigest: digestSchema,
    proposalDigest: digestSchema,
  })
  .strict()
  .superRefine(validateAdmissionRecordDigest);

export const admissionRecordSchema = z.union([
  directAdmissionRecordSchema,
  modelProposalAdmissionRecordSchema,
]);

const projectedStateSchema = z
  .object({
    schema: z.literal("covenant.timeline.state.v0alpha3"),
    contractId: identifierSchema,
    subject: subjectSchema,
    context: contextSchema,
    axes: z.array(axisSchema).max(MCP_KERNEL_LIMITS.maxAxes),
    recordedThrough: recordedThroughSchema,
    points: z.array(pointSchema).max(MCP_KERNEL_LIMITS.maxPoints),
    intervals: z.array(intervalSchema).max(MCP_KERNEL_LIMITS.maxIntervals),
    coordinates: z
      .array(coordinateAssertionSchema)
      .max(MCP_KERNEL_LIMITS.maxAssertions),
    constraints: z
      .array(constraintAssertionSchema)
      .max(MCP_KERNEL_LIMITS.maxAssertions),
    facts: z.array(factAssertionSchema).max(MCP_KERNEL_LIMITS.maxAssertions),
    stateDigest: digestSchema,
  })
  .strict();

export const createRunInputSchema = z
  .object({
    contract: contractSchema.describe(
      "Complete immutable temporal contract. Reusing the same bytes is idempotent; the server never replaces an existing contract.",
    ),
  })
  .strict();
export const createRunOutputSchema = z
  .object({
    created: z.boolean(),
    timeline: metadataSchema,
  })
  .strict();

export const listRunsInputSchema = z
  .object({
    cursor: z
      .string()
      .regex(PAGE_CURSOR)
      .describe(
        "Opaque nextCursor returned by the preceding timeline_list_runs page.",
      )
      .optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIST_PAGE_SIZE)
      .describe(
        `Maximum timelines to return. Defaults to ${MAX_LIST_PAGE_SIZE} and never exceeds ${MAX_LIST_PAGE_SIZE}.`,
      )
      .optional(),
  })
  .strict();
export const listRunsOutputSchema = z
  .object({
    timelines: z.array(metadataSchema).max(MAX_LIST_PAGE_SIZE),
    nextCursor: z
      .union([z.string().regex(PAGE_CURSOR), z.null()])
      .describe(
        "Pass this opaque cursor to the next call. A catalog change invalidates it, and null means that catalog generation is exhausted.",
      ),
  })
  .strict();

export const appendEventInputSchema = z
  .object({
    runId: identifierSchema.describe(
      "Existing run ID, equal to the contract ID used at creation.",
    ),
    expectedRunDigest: digestSchema.describe(
      "Current whole-run digest from create, list, append, project, or reason. New events require this compare-and-swap value; an exact same-ID retry is idempotent even if its digest is stale. Refresh after a conflict or uncertain write.",
    ),
    event: eventDraftSchema.describe(
      "One new event draft. References must target earlier records. Do not send schema or sequence; the server assigns them.",
    ),
    admission: admissionDecisionSchema,
  })
  .strict();
export const appendEventOutputSchema = z
  .object({
    appended: z.boolean(),
    event: eventSchema,
    timeline: metadataSchema,
    admissionRecord: directAdmissionRecordSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.admissionRecord.baseRevision !== value.event.sequence ||
      value.admissionRecord.eventIds[0] !== value.event.id
    ) {
      context.addIssue({
        code: "custom",
        message: "admission record must bind the appended event",
        path: ["admissionRecord"],
        input: value,
      });
    }
    const minimumRevision = value.event.sequence + 1;
    if (
      value.timeline.revision < minimumRevision ||
      (value.appended && value.timeline.revision !== minimumRevision)
    ) {
      context.addIssue({
        code: "custom",
        message: "timeline revision must contain the appended event",
        path: ["timeline", "revision"],
        input: value,
      });
    }
  });

const modelProposalRequestFields = {
  runId: identifierSchema.describe("Existing run to inspect or update."),
  expectedRevision: sequenceSchema.describe(
    "Run revision paired with expectedRunDigest. The server binds compilation to this exact append-only prefix.",
  ),
  expectedRunDigest: digestSchema.describe(
    "Digest of the run prefix at expectedRevision.",
  ),
  expectedRequestId: identifierSchema.describe(
    "Host-generated request identifier that the model proposal must echo.",
  ),
  proposal: modelProposalSchema,
  evidenceCatalog: modelEvidenceCatalogSchema.describe(
    "Caller-supplied, unauthenticated evidence. Text is used transiently for exact quote matching and is never stored or returned.",
  ),
  referenceCatalog: modelReferenceCatalogSchema.describe(
    "Caller-supplied handles mapped to declarations in the bound run prefix.",
  ),
  assertionCatalog: modelAssertionCatalogSchema
    .describe(
      "Optional caller-supplied handles for active assertions that may be superseded or retracted.",
    )
    .optional(),
  knowledgeCutCatalog: modelKnowledgeCutCatalogSchema
    .describe(
      "Optional caller-supplied handles for prior record cuts in the bound run prefix.",
    )
    .optional(),
};

export const previewModelProposalInputSchema = z
  .object(modelProposalRequestFields)
  .strict();

export const admitModelProposalInputSchema = z
  .object({
    ...modelProposalRequestFields,
    candidateDigest: digestSchema.describe(
      "Candidate digest returned by timeline_preview_model_proposal or an equivalent trusted compilation. Admission recompiles and requires the resulting candidate to match it; preview sessions are not retained.",
    ),
    admission: admissionDecisionSchema,
  })
  .strict();

const compiledModelProposalOutputFields = {
  candidateDigest: digestSchema,
  requestId: identifierSchema,
  proposalDigest: digestSchema,
  baseRevision: sequenceSchema,
  baseRunDigest: digestSchema,
  events: z.array(modelCandidateEventSchema).max(MAX_MODEL_PROPOSAL_EVENTS),
  query: querySchema,
  provenance: z
    .array(modelCandidateProvenanceSchema)
    .max(MAX_MODEL_PROPOSAL_EVENTS),
};

function validateCandidateProvenance(
  value: {
    candidateDigest: string;
    requestId: string;
    proposalDigest: string;
    baseRevision: number;
    baseRunDigest: string;
    events: readonly z.infer<typeof modelCandidateEventSchema>[];
    query: z.infer<typeof querySchema>;
    provenance: readonly z.infer<typeof modelCandidateProvenanceSchema>[];
  },
  context: z.core.$RefinementCtx,
): void {
  const { events, provenance } = value;
  const expectedCandidateDigest = contentDigest({
    schema: "covenant.timeline.model-proposal-candidate.v1",
    requestId: value.requestId,
    baseRunDigest: value.baseRunDigest,
    proposalDigest: value.proposalDigest,
    candidateEvents: value.events,
    candidateQuery: value.query,
    provenance: value.provenance,
  } as unknown as JsonValue);
  if (value.candidateDigest !== expectedCandidateDigest) {
    context.addIssue({
      code: "custom",
      message: "candidate digest must match the compiled artifact",
      path: ["candidateDigest"],
      input: value,
    });
  }
  if (events.length !== provenance.length) {
    context.addIssue({
      code: "custom",
      message: "events and provenance must have equal length",
      path: ["provenance"],
      input: value,
    });
    return;
  }

  events.forEach((event, index) => {
    if (event.sequence !== value.baseRevision + index) {
      context.addIssue({
        code: "custom",
        message: "event sequence must match the candidate base revision",
        path: ["events", index, "sequence"],
        input: value,
      });
    }
    const eventProvenance = provenance[index];
    if (!eventProvenance) return;
    if (event.id !== eventProvenance.candidateEventId) {
      context.addIssue({
        code: "custom",
        message: "provenance must match event order",
        path: ["provenance", index, "candidateEventId"],
        input: value,
      });
    }
    const eventEvidenceRefs =
      event.type === "assertion.retracted"
        ? event.evidenceRefs
        : event.assertion.evidenceRefs;
    if (
      eventEvidenceRefs.length !== eventProvenance.evidenceRefs.length ||
      eventEvidenceRefs.some(
        (reference, referenceIndex) =>
          reference !== eventProvenance.evidenceRefs[referenceIndex],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "provenance evidence references must match the event",
        path: ["provenance", index, "evidenceRefs"],
        input: value,
      });
    }
    const supportEvidenceRefs = [
      ...new Set(
        eventProvenance.supports.map(({ evidenceRef }) => evidenceRef),
      ),
    ].sort();
    const uniqueEventEvidenceRefs = [...new Set(eventEvidenceRefs)].sort();
    if (
      supportEvidenceRefs.length !== uniqueEventEvidenceRefs.length ||
      supportEvidenceRefs.some(
        (reference, referenceIndex) =>
          reference !== uniqueEventEvidenceRefs[referenceIndex],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "support evidence references must match the event",
        path: ["provenance", index, "supports"],
        input: value,
      });
    }
  });
}

export const previewModelProposalOutputSchema = z
  .object({
    ...compiledModelProposalOutputFields,
    timeline: metadataSchema,
    conclusion: conclusionSchema,
    persistence: z
      .literal("not-admitted")
      .describe("Preview only. No candidate event was persisted."),
    verified: z.literal(true),
  })
  .strict()
  .superRefine(validateCandidateProvenance);

export const admitModelProposalOutputSchema = z
  .object({
    ...compiledModelProposalOutputFields,
    admissionStatus: z
      .enum(["admitted", "already-admitted", "empty-candidate"])
      .describe(
        "Whether this call wrote the candidate, found the exact prior admission, or had no candidate events to persist.",
      ),
    timeline: metadataSchema,
    admissionRecord: z.union([modelProposalAdmissionRecordSchema, z.null()]),
  })
  .strict()
  .superRefine((value, context) => {
    validateCandidateProvenance(value, context);
    const { admissionRecord, events } = value;
    const minimumRevision = value.baseRevision + events.length;
    if (
      value.timeline.revision < minimumRevision ||
      (value.admissionStatus === "admitted" &&
        value.timeline.revision !== minimumRevision)
    ) {
      context.addIssue({
        code: "custom",
        message: "timeline revision must contain the candidate events",
        path: ["timeline", "revision"],
        input: value,
      });
    }
    if (events.length === 0) {
      if (
        value.admissionStatus !== "empty-candidate" ||
        admissionRecord !== null
      ) {
        context.addIssue({
          code: "custom",
          message:
            "an empty candidate requires empty-candidate status and no admission record",
          path: ["admissionStatus"],
          input: value,
        });
      }
      return;
    }
    if (value.admissionStatus === "empty-candidate") {
      context.addIssue({
        code: "custom",
        message: "a non-empty candidate cannot have empty-candidate status",
        path: ["admissionStatus"],
        input: value,
      });
    }
    if (!admissionRecord) {
      context.addIssue({
        code: "custom",
        message: "candidate events require an admission record",
        path: ["admissionRecord"],
        input: value,
      });
      return;
    }
    if (
      admissionRecord.baseRevision !== value.baseRevision ||
      admissionRecord.baseRunDigest !== value.baseRunDigest ||
      admissionRecord.candidateDigest !== value.candidateDigest ||
      admissionRecord.proposalDigest !== value.proposalDigest ||
      admissionRecord.eventIds.length !== events.length ||
      admissionRecord.eventIds.some((id, index) => id !== events[index]?.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "admission record must bind the compiled candidate",
        path: ["admissionRecord"],
        input: value,
      });
    }
  });

function validateAdmissionRecordDigest(
  value: Record<string, unknown> & { recordDigest: string },
  context: z.core.$RefinementCtx,
): void {
  const { recordDigest, ...record } = value;
  if (contentDigest(record as unknown as JsonValue) === recordDigest) return;
  context.addIssue({
    code: "custom",
    message: "admission record digest must match its content",
    path: ["recordDigest"],
    input: value,
  });
}

export const projectStateInputSchema = z
  .object({
    runId: identifierSchema.describe("Existing run to project."),
    contextId: identifierSchema.describe(
      "Contract context to project in isolation.",
    ),
    recordedThrough: recordedThroughSchema,
  })
  .strict();
export const projectStateOutputSchema = z
  .object({
    timeline: metadataSchema,
    state: projectedStateSchema,
  })
  .strict();

export const reasonInputSchema = z
  .object({
    runId: identifierSchema.describe("Existing run to reason over."),
    query: z
      .union([queryDraftSchema, querySchema])
      .describe(
        "Exact temporal query. A draft omits schema; a query returned by timeline_preview_model_proposal may be passed unchanged. Always pin recordedThrough explicitly.",
      ),
  })
  .strict();
export const reasonOutputSchema = z
  .object({
    timeline: metadataSchema,
    query: querySchema,
    conclusion: conclusionSchema,
    verified: z.literal(true),
  })
  .strict();

export type CreateRunInput = z.infer<typeof createRunInputSchema>;
export type ListRunsInput = z.infer<typeof listRunsInputSchema>;
export type AppendEventInput = z.infer<typeof appendEventInputSchema>;
export type PreviewModelProposalInput = z.infer<
  typeof previewModelProposalInputSchema
>;
export type AdmitModelProposalInput = z.infer<
  typeof admitModelProposalInputSchema
>;
export type ProjectStateInput = z.infer<typeof projectStateInputSchema>;
export type ReasonInput = z.infer<typeof reasonInputSchema>;

export function privateToolInputSchema<T extends z.ZodType>(
  schema: T,
): StandardSchemaWithJSON<z.input<T>, z.output<T>> {
  const standard = schema["~standard"];
  return {
    "~standard": {
      ...standard,
      validate(value, options) {
        const result = standard.validate(value, options);
        return result instanceof Promise
          ? result.then(redactValidationIssues)
          : redactValidationIssues(result);
      },
    },
  };
}

function redactValidationIssues<Output>(
  result: StandardSchemaV1.Result<Output>,
): StandardSchemaV1.Result<Output> {
  if (!result.issues) return result;
  return { issues: [{ message: "tool input is invalid" }] };
}

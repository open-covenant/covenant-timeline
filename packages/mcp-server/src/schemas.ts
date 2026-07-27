import * as z from "zod/v4";
import { MCP_ADMISSION, MCP_KERNEL_LIMITS } from "./constants.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export const identifierSchema = z.string().regex(IDENTIFIER);
export const digestSchema = z.string().regex(DIGEST);
export const safeIntegerSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
export const sequenceSchema = safeIntegerSchema.min(0);
export const recordedThroughSchema = z.union([sequenceSchema, z.null()]);

export const subjectSchema = z
  .object({
    kind: identifierSchema,
    id: identifierSchema,
  })
  .strict();

export const axisSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(["metric", "ordinal"]),
    unit: identifierSchema,
    origin: identifierSchema,
  })
  .strict();

export const contextSchema = z
  .object({
    id: identifierSchema,
    mode: z.enum(["actual", "forecast", "hypothetical", "planned"]),
  })
  .strict();

export const contractSchema = z
  .object({
    schema: z.literal("covenant.timeline.contract.v0alpha3"),
    id: identifierSchema,
    subject: subjectSchema,
    axes: z.array(axisSchema).min(1).max(MCP_KERNEL_LIMITS.maxAxes),
    contexts: z.array(contextSchema).min(1).max(MCP_KERNEL_LIMITS.maxContexts),
  })
  .strict();

const pointSchema = z
  .object({
    id: identifierSchema,
    contextId: identifierSchema,
    axisId: identifierSchema,
  })
  .strict();

const intervalSchema = z
  .object({
    id: identifierSchema,
    contextId: identifierSchema,
    startPointId: identifierSchema,
    endPointId: identifierSchema,
  })
  .strict();

const coordinateSchema = z.union([
  z
    .object({
      minimum: safeIntegerSchema,
      maximum: safeIntegerSchema,
    })
    .strict(),
  z.object({ minimum: safeIntegerSchema }).strict(),
  z.object({ maximum: safeIntegerSchema }).strict(),
]);

const differenceConstraintSchema = z.union([
  z
    .object({
      fromPointId: identifierSchema,
      toPointId: identifierSchema,
      minimum: safeIntegerSchema,
      maximum: safeIntegerSchema,
    })
    .strict(),
  z
    .object({
      fromPointId: identifierSchema,
      toPointId: identifierSchema,
      minimum: safeIntegerSchema,
    })
    .strict(),
  z
    .object({
      fromPointId: identifierSchema,
      toPointId: identifierSchema,
      maximum: safeIntegerSchema,
    })
    .strict(),
]);

const evidenceRefsSchema = z
  .array(digestSchema)
  .min(1)
  .max(MCP_KERNEL_LIMITS.maxEvidenceRefs);
const supersedesSchema = z
  .array(identifierSchema)
  .min(1)
  .max(MCP_KERNEL_LIMITS.maxAssertions)
  .optional();

const coordinateAssertionSchema = z
  .object({
    id: identifierSchema,
    contextId: identifierSchema,
    pointId: identifierSchema,
    coordinate: coordinateSchema,
    evidenceRefs: evidenceRefsSchema,
    supersedes: supersedesSchema,
  })
  .strict();

const constraintAssertionSchema = z
  .object({
    id: identifierSchema,
    contextId: identifierSchema,
    constraint: differenceConstraintSchema,
    evidenceRefs: evidenceRefsSchema,
    supersedes: supersedesSchema,
  })
  .strict();

const factAssertionSchema = z
  .object({
    id: identifierSchema,
    contextId: identifierSchema,
    propositionRef: identifierSchema,
    validDuring: identifierSchema.optional(),
    observedAt: identifierSchema.optional(),
    assertedAt: identifierSchema.optional(),
    evidenceRefs: evidenceRefsSchema,
    supersedes: supersedesSchema,
  })
  .strict();

const pointDraftSchema = z
  .object({
    id: identifierSchema,
    type: z.literal("point.declared"),
    point: pointSchema,
  })
  .strict();

const intervalDraftSchema = z
  .object({
    id: identifierSchema,
    type: z.literal("interval.declared"),
    interval: intervalSchema,
  })
  .strict();

const constraintDraftSchema = z
  .object({
    id: identifierSchema,
    type: z.literal("constraint.asserted"),
    assertion: constraintAssertionSchema,
  })
  .strict();

const coordinateDraftSchema = z
  .object({
    id: identifierSchema,
    type: z.literal("coordinate.asserted"),
    assertion: coordinateAssertionSchema,
  })
  .strict();

const factDraftSchema = z
  .object({
    id: identifierSchema,
    type: z.literal("fact.asserted"),
    assertion: factAssertionSchema,
  })
  .strict();

const retractionDraftSchema = z
  .object({
    id: identifierSchema,
    type: z.literal("assertion.retracted"),
    assertionId: identifierSchema,
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

const queryFields = {
  id: identifierSchema,
  contextId: identifierSchema,
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
    fromPointId: identifierSchema,
    toPointId: identifierSchema,
  })
  .strict();

const pointQueryDraftSchema = z
  .object({
    ...queryFields,
    type: z.literal("point.relations"),
    leftPointId: identifierSchema,
    rightPointId: identifierSchema,
  })
  .strict();

const intervalQueryDraftSchema = z
  .object({
    ...queryFields,
    type: z.literal("interval.relations"),
    leftIntervalId: identifierSchema,
    rightIntervalId: identifierSchema,
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
    subject: subjectSchema,
    contexts: z.array(contextSchema).max(MCP_KERNEL_LIMITS.maxContexts),
    eventCount: sequenceSchema,
    latestRecordedThrough: recordedThroughSchema,
    runDigest: digestSchema,
  })
  .strict();

const admissionSchema = z
  .object({
    mode: z.literal(MCP_ADMISSION.mode),
    assertionAuthority: z.literal(MCP_ADMISSION.assertionAuthority),
    evidencePayloads: z.literal(MCP_ADMISSION.evidencePayloads),
  })
  .strict();

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
  .object({ contract: contractSchema })
  .strict();
export const createRunOutputSchema = z
  .object({
    created: z.boolean(),
    timeline: metadataSchema,
    admission: admissionSchema,
  })
  .strict();

export const listRunsInputSchema = z.object({}).strict();
export const listRunsOutputSchema = z
  .object({
    timelines: z.array(metadataSchema).max(256),
  })
  .strict();

export const appendEventInputSchema = z
  .object({
    runId: identifierSchema,
    expectedRunDigest: digestSchema,
    event: eventDraftSchema,
  })
  .strict();
export const appendEventOutputSchema = z
  .object({
    appended: z.boolean(),
    event: eventSchema,
    timeline: metadataSchema,
    admission: admissionSchema,
  })
  .strict();

export const projectStateInputSchema = z
  .object({
    runId: identifierSchema,
    contextId: identifierSchema,
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
    runId: identifierSchema,
    query: queryDraftSchema,
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
export type AppendEventInput = z.infer<typeof appendEventInputSchema>;
export type ProjectStateInput = z.infer<typeof projectStateInputSchema>;
export type ReasonInput = z.infer<typeof reasonInputSchema>;

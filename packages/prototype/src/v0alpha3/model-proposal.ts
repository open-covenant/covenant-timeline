import {
  byteDigest,
  canonicalJson,
  contentDigest,
  TimelineCanonicalizationError,
  type JsonValue,
} from "../identity.js";
import { TimelineDocumentError } from "../document.js";
import {
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  validateRunDocumentV0Alpha3Bounded,
} from "./document.js";
import type {
  TemporalEventV0Alpha3,
  TemporalQueryV0Alpha3,
  TimelineRunDocumentV0Alpha3,
} from "./types.js";

export type TemporalModelProposalBoundsV1 =
  | {
      readonly type: "closed-range";
      readonly minimum: number;
      readonly maximum: number;
    }
  | { readonly type: "exact"; readonly value: number }
  | { readonly type: "lower-bound"; readonly minimum: number }
  | { readonly type: "upper-bound"; readonly maximum: number };

export interface TemporalModelProposalSupportV1 {
  readonly evidenceId: string;
  readonly quote: string;
}

export type TemporalModelProposalRevisionV1 =
  | { readonly type: "keep" }
  | { readonly type: "supersede"; readonly assertionHandle: string };

export interface TemporalModelCoordinateChangeV1 {
  readonly type: "coordinate";
  readonly pointHandle: string;
  readonly bounds: TemporalModelProposalBoundsV1;
  readonly supports: readonly TemporalModelProposalSupportV1[];
  readonly revision: TemporalModelProposalRevisionV1;
}

export interface TemporalModelConstraintChangeV1 {
  readonly type: "constraint";
  readonly differenceHandle: string;
  readonly bounds: TemporalModelProposalBoundsV1;
  readonly supports: readonly TemporalModelProposalSupportV1[];
  readonly revision: TemporalModelProposalRevisionV1;
}

export interface TemporalModelRetractionChangeV1 {
  readonly type: "retraction";
  readonly assertionHandle: string;
  readonly supports: readonly TemporalModelProposalSupportV1[];
}

export type TemporalModelProposalChangeV1 =
  | TemporalModelConstraintChangeV1
  | TemporalModelCoordinateChangeV1
  | TemporalModelRetractionChangeV1;

export type TemporalModelKnowledgeCutIntentV1 =
  | { readonly type: "current" }
  | { readonly type: "prior"; readonly cutHandle: string };

export type TemporalModelQueryIntentV1 =
  | {
      readonly type: "consistency";
      readonly targetHandle: string;
      readonly knowledgeCut: TemporalModelKnowledgeCutIntentV1;
    }
  | {
      readonly type: "difference";
      readonly targetHandle: string;
      readonly knowledgeCut: TemporalModelKnowledgeCutIntentV1;
    }
  | {
      readonly type: "interval-relation";
      readonly targetHandle: string;
      readonly knowledgeCut: TemporalModelKnowledgeCutIntentV1;
    }
  | {
      readonly type: "point-relation";
      readonly targetHandle: string;
      readonly knowledgeCut: TemporalModelKnowledgeCutIntentV1;
    };

export interface TemporalModelProposalV1 {
  readonly schema: "covenant.timeline.model-proposal.v1";
  readonly requestId: string;
  readonly changes: readonly TemporalModelProposalChangeV1[];
  readonly query: TemporalModelQueryIntentV1;
}

export interface TemporalModelEvidenceCatalogEntryV1 {
  readonly id: string;
  readonly status: "current" | "stale";
  readonly text: string;
}

export type TemporalModelReferenceCatalogEntryV1 =
  | {
      readonly type: "context";
      readonly handle: string;
      readonly contextId: string;
    }
  | {
      readonly type: "difference";
      readonly handle: string;
      readonly fromPointId: string;
      readonly toPointId: string;
    }
  | {
      readonly type: "interval-relation";
      readonly handle: string;
      readonly leftIntervalId: string;
      readonly rightIntervalId: string;
    }
  | {
      readonly type: "point";
      readonly handle: string;
      readonly pointId: string;
    }
  | {
      readonly type: "point-relation";
      readonly handle: string;
      readonly leftPointId: string;
      readonly rightPointId: string;
    };

export interface TemporalModelAssertionCatalogEntryV1 {
  readonly handle: string;
  readonly assertionId: string;
}

export interface TemporalModelKnowledgeCutCatalogEntryV1 {
  readonly handle: string;
  readonly recordedThrough: number | null;
}

export interface TemporalModelProposalHostV1 {
  readonly run: TimelineRunDocumentV0Alpha3;
  readonly expectedRequestId: string;
  readonly evidenceCatalog: readonly TemporalModelEvidenceCatalogEntryV1[];
  readonly referenceCatalog: readonly TemporalModelReferenceCatalogEntryV1[];
  readonly assertionCatalog?: readonly TemporalModelAssertionCatalogEntryV1[];
  readonly knowledgeCutCatalog?: readonly TemporalModelKnowledgeCutCatalogEntryV1[];
}

export interface TemporalModelProposalLimitsV1 {
  readonly maxAssertionCatalogEntries: number;
  readonly maxChanges: number;
  readonly maxEvidenceBytes: number;
  readonly maxEvidenceCatalogEntries: number;
  readonly maxKnowledgeCutCatalogEntries: number;
  readonly maxProposalBytes: number;
  readonly maxProposalDepth: number;
  readonly maxProposalNodes: number;
  readonly maxQuoteBytes: number;
  readonly maxReferenceCatalogEntries: number;
  readonly maxSupportsPerChange: number;
  readonly maxTotalEvidenceBytes: number;
}

export type TemporalModelProposalLimitOptionsV1 =
  Partial<TemporalModelProposalLimitsV1>;

export interface TemporalModelProposalOutputSchemaV1 {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonValue>>;
  readonly required: readonly ["schema", "requestId", "changes", "query"];
  readonly additionalProperties: false;
  readonly $defs: Readonly<Record<string, JsonValue>>;
}

export const DEFAULT_TEMPORAL_MODEL_PROPOSAL_LIMITS_V1: Readonly<TemporalModelProposalLimitsV1> =
  Object.freeze({
    maxAssertionCatalogEntries: 1_024,
    maxChanges: 32,
    maxEvidenceBytes: 65_536,
    maxEvidenceCatalogEntries: 256,
    maxKnowledgeCutCatalogEntries: 256,
    maxProposalBytes: 1_310_720,
    maxProposalDepth: 12,
    maxProposalNodes: 4_096,
    maxQuoteBytes: 4_096,
    maxReferenceCatalogEntries: 1_024,
    maxSupportsPerChange: 8,
    maxTotalEvidenceBytes: 1_048_576,
  });

export const TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1 = Object.freeze({
  maxCatalogValues: 512,
  maxChanges: 8,
  maxEnumValues: 1_000,
  maxHostBytes: 67_108_864,
  maxHostDepth: 128,
  maxHostNodes: 1_100_000,
  maxSchemaBytes: 65_536,
  maxStringEnumCharacters: 15_000,
  maxSupportsPerChange: 4,
  stringEnumCharacterThreshold: 250,
});

export type TemporalModelProposalIssueCodeV1 =
  | "model-proposal.candidate"
  | "model-proposal.duplicate"
  | "model-proposal.invalid"
  | "model-proposal.limit"
  | "model-proposal.reference"
  | "model-proposal.stale"
  | "model-proposal.support";

export interface TemporalModelProposalIssueV1 {
  readonly code: TemporalModelProposalIssueCodeV1;
  readonly path: string;
  readonly message: string;
}

export class TemporalModelProposalErrorV1 extends Error {
  readonly code = "model-proposal.rejected";
  readonly issues: readonly TemporalModelProposalIssueV1[];

  constructor(issues: readonly TemporalModelProposalIssueV1[]) {
    const ordered = [...issues].sort(compareIssues);
    super(
      ordered
        .map(({ code, path, message }) => `${code} ${path}: ${message}`)
        .join("; "),
    );
    this.name = "TemporalModelProposalErrorV1";
    this.issues = Object.freeze(
      ordered.map((entry) => Object.freeze({ ...entry })),
    );
  }
}

export interface TemporalModelSupportReceiptV1 {
  readonly evidenceId: string;
  readonly evidenceRef: `sha256:${string}`;
  readonly quoteDigest: `sha256:${string}`;
  readonly utf8EndByte: number;
  readonly utf8StartByte: number;
}

export interface TemporalModelCandidateProvenanceV1 {
  readonly candidateEventId: string;
  readonly evidenceRefs: readonly `sha256:${string}`[];
  readonly supports: readonly TemporalModelSupportReceiptV1[];
}

export interface TemporalModelProposalCandidateV1 {
  readonly schema: "covenant.timeline.model-proposal-candidate.v1";
  readonly requestId: string;
  readonly baseRunDigest: `sha256:${string}`;
  readonly proposalDigest: `sha256:${string}`;
  readonly candidateEvents: readonly TemporalEventV0Alpha3[];
  readonly candidateQuery: TemporalQueryV0Alpha3;
  readonly provenance: readonly TemporalModelCandidateProvenanceV1[];
}

interface EvidenceRecord {
  readonly digest: `sha256:${string}`;
  readonly entry: TemporalModelEvidenceCatalogEntryV1;
}

interface AssertionRecord {
  readonly contextId: string;
  readonly id: string;
  readonly kind: "constraint" | "coordinate" | "fact";
  readonly fromPointId?: string;
  readonly pointId?: string;
  readonly toPointId?: string;
}

interface ResolvedSupport {
  readonly evidenceId: string;
  readonly evidenceRef: `sha256:${string}`;
  readonly quoteDigest: `sha256:${string}`;
  readonly utf8EndByte: number;
  readonly utf8StartByte: number;
}

interface AssertionPlan {
  readonly kind: "constraint" | "coordinate";
  readonly body: Readonly<Record<string, JsonValue>>;
  readonly sortKey: string;
  readonly supports: readonly ResolvedSupport[];
}

interface RetractionPlan {
  readonly kind: "retraction";
  readonly assertionId: string;
  readonly evidenceRefs: readonly `sha256:${string}`[];
  readonly sortKey: string;
  readonly supports: readonly ResolvedSupport[];
}

type ChangePlan = AssertionPlan | RetractionPlan;

interface Catalogs {
  readonly assertions: ReadonlyMap<string, string>;
  readonly cuts: ReadonlyMap<string, number | null>;
  readonly evidence: ReadonlyMap<string, EvidenceRecord>;
  readonly references: ReadonlyMap<
    string,
    TemporalModelReferenceCatalogEntryV1
  >;
}

interface Declarations {
  readonly intervals: ReadonlyMap<
    string,
    { readonly contextId: string; readonly axisId: string }
  >;
  readonly points: ReadonlyMap<
    string,
    { readonly contextId: string; readonly axisId: string }
  >;
}

interface PreparedModelProposalHost {
  readonly activeAssertions: ReadonlySet<string>;
  readonly assertions: ReadonlyMap<string, AssertionRecord>;
  readonly catalogs: Catalogs;
  readonly declarations: Declarations;
  readonly host: TemporalModelProposalHostV1;
  readonly run: TimelineRunDocumentV0Alpha3;
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const SIMPLE_PATH_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const MAX_VALIDATION_ISSUES = 64;
const MAX_ISSUE_PATH_LENGTH = 256;
const MAX_ISSUE_MESSAGE_LENGTH = 512;
const CANDIDATE_PREFLIGHT_LIMITS = Object.freeze({
  maxBytes: 1_048_576,
  maxDepth: 24,
  maxNodes: 8_192,
});
const HOST_PREFLIGHT_LIMITS = Object.freeze({
  maxBytes: TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxHostBytes,
  maxDepth: TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxHostDepth,
  maxNodes: TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxHostNodes,
});
const textEncoder = new TextEncoder();

/**
 * Projects a validated, request-scoped host into a provider JSON Schema.
 * Compilation remains authoritative for all semantic and resource checks.
 */
export function createTemporalModelProposalOutputSchemaV1(
  host: TemporalModelProposalHostV1,
  options: TemporalModelProposalLimitOptionsV1 = {},
): TemporalModelProposalOutputSchemaV1 {
  const limits = resolveLimits(options);
  assertBoundedJson(host, "host", HOST_PREFLIGHT_LIMITS);
  const prepared = prepareModelProposalHost(host, limits);
  validateModelProposalOutputReferences(prepared);
  const schema = buildModelProposalOutputSchema(prepared, limits);
  validateModelProposalOutputSchemaEnums(schema);
  const schemaBytes = textEncoder.encode(
    canonicalJson(schema as unknown as JsonValue),
  ).byteLength;
  if (
    schemaBytes > TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxSchemaBytes
  ) {
    throw new TemporalModelProposalErrorV1([
      issue(
        "model-proposal.limit",
        "host",
        `request-scoped output schema must not exceed ${TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxSchemaBytes} bytes`,
      ),
    ]);
  }
  return deepFreeze(schema);
}

/**
 * Compiles untrusted model output into deterministic candidates. Quote matching
 * proves source location only; the caller remains responsible for semantic,
 * authenticity, authority, and admission decisions.
 */
export function compileTemporalModelProposalV1(
  value: unknown,
  host: TemporalModelProposalHostV1,
  options: TemporalModelProposalLimitOptionsV1 = {},
): TemporalModelProposalCandidateV1 {
  const limits = resolveLimits(options);
  const proposal = parseProposal(value, limits);
  const prepared = prepareModelProposalHost(host, limits);
  requireRequestId(proposal.requestId, prepared.host.expectedRequestId);
  const baseRun = prepared.run;
  const assertions = prepared.assertions;
  const declarations = prepared.declarations;
  const activeAssertions = prepared.activeAssertions;
  const catalogs = prepared.catalogs;

  const issues: TemporalModelProposalIssueV1[] = [];
  const plans: ChangePlan[] = [];
  const usedChangeBodies = new Map<string, string>();
  const revisedAssertions = new Map<string, string>();

  proposal.changes.forEach((change, index) => {
    const path = `changes[${index}]`;
    const supports = resolveSupports(
      change.supports,
      `${path}.supports`,
      catalogs.evidence,
      limits,
      issues,
    );
    const evidenceRefs = uniqueSorted(
      supports.map(({ evidenceRef }) => evidenceRef),
    );

    if (change.type === "retraction") {
      const assertion = resolveAssertion(
        change.assertionHandle,
        `${path}.assertionHandle`,
        catalogs.assertions,
        assertions,
        activeAssertions,
        issues,
      );
      if (!assertion) return;
      reserveRevision(assertion.id, path, revisedAssertions, issues);
      const material = {
        assertionId: assertion.id,
        evidenceRefs,
        type: "assertion.retracted",
      } as const;
      const plan: RetractionPlan = {
        kind: "retraction",
        assertionId: assertion.id,
        evidenceRefs,
        sortKey: contentDigest(material),
        supports,
      };
      reserveChange(plan.sortKey, path, usedChangeBodies, issues);
      plans.push(plan);
      return;
    }

    const referenceHandle =
      change.type === "coordinate"
        ? change.pointHandle
        : change.differenceHandle;
    const referencePath =
      change.type === "coordinate"
        ? `${path}.pointHandle`
        : `${path}.differenceHandle`;
    const reference = resolveReference(
      referenceHandle,
      referencePath,
      change.type === "coordinate" ? "point" : "difference",
      catalogs.references,
      issues,
    );
    if (!reference) return;

    const contextId =
      reference.type === "point"
        ? declarations.points.get(reference.pointId)?.contextId
        : declarations.points.get(reference.fromPointId)?.contextId;
    if (!contextId) {
      addIssue(
        issues,
        "model-proposal.reference",
        referencePath,
        "maps to a point that is not declared by the base run",
      );
      return;
    }
    const supersedes = resolveRevision(
      change.revision,
      `${path}.revision`,
      catalogs.assertions,
      assertions,
      activeAssertions,
      contextId,
      change.type,
      reference,
      issues,
    );
    if (supersedes) {
      reserveRevision(supersedes, path, revisedAssertions, issues);
    }

    const bounds = compileBounds(change.bounds);
    const body =
      change.type === "coordinate" && reference.type === "point"
        ? ({
            contextId,
            pointId: reference.pointId,
            coordinate: bounds,
            evidenceRefs,
            ...(supersedes ? { supersedes: [supersedes] } : {}),
          } satisfies Record<string, JsonValue>)
        : change.type === "constraint" && reference.type === "difference"
          ? ({
              contextId,
              constraint: {
                fromPointId: reference.fromPointId,
                toPointId: reference.toPointId,
                ...bounds,
              },
              evidenceRefs,
              ...(supersedes ? { supersedes: [supersedes] } : {}),
            } satisfies Record<string, JsonValue>)
          : undefined;
    if (!body) {
      addIssue(
        issues,
        "model-proposal.reference",
        referencePath,
        "reference type is incompatible with the change",
      );
      return;
    }
    const plan: AssertionPlan = {
      kind: change.type,
      body,
      sortKey: contentDigest({
        body,
        type:
          change.type === "coordinate"
            ? "coordinate.asserted"
            : "constraint.asserted",
      }),
      supports,
    };
    reserveChange(plan.sortKey, path, usedChangeBodies, issues);
    plans.push(plan);
  });

  if (issues.length > 0) throw new TemporalModelProposalErrorV1(issues);

  plans.sort((left, right) => compareStrings(left.sortKey, right.sortKey));
  const candidateEvents: TemporalEventV0Alpha3[] = [];
  const provenance: TemporalModelCandidateProvenanceV1[] = [];

  plans.forEach((plan, index) => {
    const sequence = baseRun.events.length + index;
    const event = materializeEvent(plan, sequence);
    candidateEvents.push(event);
    provenance.push({
      candidateEventId: event.id,
      evidenceRefs:
        plan.kind === "retraction"
          ? plan.evidenceRefs
          : (plan.body.evidenceRefs as readonly `sha256:${string}`[]),
      supports: [...plan.supports].sort(compareSupports),
    });
  });

  const candidateRun: TimelineRunDocumentV0Alpha3 = {
    schema: "covenant.timeline.run.v0alpha3",
    contract: baseRun.contract,
    events: [...baseRun.events, ...candidateEvents],
  };
  parseCandidateRun(candidateRun);
  const candidateQuery = compileQuery(
    proposal.query,
    catalogs,
    declarations,
    baseRun.events.length,
    candidateRun,
  );

  return deepFreeze({
    schema: "covenant.timeline.model-proposal-candidate.v1",
    requestId: proposal.requestId,
    baseRunDigest: contentDigest(baseRun as unknown as JsonValue),
    proposalDigest: contentDigest(proposal as unknown as JsonValue),
    candidateEvents,
    candidateQuery,
    provenance,
  });
}

/**
 * Recompiles a proposal against the same host-owned inputs and compares the
 * complete candidate artifact. JSON Schema validation alone is not an
 * integrity check.
 */
export function verifyTemporalModelProposalCandidateV1(
  candidate: unknown,
  proposal: unknown,
  host: TemporalModelProposalHostV1,
  options: TemporalModelProposalLimitOptionsV1 = {},
): candidate is TemporalModelProposalCandidateV1 {
  try {
    assertBoundedJson(candidate, "candidate", CANDIDATE_PREFLIGHT_LIMITS);
    const expected = compileTemporalModelProposalV1(proposal, host, options);
    return (
      canonicalJson(candidate as JsonValue) ===
      canonicalJson(expected as unknown as JsonValue)
    );
  } catch {
    return false;
  }
}

function parseProposal(
  value: unknown,
  limits: TemporalModelProposalLimitsV1,
): TemporalModelProposalV1 {
  assertBoundedJson(value, "$", {
    maxBytes: limits.maxProposalBytes,
    maxDepth: limits.maxProposalDepth,
    maxNodes: limits.maxProposalNodes,
  });
  const issues: TemporalModelProposalIssueV1[] = [];
  const proposal = record(value);
  if (!proposal) {
    throw new TemporalModelProposalErrorV1([
      issue("model-proposal.invalid", "$", "must be an object"),
    ]);
  }
  exactKeys(proposal, ["schema", "requestId", "changes", "query"], "$", issues);
  if (proposal.schema !== "covenant.timeline.model-proposal.v1") {
    addIssue(
      issues,
      "model-proposal.invalid",
      "schema",
      "must identify covenant.timeline.model-proposal.v1",
    );
  }
  identifier(proposal.requestId, "requestId", issues);
  if (!Array.isArray(proposal.changes)) {
    addIssue(issues, "model-proposal.invalid", "changes", "must be an array");
  } else {
    if (proposal.changes.length > limits.maxChanges) {
      addIssue(
        issues,
        "model-proposal.limit",
        "changes",
        `must contain at most ${limits.maxChanges} entries`,
      );
    }
    proposal.changes
      .slice(0, limits.maxChanges)
      .forEach((change, index) =>
        validateChange(change, `changes[${index}]`, limits, issues),
      );
  }
  validateQueryIntent(proposal.query, "query", issues);
  appendCanonicalIssue(proposal, issues);
  if (issues.length > 0) throw new TemporalModelProposalErrorV1(issues);
  return proposal as unknown as TemporalModelProposalV1;
}

function parseHost(value: unknown): TemporalModelProposalHostV1 {
  const host = record(value);
  if (!host) {
    throw new TemporalModelProposalErrorV1([
      issue("model-proposal.invalid", "host", "must be a plain object"),
    ]);
  }
  const issues: TemporalModelProposalIssueV1[] = [];
  exactKeys(
    host,
    [
      "run",
      "expectedRequestId",
      "evidenceCatalog",
      "referenceCatalog",
      "assertionCatalog",
      "knowledgeCutCatalog",
    ],
    "host",
    issues,
  );
  identifier(host.expectedRequestId, "host.expectedRequestId", issues);
  if (issues.length > 0) throw new TemporalModelProposalErrorV1(issues);
  return host as unknown as TemporalModelProposalHostV1;
}

function prepareModelProposalHost(
  value: TemporalModelProposalHostV1,
  limits: TemporalModelProposalLimitsV1,
): PreparedModelProposalHost {
  const host = parseHost(value);
  const run = parseBaseRun(host.run);
  return {
    activeAssertions: collectActiveAssertionIds(run),
    assertions: collectAssertions(run),
    catalogs: parseCatalogs(host, run, limits),
    declarations: collectDeclarations(run),
    host,
    run,
  };
}

function validateModelProposalOutputReferences(
  prepared: PreparedModelProposalHost,
): void {
  const contexts = new Set(prepared.run.contract.contexts.map(({ id }) => id));
  const issues: TemporalModelProposalIssueV1[] = [];

  for (const [handle, reference] of prepared.catalogs.references) {
    const path = childPath("host.referenceCatalog", handle);
    if (reference.type === "context") {
      if (!contexts.has(reference.contextId)) {
        addIssue(
          issues,
          "model-proposal.reference",
          path,
          "must identify a declared temporal context",
        );
      }
      continue;
    }
    if (reference.type === "point") {
      if (!prepared.declarations.points.has(reference.pointId)) {
        addIssue(
          issues,
          "model-proposal.reference",
          path,
          "must identify a declared temporal point",
        );
      }
      continue;
    }
    if (reference.type === "interval-relation") {
      validateModelProposalOutputReferencePair(
        prepared.declarations.intervals.get(reference.leftIntervalId),
        prepared.declarations.intervals.get(reference.rightIntervalId),
        "intervals",
        path,
        issues,
      );
      continue;
    }
    const leftPointId =
      reference.type === "difference"
        ? reference.fromPointId
        : reference.leftPointId;
    const rightPointId =
      reference.type === "difference"
        ? reference.toPointId
        : reference.rightPointId;
    validateModelProposalOutputReferencePair(
      prepared.declarations.points.get(leftPointId),
      prepared.declarations.points.get(rightPointId),
      "points",
      path,
      issues,
    );
  }

  if (issues.length > 0) throw new TemporalModelProposalErrorV1(issues);
}

function validateModelProposalOutputReferencePair(
  left: { readonly contextId: string; readonly axisId: string } | undefined,
  right: { readonly contextId: string; readonly axisId: string } | undefined,
  kind: "intervals" | "points",
  path: string,
  issues: TemporalModelProposalIssueV1[],
): void {
  if (!left || !right) {
    addIssue(
      issues,
      "model-proposal.reference",
      path,
      `must identify two declared temporal ${kind}`,
    );
    return;
  }
  if (left.contextId !== right.contextId) {
    addIssue(
      issues,
      "model-proposal.reference",
      path,
      `must identify ${kind} in the same temporal context`,
    );
  }
  if (left.axisId !== right.axisId) {
    addIssue(
      issues,
      "model-proposal.reference",
      path,
      `must identify ${kind} on the same temporal axis`,
    );
  }
}

interface ModelProposalOutputScope {
  readonly activeAssertionHandles: readonly string[];
  readonly constraintAssertionHandles: readonly string[];
  readonly coordinateAssertionHandles: readonly string[];
  readonly currentEvidenceIds: readonly string[];
  readonly cutHandles: readonly string[];
  readonly referenceHandles: Readonly<
    Record<TemporalModelReferenceCatalogEntryV1["type"], readonly string[]>
  >;
}

function buildModelProposalOutputSchema(
  prepared: PreparedModelProposalHost,
  limits: TemporalModelProposalLimitsV1,
): TemporalModelProposalOutputSchemaV1 {
  const scope = collectModelProposalOutputScope(prepared);
  const catalogValues =
    scope.currentEvidenceIds.length +
    scope.activeAssertionHandles.length +
    scope.cutHandles.length +
    Object.values(scope.referenceHandles).reduce(
      (total, handles) => total + handles.length,
      0,
    );
  if (
    catalogValues >
    TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxCatalogValues
  ) {
    throw new TemporalModelProposalErrorV1([
      issue(
        "model-proposal.limit",
        "host",
        `request-scoped catalogs expose ${catalogValues} values; must not exceed ${TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxCatalogValues}`,
      ),
    ]);
  }

  const maxChanges = Math.min(
    limits.maxChanges,
    TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxChanges,
  );
  const maxSupportsPerChange = Math.min(
    limits.maxSupportsPerChange,
    TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxSupportsPerChange,
  );
  const definitions: Record<string, JsonValue> = {};
  const hasChangeTarget =
    scope.referenceHandles.point.length > 0 ||
    scope.referenceHandles.difference.length > 0 ||
    scope.activeAssertionHandles.length > 0;
  const changeVariants =
    scope.currentEvidenceIds.length === 0 || !hasChangeTarget
      ? []
      : modelProposalChangeSchemas(scope, maxSupportsPerChange, definitions);
  const queryVariants = modelProposalQuerySchemas(scope);
  if (queryVariants.length === 0) {
    throw new TemporalModelProposalErrorV1([
      issue(
        "model-proposal.reference",
        "host.referenceCatalog",
        "must expose at least one context, difference, point-relation, or interval-relation query handle",
      ),
    ]);
  }

  definitions.knowledgeCut = modelProposalKnowledgeCutSchema(scope.cutHandles);
  definitions.queryIntent = modelProposalSchemaVariants(queryVariants);

  const changes: JsonValue =
    changeVariants.length === 0
      ? {
          type: "array",
          items: modelProposalSchemaObject({}),
          maxItems: 0,
        }
      : {
          type: "array",
          items: modelProposalSchemaReference("change"),
          maxItems: maxChanges,
        };
  if (changeVariants.length > 0) {
    definitions.change = modelProposalSchemaVariants(changeVariants);
  }

  return {
    type: "object",
    properties: {
      schema: modelProposalSchemaLiteral("covenant.timeline.model-proposal.v1"),
      requestId: modelProposalSchemaLiteral(prepared.host.expectedRequestId),
      changes,
      query: modelProposalSchemaReference("queryIntent"),
    },
    required: ["schema", "requestId", "changes", "query"],
    additionalProperties: false,
    $defs: definitions,
  };
}

function validateModelProposalOutputSchemaEnums(
  schema: TemporalModelProposalOutputSchemaV1,
): void {
  let enumValues = 0;
  let oversizedStringEnum:
    | { readonly characters: number; readonly values: number }
    | undefined;

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key !== "enum" || !Array.isArray(child)) {
        visit(child);
        continue;
      }
      enumValues += child.length;
      if (
        child.length <=
        TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.stringEnumCharacterThreshold
      ) {
        continue;
      }
      const characters = child.reduce(
        (total, entry) =>
          total + (typeof entry === "string" ? Array.from(entry).length : 0),
        0,
      );
      if (
        characters >
          TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxStringEnumCharacters &&
        (!oversizedStringEnum || characters > oversizedStringEnum.characters)
      ) {
        oversizedStringEnum = { characters, values: child.length };
      }
    }
  };

  visit(schema);
  const issues: TemporalModelProposalIssueV1[] = [];
  if (
    enumValues > TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxEnumValues
  ) {
    addIssue(
      issues,
      "model-proposal.limit",
      "host",
      `request-scoped output schema exposes ${enumValues} enum values; must not exceed ${TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxEnumValues}`,
    );
  }
  if (oversizedStringEnum) {
    addIssue(
      issues,
      "model-proposal.limit",
      "host",
      `request-scoped output schema contains ${oversizedStringEnum.characters} string-enum characters across ${oversizedStringEnum.values} values; enums above ${TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.stringEnumCharacterThreshold} values must not exceed ${TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxStringEnumCharacters} characters`,
    );
  }
  if (issues.length > 0) throw new TemporalModelProposalErrorV1(issues);
}

function collectModelProposalOutputScope(
  prepared: PreparedModelProposalHost,
): ModelProposalOutputScope {
  const currentEvidenceIds = [...prepared.catalogs.evidence]
    .filter(([, { entry }]) => entry.status === "current")
    .map(([id]) => id)
    .sort(compareStrings);
  const referenceHandles: Record<
    TemporalModelReferenceCatalogEntryV1["type"],
    string[]
  > = {
    context: [],
    difference: [],
    "interval-relation": [],
    point: [],
    "point-relation": [],
  };
  for (const [handle, reference] of prepared.catalogs.references) {
    referenceHandles[reference.type].push(handle);
  }
  for (const handles of Object.values(referenceHandles)) {
    handles.sort(compareStrings);
  }

  const activeAssertionHandles: string[] = [];
  const constraintAssertionHandles: string[] = [];
  const coordinateAssertionHandles: string[] = [];
  for (const [handle, assertionId] of prepared.catalogs.assertions) {
    if (!prepared.activeAssertions.has(assertionId)) continue;
    const assertion = prepared.assertions.get(assertionId);
    if (!assertion) continue;
    activeAssertionHandles.push(handle);
    if (assertion.kind === "constraint") {
      constraintAssertionHandles.push(handle);
    } else if (assertion.kind === "coordinate") {
      coordinateAssertionHandles.push(handle);
    }
  }
  activeAssertionHandles.sort(compareStrings);
  constraintAssertionHandles.sort(compareStrings);
  coordinateAssertionHandles.sort(compareStrings);

  return {
    activeAssertionHandles,
    constraintAssertionHandles,
    coordinateAssertionHandles,
    currentEvidenceIds,
    cutHandles: [...prepared.catalogs.cuts.keys()].sort(compareStrings),
    referenceHandles,
  };
}

function modelProposalChangeSchemas(
  scope: ModelProposalOutputScope,
  maxSupportsPerChange: number,
  definitions: Record<string, JsonValue>,
): readonly JsonValue[] {
  definitions.safeInteger = { type: "integer" };
  definitions.support = modelProposalSchemaObject({
    evidenceId: modelProposalSchemaEnum(scope.currentEvidenceIds),
    quote: { type: "string" },
  });
  definitions.supports = {
    type: "array",
    items: modelProposalSchemaReference("support"),
    minItems: 1,
    maxItems: maxSupportsPerChange,
  };
  definitions.bounds = modelProposalSchemaVariants([
    modelProposalSchemaObject({
      type: modelProposalSchemaLiteral("exact"),
      value: modelProposalSchemaReference("safeInteger"),
    }),
    modelProposalSchemaObject({
      type: modelProposalSchemaLiteral("lower-bound"),
      minimum: modelProposalSchemaReference("safeInteger"),
    }),
    modelProposalSchemaObject({
      type: modelProposalSchemaLiteral("upper-bound"),
      maximum: modelProposalSchemaReference("safeInteger"),
    }),
    modelProposalSchemaObject({
      type: modelProposalSchemaLiteral("closed-range"),
      minimum: modelProposalSchemaReference("safeInteger"),
      maximum: modelProposalSchemaReference("safeInteger"),
    }),
  ]);

  const changes: JsonValue[] = [];
  if (scope.referenceHandles.point.length > 0) {
    const revisions: JsonValue[] = [
      modelProposalSchemaObject({
        type: modelProposalSchemaLiteral("keep"),
      }),
    ];
    if (scope.coordinateAssertionHandles.length > 0) {
      revisions.push(
        modelProposalSchemaObject({
          type: modelProposalSchemaLiteral("supersede"),
          assertionHandle: modelProposalSchemaEnum(
            scope.coordinateAssertionHandles,
          ),
        }),
      );
    }
    changes.push(
      modelProposalSchemaObject({
        type: modelProposalSchemaLiteral("coordinate"),
        pointHandle: modelProposalSchemaEnum(scope.referenceHandles.point),
        bounds: modelProposalSchemaReference("bounds"),
        supports: modelProposalSchemaReference("supports"),
        revision: modelProposalSchemaVariants(revisions),
      }),
    );
  }
  if (scope.referenceHandles.difference.length > 0) {
    const revisions: JsonValue[] = [
      modelProposalSchemaObject({
        type: modelProposalSchemaLiteral("keep"),
      }),
    ];
    if (scope.constraintAssertionHandles.length > 0) {
      revisions.push(
        modelProposalSchemaObject({
          type: modelProposalSchemaLiteral("supersede"),
          assertionHandle: modelProposalSchemaEnum(
            scope.constraintAssertionHandles,
          ),
        }),
      );
    }
    changes.push(
      modelProposalSchemaObject({
        type: modelProposalSchemaLiteral("constraint"),
        differenceHandle: modelProposalSchemaEnum(
          scope.referenceHandles.difference,
        ),
        bounds: modelProposalSchemaReference("bounds"),
        supports: modelProposalSchemaReference("supports"),
        revision: modelProposalSchemaVariants(revisions),
      }),
    );
  }
  if (scope.activeAssertionHandles.length > 0) {
    changes.push(
      modelProposalSchemaObject({
        type: modelProposalSchemaLiteral("retraction"),
        assertionHandle: modelProposalSchemaEnum(scope.activeAssertionHandles),
        supports: modelProposalSchemaReference("supports"),
      }),
    );
  }
  return changes;
}

function modelProposalQuerySchemas(
  scope: ModelProposalOutputScope,
): readonly JsonValue[] {
  const queries: JsonValue[] = [];
  const addQuery = (
    type: TemporalModelQueryIntentV1["type"],
    handles: readonly string[],
  ): void => {
    if (handles.length === 0) return;
    queries.push(
      modelProposalSchemaObject({
        type: modelProposalSchemaLiteral(type),
        targetHandle: modelProposalSchemaEnum(handles),
        knowledgeCut: modelProposalSchemaReference("knowledgeCut"),
      }),
    );
  };
  addQuery("consistency", scope.referenceHandles.context);
  addQuery("difference", scope.referenceHandles.difference);
  addQuery("point-relation", scope.referenceHandles["point-relation"]);
  addQuery("interval-relation", scope.referenceHandles["interval-relation"]);
  return queries;
}

function modelProposalKnowledgeCutSchema(
  cutHandles: readonly string[],
): JsonValue {
  const variants: JsonValue[] = [
    modelProposalSchemaObject({
      type: modelProposalSchemaLiteral("current"),
    }),
  ];
  if (cutHandles.length > 0) {
    variants.push(
      modelProposalSchemaObject({
        type: modelProposalSchemaLiteral("prior"),
        cutHandle: modelProposalSchemaEnum(cutHandles),
      }),
    );
  }
  return modelProposalSchemaVariants(variants);
}

function modelProposalSchemaObject(
  properties: Readonly<Record<string, JsonValue>>,
): JsonValue {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function modelProposalSchemaLiteral(value: string): JsonValue {
  return modelProposalSchemaEnum([value]);
}

function modelProposalSchemaEnum(values: readonly string[]): JsonValue {
  return { type: "string", enum: values };
}

function modelProposalSchemaReference(name: string): JsonValue {
  return { $ref: `#/$defs/${name}` };
}

function modelProposalSchemaVariants(
  variants: readonly JsonValue[],
): JsonValue {
  if (variants.length === 1) return variants[0] as JsonValue;
  return { anyOf: variants };
}

function validateChange(
  value: unknown,
  path: string,
  limits: TemporalModelProposalLimitsV1,
  issues: TemporalModelProposalIssueV1[],
): void {
  const change = record(value);
  if (!change) {
    addIssue(issues, "model-proposal.invalid", path, "must be an object");
    return;
  }
  if (change.type === "coordinate") {
    exactKeys(
      change,
      ["type", "pointHandle", "bounds", "supports", "revision"],
      path,
      issues,
    );
    identifier(change.pointHandle, `${path}.pointHandle`, issues);
    validateBounds(change.bounds, `${path}.bounds`, issues);
    validateSupports(change.supports, `${path}.supports`, limits, issues);
    validateRevision(change.revision, `${path}.revision`, issues);
    return;
  }
  if (change.type === "constraint") {
    exactKeys(
      change,
      ["type", "differenceHandle", "bounds", "supports", "revision"],
      path,
      issues,
    );
    identifier(change.differenceHandle, `${path}.differenceHandle`, issues);
    validateBounds(change.bounds, `${path}.bounds`, issues);
    validateSupports(change.supports, `${path}.supports`, limits, issues);
    validateRevision(change.revision, `${path}.revision`, issues);
    return;
  }
  if (change.type === "retraction") {
    exactKeys(change, ["type", "assertionHandle", "supports"], path, issues);
    identifier(change.assertionHandle, `${path}.assertionHandle`, issues);
    validateSupports(change.supports, `${path}.supports`, limits, issues);
    return;
  }
  addIssue(
    issues,
    "model-proposal.invalid",
    `${path}.type`,
    "must be coordinate, constraint, or retraction",
  );
}

function validateBounds(
  value: unknown,
  path: string,
  issues: TemporalModelProposalIssueV1[],
): void {
  const bounds = record(value);
  if (!bounds) {
    addIssue(issues, "model-proposal.invalid", path, "must be an object");
    return;
  }
  if (bounds.type === "exact") {
    exactKeys(bounds, ["type", "value"], path, issues);
    safeInteger(bounds.value, `${path}.value`, issues);
    return;
  }
  if (bounds.type === "lower-bound") {
    exactKeys(bounds, ["type", "minimum"], path, issues);
    safeInteger(bounds.minimum, `${path}.minimum`, issues);
    return;
  }
  if (bounds.type === "upper-bound") {
    exactKeys(bounds, ["type", "maximum"], path, issues);
    safeInteger(bounds.maximum, `${path}.maximum`, issues);
    return;
  }
  if (bounds.type === "closed-range") {
    exactKeys(bounds, ["type", "minimum", "maximum"], path, issues);
    const minimum = safeInteger(bounds.minimum, `${path}.minimum`, issues);
    const maximum = safeInteger(bounds.maximum, `${path}.maximum`, issues);
    if (
      minimum &&
      maximum &&
      (bounds.minimum as number) > (bounds.maximum as number)
    ) {
      addIssue(
        issues,
        "model-proposal.invalid",
        `${path}.maximum`,
        "must be greater than or equal to minimum",
      );
    }
    return;
  }
  addIssue(
    issues,
    "model-proposal.invalid",
    `${path}.type`,
    "must be exact, lower-bound, upper-bound, or closed-range",
  );
}

function validateSupports(
  value: unknown,
  path: string,
  limits: TemporalModelProposalLimitsV1,
  issues: TemporalModelProposalIssueV1[],
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, "model-proposal.invalid", path, "must be an array");
    return;
  }
  if (value.length === 0) {
    addIssue(issues, "model-proposal.support", path, "must not be empty");
  }
  if (value.length > limits.maxSupportsPerChange) {
    addIssue(
      issues,
      "model-proposal.limit",
      path,
      `must contain at most ${limits.maxSupportsPerChange} entries`,
    );
  }
  const seen = new Set<string>();
  value.slice(0, limits.maxSupportsPerChange).forEach((entry, index) => {
    const supportPath = `${path}[${index}]`;
    const support = record(entry);
    if (!support) {
      addIssue(
        issues,
        "model-proposal.invalid",
        supportPath,
        "must be an object",
      );
      return;
    }
    exactKeys(support, ["evidenceId", "quote"], supportPath, issues);
    identifier(support.evidenceId, `${supportPath}.evidenceId`, issues);
    if (typeof support.quote !== "string" || support.quote.length === 0) {
      addIssue(
        issues,
        "model-proposal.support",
        `${supportPath}.quote`,
        "must be a non-empty string",
      );
    } else {
      const bytes = textEncoder.encode(support.quote).byteLength;
      if (bytes > limits.maxQuoteBytes) {
        addIssue(
          issues,
          "model-proposal.limit",
          `${supportPath}.quote`,
          `must not exceed ${limits.maxQuoteBytes} UTF-8 bytes`,
        );
      }
    }
    if (
      typeof support.evidenceId === "string" &&
      typeof support.quote === "string"
    ) {
      const key = `${support.evidenceId}\u0000${support.quote}`;
      if (seen.has(key)) {
        addIssue(
          issues,
          "model-proposal.duplicate",
          supportPath,
          "duplicates an earlier support",
        );
      }
      seen.add(key);
    }
  });
}

function validateRevision(
  value: unknown,
  path: string,
  issues: TemporalModelProposalIssueV1[],
): void {
  const revision = record(value);
  if (!revision) {
    addIssue(issues, "model-proposal.invalid", path, "must be an object");
    return;
  }
  if (revision.type === "keep") {
    exactKeys(revision, ["type"], path, issues);
    return;
  }
  if (revision.type === "supersede") {
    exactKeys(revision, ["type", "assertionHandle"], path, issues);
    identifier(revision.assertionHandle, `${path}.assertionHandle`, issues);
    return;
  }
  addIssue(
    issues,
    "model-proposal.invalid",
    `${path}.type`,
    "must be keep or supersede",
  );
}

function validateQueryIntent(
  value: unknown,
  path: string,
  issues: TemporalModelProposalIssueV1[],
): void {
  const query = record(value);
  if (!query) {
    addIssue(issues, "model-proposal.invalid", path, "must be an object");
    return;
  }
  if (
    query.type === "consistency" ||
    query.type === "difference" ||
    query.type === "point-relation" ||
    query.type === "interval-relation"
  ) {
    exactKeys(query, ["type", "targetHandle", "knowledgeCut"], path, issues);
    identifier(query.targetHandle, `${path}.targetHandle`, issues);
  } else {
    addIssue(
      issues,
      "model-proposal.invalid",
      `${path}.type`,
      "must be consistency, difference, point-relation, or interval-relation",
    );
  }
  validateKnowledgeCut(query.knowledgeCut, `${path}.knowledgeCut`, issues);
}

function validateKnowledgeCut(
  value: unknown,
  path: string,
  issues: TemporalModelProposalIssueV1[],
): void {
  const cut = record(value);
  if (!cut) {
    addIssue(issues, "model-proposal.invalid", path, "must be an object");
    return;
  }
  if (cut.type === "current") {
    exactKeys(cut, ["type"], path, issues);
    return;
  }
  if (cut.type === "prior") {
    exactKeys(cut, ["type", "cutHandle"], path, issues);
    identifier(cut.cutHandle, `${path}.cutHandle`, issues);
    return;
  }
  addIssue(
    issues,
    "model-proposal.invalid",
    `${path}.type`,
    "must be current or prior",
  );
}

function parseBaseRun(
  run: TimelineRunDocumentV0Alpha3,
): TimelineRunDocumentV0Alpha3 {
  const issues = validateRunDocumentV0Alpha3Bounded(run, MAX_VALIDATION_ISSUES);
  if (issues.length > 0) {
    throw new TemporalModelProposalErrorV1(
      issues.map(({ path, message }) =>
        issue(
          "model-proposal.candidate",
          path === "$" ? "host.run" : `host.run.${path}`,
          message,
        ),
      ),
    );
  }
  return run;
}

function parseCatalogs(
  host: TemporalModelProposalHostV1,
  run: TimelineRunDocumentV0Alpha3,
  limits: TemporalModelProposalLimitsV1,
): Catalogs {
  const issues: TemporalModelProposalIssueV1[] = [];
  const evidence = parseEvidenceCatalog(host.evidenceCatalog, limits, issues);
  const references = parseReferenceCatalog(
    host.referenceCatalog,
    limits,
    issues,
  );
  const assertions = parseAssertionCatalog(
    host.assertionCatalog ?? [],
    limits,
    issues,
  );
  const cuts = parseCutCatalog(
    host.knowledgeCutCatalog ?? [],
    run.events.length,
    limits,
    issues,
  );
  if (issues.length > 0) throw new TemporalModelProposalErrorV1(issues);
  return { evidence, references, assertions, cuts };
}

function parseEvidenceCatalog(
  value: unknown,
  limits: TemporalModelProposalLimitsV1,
  issues: TemporalModelProposalIssueV1[],
): ReadonlyMap<string, EvidenceRecord> {
  const result = new Map<string, EvidenceRecord>();
  if (!Array.isArray(value)) {
    addIssue(
      issues,
      "model-proposal.invalid",
      "host.evidenceCatalog",
      "must be an array",
    );
    return result;
  }
  if (value.length > limits.maxEvidenceCatalogEntries) {
    addIssue(
      issues,
      "model-proposal.limit",
      "host.evidenceCatalog",
      `must contain at most ${limits.maxEvidenceCatalogEntries} entries`,
    );
  }
  let totalBytes = 0;
  let totalLimitReported = false;
  value.slice(0, limits.maxEvidenceCatalogEntries).forEach((entry, index) => {
    const path = `host.evidenceCatalog[${index}]`;
    const evidence = record(entry);
    if (!evidence) {
      addIssue(issues, "model-proposal.invalid", path, "must be an object");
      return;
    }
    exactKeys(evidence, ["id", "status", "text"], path, issues);
    const validId = identifier(evidence.id, `${path}.id`, issues);
    if (evidence.status !== "current" && evidence.status !== "stale") {
      addIssue(
        issues,
        "model-proposal.invalid",
        `${path}.status`,
        "must be current or stale",
      );
    }
    if (typeof evidence.text !== "string" || hasLoneSurrogate(evidence.text)) {
      addIssue(
        issues,
        "model-proposal.invalid",
        `${path}.text`,
        "must be a well-formed Unicode string",
      );
      return;
    }
    if (evidence.text.length > limits.maxEvidenceBytes) {
      addIssue(
        issues,
        "model-proposal.limit",
        `${path}.text`,
        `must not exceed ${limits.maxEvidenceBytes} UTF-8 bytes`,
      );
      return;
    }
    const remainingBytes = limits.maxTotalEvidenceBytes - totalBytes;
    if (evidence.text.length > remainingBytes) {
      if (!totalLimitReported) {
        addIssue(
          issues,
          "model-proposal.limit",
          "host.evidenceCatalog",
          `text must not exceed ${limits.maxTotalEvidenceBytes} UTF-8 bytes in total`,
        );
        totalLimitReported = true;
      }
      return;
    }
    const bytes = textEncoder.encode(evidence.text);
    if (bytes.byteLength > limits.maxEvidenceBytes) {
      addIssue(
        issues,
        "model-proposal.limit",
        `${path}.text`,
        `must not exceed ${limits.maxEvidenceBytes} UTF-8 bytes`,
      );
      return;
    }
    if (bytes.byteLength > remainingBytes) {
      if (!totalLimitReported) {
        addIssue(
          issues,
          "model-proposal.limit",
          "host.evidenceCatalog",
          `text must not exceed ${limits.maxTotalEvidenceBytes} UTF-8 bytes in total`,
        );
        totalLimitReported = true;
      }
      return;
    }
    totalBytes += bytes.byteLength;
    if (validId) {
      if (result.has(evidence.id as string)) {
        addIssue(
          issues,
          "model-proposal.duplicate",
          `${path}.id`,
          "duplicates an earlier evidence ID",
        );
      } else if (
        (evidence.status === "current" || evidence.status === "stale") &&
        typeof evidence.text === "string"
      ) {
        result.set(evidence.id as string, {
          digest: byteDigest(bytes),
          entry: evidence as unknown as TemporalModelEvidenceCatalogEntryV1,
        });
      }
    }
  });
  return result;
}

function parseReferenceCatalog(
  value: unknown,
  limits: TemporalModelProposalLimitsV1,
  issues: TemporalModelProposalIssueV1[],
): ReadonlyMap<string, TemporalModelReferenceCatalogEntryV1> {
  const result = new Map<string, TemporalModelReferenceCatalogEntryV1>();
  if (!Array.isArray(value)) {
    addIssue(
      issues,
      "model-proposal.invalid",
      "host.referenceCatalog",
      "must be an array",
    );
    return result;
  }
  if (value.length > limits.maxReferenceCatalogEntries) {
    addIssue(
      issues,
      "model-proposal.limit",
      "host.referenceCatalog",
      `must contain at most ${limits.maxReferenceCatalogEntries} entries`,
    );
  }
  value.slice(0, limits.maxReferenceCatalogEntries).forEach((entry, index) => {
    const path = `host.referenceCatalog[${index}]`;
    const reference = record(entry);
    if (!reference) {
      addIssue(issues, "model-proposal.invalid", path, "must be an object");
      return;
    }
    if (reference.type === "context") {
      exactKeys(reference, ["type", "handle", "contextId"], path, issues);
      identifier(reference.contextId, `${path}.contextId`, issues);
    } else if (reference.type === "point") {
      exactKeys(reference, ["type", "handle", "pointId"], path, issues);
      identifier(reference.pointId, `${path}.pointId`, issues);
    } else if (reference.type === "difference") {
      exactKeys(
        reference,
        ["type", "handle", "fromPointId", "toPointId"],
        path,
        issues,
      );
      identifier(reference.fromPointId, `${path}.fromPointId`, issues);
      identifier(reference.toPointId, `${path}.toPointId`, issues);
    } else if (reference.type === "point-relation") {
      exactKeys(
        reference,
        ["type", "handle", "leftPointId", "rightPointId"],
        path,
        issues,
      );
      identifier(reference.leftPointId, `${path}.leftPointId`, issues);
      identifier(reference.rightPointId, `${path}.rightPointId`, issues);
    } else if (reference.type === "interval-relation") {
      exactKeys(
        reference,
        ["type", "handle", "leftIntervalId", "rightIntervalId"],
        path,
        issues,
      );
      identifier(reference.leftIntervalId, `${path}.leftIntervalId`, issues);
      identifier(reference.rightIntervalId, `${path}.rightIntervalId`, issues);
    } else {
      addIssue(
        issues,
        "model-proposal.invalid",
        `${path}.type`,
        "must be context, point, difference, point-relation, or interval-relation",
      );
    }
    if (identifier(reference.handle, `${path}.handle`, issues)) {
      if (result.has(reference.handle as string)) {
        addIssue(
          issues,
          "model-proposal.duplicate",
          `${path}.handle`,
          "duplicates an earlier reference handle",
        );
      } else {
        result.set(
          reference.handle as string,
          reference as unknown as TemporalModelReferenceCatalogEntryV1,
        );
      }
    }
  });
  return result;
}

function parseAssertionCatalog(
  value: unknown,
  limits: TemporalModelProposalLimitsV1,
  issues: TemporalModelProposalIssueV1[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const assertionIds = new Set<string>();
  if (!Array.isArray(value)) {
    addIssue(
      issues,
      "model-proposal.invalid",
      "host.assertionCatalog",
      "must be an array",
    );
    return result;
  }
  if (value.length > limits.maxAssertionCatalogEntries) {
    addIssue(
      issues,
      "model-proposal.limit",
      "host.assertionCatalog",
      `must contain at most ${limits.maxAssertionCatalogEntries} entries`,
    );
  }
  value.slice(0, limits.maxAssertionCatalogEntries).forEach((entry, index) => {
    const path = `host.assertionCatalog[${index}]`;
    const mapping = record(entry);
    if (!mapping) {
      addIssue(issues, "model-proposal.invalid", path, "must be an object");
      return;
    }
    exactKeys(mapping, ["handle", "assertionId"], path, issues);
    const handleValid = identifier(mapping.handle, `${path}.handle`, issues);
    const idValid = identifier(
      mapping.assertionId,
      `${path}.assertionId`,
      issues,
    );
    if (handleValid && result.has(mapping.handle as string)) {
      addIssue(
        issues,
        "model-proposal.duplicate",
        `${path}.handle`,
        "duplicates an earlier assertion handle",
      );
    }
    if (idValid && assertionIds.has(mapping.assertionId as string)) {
      addIssue(
        issues,
        "model-proposal.duplicate",
        `${path}.assertionId`,
        "is exposed by more than one assertion handle",
      );
    }
    if (
      handleValid &&
      idValid &&
      !result.has(mapping.handle as string) &&
      !assertionIds.has(mapping.assertionId as string)
    ) {
      result.set(mapping.handle as string, mapping.assertionId as string);
      assertionIds.add(mapping.assertionId as string);
    }
  });
  return result;
}

function parseCutCatalog(
  value: unknown,
  eventCount: number,
  limits: TemporalModelProposalLimitsV1,
  issues: TemporalModelProposalIssueV1[],
): ReadonlyMap<string, number | null> {
  const result = new Map<string, number | null>();
  if (!Array.isArray(value)) {
    addIssue(
      issues,
      "model-proposal.invalid",
      "host.knowledgeCutCatalog",
      "must be an array",
    );
    return result;
  }
  if (value.length > limits.maxKnowledgeCutCatalogEntries) {
    addIssue(
      issues,
      "model-proposal.limit",
      "host.knowledgeCutCatalog",
      `must contain at most ${limits.maxKnowledgeCutCatalogEntries} entries`,
    );
  }
  value
    .slice(0, limits.maxKnowledgeCutCatalogEntries)
    .forEach((entry, index) => {
      const path = `host.knowledgeCutCatalog[${index}]`;
      const cut = record(entry);
      if (!cut) {
        addIssue(issues, "model-proposal.invalid", path, "must be an object");
        return;
      }
      exactKeys(cut, ["handle", "recordedThrough"], path, issues);
      const handleValid = identifier(cut.handle, `${path}.handle`, issues);
      if (
        cut.recordedThrough !== null &&
        (!Number.isSafeInteger(cut.recordedThrough) ||
          (cut.recordedThrough as number) < 0 ||
          (cut.recordedThrough as number) >= eventCount)
      ) {
        addIssue(
          issues,
          "model-proposal.reference",
          `${path}.recordedThrough`,
          "must identify a sequence in the base run or be null",
        );
      }
      if (handleValid) {
        if (result.has(cut.handle as string)) {
          addIssue(
            issues,
            "model-proposal.duplicate",
            `${path}.handle`,
            "duplicates an earlier knowledge-cut handle",
          );
        } else if (
          cut.recordedThrough === null ||
          (Number.isSafeInteger(cut.recordedThrough) &&
            (cut.recordedThrough as number) >= 0 &&
            (cut.recordedThrough as number) < eventCount)
        ) {
          result.set(
            cut.handle as string,
            cut.recordedThrough as number | null,
          );
        }
      }
    });
  return result;
}

function collectAssertions(
  run: TimelineRunDocumentV0Alpha3,
): ReadonlyMap<string, AssertionRecord> {
  const result = new Map<string, AssertionRecord>();
  for (const event of run.events) {
    if (
      event.type === "coordinate.asserted" ||
      event.type === "constraint.asserted" ||
      event.type === "fact.asserted"
    ) {
      const assertion = event.assertion;
      result.set(assertion.id, {
        id: assertion.id,
        contextId: assertion.contextId,
        kind:
          event.type === "coordinate.asserted"
            ? "coordinate"
            : event.type === "constraint.asserted"
              ? "constraint"
              : "fact",
        ...(event.type === "coordinate.asserted"
          ? { pointId: event.assertion.pointId }
          : {}),
        ...(event.type === "constraint.asserted"
          ? {
              fromPointId: event.assertion.constraint.fromPointId,
              toPointId: event.assertion.constraint.toPointId,
            }
          : {}),
      });
    }
  }
  return result;
}

function collectDeclarations(run: TimelineRunDocumentV0Alpha3): Declarations {
  const points = new Map<
    string,
    { readonly contextId: string; readonly axisId: string }
  >();
  const intervals = new Map<
    string,
    { readonly contextId: string; readonly axisId: string }
  >();
  for (const event of run.events) {
    if (event.type === "point.declared") {
      points.set(event.point.id, {
        contextId: event.point.contextId,
        axisId: event.point.axisId,
      });
    } else if (event.type === "interval.declared") {
      const start = points.get(event.interval.startPointId);
      if (start) {
        intervals.set(event.interval.id, {
          contextId: event.interval.contextId,
          axisId: start.axisId,
        });
      }
    }
  }
  return { intervals, points };
}

function collectActiveAssertionIds(
  run: TimelineRunDocumentV0Alpha3,
): ReadonlySet<string> {
  const inactive = new Set<string>();
  const all = new Set<string>();
  for (const event of run.events) {
    if (
      event.type === "coordinate.asserted" ||
      event.type === "constraint.asserted" ||
      event.type === "fact.asserted"
    ) {
      all.add(event.assertion.id);
      for (const target of event.assertion.supersedes ?? []) {
        inactive.add(target);
      }
    } else if (event.type === "assertion.retracted") {
      inactive.add(event.assertionId);
    }
  }
  return new Set([...all].filter((id) => !inactive.has(id)));
}

function resolveSupports(
  supports: readonly TemporalModelProposalSupportV1[],
  path: string,
  evidence: ReadonlyMap<string, EvidenceRecord>,
  limits: TemporalModelProposalLimitsV1,
  issues: TemporalModelProposalIssueV1[],
): readonly ResolvedSupport[] {
  const resolved: ResolvedSupport[] = [];
  supports.slice(0, limits.maxSupportsPerChange).forEach((support, index) => {
    const supportPath = `${path}[${index}]`;
    const source = evidence.get(support.evidenceId);
    if (!source) {
      addIssue(
        issues,
        "model-proposal.reference",
        `${supportPath}.evidenceId`,
        "is not present in the host evidence catalog",
      );
      return;
    }
    if (source.entry.status === "stale") {
      addIssue(
        issues,
        "model-proposal.stale",
        `${supportPath}.evidenceId`,
        "references stale evidence",
      );
      return;
    }
    const first = source.entry.text.indexOf(support.quote);
    if (first < 0) {
      addIssue(
        issues,
        "model-proposal.support",
        `${supportPath}.quote`,
        "does not occur in the referenced evidence text",
      );
      return;
    }
    if (source.entry.text.lastIndexOf(support.quote) !== first) {
      addIssue(
        issues,
        "model-proposal.support",
        `${supportPath}.quote`,
        "must occur exactly once in the referenced evidence text",
      );
      return;
    }
    const utf8StartByte = textEncoder.encode(
      source.entry.text.slice(0, first),
    ).byteLength;
    const utf8EndByte =
      utf8StartByte + textEncoder.encode(support.quote).byteLength;
    resolved.push({
      evidenceId: support.evidenceId,
      evidenceRef: source.digest,
      quoteDigest: byteDigest(textEncoder.encode(support.quote)),
      utf8EndByte,
      utf8StartByte,
    });
  });
  return resolved;
}

function resolveAssertion(
  handle: string,
  path: string,
  catalog: ReadonlyMap<string, string>,
  assertions: ReadonlyMap<string, AssertionRecord>,
  active: ReadonlySet<string>,
  issues: TemporalModelProposalIssueV1[],
): AssertionRecord | undefined {
  const id = catalog.get(handle);
  if (!id) {
    addIssue(
      issues,
      "model-proposal.reference",
      path,
      "is not present in the host assertion catalog",
    );
    return undefined;
  }
  const assertion = assertions.get(id);
  if (!assertion) {
    addIssue(
      issues,
      "model-proposal.reference",
      path,
      "maps to an assertion that is not present in the base run",
    );
    return undefined;
  }
  if (!active.has(id)) {
    addIssue(
      issues,
      "model-proposal.stale",
      path,
      "maps to an assertion that is no longer active",
    );
    return undefined;
  }
  return assertion;
}

function resolveRevision(
  revision: TemporalModelProposalRevisionV1,
  path: string,
  catalog: ReadonlyMap<string, string>,
  assertions: ReadonlyMap<string, AssertionRecord>,
  active: ReadonlySet<string>,
  contextId: string,
  kind: "constraint" | "coordinate",
  reference: TemporalModelReferenceCatalogEntryV1,
  issues: TemporalModelProposalIssueV1[],
): string | undefined {
  if (revision.type === "keep") return undefined;
  const assertion = resolveAssertion(
    revision.assertionHandle,
    `${path}.assertionHandle`,
    catalog,
    assertions,
    active,
    issues,
  );
  if (!assertion) return undefined;
  if (assertion.contextId !== contextId) {
    addIssue(
      issues,
      "model-proposal.reference",
      `${path}.assertionHandle`,
      "maps to an assertion in another temporal context",
    );
    return undefined;
  }
  if (assertion.kind !== kind) {
    addIssue(
      issues,
      "model-proposal.reference",
      `${path}.assertionHandle`,
      `must map to an active ${kind} assertion`,
    );
    return undefined;
  }
  if (
    kind === "coordinate" &&
    reference.type === "point" &&
    assertion.pointId !== reference.pointId
  ) {
    addIssue(
      issues,
      "model-proposal.reference",
      `${path}.assertionHandle`,
      "must map to a coordinate assertion for the selected point",
    );
    return undefined;
  }
  if (
    kind === "constraint" &&
    reference.type === "difference" &&
    (assertion.fromPointId !== reference.fromPointId ||
      assertion.toPointId !== reference.toPointId)
  ) {
    addIssue(
      issues,
      "model-proposal.reference",
      `${path}.assertionHandle`,
      "must map to a constraint assertion with the selected orientation",
    );
    return undefined;
  }
  return assertion.id;
}

function resolveReference<
  T extends TemporalModelReferenceCatalogEntryV1["type"],
>(
  handle: string,
  path: string,
  type: T,
  catalog: ReadonlyMap<string, TemporalModelReferenceCatalogEntryV1>,
  issues: TemporalModelProposalIssueV1[],
): Extract<TemporalModelReferenceCatalogEntryV1, { type: T }> | undefined {
  const reference = catalog.get(handle);
  if (!reference) {
    addIssue(
      issues,
      "model-proposal.reference",
      path,
      "is not present in the host reference catalog",
    );
    return undefined;
  }
  if (reference.type !== type) {
    addIssue(
      issues,
      "model-proposal.reference",
      path,
      `must map to a ${type} reference`,
    );
    return undefined;
  }
  return reference as Extract<
    TemporalModelReferenceCatalogEntryV1,
    { type: T }
  >;
}

function reserveChange(
  key: string,
  path: string,
  changes: Map<string, string>,
  issues: TemporalModelProposalIssueV1[],
): void {
  const previous = changes.get(key);
  if (previous) {
    addIssue(
      issues,
      "model-proposal.duplicate",
      path,
      `duplicates the candidate change at ${previous}`,
    );
    return;
  }
  changes.set(key, path);
}

function reserveRevision(
  assertionId: string,
  path: string,
  revisions: Map<string, string>,
  issues: TemporalModelProposalIssueV1[],
): void {
  const previous = revisions.get(assertionId);
  if (previous) {
    addIssue(
      issues,
      "model-proposal.duplicate",
      path,
      `targets the same assertion as ${previous}`,
    );
    return;
  }
  revisions.set(assertionId, path);
}

function materializeEvent(
  plan: ChangePlan,
  sequence: number,
): TemporalEventV0Alpha3 {
  if (plan.kind === "retraction") {
    const body = {
      schema: "covenant.timeline.event.v0alpha3",
      sequence,
      type: "assertion.retracted",
      assertionId: plan.assertionId,
      evidenceRefs: plan.evidenceRefs,
    } as const;
    return {
      ...body,
      id: contentId("event", body),
    };
  }
  const assertion = {
    id: contentId(`${plan.kind}-assertion`, plan.body),
    ...plan.body,
  };
  const body = {
    schema: "covenant.timeline.event.v0alpha3",
    sequence,
    type:
      plan.kind === "coordinate"
        ? ("coordinate.asserted" as const)
        : ("constraint.asserted" as const),
    assertion,
  };
  return {
    ...body,
    id: contentId("event", body),
  } as TemporalEventV0Alpha3;
}

function compileQuery(
  intent: TemporalModelQueryIntentV1,
  catalogs: Catalogs,
  declarations: Declarations,
  baseEventCount: number,
  run: TimelineRunDocumentV0Alpha3,
): TemporalQueryV0Alpha3 {
  const issues: TemporalModelProposalIssueV1[] = [];
  const currentCut = run.events.length === 0 ? null : run.events.length - 1;
  let recordedThrough: number | null;
  if (intent.knowledgeCut.type === "current") {
    recordedThrough = currentCut;
  } else {
    const cut = catalogs.cuts.get(intent.knowledgeCut.cutHandle);
    if (
      cut === undefined &&
      !catalogs.cuts.has(intent.knowledgeCut.cutHandle)
    ) {
      throw new TemporalModelProposalErrorV1([
        issue(
          "model-proposal.reference",
          "query.knowledgeCut.cutHandle",
          "is not present in the host knowledge-cut catalog",
        ),
      ]);
    }
    recordedThrough = cut ?? null;
    if (
      currentCut === null ||
      (recordedThrough !== null && recordedThrough >= currentCut) ||
      (baseEventCount === 0 && recordedThrough === null)
    ) {
      throw new TemporalModelProposalErrorV1([
        issue(
          "model-proposal.reference",
          "query.knowledgeCut.cutHandle",
          "must resolve to a cut earlier than the current candidate cut",
        ),
      ]);
    }
  }

  let body: Readonly<Record<string, JsonValue>>;
  if (intent.type === "consistency") {
    const reference = resolveReference(
      intent.targetHandle,
      "query.targetHandle",
      "context",
      catalogs.references,
      issues,
    );
    if (!reference) throw new TemporalModelProposalErrorV1(issues);
    body = {
      schema: "covenant.timeline.query.v0alpha3",
      type: "context.consistency",
      contextId: reference.contextId,
      recordedThrough,
    };
  } else {
    const expected =
      intent.type === "difference"
        ? "difference"
        : intent.type === "point-relation"
          ? "point-relation"
          : "interval-relation";
    const reference = resolveReference(
      intent.targetHandle,
      "query.targetHandle",
      expected,
      catalogs.references,
      issues,
    );
    if (!reference) throw new TemporalModelProposalErrorV1(issues);
    if (reference.type === "difference") {
      const contextId = declarations.points.get(
        reference.fromPointId,
      )?.contextId;
      if (!contextId) {
        throw unknownQueryDeclaration("point", reference.fromPointId);
      }
      body = {
        schema: "covenant.timeline.query.v0alpha3",
        type: "difference.bounds",
        contextId,
        recordedThrough,
        fromPointId: reference.fromPointId,
        toPointId: reference.toPointId,
      };
    } else if (reference.type === "point-relation") {
      const contextId = declarations.points.get(
        reference.leftPointId,
      )?.contextId;
      if (!contextId) {
        throw unknownQueryDeclaration("point", reference.leftPointId);
      }
      body = {
        schema: "covenant.timeline.query.v0alpha3",
        type: "point.relations",
        contextId,
        recordedThrough,
        leftPointId: reference.leftPointId,
        rightPointId: reference.rightPointId,
      };
    } else {
      const contextId = declarations.intervals.get(
        reference.leftIntervalId,
      )?.contextId;
      if (!contextId) {
        throw unknownQueryDeclaration("interval", reference.leftIntervalId);
      }
      body = {
        schema: "covenant.timeline.query.v0alpha3",
        type: "interval.relations",
        contextId,
        recordedThrough,
        leftIntervalId: reference.leftIntervalId,
        rightIntervalId: reference.rightIntervalId,
      };
    }
  }
  const query = {
    ...body,
    id: contentId("query", body),
  } as TemporalQueryV0Alpha3;
  try {
    return parseQueryV0Alpha3(query, run);
  } catch (error) {
    if (error instanceof TimelineDocumentError) {
      throw new TemporalModelProposalErrorV1(
        error.issues.map(({ path, message }) =>
          issue(
            "model-proposal.candidate",
            path === "$" ? "candidateQuery" : `candidateQuery.${path}`,
            message,
          ),
        ),
      );
    }
    throw error;
  }
}

function parseCandidateRun(run: TimelineRunDocumentV0Alpha3): void {
  try {
    parseRunDocumentV0Alpha3(run);
  } catch (error) {
    if (error instanceof TimelineDocumentError) {
      throw new TemporalModelProposalErrorV1(
        error.issues.map(({ path, message }) =>
          issue(
            "model-proposal.candidate",
            path === "$" ? "candidateRun" : `candidateRun.${path}`,
            message,
          ),
        ),
      );
    }
    throw error;
  }
}

function requireRequestId(actual: string, expected: string): void {
  if (!IDENTIFIER.test(expected)) {
    throw new TemporalModelProposalErrorV1([
      issue(
        "model-proposal.invalid",
        "host.expectedRequestId",
        "must be a lowercase portable identifier",
      ),
    ]);
  }
  if (actual !== expected) {
    throw new TemporalModelProposalErrorV1([
      issue(
        "model-proposal.reference",
        "requestId",
        "must match host.expectedRequestId",
      ),
    ]);
  }
}

function unknownQueryDeclaration(
  kind: "interval" | "point",
  id: string,
): TemporalModelProposalErrorV1 {
  return new TemporalModelProposalErrorV1([
    issue(
      "model-proposal.reference",
      "query.targetHandle",
      `maps to ${kind} ${id}, which is not declared by the base run`,
    ),
  ]);
}

function compileBounds(
  bounds: TemporalModelProposalBoundsV1,
): Readonly<Record<string, number>> {
  switch (bounds.type) {
    case "exact":
      return { minimum: bounds.value, maximum: bounds.value };
    case "lower-bound":
      return { minimum: bounds.minimum };
    case "upper-bound":
      return { maximum: bounds.maximum };
    case "closed-range":
      return { minimum: bounds.minimum, maximum: bounds.maximum };
  }
}

function resolveLimits(
  options: TemporalModelProposalLimitOptionsV1,
): TemporalModelProposalLimitsV1 {
  const configured = record(options);
  if (!configured) {
    throw new TemporalModelProposalErrorV1([
      issue("model-proposal.invalid", "options", "must be a plain object"),
    ]);
  }
  const issues: TemporalModelProposalIssueV1[] = [];
  exactKeys(
    configured,
    Object.keys(DEFAULT_TEMPORAL_MODEL_PROPOSAL_LIMITS_V1),
    "options",
    issues,
  );
  const limits = {
    ...DEFAULT_TEMPORAL_MODEL_PROPOSAL_LIMITS_V1,
  } as TemporalModelProposalLimitsV1;
  for (const [name, maximum] of Object.entries(
    DEFAULT_TEMPORAL_MODEL_PROPOSAL_LIMITS_V1,
  )) {
    if (!Object.hasOwn(configured, name)) continue;
    const value = configured[name];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 1
    ) {
      addIssue(
        issues,
        "model-proposal.limit",
        `options.${name}`,
        "must be a positive safe integer",
      );
      continue;
    }
    if ((value as number) > maximum) {
      addIssue(
        issues,
        "model-proposal.limit",
        `options.${name}`,
        `must not exceed the protocol maximum of ${maximum}`,
      );
      continue;
    }
    (limits as unknown as Record<string, number>)[name] = value as number;
  }
  if (issues.length > 0) throw new TemporalModelProposalErrorV1(issues);
  return limits;
}

function contentId(prefix: string, value: JsonValue): string {
  return `${prefix}-${contentDigest(value).slice("sha256:".length)}`;
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSupports(
  left: ResolvedSupport,
  right: ResolvedSupport,
): number {
  return (
    compareStrings(left.evidenceRef, right.evidenceRef) ||
    left.utf8StartByte - right.utf8StartByte ||
    left.utf8EndByte - right.utf8EndByte ||
    compareStrings(left.evidenceId, right.evidenceId) ||
    compareStrings(left.quoteDigest, right.quoteDigest)
  );
}

function compareIssues(
  left: TemporalModelProposalIssueV1,
  right: TemporalModelProposalIssueV1,
): number {
  return (
    compareStrings(left.path, right.path) ||
    compareStrings(left.code, right.code) ||
    compareStrings(left.message, right.message)
  );
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: TemporalModelProposalIssueV1[],
): void {
  const expected = new Set(allowed);
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (!expected.has(key)) {
      addIssue(
        issues,
        "model-proposal.invalid",
        childPath(path, key),
        "unknown field",
      );
    }
    if (issues.length >= MAX_VALIDATION_ISSUES) break;
  }
}

function identifier(
  value: unknown,
  path: string,
  issues: TemporalModelProposalIssueV1[],
): value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    addIssue(
      issues,
      "model-proposal.invalid",
      path,
      "must be a lowercase portable identifier",
    );
    return false;
  }
  return true;
}

function safeInteger(
  value: unknown,
  path: string,
  issues: TemporalModelProposalIssueV1[],
): value is number {
  if (!Number.isSafeInteger(value)) {
    addIssue(issues, "model-proposal.invalid", path, "must be a safe integer");
    return false;
  }
  return true;
}

function appendCanonicalIssue(
  value: unknown,
  issues: TemporalModelProposalIssueV1[],
): void {
  try {
    canonicalJson(value as JsonValue);
  } catch (error) {
    if (error instanceof TimelineCanonicalizationError) {
      addIssue(issues, "model-proposal.invalid", error.path, error.reason);
      return;
    }
    throw error;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function addIssue(
  issues: TemporalModelProposalIssueV1[],
  code: TemporalModelProposalIssueCodeV1,
  path: string,
  message: string,
): void {
  if (issues.length >= MAX_VALIDATION_ISSUES) return;
  issues.push(issue(code, path, message));
}

function issue(
  code: TemporalModelProposalIssueCodeV1,
  path: string,
  message: string,
): TemporalModelProposalIssueV1 {
  return {
    code,
    path: sanitizeIssueText(path, MAX_ISSUE_PATH_LENGTH),
    message: sanitizeIssueText(message, MAX_ISSUE_MESSAGE_LENGTH),
  };
}

interface JsonPreflightLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}

function assertBoundedJson(
  value: unknown,
  path: string,
  limits: JsonPreflightLimits,
): void {
  const issues: TemporalModelProposalIssueV1[] = [];
  const active = new WeakSet<object>();
  let bytes = 0;
  let nodes = 0;
  let stopped = false;

  const fail = (
    code: TemporalModelProposalIssueCodeV1,
    issuePath: string,
    message: string,
  ): void => {
    if (stopped) return;
    addIssue(issues, code, issuePath, message);
    stopped = true;
  };
  const addBytes = (amount: number): boolean => {
    bytes += amount;
    if (bytes <= limits.maxBytes) return true;
    fail(
      "model-proposal.limit",
      path,
      `must not exceed ${limits.maxBytes} encoded JSON bytes`,
    );
    return false;
  };
  const addString = (text: string): boolean =>
    addBytes(jsonStringByteLength(text, limits.maxBytes - bytes));

  const visit = (entry: unknown, entryPath: string, depth: number): void => {
    if (stopped) return;
    nodes += 1;
    if (nodes > limits.maxNodes) {
      fail(
        "model-proposal.limit",
        path,
        `must not exceed ${limits.maxNodes} JSON values`,
      );
      return;
    }
    if (depth > limits.maxDepth) {
      fail(
        "model-proposal.limit",
        entryPath,
        `must not exceed ${limits.maxDepth} levels`,
      );
      return;
    }
    if (entry === null) {
      addBytes(4);
      return;
    }
    if (typeof entry === "string") {
      addString(entry);
      return;
    }
    if (typeof entry === "boolean") {
      addBytes(entry ? 4 : 5);
      return;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) {
        fail(
          "model-proposal.invalid",
          entryPath,
          "must contain only finite JSON numbers",
        );
        return;
      }
      addBytes(String(entry).length);
      return;
    }
    if (typeof entry !== "object") {
      fail(
        "model-proposal.invalid",
        entryPath,
        "must contain only JSON values",
      );
      return;
    }
    if (active.has(entry)) {
      fail("model-proposal.invalid", entryPath, "must not contain cycles");
      return;
    }
    active.add(entry);
    if (Array.isArray(entry)) {
      let lengthDescriptor: PropertyDescriptor | undefined;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(entry, "length");
      } catch {
        active.delete(entry);
        fail("model-proposal.invalid", entryPath, "must be a plain JSON array");
        return;
      }
      if (
        !lengthDescriptor ||
        !Object.hasOwn(lengthDescriptor, "value") ||
        typeof lengthDescriptor.value !== "number"
      ) {
        active.delete(entry);
        fail("model-proposal.invalid", entryPath, "must be a plain JSON array");
        return;
      }
      const length = lengthDescriptor.value;
      if (length > limits.maxNodes) {
        fail(
          "model-proposal.limit",
          entryPath,
          `must not contain more than ${limits.maxNodes} array entries`,
        );
      } else if (addBytes(2 + Math.max(0, length - 1))) {
        for (let index = 0; index < length && !stopped; index += 1) {
          let descriptor: PropertyDescriptor | undefined;
          try {
            descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
          } catch {
            fail(
              "model-proposal.invalid",
              `${entryPath}[${index}]`,
              "must be a data property",
            );
            break;
          }
          if (!descriptor || !Object.hasOwn(descriptor, "value")) {
            fail(
              "model-proposal.invalid",
              `${entryPath}[${index}]`,
              "must be a data property",
            );
            break;
          }
          visit(descriptor.value, `${entryPath}[${index}]`, depth + 1);
        }
      }
      active.delete(entry);
      return;
    }

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(entry);
    } catch {
      active.delete(entry);
      fail("model-proposal.invalid", entryPath, "must be a plain JSON object");
      return;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      active.delete(entry);
      fail("model-proposal.invalid", entryPath, "must be a plain JSON object");
      return;
    }
    if (!addBytes(2)) {
      active.delete(entry);
      return;
    }
    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(entry);
    } catch {
      active.delete(entry);
      fail("model-proposal.invalid", entryPath, "must be a plain JSON object");
      return;
    }
    let propertyCount = 0;
    try {
      for (const key of keys) {
        if (typeof key !== "string") {
          fail(
            "model-proposal.invalid",
            entryPath,
            "must contain only string property names",
          );
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(entry, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          fail(
            "model-proposal.invalid",
            childPath(entryPath, key),
            "must be a data property",
          );
          break;
        }
        if (!descriptor.enumerable) {
          fail(
            "model-proposal.invalid",
            childPath(entryPath, key),
            "must be enumerable",
          );
          break;
        }
        propertyCount += 1;
        if (propertyCount > 1 && !addBytes(1)) break;
        if (!addString(key) || !addBytes(1)) break;
        visit(descriptor.value, childPath(entryPath, key), depth + 1);
        if (stopped) break;
      }
    } catch {
      fail("model-proposal.invalid", entryPath, "must be a plain JSON object");
    }
    active.delete(entry);
  };

  visit(value, path, 0);
  if (issues.length > 0) throw new TemporalModelProposalErrorV1(issues);
}

function jsonStringByteLength(value: string, remaining: number): number {
  let bytes = 2;
  for (let index = 0; index < value.length && bytes <= remaining; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function childPath(parent: string, key: string): string {
  if (SIMPLE_PATH_KEY.test(key))
    return parent === "$" ? key : `${parent}.${key}`;
  const prefix = key.slice(0, 64);
  const suffix = key.length > prefix.length ? "..." : "";
  return `${parent}[${JSON.stringify(`${prefix}${suffix}`)}]`;
}

function sanitizeIssueText(value: string, maximum: number): string {
  const escaped = value.replace(
    /[\u0000-\u001f\u007f]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return escaped.length <= maximum
    ? escaped
    : `${escaped.slice(0, maximum - 3)}...`;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

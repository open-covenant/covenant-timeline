import type { Subject } from "../contract.js";

export type TemporalContextModeV0Alpha3 =
  | "actual"
  | "forecast"
  | "hypothetical"
  | "planned";

export interface TemporalAxisV0Alpha3 {
  id: string;
  kind: "metric" | "ordinal";
  unit: string;
  origin: string;
}

export interface TemporalContextV0Alpha3 {
  id: string;
  mode: TemporalContextModeV0Alpha3;
}

export type TemporalEvidenceRefV0Alpha3 = `sha256:${string}`;

export interface TimelineContractV0Alpha3 {
  schema: "covenant.timeline.contract.v0alpha3";
  id: string;
  subject: Subject;
  axes: readonly TemporalAxisV0Alpha3[];
  contexts: readonly TemporalContextV0Alpha3[];
}

export type TemporalCoordinateV0Alpha3 =
  | { minimum: number; maximum?: number }
  | { minimum?: undefined; maximum: number };

export interface TemporalPointV0Alpha3 {
  id: string;
  contextId: string;
  axisId: string;
}

export interface TemporalIntervalV0Alpha3 {
  id: string;
  contextId: string;
  startPointId: string;
  endPointId: string;
}

export type TemporalDifferenceConstraintV0Alpha3 = {
  fromPointId: string;
  toPointId: string;
} & TemporalCoordinateV0Alpha3;

export interface TemporalCoordinateAssertionV0Alpha3 {
  id: string;
  contextId: string;
  pointId: string;
  coordinate: TemporalCoordinateV0Alpha3;
  evidenceRefs: readonly TemporalEvidenceRefV0Alpha3[];
  supersedes?: readonly string[];
}

export interface TemporalConstraintAssertionV0Alpha3 {
  id: string;
  contextId: string;
  constraint: TemporalDifferenceConstraintV0Alpha3;
  evidenceRefs: readonly TemporalEvidenceRefV0Alpha3[];
  supersedes?: readonly string[];
}

export interface TemporalFactAssertionV0Alpha3 {
  id: string;
  contextId: string;
  propositionRef: string;
  validDuring?: string;
  observedAt?: string;
  assertedAt?: string;
  evidenceRefs: readonly TemporalEvidenceRefV0Alpha3[];
  supersedes?: readonly string[];
}

interface TemporalEventBaseV0Alpha3 {
  schema: "covenant.timeline.event.v0alpha3";
  id: string;
  sequence: number;
}

export interface TemporalPointDeclaredV0Alpha3 extends TemporalEventBaseV0Alpha3 {
  type: "point.declared";
  point: TemporalPointV0Alpha3;
}

export interface TemporalIntervalDeclaredV0Alpha3 extends TemporalEventBaseV0Alpha3 {
  type: "interval.declared";
  interval: TemporalIntervalV0Alpha3;
}

export interface TemporalConstraintAssertedV0Alpha3 extends TemporalEventBaseV0Alpha3 {
  type: "constraint.asserted";
  assertion: TemporalConstraintAssertionV0Alpha3;
}

export interface TemporalCoordinateAssertedV0Alpha3 extends TemporalEventBaseV0Alpha3 {
  type: "coordinate.asserted";
  assertion: TemporalCoordinateAssertionV0Alpha3;
}

export interface TemporalFactAssertedV0Alpha3 extends TemporalEventBaseV0Alpha3 {
  type: "fact.asserted";
  assertion: TemporalFactAssertionV0Alpha3;
}

export interface TemporalAssertionRetractedV0Alpha3 extends TemporalEventBaseV0Alpha3 {
  type: "assertion.retracted";
  assertionId: string;
  evidenceRefs: readonly TemporalEvidenceRefV0Alpha3[];
}

export type TemporalEventV0Alpha3 =
  | TemporalAssertionRetractedV0Alpha3
  | TemporalConstraintAssertedV0Alpha3
  | TemporalCoordinateAssertedV0Alpha3
  | TemporalFactAssertedV0Alpha3
  | TemporalIntervalDeclaredV0Alpha3
  | TemporalPointDeclaredV0Alpha3;

export interface TimelineRunDocumentV0Alpha3 {
  schema: "covenant.timeline.run.v0alpha3";
  contract: TimelineContractV0Alpha3;
  events: readonly TemporalEventV0Alpha3[];
}

interface TemporalQueryBaseV0Alpha3 {
  schema: "covenant.timeline.query.v0alpha3";
  id: string;
  contextId: string;
  recordedThrough: number | null;
}

export interface TemporalConsistencyQueryV0Alpha3 extends TemporalQueryBaseV0Alpha3 {
  type: "context.consistency";
}

export interface TemporalDifferenceBoundsQueryV0Alpha3 extends TemporalQueryBaseV0Alpha3 {
  type: "difference.bounds";
  fromPointId: string;
  toPointId: string;
}

export interface TemporalPointRelationsQueryV0Alpha3 extends TemporalQueryBaseV0Alpha3 {
  type: "point.relations";
  leftPointId: string;
  rightPointId: string;
}

export interface TemporalIntervalRelationsQueryV0Alpha3 extends TemporalQueryBaseV0Alpha3 {
  type: "interval.relations";
  leftIntervalId: string;
  rightIntervalId: string;
}

export type TemporalQueryV0Alpha3 =
  | TemporalConsistencyQueryV0Alpha3
  | TemporalDifferenceBoundsQueryV0Alpha3
  | TemporalIntervalRelationsQueryV0Alpha3
  | TemporalPointRelationsQueryV0Alpha3;

export type TemporalPointRelationV0Alpha3 = "after" | "before" | "equal";

export type TemporalIntervalRelationV0Alpha3 =
  | "after"
  | "before"
  | "contains"
  | "during"
  | "equal"
  | "finished-by"
  | "finishes"
  | "meets"
  | "met-by"
  | "overlapped-by"
  | "overlaps"
  | "started-by"
  | "starts";

export interface TemporalConsistencyResultV0Alpha3 {
  type: "context.consistency";
  status: "consistent" | "inconsistent";
}

export interface TemporalDifferenceBoundsResultV0Alpha3 {
  type: "difference.bounds";
  status: "bounded" | "inconsistent" | "partially-bounded" | "unbounded";
  minimum: number | null;
  maximum: number | null;
}

export interface TemporalPointRelationsResultV0Alpha3 {
  type: "point.relations";
  status: "inconsistent" | "indeterminate" | "resolved";
  possible: readonly TemporalPointRelationV0Alpha3[];
}

export interface TemporalIntervalRelationsResultV0Alpha3 {
  type: "interval.relations";
  status: "inconsistent" | "indeterminate" | "resolved";
  possible: readonly TemporalIntervalRelationV0Alpha3[];
}

export type TemporalSemanticResultV0Alpha3 =
  | TemporalConsistencyResultV0Alpha3
  | TemporalDifferenceBoundsResultV0Alpha3
  | TemporalIntervalRelationsResultV0Alpha3
  | TemporalPointRelationsResultV0Alpha3;

export interface TemporalScheduleProofV0Alpha3 {
  kind: "schedule";
  coordinates: Readonly<Record<string, number>>;
}

export interface TemporalProofEdgeV0Alpha3 {
  sourceId: string;
  fromNodeId: string;
  toNodeId: string;
  maximum: number;
}

export interface TemporalNegativeCycleProofV0Alpha3 {
  kind: "negative-cycle";
  edges: readonly TemporalProofEdgeV0Alpha3[];
}

export interface TemporalBoundProofV0Alpha3 {
  kind: "bounds";
  lowerEdges: readonly TemporalProofEdgeV0Alpha3[];
  upperEdges: readonly TemporalProofEdgeV0Alpha3[];
}

export interface TemporalRelationCaseProofV0Alpha3 {
  relation: TemporalIntervalRelationV0Alpha3 | TemporalPointRelationV0Alpha3;
  possible: boolean;
  witness: TemporalNegativeCycleProofV0Alpha3 | TemporalScheduleProofV0Alpha3;
}

export interface TemporalRelationProofV0Alpha3 {
  kind: "relation-cases";
  cases: readonly TemporalRelationCaseProofV0Alpha3[];
}

export type TemporalProofV0Alpha3 =
  | TemporalBoundProofV0Alpha3
  | TemporalNegativeCycleProofV0Alpha3
  | TemporalRelationProofV0Alpha3
  | TemporalScheduleProofV0Alpha3;

export interface TemporalReasoningReceiptV0Alpha3 {
  reasoner: "covenant.timeline.stn.v0alpha1";
  stateDigest: `sha256:${string}`;
  queryDigest: `sha256:${string}`;
  semanticResultDigest: `sha256:${string}`;
  proof: TemporalProofV0Alpha3;
}

export interface TemporalConclusionV0Alpha3 {
  schema: "covenant.timeline.conclusion.v0alpha3";
  queryId: string;
  result: TemporalSemanticResultV0Alpha3;
  receipt: TemporalReasoningReceiptV0Alpha3;
}

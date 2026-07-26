import { canonicalJson, contentDigest, type JsonValue } from "../identity.js";
import {
  validateQueryV0Alpha3,
  validateRunDocumentV0Alpha3,
} from "./document.js";
import type {
  TemporalAxisV0Alpha3,
  TemporalConclusionV0Alpha3,
  TemporalConstraintAssertionV0Alpha3,
  TemporalContextV0Alpha3,
  TemporalCoordinateAssertionV0Alpha3,
  TemporalEventV0Alpha3,
  TemporalFactAssertionV0Alpha3,
  TemporalIntervalRelationV0Alpha3,
  TemporalIntervalV0Alpha3,
  TemporalPointRelationV0Alpha3,
  TemporalPointV0Alpha3,
  TemporalProofV0Alpha3,
  TemporalProofEdgeV0Alpha3,
  TemporalQueryV0Alpha3,
  TemporalRelationCaseProofV0Alpha3,
  TemporalScheduleProofV0Alpha3,
  TimelineContractV0Alpha3,
  TimelineRunDocumentV0Alpha3,
} from "./types.js";

export interface TemporalKernelLimitsV0Alpha3 {
  maxAssertions: number;
  maxAxes: number;
  maxContexts: number;
  maxEdges: number;
  maxEvents: number;
  maxEvidenceRefs: number;
  maxIntervals: number;
  maxOperations: number;
  maxPoints: number;
}

export type TemporalKernelLimitOptionsV0Alpha3 =
  Partial<TemporalKernelLimitsV0Alpha3>;

export const DEFAULT_TEMPORAL_KERNEL_LIMITS_V0ALPHA3: Readonly<TemporalKernelLimitsV0Alpha3> =
  Object.freeze({
    maxAssertions: 16_384,
    maxAxes: 256,
    maxContexts: 256,
    maxEdges: 32_768,
    maxEvents: 50_000,
    maxEvidenceRefs: 10_000,
    maxIntervals: 4_096,
    maxOperations: 20_000_000,
    maxPoints: 4_096,
  });

export type TemporalKernelErrorCodeV0Alpha3 =
  | "temporal.arithmetic.overflow"
  | "temporal.input.invalid"
  | "temporal.input.limit"
  | "temporal.input.reference";

export class TemporalKernelErrorV0Alpha3 extends Error {
  constructor(
    readonly code: TemporalKernelErrorCodeV0Alpha3,
    message: string,
  ) {
    super(message);
    this.name = "TemporalKernelErrorV0Alpha3";
  }
}

export interface TemporalProjectedStateV0Alpha3 {
  readonly schema: "covenant.timeline.state.v0alpha3";
  readonly contractId: string;
  readonly subject: Readonly<{ kind: string; id: string }>;
  readonly context: Readonly<TemporalContextV0Alpha3>;
  readonly axes: readonly Readonly<TemporalAxisV0Alpha3>[];
  readonly recordedThrough: number | null;
  readonly points: readonly Readonly<TemporalPointV0Alpha3>[];
  readonly intervals: readonly Readonly<TemporalIntervalV0Alpha3>[];
  readonly coordinates: readonly Readonly<TemporalCoordinateAssertionV0Alpha3>[];
  readonly constraints: readonly Readonly<TemporalConstraintAssertionV0Alpha3>[];
  readonly facts: readonly Readonly<TemporalFactAssertionV0Alpha3>[];
  readonly stateDigest: `sha256:${string}`;
}

interface AssertionRecord {
  readonly kind: "constraint" | "coordinate" | "fact";
  readonly value:
    | TemporalConstraintAssertionV0Alpha3
    | TemporalCoordinateAssertionV0Alpha3
    | TemporalFactAssertionV0Alpha3;
}

interface Projection {
  readonly state: TemporalProjectedStateV0Alpha3;
  readonly points: ReadonlyMap<string, TemporalPointV0Alpha3>;
  readonly intervals: ReadonlyMap<string, TemporalIntervalV0Alpha3>;
  readonly coordinates: readonly TemporalCoordinateAssertionV0Alpha3[];
  readonly constraints: readonly TemporalConstraintAssertionV0Alpha3[];
}

interface Edge {
  readonly from: string;
  readonly to: string;
  readonly weight: number;
  readonly source: string;
}

interface Graph {
  readonly nodes: readonly string[];
  readonly edges: readonly Edge[];
  readonly pointAxes: ReadonlyMap<string, string>;
}

interface ConsistentGraph {
  readonly consistent: true;
  readonly distances: ReadonlyMap<string, bigint>;
}

interface InconsistentGraph {
  readonly consistent: false;
  readonly edges: readonly TemporalProofEdgeV0Alpha3[];
}

type GraphConsistency = ConsistentGraph | InconsistentGraph;

interface ShortestPath {
  readonly distance: number | null;
  readonly edges: readonly TemporalProofEdgeV0Alpha3[];
}

interface DifferenceSpec {
  readonly from: string;
  readonly to: string;
  readonly minimum?: number;
  readonly maximum?: number;
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SCHEDULE_ZERO = "\u0000schedule-zero";
const ORIGIN_PREFIX = "@origin:";
const INTRINSIC_PREFIX = "@";
const POINT_RELATIONS: readonly TemporalPointRelationV0Alpha3[] = [
  "before",
  "equal",
  "after",
];
const INTERVAL_RELATIONS: readonly TemporalIntervalRelationV0Alpha3[] = [
  "before",
  "meets",
  "overlaps",
  "starts",
  "during",
  "finishes",
  "equal",
  "finished-by",
  "contains",
  "started-by",
  "overlapped-by",
  "met-by",
  "after",
];

export function projectTemporalStateV0Alpha3(
  run: TimelineRunDocumentV0Alpha3,
  contextId: string,
  recordedThrough: number | null,
  options: TemporalKernelLimitOptionsV0Alpha3 = {},
): TemporalProjectedStateV0Alpha3 {
  return project(run, contextId, recordedThrough, options).state;
}

export function reasonTemporalQueryV0Alpha3(
  run: TimelineRunDocumentV0Alpha3,
  query: TemporalQueryV0Alpha3,
  options: TemporalKernelLimitOptionsV0Alpha3 = {},
): TemporalConclusionV0Alpha3 {
  const limits = resolveLimits(options);
  validateQueryShape(query);
  const queryIssues = validateQueryV0Alpha3(query, run, {
    maxEvents: limits.maxEvents,
    maxEvidenceRefs: limits.maxEvidenceRefs,
  });
  if (queryIssues.length > 0) {
    invalid(
      queryIssues.map(({ path, message }) => `${path}: ${message}`).join("; "),
    );
  }
  const projection = projectInternal(
    run,
    query.contextId,
    query.recordedThrough,
    limits,
  );
  const budget = new OperationBudget(limits.maxOperations);
  const graph = buildGraph(projection, limits);

  let result: TemporalConclusionV0Alpha3["result"];
  let proof: TemporalProofV0Alpha3;

  switch (query.type) {
    case "context.consistency": {
      const consistency = checkConsistency(graph, budget);
      if (consistency.consistent) {
        result = {
          type: "context.consistency",
          status: "consistent",
        };
        proof = scheduleProof(graph, budget);
      } else {
        result = {
          type: "context.consistency",
          status: "inconsistent",
        };
        proof = {
          kind: "negative-cycle",
          edges: consistency.edges,
        };
      }
      break;
    }
    case "difference.bounds": {
      const from = requirePoint(projection, query.fromPointId, query.contextId);
      const to = requirePoint(projection, query.toPointId, query.contextId);
      requireSameAxis(from, to, "difference bounds");
      const scoped = connectedScope(
        graph,
        [query.fromPointId, query.toPointId],
        budget,
      );
      const consistency = checkConsistency(scoped, budget);
      if (!consistency.consistent) {
        result = {
          type: "difference.bounds",
          status: "inconsistent",
          minimum: null,
          maximum: null,
        };
        proof = {
          kind: "negative-cycle",
          edges: consistency.edges,
        };
        break;
      }
      const upper = shortestPath(
        scoped,
        query.fromPointId,
        query.toPointId,
        budget,
      );
      const reverse = shortestPath(
        scoped,
        query.toPointId,
        query.fromPointId,
        budget,
      );
      const minimum =
        reverse.distance === null ? null : safeNegate(reverse.distance);
      const maximum = upper.distance;
      result = {
        type: "difference.bounds",
        status:
          minimum !== null && maximum !== null
            ? "bounded"
            : minimum !== null || maximum !== null
              ? "partially-bounded"
              : "unbounded",
        minimum,
        maximum,
      };
      proof = {
        kind: "bounds",
        lowerEdges: reverse.edges,
        upperEdges: upper.edges,
      };
      break;
    }
    case "point.relations": {
      const left = requirePoint(projection, query.leftPointId, query.contextId);
      const right = requirePoint(
        projection,
        query.rightPointId,
        query.contextId,
      );
      requireSameAxis(left, right, "point relations");
      const scoped = connectedScope(
        graph,
        [query.leftPointId, query.rightPointId],
        budget,
      );
      const evaluated = evaluateRelations(
        scoped,
        POINT_RELATIONS,
        (relation) =>
          pointRelationSpecs(query.leftPointId, query.rightPointId, relation),
        query.id,
        limits,
        budget,
      );
      result = {
        type: "point.relations",
        status: evaluated.inconsistentEdges
          ? "inconsistent"
          : evaluated.possible.length === 1
            ? "resolved"
            : "indeterminate",
        possible:
          evaluated.possible as readonly TemporalPointRelationV0Alpha3[],
      };
      proof = evaluated.inconsistentEdges
        ? {
            kind: "negative-cycle",
            edges: evaluated.inconsistentEdges,
          }
        : {
            kind: "relation-cases",
            cases: evaluated.cases,
          };
      break;
    }
    case "interval.relations": {
      const left = requireInterval(
        projection,
        query.leftIntervalId,
        query.contextId,
      );
      const right = requireInterval(
        projection,
        query.rightIntervalId,
        query.contextId,
      );
      const leftStart = requirePoint(
        projection,
        left.startPointId,
        query.contextId,
      );
      const rightStart = requirePoint(
        projection,
        right.startPointId,
        query.contextId,
      );
      requireSameAxis(leftStart, rightStart, "interval relations");
      const scoped = connectedScope(
        graph,
        [
          left.startPointId,
          left.endPointId,
          right.startPointId,
          right.endPointId,
        ],
        budget,
      );
      const evaluated = evaluateRelations(
        scoped,
        INTERVAL_RELATIONS,
        (relation) => intervalRelationSpecs(left, right, relation),
        query.id,
        limits,
        budget,
      );
      result = {
        type: "interval.relations",
        status: evaluated.inconsistentEdges
          ? "inconsistent"
          : evaluated.possible.length === 1
            ? "resolved"
            : "indeterminate",
        possible:
          evaluated.possible as readonly TemporalIntervalRelationV0Alpha3[],
      };
      proof = evaluated.inconsistentEdges
        ? {
            kind: "negative-cycle",
            edges: evaluated.inconsistentEdges,
          }
        : {
            kind: "relation-cases",
            cases: evaluated.cases,
          };
      break;
    }
  }

  const conclusion: TemporalConclusionV0Alpha3 = {
    schema: "covenant.timeline.conclusion.v0alpha3",
    queryId: query.id,
    result,
    receipt: {
      reasoner: "covenant.timeline.stn.v0alpha1",
      stateDigest: projection.state.stateDigest,
      queryDigest: digest(query),
      semanticResultDigest: digest(result),
      proof,
    },
  };
  return freezeJson(conclusion);
}

export function verifyTemporalConclusionV0Alpha3(
  run: TimelineRunDocumentV0Alpha3,
  query: TemporalQueryV0Alpha3,
  conclusion: TemporalConclusionV0Alpha3,
  options: TemporalKernelLimitOptionsV0Alpha3 = {},
): boolean {
  try {
    canonicalJson(conclusion as unknown as JsonValue);
    const limits = resolveLimits(options);
    validateQueryShape(query);
    const queryIssues = validateQueryV0Alpha3(query, run, {
      maxEvents: limits.maxEvents,
      maxEvidenceRefs: limits.maxEvidenceRefs,
    });
    if (queryIssues.length > 0) return false;
    const projection = projectInternal(
      run,
      query.contextId,
      query.recordedThrough,
      limits,
    );
    if (
      !validateConclusionEnvelope(
        conclusion,
        query,
        projection.state.stateDigest,
      )
    ) {
      return false;
    }

    const graph = buildGraph(projection, limits);
    const budget = new OperationBudget(limits.maxOperations);
    switch (query.type) {
      case "context.consistency":
        return verifyConsistencyConclusion(conclusion, graph, limits, budget);
      case "difference.bounds": {
        const from = requirePoint(
          projection,
          query.fromPointId,
          query.contextId,
        );
        const to = requirePoint(projection, query.toPointId, query.contextId);
        requireSameAxis(from, to, "difference bounds");
        return verifyBoundsConclusion(
          conclusion,
          connectedScope(graph, [query.fromPointId, query.toPointId], budget),
          query.fromPointId,
          query.toPointId,
          limits,
          budget,
        );
      }
      case "point.relations": {
        const left = requirePoint(
          projection,
          query.leftPointId,
          query.contextId,
        );
        const right = requirePoint(
          projection,
          query.rightPointId,
          query.contextId,
        );
        requireSameAxis(left, right, "point relations");
        return verifyRelationConclusion(
          conclusion,
          connectedScope(
            graph,
            [query.leftPointId, query.rightPointId],
            budget,
          ),
          POINT_RELATIONS,
          (relation) =>
            pointRelationSpecs(query.leftPointId, query.rightPointId, relation),
          query.id,
          limits,
          budget,
        );
      }
      case "interval.relations": {
        const left = requireInterval(
          projection,
          query.leftIntervalId,
          query.contextId,
        );
        const right = requireInterval(
          projection,
          query.rightIntervalId,
          query.contextId,
        );
        const leftStart = requirePoint(
          projection,
          left.startPointId,
          query.contextId,
        );
        const rightStart = requirePoint(
          projection,
          right.startPointId,
          query.contextId,
        );
        requireSameAxis(leftStart, rightStart, "interval relations");
        return verifyRelationConclusion(
          conclusion,
          connectedScope(
            graph,
            [
              left.startPointId,
              left.endPointId,
              right.startPointId,
              right.endPointId,
            ],
            budget,
          ),
          INTERVAL_RELATIONS,
          (relation) => intervalRelationSpecs(left, right, relation),
          query.id,
          limits,
          budget,
        );
      }
    }
  } catch {
    return false;
  }
}

function validateConclusionEnvelope(
  conclusion: TemporalConclusionV0Alpha3,
  query: TemporalQueryV0Alpha3,
  stateDigest: `sha256:${string}`,
): boolean {
  if (
    !hasExactKeys(conclusion, ["schema", "queryId", "result", "receipt"]) ||
    conclusion.schema !== "covenant.timeline.conclusion.v0alpha3" ||
    conclusion.queryId !== query.id
  ) {
    return false;
  }
  const receipt = conclusion.receipt;
  if (
    !hasExactKeys(receipt, [
      "reasoner",
      "stateDigest",
      "queryDigest",
      "semanticResultDigest",
      "proof",
    ]) ||
    receipt.reasoner !== "covenant.timeline.stn.v0alpha1" ||
    receipt.stateDigest !== stateDigest ||
    receipt.queryDigest !== digest(query) ||
    receipt.semanticResultDigest !== digest(conclusion.result)
  ) {
    return false;
  }
  return true;
}

function verifyConsistencyConclusion(
  conclusion: TemporalConclusionV0Alpha3,
  graph: Graph,
  limits: TemporalKernelLimitsV0Alpha3,
  budget: OperationBudget,
): boolean {
  const result = conclusion.result;
  if (
    result.type !== "context.consistency" ||
    !hasExactKeys(result, ["type", "status"]) ||
    (result.status !== "consistent" && result.status !== "inconsistent")
  ) {
    return false;
  }
  return result.status === "consistent"
    ? validateScheduleProof(conclusion.receipt.proof, graph, budget)
    : validateNegativeCycleProof(
        conclusion.receipt.proof,
        graph,
        limits,
        budget,
      );
}

function verifyBoundsConclusion(
  conclusion: TemporalConclusionV0Alpha3,
  graph: Graph,
  fromPointId: string,
  toPointId: string,
  limits: TemporalKernelLimitsV0Alpha3,
  budget: OperationBudget,
): boolean {
  const result = conclusion.result;
  if (
    result.type !== "difference.bounds" ||
    !hasExactKeys(result, ["type", "status", "minimum", "maximum"]) ||
    !isSafeIntegerOrNull(result.minimum) ||
    !isSafeIntegerOrNull(result.maximum)
  ) {
    return false;
  }

  if (result.status === "inconsistent") {
    return (
      result.minimum === null &&
      result.maximum === null &&
      validateNegativeCycleProof(
        conclusion.receipt.proof,
        graph,
        limits,
        budget,
      )
    );
  }
  if (
    result.status !== "bounded" &&
    result.status !== "partially-bounded" &&
    result.status !== "unbounded"
  ) {
    return false;
  }

  const consistency = checkConsistency(graph, budget);
  if (!consistency.consistent) return false;
  const upper = shortestPath(graph, fromPointId, toPointId, budget);
  const reverse = shortestPath(graph, toPointId, fromPointId, budget);
  const minimum =
    reverse.distance === null ? null : safeNegate(reverse.distance);
  const maximum = upper.distance;
  const status =
    minimum !== null && maximum !== null
      ? "bounded"
      : minimum !== null || maximum !== null
        ? "partially-bounded"
        : "unbounded";
  if (
    result.status !== status ||
    result.minimum !== minimum ||
    result.maximum !== maximum
  ) {
    return false;
  }

  const proof = conclusion.receipt.proof;
  if (
    !hasExactKeys(proof, ["kind", "lowerEdges", "upperEdges"]) ||
    proof.kind !== "bounds"
  ) {
    return false;
  }
  return (
    validateBoundPath(
      proof.lowerEdges,
      graph,
      toPointId,
      fromPointId,
      reverse.distance,
      limits,
      budget,
    ) &&
    validateBoundPath(
      proof.upperEdges,
      graph,
      fromPointId,
      toPointId,
      upper.distance,
      limits,
      budget,
    )
  );
}

function verifyRelationConclusion<T extends string>(
  conclusion: TemporalConclusionV0Alpha3,
  graph: Graph,
  relations: readonly T[],
  compile: (relation: T) => readonly DifferenceSpec[],
  queryId: string,
  limits: TemporalKernelLimitsV0Alpha3,
  budget: OperationBudget,
): boolean {
  const result = conclusion.result;
  const expectedType =
    relations === POINT_RELATIONS ? "point.relations" : "interval.relations";
  if (
    result.type !== expectedType ||
    !hasExactKeys(result, ["type", "status", "possible"])
  ) {
    return false;
  }
  const possible = result.possible as readonly string[];
  if (
    !Array.isArray(possible) ||
    !possible.every((relation) => relations.includes(relation as T)) ||
    !isOrderedSubset(possible, relations)
  ) {
    return false;
  }

  const consistency = checkConsistency(graph, budget);
  if (!consistency.consistent) {
    return (
      result.status === "inconsistent" &&
      possible.length === 0 &&
      validateNegativeCycleProof(
        conclusion.receipt.proof,
        graph,
        limits,
        budget,
      )
    );
  }
  if (result.status === "inconsistent") return false;

  const certified = validateRelationCases(
    conclusion.receipt.proof,
    graph,
    relations,
    compile,
    queryId,
    limits,
    budget,
  );
  if (
    certified === null ||
    certified.length === 0 ||
    !sameStrings(possible, certified)
  ) {
    return false;
  }
  return (
    result.status === (certified.length === 1 ? "resolved" : "indeterminate")
  );
}

function validateRelationCases<T extends string>(
  proof: TemporalProofV0Alpha3,
  graph: Graph,
  relations: readonly T[],
  compile: (relation: T) => readonly DifferenceSpec[],
  queryId: string,
  limits: TemporalKernelLimitsV0Alpha3,
  budget: OperationBudget,
): readonly string[] | null {
  if (
    !hasExactKeys(proof, ["kind", "cases"]) ||
    proof.kind !== "relation-cases" ||
    !Array.isArray(proof.cases) ||
    proof.cases.length !== relations.length
  ) {
    return null;
  }

  const possible: string[] = [];
  for (let index = 0; index < relations.length; index += 1) {
    const relation = relations[index]!;
    const relationCase = proof.cases[index];
    if (
      !hasExactKeys(relationCase, ["relation", "possible", "witness"]) ||
      relationCase.relation !== relation ||
      typeof relationCase.possible !== "boolean"
    ) {
      return null;
    }
    const candidate = extendGraph(
      graph,
      compile(relation),
      `${INTRINSIC_PREFIX}query:${queryId}:${relation}`,
      limits,
    );
    const witness = relationCase.witness as TemporalProofV0Alpha3;
    const valid = relationCase.possible
      ? validateScheduleProof(witness, candidate, budget)
      : validateNegativeCycleProof(witness, candidate, limits, budget);
    if (!valid) return null;
    if (relationCase.possible) possible.push(relation);
  }
  return possible;
}

function validateScheduleProof(
  proof: TemporalProofV0Alpha3,
  graph: Graph,
  budget: OperationBudget,
): boolean {
  if (
    !hasExactKeys(proof, ["kind", "coordinates"]) ||
    proof.kind !== "schedule" ||
    !isRecord(proof.coordinates)
  ) {
    return false;
  }
  const expectedPointIds = [...graph.pointAxes.keys()].sort();
  const suppliedPointIds = Object.keys(proof.coordinates).sort();
  if (!sameStrings(expectedPointIds, suppliedPointIds)) return false;
  for (const pointId of expectedPointIds) {
    if (!Number.isSafeInteger(proof.coordinates[pointId])) return false;
  }
  for (const edge of graph.edges) {
    budget.consume();
    const from = proofNodeCoordinate(edge.from, proof.coordinates, graph);
    const to = proofNodeCoordinate(edge.to, proof.coordinates, graph);
    if (from === null || to === null) return false;
    if (BigInt(to) - BigInt(from) > BigInt(edge.weight)) return false;
  }
  return true;
}

function validateNegativeCycleProof(
  proof: TemporalProofV0Alpha3,
  graph: Graph,
  limits: TemporalKernelLimitsV0Alpha3,
  budget: OperationBudget,
): boolean {
  if (
    !hasExactKeys(proof, ["kind", "edges"]) ||
    proof.kind !== "negative-cycle" ||
    !Array.isArray(proof.edges) ||
    proof.edges.length === 0 ||
    proof.edges.length > limits.maxEdges
  ) {
    return false;
  }
  const edgeKeys = new Set(graph.edges.map(edgeKey));
  let sum = 0n;
  for (let index = 0; index < proof.edges.length; index += 1) {
    budget.consume();
    const edge = proof.edges[index]!;
    const next = proof.edges[(index + 1) % proof.edges.length]!;
    if (
      !validateProofEdge(edge, edgeKeys) ||
      edge.toNodeId !== next.fromNodeId
    ) {
      return false;
    }
    sum += BigInt(edge.maximum);
  }
  return sum < 0n;
}

function validateBoundPath(
  value: unknown,
  graph: Graph,
  source: string,
  target: string,
  expectedDistance: number | null,
  limits: TemporalKernelLimitsV0Alpha3,
  budget: OperationBudget,
): boolean {
  if (!Array.isArray(value) || value.length > limits.maxEdges) return false;
  if (expectedDistance === null) return value.length === 0;
  if (value.length === 0) {
    return source === target && expectedDistance === 0;
  }

  const edges = value as readonly TemporalProofEdgeV0Alpha3[];
  const edgeKeys = new Set(graph.edges.map(edgeKey));
  if (edges[0]!.fromNodeId !== source || edges.at(-1)!.toNodeId !== target) {
    return false;
  }
  let sum = 0n;
  for (let index = 0; index < edges.length; index += 1) {
    budget.consume();
    const edge = edges[index]!;
    if (
      !validateProofEdge(edge, edgeKeys) ||
      (index > 0 && edges[index - 1]!.toNodeId !== edge.fromNodeId)
    ) {
      return false;
    }
    sum += BigInt(edge.maximum);
  }
  return sum === BigInt(expectedDistance);
}

function validateProofEdge(
  edge: TemporalProofEdgeV0Alpha3,
  graphEdgeKeys: ReadonlySet<string>,
): boolean {
  return (
    hasExactKeys(edge, ["sourceId", "fromNodeId", "toNodeId", "maximum"]) &&
    typeof edge.sourceId === "string" &&
    typeof edge.fromNodeId === "string" &&
    typeof edge.toNodeId === "string" &&
    Number.isSafeInteger(edge.maximum) &&
    graphEdgeKeys.has(proofEdgeKey(edge))
  );
}

function proofNodeCoordinate(
  nodeId: string,
  coordinates: Readonly<Record<string, number>>,
  graph: Graph,
): number | null {
  if (nodeId.startsWith(ORIGIN_PREFIX)) return 0;
  if (!graph.pointAxes.has(nodeId)) return null;
  const coordinate = coordinates[nodeId];
  return typeof coordinate === "number" && Number.isSafeInteger(coordinate)
    ? coordinate
    : null;
}

function edgeKey(edge: Edge): string {
  return JSON.stringify([edge.source, edge.from, edge.to, edge.weight]);
}

function proofEdgeKey(edge: TemporalProofEdgeV0Alpha3): string {
  return JSON.stringify([
    edge.sourceId,
    edge.fromNodeId,
    edge.toNodeId,
    edge.maximum,
  ]);
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return sameStrings(Object.keys(value).sort(), [...expected].sort());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeIntegerOrNull(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value);
}

function isOrderedSubset<T extends string>(
  values: readonly string[],
  order: readonly T[],
): boolean {
  let previous = -1;
  for (const value of values) {
    const index = order.indexOf(value as T);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function project(
  run: TimelineRunDocumentV0Alpha3,
  contextId: string,
  recordedThrough: number | null,
  options: TemporalKernelLimitOptionsV0Alpha3,
): Projection {
  return projectInternal(
    run,
    contextId,
    recordedThrough,
    resolveLimits(options),
  );
}

function projectInternal(
  run: TimelineRunDocumentV0Alpha3,
  contextId: string,
  recordedThrough: number | null,
  limits: TemporalKernelLimitsV0Alpha3,
): Projection {
  if (!run || typeof run !== "object") {
    invalid("run must be an object");
  }
  if (run.schema !== "covenant.timeline.run.v0alpha3") {
    invalid("run schema must identify v0alpha3");
  }
  requireIdentifier(contextId, "contextId");

  const prefix = selectPrefix(run.events, recordedThrough, limits);
  const prefixIssues = validateRunDocumentV0Alpha3(
    { ...run, events: prefix },
    {
      maxCheckpoints: Math.max(limits.maxAxes, limits.maxContexts),
      maxEvents: limits.maxEvents,
      maxEvidenceRefs: limits.maxEvidenceRefs,
    },
  );
  if (prefixIssues.length > 0) {
    invalid(
      prefixIssues.map(({ path, message }) => `${path}: ${message}`).join("; "),
    );
  }
  validateContract(run.contract, limits);
  const contexts = new Map(
    run.contract.contexts.map((value) => [value.id, value]),
  );
  const context = contexts.get(contextId);
  if (!context) {
    reference(`context ${contextId} is not declared by the contract`);
  }
  const axes = new Map(run.contract.axes.map((value) => [value.id, value]));
  const points = new Map<string, TemporalPointV0Alpha3>();
  const intervals = new Map<string, TemporalIntervalV0Alpha3>();
  const assertions = new Map<string, AssertionRecord>();
  const retracted = new Set<string>();
  const eventIds = new Set<string>();
  const temporalIds = new Set<string>();
  const contextEvents: TemporalEventV0Alpha3[] = [];

  for (const event of prefix) {
    validateEventBase(event, eventIds);

    switch (event.type) {
      case "point.declared": {
        validatePoint(event.point, contexts, axes);
        reserveTemporalId(event.point.id, temporalIds);
        enforceLimit(points.size + 1, limits.maxPoints, "points");
        points.set(event.point.id, event.point);
        if (event.point.contextId === contextId) contextEvents.push(event);
        break;
      }
      case "interval.declared": {
        validateInterval(event.interval, contexts, points);
        reserveTemporalId(event.interval.id, temporalIds);
        enforceLimit(intervals.size + 1, limits.maxIntervals, "intervals");
        intervals.set(event.interval.id, event.interval);
        if (event.interval.contextId === contextId) contextEvents.push(event);
        break;
      }
      case "constraint.asserted": {
        validateConstraintAssertion(
          event.assertion,
          contexts,
          points,
          assertions,
          limits,
        );
        reserveTemporalId(event.assertion.id, temporalIds);
        addAssertion(
          assertions,
          {
            kind: "constraint",
            value: event.assertion,
          },
          limits,
        );
        if (event.assertion.contextId === contextId) contextEvents.push(event);
        break;
      }
      case "coordinate.asserted": {
        validateCoordinateAssertion(
          event.assertion,
          contexts,
          points,
          assertions,
          limits,
        );
        reserveTemporalId(event.assertion.id, temporalIds);
        addAssertion(
          assertions,
          {
            kind: "coordinate",
            value: event.assertion,
          },
          limits,
        );
        if (event.assertion.contextId === contextId) contextEvents.push(event);
        break;
      }
      case "fact.asserted": {
        validateFactAssertion(
          event.assertion,
          contexts,
          points,
          intervals,
          assertions,
          limits,
        );
        reserveTemporalId(event.assertion.id, temporalIds);
        addAssertion(
          assertions,
          {
            kind: "fact",
            value: event.assertion,
          },
          limits,
        );
        if (event.assertion.contextId === contextId) contextEvents.push(event);
        break;
      }
      case "assertion.retracted": {
        requireIdentifier(event.assertionId, "retraction assertionId");
        validateReferences(
          event.evidenceRefs,
          "retraction evidenceRefs",
          limits,
        );
        const target = assertions.get(event.assertionId);
        if (!target) {
          reference(
            `retraction ${event.id} references unknown assertion ${event.assertionId}`,
          );
        }
        retracted.add(event.assertionId);
        if (target.value.contextId === contextId) contextEvents.push(event);
        break;
      }
    }
  }

  const activeIds = resolveActiveAssertions(assertions, retracted);
  const selectedPoints = sortedValues(points)
    .filter((point) => point.contextId === contextId)
    .map(cloneJson);
  const selectedIntervals = sortedValues(intervals)
    .filter((interval) => interval.contextId === contextId)
    .map(cloneJson);
  const active = [...assertions.values()]
    .filter(
      (record) =>
        activeIds.has(record.value.id) && record.value.contextId === contextId,
    )
    .sort((left, right) => compareStrings(left.value.id, right.value.id));
  const coordinates = active
    .filter(
      (
        record,
      ): record is AssertionRecord & {
        value: TemporalCoordinateAssertionV0Alpha3;
      } => record.kind === "coordinate",
    )
    .map((record) => cloneJson(record.value));
  const constraints = active
    .filter(
      (
        record,
      ): record is AssertionRecord & {
        value: TemporalConstraintAssertionV0Alpha3;
      } => record.kind === "constraint",
    )
    .map((record) => cloneJson(record.value));
  const facts = active
    .filter(
      (
        record,
      ): record is AssertionRecord & {
        value: TemporalFactAssertionV0Alpha3;
      } => record.kind === "fact",
    )
    .map((record) => cloneJson(record.value));
  const cut = prefix.at(-1)?.sequence ?? null;
  const stateDigest = digest({
    schema: "covenant.timeline.state-input.v0alpha3",
    contract: run.contract,
    contextId,
    recordedThrough: cut,
    events: contextEvents,
  });
  const state: TemporalProjectedStateV0Alpha3 = freezeJson({
    schema: "covenant.timeline.state.v0alpha3",
    contractId: run.contract.id,
    subject: cloneJson(run.contract.subject),
    context: cloneJson(context),
    axes: sortedValues(axes).map(cloneJson),
    recordedThrough: cut,
    points: selectedPoints,
    intervals: selectedIntervals,
    coordinates,
    constraints,
    facts,
    stateDigest,
  });

  return {
    state,
    points: new Map(selectedPoints.map((point) => [point.id, point])),
    intervals: new Map(
      selectedIntervals.map((interval) => [interval.id, interval]),
    ),
    coordinates,
    constraints,
  };
}

function validateContract(
  contract: TimelineContractV0Alpha3,
  limits: TemporalKernelLimitsV0Alpha3,
): void {
  if (contract.schema !== "covenant.timeline.contract.v0alpha3") {
    invalid("contract schema must identify v0alpha3");
  }
  requireIdentifier(contract.id, "contract id");
  requireIdentifier(contract.subject.kind, "subject kind");
  requireIdentifier(contract.subject.id, "subject id");
  if (!Array.isArray(contract.axes) || contract.axes.length === 0) {
    invalid("contract axes must be a non-empty array");
  }
  if (!Array.isArray(contract.contexts) || contract.contexts.length === 0) {
    invalid("contract contexts must be a non-empty array");
  }
  enforceLimit(contract.axes.length, limits.maxAxes, "axes");
  enforceLimit(contract.contexts.length, limits.maxContexts, "contexts");

  const axisIds = new Set<string>();
  for (const axis of contract.axes) {
    requireIdentifier(axis.id, "axis id");
    if (axis.kind !== "metric" && axis.kind !== "ordinal") {
      invalid(`axis ${axis.id} has unsupported kind`);
    }
    requireIdentifier(axis.unit, `axis ${axis.id} unit`);
    requireIdentifier(axis.origin, `axis ${axis.id} origin`);
    if (axisIds.has(axis.id))
      invalid(`axis ${axis.id} is declared more than once`);
    axisIds.add(axis.id);
  }

  const contextIds = new Set<string>();
  for (const context of contract.contexts) {
    requireIdentifier(context.id, "context id");
    if (
      context.mode !== "actual" &&
      context.mode !== "forecast" &&
      context.mode !== "hypothetical" &&
      context.mode !== "planned"
    ) {
      invalid(`context ${context.id} has unsupported mode`);
    }
    if (contextIds.has(context.id)) {
      invalid(`context ${context.id} is declared more than once`);
    }
    contextIds.add(context.id);
  }
}

function selectPrefix(
  events: readonly TemporalEventV0Alpha3[],
  recordedThrough: number | null,
  limits: TemporalKernelLimitsV0Alpha3,
): readonly TemporalEventV0Alpha3[] {
  if (!Array.isArray(events)) invalid("run events must be an array");
  enforceLimit(events.length, limits.maxEvents, "events");
  if (recordedThrough !== null) {
    if (
      !Number.isSafeInteger(recordedThrough) ||
      recordedThrough < 0 ||
      recordedThrough >= events.length
    ) {
      invalid("recordedThrough must be null or a sequence present in the run");
    }
  }
  const prefix =
    recordedThrough === null ? [] : events.slice(0, recordedThrough + 1);
  const ids = new Set<string>();
  prefix.forEach((event, index) => {
    if (!event || event.schema !== "covenant.timeline.event.v0alpha3") {
      invalid(`event at index ${index} has an invalid schema`);
    }
    requireIdentifier(event.id, `event at index ${index} id`);
    if (!Number.isSafeInteger(event.sequence) || event.sequence !== index) {
      invalid(`event ${event.id} must have contiguous sequence ${index}`);
    }
    if (ids.has(event.id)) invalid(`event ${event.id} is duplicated`);
    ids.add(event.id);
  });
  return prefix;
}

function validateEventBase(
  event: TemporalEventV0Alpha3,
  eventIds: Set<string>,
): void {
  if (eventIds.has(event.id)) invalid(`event ${event.id} is duplicated`);
  eventIds.add(event.id);
}

function validatePoint(
  point: TemporalPointV0Alpha3,
  contexts: ReadonlyMap<string, TemporalContextV0Alpha3>,
  axes: ReadonlyMap<string, TemporalAxisV0Alpha3>,
): void {
  requireIdentifier(point.id, "point id");
  requireIdentifier(point.contextId, `point ${point.id} contextId`);
  requireIdentifier(point.axisId, `point ${point.id} axisId`);
  if (!contexts.has(point.contextId)) {
    reference(
      `point ${point.id} references unknown context ${point.contextId}`,
    );
  }
  if (!axes.has(point.axisId)) {
    reference(`point ${point.id} references unknown axis ${point.axisId}`);
  }
}

function validateInterval(
  interval: TemporalIntervalV0Alpha3,
  contexts: ReadonlyMap<string, TemporalContextV0Alpha3>,
  points: ReadonlyMap<string, TemporalPointV0Alpha3>,
): void {
  requireIdentifier(interval.id, "interval id");
  requireIdentifier(interval.contextId, `interval ${interval.id} contextId`);
  if (!contexts.has(interval.contextId)) {
    reference(
      `interval ${interval.id} references unknown context ${interval.contextId}`,
    );
  }
  const start = points.get(interval.startPointId);
  const end = points.get(interval.endPointId);
  if (!start || !end) {
    reference(`interval ${interval.id} references an undeclared point`);
  }
  if (
    start.contextId !== interval.contextId ||
    end.contextId !== interval.contextId
  ) {
    reference(`interval ${interval.id} crosses temporal contexts`);
  }
  requireSameAxis(start, end, `interval ${interval.id}`);
}

function validateCoordinateAssertion(
  assertion: TemporalCoordinateAssertionV0Alpha3,
  contexts: ReadonlyMap<string, TemporalContextV0Alpha3>,
  points: ReadonlyMap<string, TemporalPointV0Alpha3>,
  assertions: ReadonlyMap<string, AssertionRecord>,
  limits: TemporalKernelLimitsV0Alpha3,
): void {
  validateAssertionBase(assertion, "coordinate", contexts, assertions, limits);
  const point = points.get(assertion.pointId);
  if (!point) {
    reference(`coordinate ${assertion.id} references an undeclared point`);
  }
  if (point.contextId !== assertion.contextId) {
    reference(`coordinate ${assertion.id} crosses temporal contexts`);
  }
  validateBounds(
    assertion.coordinate.minimum,
    assertion.coordinate.maximum,
    `coordinate ${assertion.id}`,
    true,
  );
  for (const targetId of assertion.supersedes ?? []) {
    const target = assertions.get(targetId);
    if (
      target?.kind !== "coordinate" ||
      (target.value as TemporalCoordinateAssertionV0Alpha3).pointId !==
        assertion.pointId
    ) {
      reference(
        `coordinate ${assertion.id} must supersede a coordinate for the same point`,
      );
    }
  }
}

function validateConstraintAssertion(
  assertion: TemporalConstraintAssertionV0Alpha3,
  contexts: ReadonlyMap<string, TemporalContextV0Alpha3>,
  points: ReadonlyMap<string, TemporalPointV0Alpha3>,
  assertions: ReadonlyMap<string, AssertionRecord>,
  limits: TemporalKernelLimitsV0Alpha3,
): void {
  validateAssertionBase(assertion, "constraint", contexts, assertions, limits);
  const from = points.get(assertion.constraint.fromPointId);
  const to = points.get(assertion.constraint.toPointId);
  if (!from || !to) {
    reference(`constraint ${assertion.id} references an undeclared point`);
  }
  if (
    from.contextId !== assertion.contextId ||
    to.contextId !== assertion.contextId
  ) {
    reference(`constraint ${assertion.id} crosses temporal contexts`);
  }
  requireSameAxis(from, to, `constraint ${assertion.id}`);
  validateBounds(
    assertion.constraint.minimum,
    assertion.constraint.maximum,
    `constraint ${assertion.id}`,
    true,
  );
}

function validateFactAssertion(
  assertion: TemporalFactAssertionV0Alpha3,
  contexts: ReadonlyMap<string, TemporalContextV0Alpha3>,
  points: ReadonlyMap<string, TemporalPointV0Alpha3>,
  intervals: ReadonlyMap<string, TemporalIntervalV0Alpha3>,
  assertions: ReadonlyMap<string, AssertionRecord>,
  limits: TemporalKernelLimitsV0Alpha3,
): void {
  validateAssertionBase(assertion, "fact", contexts, assertions, limits);
  requireIdentifier(
    assertion.propositionRef,
    `fact ${assertion.id} propositionRef`,
  );

  if (assertion.validDuring !== undefined) {
    const interval = intervals.get(assertion.validDuring);
    if (!interval) {
      reference(
        `fact ${assertion.id} references unknown interval ${assertion.validDuring}`,
      );
    }
    if (interval.contextId !== assertion.contextId) {
      reference(`fact ${assertion.id} crosses temporal contexts`);
    }
  }

  for (const [name, pointId] of [
    ["observedAt", assertion.observedAt],
    ["assertedAt", assertion.assertedAt],
  ] as const) {
    if (pointId === undefined) continue;
    const point = points.get(pointId);
    if (!point) {
      reference(
        `fact ${assertion.id} ${name} references unknown point ${pointId}`,
      );
    }
    if (point.contextId !== assertion.contextId) {
      reference(`fact ${assertion.id} crosses temporal contexts`);
    }
  }
}

function validateAssertionBase(
  assertion:
    | TemporalConstraintAssertionV0Alpha3
    | TemporalCoordinateAssertionV0Alpha3
    | TemporalFactAssertionV0Alpha3,
  kind: AssertionRecord["kind"],
  contexts: ReadonlyMap<string, TemporalContextV0Alpha3>,
  assertions: ReadonlyMap<string, AssertionRecord>,
  limits: TemporalKernelLimitsV0Alpha3,
): void {
  requireIdentifier(assertion.id, `${kind} assertion id`);
  requireIdentifier(assertion.contextId, `assertion ${assertion.id} contextId`);
  if (!contexts.has(assertion.contextId)) {
    reference(
      `assertion ${assertion.id} references unknown context ${assertion.contextId}`,
    );
  }
  validateReferences(
    assertion.evidenceRefs,
    `assertion ${assertion.id}`,
    limits,
  );
  const supersedes = assertion.supersedes ?? [];
  if (assertion.supersedes !== undefined && supersedes.length === 0) {
    invalid(`assertion ${assertion.id} supersedes must not be empty`);
  }
  if (supersedes.length > limits.maxAssertions) {
    limit(`assertion ${assertion.id} supersedes too many assertions`);
  }
  const seen = new Set<string>();
  for (const targetId of supersedes) {
    requireIdentifier(targetId, `assertion ${assertion.id} supersedes`);
    if (seen.has(targetId)) {
      invalid(`assertion ${assertion.id} repeats supersession ${targetId}`);
    }
    seen.add(targetId);
    const target = assertions.get(targetId);
    if (!target) {
      reference(
        `assertion ${assertion.id} supersedes unknown assertion ${targetId}`,
      );
    }
    if (target.kind !== kind) {
      reference(
        `assertion ${assertion.id} cannot supersede another assertion kind`,
      );
    }
    if (target.value.contextId !== assertion.contextId) {
      reference(`assertion ${assertion.id} supersedes across contexts`);
    }
  }
}

function addAssertion(
  assertions: Map<string, AssertionRecord>,
  record: AssertionRecord,
  limits: TemporalKernelLimitsV0Alpha3,
): void {
  if (assertions.has(record.value.id)) {
    invalid(`assertion ${record.value.id} is declared more than once`);
  }
  enforceLimit(assertions.size + 1, limits.maxAssertions, "assertions");
  assertions.set(record.value.id, record);
}

function resolveActiveAssertions(
  assertions: ReadonlyMap<string, AssertionRecord>,
  retracted: ReadonlySet<string>,
): ReadonlySet<string> {
  const superseded = new Set<string>();
  for (const record of assertions.values()) {
    for (const target of record.value.supersedes ?? []) {
      superseded.add(target);
    }
  }
  const active = new Set<string>();
  for (const id of assertions.keys()) {
    if (!retracted.has(id) && !superseded.has(id)) active.add(id);
  }
  return active;
}

function buildGraph(
  projection: Projection,
  limits: TemporalKernelLimitsV0Alpha3,
): Graph {
  const nodes = new Set<string>();
  const edges: Edge[] = [];
  const pointAxes = new Map<string, string>();

  for (const point of projection.points.values()) {
    nodes.add(point.id);
    pointAxes.set(point.id, point.axisId);
  }

  for (const assertion of projection.coordinates) {
    const point = projection.points.get(assertion.pointId)!;
    const origin = originId(point.axisId);
    nodes.add(origin);
    addDifferenceEdges(
      edges,
      {
        from: origin,
        to: assertion.pointId,
        minimum: assertion.coordinate.minimum,
        maximum: assertion.coordinate.maximum,
      },
      assertion.id,
      limits,
    );
  }

  for (const interval of projection.intervals.values()) {
    addDifferenceEdges(
      edges,
      {
        from: interval.startPointId,
        to: interval.endPointId,
        minimum: 1,
      },
      `${INTRINSIC_PREFIX}interval:${interval.id}`,
      limits,
    );
  }

  for (const assertion of projection.constraints) {
    addDifferenceEdges(
      edges,
      {
        from: assertion.constraint.fromPointId,
        to: assertion.constraint.toPointId,
        minimum: assertion.constraint.minimum,
        maximum: assertion.constraint.maximum,
      },
      assertion.id,
      limits,
    );
  }

  return {
    nodes: [...nodes].sort(),
    edges: edges.sort(compareEdges),
    pointAxes,
  };
}

function addDifferenceEdges(
  edges: Edge[],
  spec: DifferenceSpec,
  source: string,
  limits: TemporalKernelLimitsV0Alpha3,
): void {
  if (spec.maximum !== undefined) {
    enforceLimit(edges.length + 1, limits.maxEdges, "constraint edges");
    edges.push({
      from: spec.from,
      to: spec.to,
      weight: spec.maximum,
      source,
    });
  }
  if (spec.minimum !== undefined) {
    enforceLimit(edges.length + 1, limits.maxEdges, "constraint edges");
    edges.push({
      from: spec.to,
      to: spec.from,
      weight: safeNegate(spec.minimum),
      source,
    });
  }
}

function connectedScope(
  graph: Graph,
  seeds: readonly string[],
  budget: OperationBudget,
): Graph {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node, []);
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  for (const neighbours of adjacency.values()) neighbours.sort();

  const included = new Set<string>();
  const queue = [...new Set(seeds)].sort();
  for (const seed of queue) {
    if (!adjacency.has(seed))
      reference(`query references unknown point ${seed}`);
    included.add(seed);
  }
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index]!;
    for (const neighbour of adjacency.get(node) ?? []) {
      budget.consume();
      if (included.has(neighbour)) continue;
      included.add(neighbour);
      queue.push(neighbour);
    }
  }

  return {
    nodes: [...included].sort(),
    edges: graph.edges.filter(
      (edge) => included.has(edge.from) && included.has(edge.to),
    ),
    pointAxes: new Map(
      [...graph.pointAxes].filter(([pointId]) => included.has(pointId)),
    ),
  };
}

function checkConsistency(
  graph: Graph,
  budget: OperationBudget,
): GraphConsistency {
  const distances = new Map(graph.nodes.map((node) => [node, 0n]));
  const predecessors = new Map<string, Edge>();
  let updated: string | null = null;

  for (let iteration = 0; iteration < graph.nodes.length; iteration += 1) {
    updated = null;
    for (const edge of graph.edges) {
      budget.consume();
      const candidate = distances.get(edge.from)! + BigInt(edge.weight);
      if (candidate >= distances.get(edge.to)!) continue;
      distances.set(edge.to, candidate);
      predecessors.set(edge.to, edge);
      updated = edge.to;
    }
    if (updated === null) {
      return { consistent: true, distances };
    }
  }

  if (updated === null) return { consistent: true, distances };
  let cursor = updated;
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const edge = predecessors.get(cursor);
    if (!edge) invalid("reasoner could not reconstruct a negative cycle");
    cursor = edge.from;
  }
  const cycleStart = cursor;
  const cycle: Edge[] = [];
  do {
    const edge = predecessors.get(cursor);
    if (!edge) invalid("reasoner could not reconstruct a negative cycle");
    cycle.push(edge);
    cursor = edge.from;
    if (cycle.length > graph.nodes.length + 1) {
      invalid("reasoner produced an invalid negative cycle");
    }
  } while (cursor !== cycleStart);

  return {
    consistent: false,
    edges: canonicalCycle(cycle.reverse()).map(proofEdge),
  };
}

function shortestPath(
  graph: Graph,
  source: string,
  target: string,
  budget: OperationBudget,
): ShortestPath {
  if (source === target) return { distance: 0, edges: [] };
  const distances = new Map<string, bigint>();
  const predecessors = new Map<string, Edge>();
  distances.set(source, 0n);

  for (let iteration = 1; iteration < graph.nodes.length; iteration += 1) {
    let changed = false;
    for (const edge of graph.edges) {
      budget.consume();
      const from = distances.get(edge.from);
      if (from === undefined) continue;
      const candidate = from + BigInt(edge.weight);
      const current = distances.get(edge.to);
      if (current !== undefined && candidate >= current) continue;
      distances.set(edge.to, candidate);
      predecessors.set(edge.to, edge);
      changed = true;
    }
    if (!changed) break;
  }

  const distance = distances.get(target);
  if (distance === undefined) return { distance: null, edges: [] };
  const path: Edge[] = [];
  let cursor = target;
  for (let steps = 0; cursor !== source; steps += 1) {
    if (steps >= graph.nodes.length) {
      invalid("reasoner produced an invalid shortest path");
    }
    const edge = predecessors.get(cursor);
    if (!edge) invalid("reasoner could not reconstruct a shortest path");
    path.push(edge);
    cursor = edge.from;
  }
  path.reverse();
  return {
    distance: safeNumber(distance),
    edges: path.map(proofEdge),
  };
}

function scheduleProof(
  graph: Graph,
  budget: OperationBudget,
): TemporalScheduleProofV0Alpha3 {
  const bounded = boundedScheduleGraph(graph);
  const consistency = checkConsistency(bounded, budget);
  if (!consistency.consistent) {
    throw new TemporalKernelErrorV0Alpha3(
      "temporal.arithmetic.overflow",
      "temporal state has no safe-integer schedule",
    );
  }
  const zero = consistency.distances.get(SCHEDULE_ZERO)!;
  const coordinates: Record<string, number> = {};
  for (const pointId of [...graph.pointAxes.keys()].sort()) {
    coordinates[pointId] = safeNumber(
      consistency.distances.get(pointId)! - zero,
    );
  }
  return {
    kind: "schedule",
    coordinates,
  };
}

function boundedScheduleGraph(graph: Graph): Graph {
  const edges = [...graph.edges];
  for (const pointId of [...graph.pointAxes.keys()].sort()) {
    edges.push(
      {
        from: SCHEDULE_ZERO,
        to: pointId,
        weight: Number.MAX_SAFE_INTEGER,
        source: `${INTRINSIC_PREFIX}safe-domain:${pointId}:maximum`,
      },
      {
        from: pointId,
        to: SCHEDULE_ZERO,
        weight: Number.MAX_SAFE_INTEGER,
        source: `${INTRINSIC_PREFIX}safe-domain:${pointId}:minimum`,
      },
    );
  }
  for (const node of graph.nodes) {
    if (!node.startsWith(ORIGIN_PREFIX)) continue;
    edges.push(
      {
        from: SCHEDULE_ZERO,
        to: node,
        weight: 0,
        source: `${INTRINSIC_PREFIX}safe-domain:${node}:origin-upper`,
      },
      {
        from: node,
        to: SCHEDULE_ZERO,
        weight: 0,
        source: `${INTRINSIC_PREFIX}safe-domain:${node}:origin-lower`,
      },
    );
  }
  return {
    nodes: [...graph.nodes, SCHEDULE_ZERO].sort(),
    edges: edges.sort(compareEdges),
    pointAxes: graph.pointAxes,
  };
}

function evaluateRelations<T extends string>(
  graph: Graph,
  relations: readonly T[],
  compile: (relation: T) => readonly DifferenceSpec[],
  queryId: string,
  limits: TemporalKernelLimitsV0Alpha3,
  budget: OperationBudget,
): {
  readonly inconsistentEdges: readonly TemporalProofEdgeV0Alpha3[] | null;
  readonly possible: readonly T[];
  readonly cases: readonly TemporalRelationCaseProofV0Alpha3[];
} {
  const base = checkConsistency(graph, budget);
  if (!base.consistent) {
    return {
      inconsistentEdges: base.edges,
      possible: [],
      cases: [],
    };
  }

  const possible: T[] = [];
  const cases: TemporalRelationCaseProofV0Alpha3[] = [];
  for (const relation of relations) {
    const candidate = extendGraph(
      graph,
      compile(relation),
      `${INTRINSIC_PREFIX}query:${queryId}:${relation}`,
      limits,
    );
    const consistency = checkConsistency(candidate, budget);
    if (consistency.consistent) {
      possible.push(relation);
      cases.push({
        relation: relation as
          | TemporalIntervalRelationV0Alpha3
          | TemporalPointRelationV0Alpha3,
        possible: true,
        witness: scheduleProof(candidate, budget),
      });
    } else {
      cases.push({
        relation: relation as
          | TemporalIntervalRelationV0Alpha3
          | TemporalPointRelationV0Alpha3,
        possible: false,
        witness: {
          kind: "negative-cycle",
          edges: consistency.edges,
        },
      });
    }
  }
  return { inconsistentEdges: null, possible, cases };
}

function extendGraph(
  graph: Graph,
  specs: readonly DifferenceSpec[],
  sourcePrefix: string,
  limits: TemporalKernelLimitsV0Alpha3,
): Graph {
  const edges = [...graph.edges];
  specs.forEach((spec, index) => {
    addDifferenceEdges(edges, spec, `${sourcePrefix}:${index}`, limits);
  });
  return {
    ...graph,
    edges: edges.sort(compareEdges),
  };
}

function pointRelationSpecs(
  left: string,
  right: string,
  relation: TemporalPointRelationV0Alpha3,
): readonly DifferenceSpec[] {
  switch (relation) {
    case "before":
      return [lessThan(left, right)];
    case "equal":
      return [equalTo(left, right)];
    case "after":
      return [lessThan(right, left)];
  }
}

function intervalRelationSpecs(
  left: TemporalIntervalV0Alpha3,
  right: TemporalIntervalV0Alpha3,
  relation: TemporalIntervalRelationV0Alpha3,
): readonly DifferenceSpec[] {
  const ls = left.startPointId;
  const le = left.endPointId;
  const rs = right.startPointId;
  const re = right.endPointId;

  switch (relation) {
    case "before":
      return [lessThan(le, rs)];
    case "meets":
      return [equalTo(le, rs)];
    case "overlaps":
      return [lessThan(ls, rs), lessThan(rs, le), lessThan(le, re)];
    case "starts":
      return [equalTo(ls, rs), lessThan(le, re)];
    case "during":
      return [lessThan(rs, ls), lessThan(le, re)];
    case "finishes":
      return [lessThan(rs, ls), equalTo(le, re)];
    case "equal":
      return [equalTo(ls, rs), equalTo(le, re)];
    case "finished-by":
      return [lessThan(ls, rs), equalTo(le, re)];
    case "contains":
      return [lessThan(ls, rs), lessThan(re, le)];
    case "started-by":
      return [equalTo(ls, rs), lessThan(re, le)];
    case "overlapped-by":
      return [lessThan(rs, ls), lessThan(ls, re), lessThan(re, le)];
    case "met-by":
      return [equalTo(ls, re)];
    case "after":
      return [lessThan(re, ls)];
  }
}

function lessThan(left: string, right: string): DifferenceSpec {
  return { from: left, to: right, minimum: 1 };
}

function equalTo(left: string, right: string): DifferenceSpec {
  return { from: left, to: right, minimum: 0, maximum: 0 };
}

function requirePoint(
  projection: Projection,
  pointId: string,
  contextId: string,
): TemporalPointV0Alpha3 {
  requireIdentifier(pointId, "query point id");
  const point = projection.points.get(pointId);
  if (!point || point.contextId !== contextId) {
    reference(`query references point ${pointId} outside context ${contextId}`);
  }
  return point;
}

function requireInterval(
  projection: Projection,
  intervalId: string,
  contextId: string,
): TemporalIntervalV0Alpha3 {
  requireIdentifier(intervalId, "query interval id");
  const interval = projection.intervals.get(intervalId);
  if (!interval || interval.contextId !== contextId) {
    reference(
      `query references interval ${intervalId} outside context ${contextId}`,
    );
  }
  return interval;
}

function requireSameAxis(
  left: TemporalPointV0Alpha3,
  right: TemporalPointV0Alpha3,
  operation: string,
): void {
  if (left.axisId !== right.axisId) {
    reference(`${operation} cannot cross temporal axes`);
  }
}

function validateBounds(
  minimum: number | undefined,
  maximum: number | undefined,
  label: string,
  requireOne: boolean,
): void {
  if (minimum === undefined && maximum === undefined) {
    if (requireOne) invalid(`${label} must declare at least one bound`);
    return;
  }
  if (minimum !== undefined && !Number.isSafeInteger(minimum)) {
    invalid(`${label} minimum must be a safe integer`);
  }
  if (maximum !== undefined && !Number.isSafeInteger(maximum)) {
    invalid(`${label} maximum must be a safe integer`);
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    invalid(`${label} minimum must not exceed maximum`);
  }
}

function validateReferences(
  refs: readonly string[],
  label: string,
  limits: TemporalKernelLimitsV0Alpha3,
): void {
  if (!Array.isArray(refs) || refs.length === 0) {
    invalid(`${label} evidenceRefs must be a non-empty array`);
  }
  enforceLimit(refs.length, limits.maxEvidenceRefs, "evidence references");
  const seen = new Set<string>();
  for (const ref of refs) {
    if (typeof ref !== "string" || !DIGEST.test(ref)) {
      invalid(`${label} evidence reference must be a lowercase SHA-256 digest`);
    }
    if (seen.has(ref)) invalid(`${label} repeats evidence reference ${ref}`);
    seen.add(ref);
  }
}

function validateQueryShape(query: TemporalQueryV0Alpha3): void {
  if (!query || typeof query !== "object") {
    invalid("query must be an object");
  }
  if (query.schema !== "covenant.timeline.query.v0alpha3") {
    invalid("query schema must identify v0alpha3");
  }
  requireIdentifier(query.id, "query id");
  requireIdentifier(query.contextId, "query contextId");
  if (
    query.recordedThrough !== null &&
    (!Number.isSafeInteger(query.recordedThrough) || query.recordedThrough < 0)
  ) {
    invalid("query recordedThrough must be null or a safe sequence");
  }
  switch (query.type) {
    case "context.consistency":
      return;
    case "difference.bounds":
      requireIdentifier(query.fromPointId, "query fromPointId");
      requireIdentifier(query.toPointId, "query toPointId");
      return;
    case "point.relations":
      requireIdentifier(query.leftPointId, "query leftPointId");
      requireIdentifier(query.rightPointId, "query rightPointId");
      return;
    case "interval.relations":
      requireIdentifier(query.leftIntervalId, "query leftIntervalId");
      requireIdentifier(query.rightIntervalId, "query rightIntervalId");
      return;
    default:
      invalid("query type is unsupported");
  }
}

function resolveLimits(
  options: TemporalKernelLimitOptionsV0Alpha3,
): TemporalKernelLimitsV0Alpha3 {
  const allowed = new Set(Object.keys(DEFAULT_TEMPORAL_KERNEL_LIMITS_V0ALPHA3));
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) invalid(`unknown kernel limit ${key}`);
  }
  const limits = {
    ...DEFAULT_TEMPORAL_KERNEL_LIMITS_V0ALPHA3,
    ...options,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      invalid(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

function compareEdges(left: Edge, right: Edge): number {
  const weightOrder =
    left.weight === right.weight ? 0 : left.weight < right.weight ? -1 : 1;
  return (
    compareStrings(left.from, right.from) ||
    compareStrings(left.to, right.to) ||
    weightOrder ||
    compareStrings(left.source, right.source)
  );
}

function canonicalCycle(edges: readonly Edge[]): readonly Edge[] {
  if (edges.length < 2) return edges;
  let best = [...edges];
  for (let offset = 1; offset < edges.length; offset += 1) {
    const candidate = [...edges.slice(offset), ...edges.slice(0, offset)];
    if (compareEdgeSequences(candidate, best) < 0) best = candidate;
  }
  return best;
}

function compareEdgeSequences(
  left: readonly Edge[],
  right: readonly Edge[],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const order = compareEdges(left[index]!, right[index]!);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

function proofEdge(edge: Edge): TemporalProofEdgeV0Alpha3 {
  return {
    sourceId: edge.source,
    fromNodeId: edge.from,
    toNodeId: edge.to,
    maximum: edge.weight,
  };
}

function originId(axisId: string): string {
  return `${ORIGIN_PREFIX}${axisId}`;
}

function sortedValues<T extends { id: string }>(
  values: ReadonlyMap<string, T>,
): T[] {
  return [...values.values()].sort((left, right) =>
    compareStrings(left.id, right.id),
  );
}

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function reserveTemporalId(id: string, ids: Set<string>): void {
  if (ids.has(id)) {
    invalid(`temporal object ${id} is declared more than once`);
  }
  ids.add(id);
}

function digest(value: unknown): `sha256:${string}` {
  return contentDigest(value as JsonValue);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalJson(value as unknown as JsonValue)) as T;
}

function freezeJson<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeJson(nested);
    Object.freeze(value);
  }
  return value;
}

function requireIdentifier(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    invalid(`${label} must be a lowercase portable identifier`);
  }
}

function enforceLimit(actual: number, maximum: number, label: string): void {
  if (actual > maximum) limit(`${label} exceed limit ${maximum}`);
}

function safeNegate(value: number): number {
  const result = -value;
  if (!Number.isSafeInteger(result)) {
    throw new TemporalKernelErrorV0Alpha3(
      "temporal.arithmetic.overflow",
      "temporal constraint arithmetic exceeded the safe integer domain",
    );
  }
  return result;
}

function safeNumber(value: bigint): number {
  if (value < SAFE_MIN || value > SAFE_MAX) {
    throw new TemporalKernelErrorV0Alpha3(
      "temporal.arithmetic.overflow",
      "temporal constraint arithmetic exceeded the safe integer domain",
    );
  }
  return Number(value);
}

function invalid(message: string): never {
  throw new TemporalKernelErrorV0Alpha3("temporal.input.invalid", message);
}

function reference(message: string): never {
  throw new TemporalKernelErrorV0Alpha3("temporal.input.reference", message);
}

function limit(message: string): never {
  throw new TemporalKernelErrorV0Alpha3("temporal.input.limit", message);
}

class OperationBudget {
  private used = 0;

  constructor(private readonly maximum: number) {}

  consume(): void {
    this.used += 1;
    if (this.used > this.maximum) {
      limit(`reasoner exceeded operation limit ${this.maximum}`);
    }
  }
}

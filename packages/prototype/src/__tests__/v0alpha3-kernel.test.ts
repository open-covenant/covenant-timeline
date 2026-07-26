import { describe, expect, it } from "vitest";
import {
  TemporalKernelErrorV0Alpha3,
  projectTemporalStateV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "../v0alpha3/kernel.js";
import type {
  TemporalConclusionV0Alpha3,
  TemporalEventV0Alpha3,
  TemporalQueryV0Alpha3,
  TimelineContractV0Alpha3,
  TimelineRunDocumentV0Alpha3,
} from "../v0alpha3/types.js";

const contract: TimelineContractV0Alpha3 = {
  schema: "covenant.timeline.contract.v0alpha3",
  id: "temporal-test",
  subject: { kind: "system", id: "example" },
  axes: [
    {
      id: "day",
      kind: "metric",
      unit: "day",
      origin: "2026-01-01",
    },
    {
      id: "revision",
      kind: "ordinal",
      unit: "revision",
      origin: "repository-created",
    },
  ],
  contexts: [
    { id: "actual", mode: "actual" },
    { id: "forecast", mode: "forecast" },
  ],
};

const evidenceRef = (sequence: number): `sha256:${string}` =>
  `sha256:${sequence.toString(16).padStart(64, "0")}`;

const point = (
  sequence: number,
  id: string,
  contextId = "actual",
  axisId = "day",
): TemporalEventV0Alpha3 => ({
  schema: "covenant.timeline.event.v0alpha3",
  id: `event-${sequence}`,
  sequence,
  type: "point.declared",
  point: {
    id,
    contextId,
    axisId,
  },
});

const coordinate = (
  sequence: number,
  id: string,
  pointId: string,
  value: { minimum?: number; maximum?: number },
  contextId = "actual",
  supersedes?: readonly string[],
): TemporalEventV0Alpha3 =>
  ({
    schema: "covenant.timeline.event.v0alpha3",
    id: `event-${sequence}`,
    sequence,
    type: "coordinate.asserted",
    assertion: {
      id,
      contextId,
      pointId,
      coordinate: value,
      evidenceRefs: [evidenceRef(sequence)],
      ...(supersedes ? { supersedes } : {}),
    },
  }) as TemporalEventV0Alpha3;

const interval = (
  sequence: number,
  id: string,
  startPointId: string,
  endPointId: string,
  contextId = "actual",
): TemporalEventV0Alpha3 => ({
  schema: "covenant.timeline.event.v0alpha3",
  id: `event-${sequence}`,
  sequence,
  type: "interval.declared",
  interval: {
    id,
    contextId,
    startPointId,
    endPointId,
  },
});

const constraint = (
  sequence: number,
  id: string,
  fromPointId: string,
  toPointId: string,
  bounds: { minimum?: number; maximum?: number },
  contextId = "actual",
  supersedes?: readonly string[],
): TemporalEventV0Alpha3 => ({
  schema: "covenant.timeline.event.v0alpha3",
  id: `event-${sequence}`,
  sequence,
  type: "constraint.asserted",
  assertion: {
    id,
    contextId,
    constraint: {
      fromPointId,
      toPointId,
      ...bounds,
    },
    evidenceRefs: [evidenceRef(sequence)],
    ...(supersedes ? { supersedes } : {}),
  },
});

const retraction = (
  sequence: number,
  assertionId: string,
): TemporalEventV0Alpha3 => ({
  schema: "covenant.timeline.event.v0alpha3",
  id: `event-${sequence}`,
  sequence,
  type: "assertion.retracted",
  assertionId,
  evidenceRefs: [evidenceRef(sequence)],
});

const run = (
  events: readonly TemporalEventV0Alpha3[],
): TimelineRunDocumentV0Alpha3 => ({
  schema: "covenant.timeline.run.v0alpha3",
  contract,
  events,
});

const query = (
  value: Omit<TemporalQueryV0Alpha3, "schema" | "contextId"> &
    Partial<Pick<TemporalQueryV0Alpha3, "contextId">>,
): TemporalQueryV0Alpha3 =>
  ({
    schema: "covenant.timeline.query.v0alpha3",
    contextId: "actual",
    ...value,
  }) as TemporalQueryV0Alpha3;

describe("v0alpha3 temporal kernel", () => {
  it("projects an explicit knowledge cut and applies active supersession", () => {
    const document = run([
      point(0, "start"),
      point(1, "finish"),
      constraint(2, "duration-old", "start", "finish", {
        minimum: 5,
        maximum: 5,
      }),
      constraint(
        3,
        "duration-new",
        "start",
        "finish",
        { minimum: 7, maximum: 7 },
        "actual",
        ["duration-old"],
      ),
      retraction(4, "duration-new"),
      constraint(5, "duration-restored", "start", "finish", {
        minimum: 5,
        maximum: 5,
      }),
    ]);

    const empty = projectTemporalStateV0Alpha3(document, "actual", null);
    const replaced = projectTemporalStateV0Alpha3(document, "actual", 3);
    const suppressed = projectTemporalStateV0Alpha3(document, "actual", 4);
    const restored = projectTemporalStateV0Alpha3(document, "actual", 5);

    expect(empty.recordedThrough).toBeNull();
    expect(empty.points).toEqual([]);
    expect(replaced.constraints.map(({ id }) => id)).toEqual(["duration-new"]);
    expect(suppressed.constraints).toEqual([]);
    expect(restored.constraints.map(({ id }) => id)).toEqual([
      "duration-restored",
    ]);
    expect(restored).toEqual(
      projectTemporalStateV0Alpha3(document, "actual", 5),
    );
    expect(restored.stateDigest).not.toBe(replaced.stateDigest);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.constraints)).toBe(true);
  });

  it("interprets bounds as minimum <= to - from <= maximum", () => {
    const document = run([
      point(0, "start"),
      point(1, "finish"),
      constraint(2, "duration", "start", "finish", {
        minimum: 3,
        maximum: 6,
      }),
    ]);
    const conclusion = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "difference.bounds",
        id: "duration-bounds",
        recordedThrough: 2,
        fromPointId: "start",
        toPointId: "finish",
      }),
    );

    expect(conclusion.result).toEqual({
      type: "difference.bounds",
      status: "bounded",
      minimum: 3,
      maximum: 6,
    });
    expect(conclusion.receipt.proof).toEqual({
      kind: "bounds",
      lowerEdges: [
        {
          sourceId: "duration",
          fromNodeId: "finish",
          toNodeId: "start",
          maximum: -3,
        },
      ],
      upperEdges: [
        {
          sourceId: "duration",
          fromNodeId: "start",
          toNodeId: "finish",
          maximum: 6,
        },
      ],
    });
  });

  it("compiles coordinate assertions against the implicit axis origin", () => {
    const document = run([
      point(0, "window"),
      point(1, "fixed"),
      coordinate(2, "window-coordinate", "window", {
        minimum: 2,
        maximum: 4,
      }),
      coordinate(3, "fixed-coordinate", "fixed", {
        minimum: 10,
        maximum: 10,
      }),
    ]);
    const conclusion = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "difference.bounds",
        id: "coordinate-bounds",
        recordedThrough: 3,
        fromPointId: "window",
        toPointId: "fixed",
      }),
    );

    expect(conclusion.result).toEqual({
      type: "difference.bounds",
      status: "bounded",
      minimum: 6,
      maximum: 8,
    });
    expect(conclusion.receipt.proof).toEqual({
      kind: "bounds",
      lowerEdges: [
        {
          sourceId: "fixed-coordinate",
          fromNodeId: "fixed",
          toNodeId: "@origin:day",
          maximum: -10,
        },
        {
          sourceId: "window-coordinate",
          fromNodeId: "@origin:day",
          toNodeId: "window",
          maximum: 4,
        },
      ],
      upperEdges: [
        {
          sourceId: "window-coordinate",
          fromNodeId: "window",
          toNodeId: "@origin:day",
          maximum: -2,
        },
        {
          sourceId: "fixed-coordinate",
          fromNodeId: "@origin:day",
          toNodeId: "fixed",
          maximum: 10,
        },
      ],
    });
  });

  it("isolates query components but checks the whole requested context", () => {
    const document = run([
      point(0, "left"),
      point(1, "right"),
      point(2, "bad-left"),
      point(3, "bad-right"),
      constraint(4, "bad-min", "bad-left", "bad-right", { minimum: 5 }),
      constraint(5, "bad-max", "bad-left", "bad-right", { maximum: 3 }),
    ]);
    const relation = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "point.relations",
        id: "isolated-relation",
        recordedThrough: 5,
        leftPointId: "left",
        rightPointId: "right",
      }),
    );
    const consistency = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "context.consistency",
        id: "whole-context",
        recordedThrough: 5,
      }),
    );

    expect(relation.result).toEqual({
      type: "point.relations",
      status: "indeterminate",
      possible: ["before", "equal", "after"],
    });
    expect(consistency.result).toEqual({
      type: "context.consistency",
      status: "inconsistent",
    });
    expect(consistency.receipt.proof).toEqual({
      kind: "negative-cycle",
      edges: [
        {
          sourceId: "bad-max",
          fromNodeId: "bad-left",
          toNodeId: "bad-right",
          maximum: 3,
        },
        {
          sourceId: "bad-min",
          fromNodeId: "bad-right",
          toNodeId: "bad-left",
          maximum: -5,
        },
      ],
    });
    if (consistency.receipt.proof.kind === "negative-cycle") {
      const { edges } = consistency.receipt.proof;
      edges.forEach((edge, index) => {
        expect(edge.toNodeId).toBe(
          edges[(index + 1) % edges.length]!.fromNodeId,
        );
      });
      expect(edges.reduce((sum, edge) => sum + edge.maximum, 0)).toBeLessThan(
        0,
      );
    }
  });

  it("keeps scenario contexts independent", () => {
    const document = run([
      point(0, "actual-left"),
      point(1, "actual-right"),
      point(2, "forecast-left", "forecast"),
      point(3, "forecast-right", "forecast"),
      constraint(
        4,
        "forecast-min",
        "forecast-left",
        "forecast-right",
        { minimum: 5 },
        "forecast",
      ),
      constraint(
        5,
        "forecast-max",
        "forecast-left",
        "forecast-right",
        { maximum: 3 },
        "forecast",
      ),
    ]);

    const actual = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "context.consistency",
        id: "actual-consistency",
        recordedThrough: 5,
      }),
    );
    const forecast = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "context.consistency",
        id: "forecast-consistency",
        contextId: "forecast",
        recordedThrough: 5,
      }),
    );

    expect(actual.result).toEqual({
      type: "context.consistency",
      status: "consistent",
    });
    expect(forecast.result).toEqual({
      type: "context.consistency",
      status: "inconsistent",
    });
  });

  it("excludes other-context payloads from state identity but retains the global cut", () => {
    const first = run([
      point(0, "actual-point"),
      point(1, "forecast-a", "forecast"),
    ]);
    const second = run([
      point(0, "actual-point"),
      point(1, "forecast-b", "forecast"),
    ]);

    const atZero = projectTemporalStateV0Alpha3(first, "actual", 0);
    const firstAtOne = projectTemporalStateV0Alpha3(first, "actual", 1);
    const secondAtOne = projectTemporalStateV0Alpha3(second, "actual", 1);

    expect(firstAtOne.stateDigest).toBe(secondAtOne.stateDigest);
    expect(firstAtOne.stateDigest).not.toBe(atZero.stateDigest);
  });

  it("preserves fact validity and observation coordinates on distinct axes", () => {
    const document = run([
      point(0, "valid-start"),
      point(1, "valid-end"),
      interval(2, "valid-window", "valid-start", "valid-end"),
      point(3, "observed-revision", "actual", "revision"),
      {
        schema: "covenant.timeline.event.v0alpha3",
        id: "event-4",
        sequence: 4,
        type: "fact.asserted",
        assertion: {
          id: "fact-observed",
          contextId: "actual",
          propositionRef: "release.approved",
          validDuring: "valid-window",
          observedAt: "observed-revision",
          evidenceRefs: [evidenceRef(4)],
        },
      },
    ]);

    expect(
      projectTemporalStateV0Alpha3(document, "actual", 4).facts.map(
        ({ id }) => id,
      ),
    ).toEqual(["fact-observed"]);
  });

  it("enumerates all 13 Allen relations for unconstrained proper intervals", () => {
    const document = run([
      point(0, "left-start"),
      point(1, "left-end"),
      point(2, "right-start"),
      point(3, "right-end"),
      interval(4, "left", "left-start", "left-end"),
      interval(5, "right", "right-start", "right-end"),
    ]);
    const conclusion = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "interval.relations",
        id: "all-allen-relations",
        recordedThrough: 5,
        leftIntervalId: "left",
        rightIntervalId: "right",
      }),
    );

    expect(conclusion.result).toEqual({
      type: "interval.relations",
      status: "indeterminate",
      possible: [
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
      ],
    });
    expect(conclusion.receipt.proof.kind).toBe("relation-cases");
    if (conclusion.receipt.proof.kind === "relation-cases") {
      expect(conclusion.receipt.proof.cases).toHaveLength(13);
      expect(
        conclusion.receipt.proof.cases.every(({ possible }) => possible),
      ).toBe(true);
    }
  });

  it("resolves an Allen relation from endpoint coordinates", () => {
    const document = run([
      point(0, "left-start"),
      point(1, "left-end"),
      point(2, "right-start"),
      point(3, "right-end"),
      coordinate(4, "left-start-coordinate", "left-start", {
        minimum: 0,
        maximum: 0,
      }),
      coordinate(5, "left-end-coordinate", "left-end", {
        minimum: 2,
        maximum: 2,
      }),
      coordinate(6, "right-start-coordinate", "right-start", {
        minimum: 2,
        maximum: 2,
      }),
      coordinate(7, "right-end-coordinate", "right-end", {
        minimum: 5,
        maximum: 5,
      }),
      interval(8, "left", "left-start", "left-end"),
      interval(9, "right", "right-start", "right-end"),
    ]);
    const conclusion = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "interval.relations",
        id: "meeting",
        recordedThrough: 9,
        leftIntervalId: "left",
        rightIntervalId: "right",
      }),
    );

    expect(conclusion.result).toEqual({
      type: "interval.relations",
      status: "resolved",
      possible: ["meets"],
    });
  });

  it.each([
    ["before", [0, 1], [3, 4]],
    ["meets", [0, 1], [1, 3]],
    ["overlaps", [0, 3], [2, 4]],
    ["starts", [0, 2], [0, 4]],
    ["during", [1, 3], [0, 4]],
    ["finishes", [1, 4], [0, 4]],
    ["equal", [0, 4], [0, 4]],
    ["finished-by", [0, 4], [1, 4]],
    ["contains", [0, 5], [1, 4]],
    ["started-by", [0, 5], [0, 3]],
    ["overlapped-by", [2, 5], [0, 3]],
    ["met-by", [3, 5], [0, 3]],
    ["after", [4, 5], [0, 3]],
  ] as const)(
    "resolves the %s Allen base relation",
    (relation, leftCoordinates, rightCoordinates) => {
      const document = run([
        point(0, "left-start"),
        point(1, "left-end"),
        point(2, "right-start"),
        point(3, "right-end"),
        coordinate(4, "left-start-coordinate", "left-start", {
          minimum: leftCoordinates[0],
          maximum: leftCoordinates[0],
        }),
        coordinate(5, "left-end-coordinate", "left-end", {
          minimum: leftCoordinates[1],
          maximum: leftCoordinates[1],
        }),
        coordinate(6, "right-start-coordinate", "right-start", {
          minimum: rightCoordinates[0],
          maximum: rightCoordinates[0],
        }),
        coordinate(7, "right-end-coordinate", "right-end", {
          minimum: rightCoordinates[1],
          maximum: rightCoordinates[1],
        }),
        interval(8, "left", "left-start", "left-end"),
        interval(9, "right", "right-start", "right-end"),
      ]);
      const conclusion = reasonTemporalQueryV0Alpha3(
        document,
        query({
          type: "interval.relations",
          id: `resolved-${relation}`,
          recordedThrough: 9,
          leftIntervalId: "left",
          rightIntervalId: "right",
        }),
      );

      expect(conclusion.result).toEqual({
        type: "interval.relations",
        status: "resolved",
        possible: [relation],
      });
    },
  );

  it("returns canonical, bound receipts that fail verification when changed", () => {
    const document = run([
      point(0, "left"),
      point(1, "right"),
      constraint(2, "ordered", "left", "right", { minimum: 1 }),
    ]);
    const temporalQuery = query({
      type: "point.relations",
      id: "verified",
      recordedThrough: 2,
      leftPointId: "left",
      rightPointId: "right",
    });
    const conclusion = reasonTemporalQueryV0Alpha3(document, temporalQuery);

    expect(conclusion.result).toEqual({
      type: "point.relations",
      status: "resolved",
      possible: ["before"],
    });
    expect(
      verifyTemporalConclusionV0Alpha3(document, temporalQuery, conclusion),
    ).toBe(true);
    expect(conclusion.receipt.proof.kind).toBe("relation-cases");
    const alternate = {
      ...conclusion,
      receipt: {
        ...conclusion.receipt,
        proof: {
          kind: "relation-cases" as const,
          cases:
            conclusion.receipt.proof.kind === "relation-cases"
              ? conclusion.receipt.proof.cases.map((relationCase) =>
                  relationCase.relation === "before"
                    ? {
                        ...relationCase,
                        witness: {
                          kind: "schedule" as const,
                          coordinates: { left: 10, right: 11 },
                        },
                      }
                    : relationCase,
                )
              : [],
        },
      },
    } satisfies TemporalConclusionV0Alpha3;
    expect(
      verifyTemporalConclusionV0Alpha3(document, temporalQuery, alternate),
    ).toBe(true);
    const invalidWitness = {
      ...alternate,
      receipt: {
        ...alternate.receipt,
        proof: {
          ...alternate.receipt.proof,
          cases: alternate.receipt.proof.cases.map((relationCase) =>
            relationCase.relation === "before"
              ? {
                  ...relationCase,
                  witness: {
                    kind: "schedule" as const,
                    coordinates: { left: 10, right: 10 },
                  },
                }
              : relationCase,
          ),
        },
      },
    } satisfies TemporalConclusionV0Alpha3;
    expect(
      verifyTemporalConclusionV0Alpha3(document, temporalQuery, invalidWitness),
    ).toBe(false);
    expect(
      verifyTemporalConclusionV0Alpha3(document, temporalQuery, {
        ...conclusion,
        queryId: "substituted",
      }),
    ).toBe(false);
    expect(conclusion.receipt.stateDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(conclusion.receipt.queryDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(conclusion.receipt.semanticResultDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it("rejects cross-axis constraints and unsafe coordinates", () => {
    const crossAxis = run([
      point(0, "day-point"),
      point(1, "revision-point", "actual", "revision"),
      constraint(2, "invalid", "day-point", "revision-point", { minimum: 1 }),
    ]);
    const unsafe = run([
      point(0, "unsafe"),
      coordinate(1, "unsafe-coordinate", "unsafe", {
        minimum: Number.MAX_SAFE_INTEGER + 1,
      }),
    ]);

    expect(() => projectTemporalStateV0Alpha3(crossAxis, "actual", 2)).toThrow(
      TemporalKernelErrorV0Alpha3,
    );
    expect(() => projectTemporalStateV0Alpha3(unsafe, "actual", 1)).toThrow(
      TemporalKernelErrorV0Alpha3,
    );
  });

  it("rejects empty coordinates, negative cuts, and temporal ID collisions", () => {
    const emptyCoordinate = run([
      point(0, "empty"),
      coordinate(1, "empty-coordinate", "empty", {}),
    ]);
    const collidingIds = run([
      point(0, "shared"),
      point(1, "end"),
      interval(2, "shared", "shared", "end"),
    ]);

    expect(() =>
      projectTemporalStateV0Alpha3(emptyCoordinate, "actual", 1),
    ).toThrow(TemporalKernelErrorV0Alpha3);
    expect(() => projectTemporalStateV0Alpha3(run([]), "actual", -1)).toThrow(
      TemporalKernelErrorV0Alpha3,
    );
    expect(() =>
      projectTemporalStateV0Alpha3(collidingIds, "actual", 2),
    ).toThrow(TemporalKernelErrorV0Alpha3);
  });

  it("enforces interval properness as at least one tick", () => {
    const document = run([
      point(0, "start"),
      point(1, "end"),
      coordinate(2, "start-coordinate", "start", {
        minimum: 3,
        maximum: 3,
      }),
      coordinate(3, "end-coordinate", "end", {
        minimum: 3,
        maximum: 3,
      }),
      interval(4, "zero-duration", "start", "end"),
    ]);
    const conclusion = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "context.consistency",
        id: "proper-interval",
        recordedThrough: 4,
      }),
    );

    expect(conclusion.result).toEqual({
      type: "context.consistency",
      status: "inconsistent",
    });
  });

  it.each([
    ["before", 1, 2],
    ["equal", 2, 2],
    ["after", 3, 2],
  ] as const)("resolves the %s point relation", (relation, left, right) => {
    const document = run([
      point(0, "left"),
      point(1, "right"),
      coordinate(2, "left-coordinate", "left", {
        minimum: left,
        maximum: left,
      }),
      coordinate(3, "right-coordinate", "right", {
        minimum: right,
        maximum: right,
      }),
    ]);
    const conclusion = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "point.relations",
        id: `point-${relation}`,
        recordedThrough: 3,
        leftPointId: "left",
        rightPointId: "right",
      }),
    );

    expect(conclusion.result).toEqual({
      type: "point.relations",
      status: "resolved",
      possible: [relation],
    });
  });

  it("distinguishes partial, unbounded, and transitive tight bounds", () => {
    const partialRun = run([
      point(0, "a"),
      point(1, "b"),
      constraint(2, "minimum", "a", "b", { minimum: 3 }),
    ]);
    const unboundedRun = run([point(0, "a"), point(1, "b")]);
    const transitiveRun = run([
      point(0, "a"),
      point(1, "b"),
      point(2, "c"),
      constraint(3, "a-to-b", "a", "b", { maximum: 2 }),
      constraint(4, "b-to-c", "b", "c", { maximum: 3 }),
    ]);
    const boundsQuery = (
      id: string,
      recordedThrough: number,
      toPointId = "b",
    ) =>
      query({
        type: "difference.bounds",
        id,
        recordedThrough,
        fromPointId: "a",
        toPointId,
      });

    expect(
      reasonTemporalQueryV0Alpha3(partialRun, boundsQuery("partial", 2)).result,
    ).toEqual({
      type: "difference.bounds",
      status: "partially-bounded",
      minimum: 3,
      maximum: null,
    });
    expect(
      reasonTemporalQueryV0Alpha3(unboundedRun, boundsQuery("unbounded", 1))
        .result,
    ).toEqual({
      type: "difference.bounds",
      status: "unbounded",
      minimum: null,
      maximum: null,
    });

    const transitiveQuery = boundsQuery("transitive", 4, "c");
    const transitive = reasonTemporalQueryV0Alpha3(
      transitiveRun,
      transitiveQuery,
    );
    expect(transitive.result).toEqual({
      type: "difference.bounds",
      status: "partially-bounded",
      minimum: null,
      maximum: 5,
    });
    expect(transitive.receipt.proof).toMatchObject({
      kind: "bounds",
      upperEdges: [
        { sourceId: "a-to-b", fromNodeId: "a", toNodeId: "b", maximum: 2 },
        { sourceId: "b-to-c", fromNodeId: "b", toNodeId: "c", maximum: 3 },
      ],
    });
    expect(
      verifyTemporalConclusionV0Alpha3(
        transitiveRun,
        transitiveQuery,
        transitive,
      ),
    ).toBe(true);
  });

  it("anchors schedules to coordinate assertions at the axis origin", () => {
    const document = run([
      point(0, "anchored"),
      coordinate(1, "anchored-coordinate", "anchored", {
        minimum: 5,
        maximum: 5,
      }),
    ]);
    const conclusion = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "context.consistency",
        id: "anchored-schedule",
        recordedThrough: 1,
      }),
    );

    expect(conclusion.receipt.proof).toEqual({
      kind: "schedule",
      coordinates: { anchored: 5 },
    });
  });

  it("returns a direct negative cycle for an inconsistent relation component", () => {
    const document = run([
      point(0, "left"),
      point(1, "right"),
      constraint(2, "minimum", "left", "right", { minimum: 5 }),
      constraint(3, "maximum", "left", "right", { maximum: 3 }),
    ]);
    const temporalQuery = query({
      type: "point.relations",
      id: "inconsistent-relation",
      recordedThrough: 3,
      leftPointId: "left",
      rightPointId: "right",
    });
    const conclusion = reasonTemporalQueryV0Alpha3(document, temporalQuery);

    expect(conclusion.result).toEqual({
      type: "point.relations",
      status: "inconsistent",
      possible: [],
    });
    expect(conclusion.receipt.proof.kind).toBe("negative-cycle");
    expect(
      verifyTemporalConclusionV0Alpha3(document, temporalQuery, conclusion),
    ).toBe(true);
  });

  it("keeps superseded coordinates suppressed after retracting their replacement", () => {
    const document = run([
      point(0, "observed"),
      coordinate(1, "coordinate-v1", "observed", {
        minimum: 1,
        maximum: 1,
      }),
      coordinate(
        2,
        "coordinate-v2",
        "observed",
        { minimum: 2, maximum: 2 },
        "actual",
        ["coordinate-v1"],
      ),
      retraction(3, "coordinate-v2"),
      coordinate(4, "coordinate-v3", "observed", {
        minimum: 3,
        maximum: 3,
      }),
    ]);

    expect(
      projectTemporalStateV0Alpha3(document, "actual", 3).coordinates,
    ).toEqual([]);
    expect(
      projectTemporalStateV0Alpha3(document, "actual", 4).coordinates.map(
        ({ id }) => id,
      ),
    ).toEqual(["coordinate-v3"]);
  });

  it("ignores overflowing non-improving closure candidates", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const document = run([
      point(0, "source"),
      point(1, "a"),
      point(2, "b"),
      constraint(3, "source-a", "source", "a", { maximum }),
      constraint(4, "source-b", "source", "b", { maximum: 0 }),
      constraint(5, "a-b", "a", "b", { maximum: 1 }),
    ]);
    const conclusion = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "difference.bounds",
        id: "safe-shortest-path",
        recordedThrough: 5,
        fromPointId: "source",
        toPointId: "b",
      }),
    );

    expect(conclusion.result).toEqual({
      type: "difference.bounds",
      status: "partially-bounded",
      minimum: null,
      maximum: 0,
    });
  });

  it("centers an unanchored schedule across the safe integer domain", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const document = run([
      point(0, "p0"),
      point(1, "p1"),
      point(2, "p2"),
      constraint(3, "p0-p1", "p0", "p1", { minimum: maximum }),
      constraint(4, "p1-p2", "p1", "p2", { minimum: maximum }),
    ]);
    const conclusion = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "context.consistency",
        id: "centered-safe-schedule",
        recordedThrough: 4,
      }),
    );

    expect(conclusion.receipt.proof).toEqual({
      kind: "schedule",
      coordinates: {
        p0: Number.MIN_SAFE_INTEGER,
        p1: 0,
        p2: Number.MAX_SAFE_INTEGER,
      },
    });
  });

  it("finds a safe schedule when an upper anchor requires shifting the solver potential", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const minimum = Number.MIN_SAFE_INTEGER;
    const document = run([
      point(0, "u"),
      point(1, "m"),
      point(2, "v"),
      coordinate(3, "u-upper", "u", { maximum }),
      constraint(4, "u-to-m", "u", "m", { maximum: minimum }),
      constraint(5, "m-to-v", "m", "v", { maximum: minimum }),
    ]);
    const temporalQuery = query({
      type: "context.consistency",
      id: "shifted-upper-anchor",
      recordedThrough: 5,
    });
    const conclusion = reasonTemporalQueryV0Alpha3(document, temporalQuery);

    expect(conclusion.receipt.proof).toEqual({
      kind: "schedule",
      coordinates: { m: 0, u: maximum, v: minimum },
    });
    expect(
      verifyTemporalConclusionV0Alpha3(document, temporalQuery, conclusion),
    ).toBe(true);
  });

  it("finds the symmetric safe schedule for a lower anchor", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const minimum = Number.MIN_SAFE_INTEGER;
    const document = run([
      point(0, "u"),
      point(1, "m"),
      point(2, "v"),
      coordinate(3, "u-lower", "u", { minimum }),
      constraint(4, "u-to-m", "u", "m", { minimum: maximum }),
      constraint(5, "m-to-v", "m", "v", { minimum: maximum }),
    ]);
    const temporalQuery = query({
      type: "context.consistency",
      id: "shifted-lower-anchor",
      recordedThrough: 5,
    });
    const conclusion = reasonTemporalQueryV0Alpha3(document, temporalQuery);

    expect(conclusion.receipt.proof).toEqual({
      kind: "schedule",
      coordinates: { m: 0, u: minimum, v: maximum },
    });
    expect(
      verifyTemporalConclusionV0Alpha3(document, temporalQuery, conclusion),
    ).toBe(true);
    expect(
      verifyTemporalConclusionV0Alpha3(document, temporalQuery, {
        ...conclusion,
        receipt: {
          ...conclusion.receipt,
          proof: {
            kind: "schedule",
            coordinates: { m: 0, u: minimum, v: minimum },
          },
        },
      }),
    ).toBe(false);
  });

  it("fails closed when a component has no safe-integer schedule", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const document = run([
      point(0, "p0"),
      point(1, "p1"),
      point(2, "p2"),
      point(3, "p3"),
      constraint(4, "p0-p1", "p0", "p1", { minimum: maximum }),
      constraint(5, "p1-p2", "p1", "p2", { minimum: maximum }),
      constraint(6, "p2-p3", "p2", "p3", { minimum: maximum }),
    ]);

    expect(() =>
      reasonTemporalQueryV0Alpha3(
        document,
        query({
          type: "context.consistency",
          id: "unsafe-schedule",
          recordedThrough: 6,
        }),
      ),
    ).toThrowError(/no safe-integer schedule/);
  });

  it("returns representable bounds without requiring a schedule witness", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const document = run([
      point(0, "anchor"),
      point(1, "beyond"),
      coordinate(2, "anchor-coordinate", "anchor", {
        minimum: maximum,
        maximum,
      }),
      constraint(3, "beyond-anchor", "anchor", "beyond", {
        minimum: maximum,
      }),
    ]);
    const temporalQuery = query({
      type: "difference.bounds",
      id: "representable-bounds",
      recordedThrough: 3,
      fromPointId: "anchor",
      toPointId: "beyond",
    });

    const conclusion = reasonTemporalQueryV0Alpha3(document, temporalQuery);

    expect(conclusion.result).toEqual({
      type: "difference.bounds",
      status: "partially-bounded",
      minimum: maximum,
      maximum: null,
    });
    expect(
      verifyTemporalConclusionV0Alpha3(document, temporalQuery, conclusion),
    ).toBe(true);
  });

  it("emits an ordered three-edge contradiction cycle", () => {
    const document = run([
      point(0, "a"),
      point(1, "b"),
      point(2, "c"),
      constraint(3, "a-b", "a", "b", { maximum: 0 }),
      constraint(4, "b-c", "b", "c", { maximum: 0 }),
      constraint(5, "c-a", "c", "a", { maximum: -1 }),
    ]);
    const conclusion = reasonTemporalQueryV0Alpha3(
      document,
      query({
        type: "context.consistency",
        id: "three-edge-cycle",
        recordedThrough: 5,
      }),
    );

    expect(conclusion.receipt.proof.kind).toBe("negative-cycle");
    if (conclusion.receipt.proof.kind === "negative-cycle") {
      expect(conclusion.receipt.proof.edges).toHaveLength(3);
      expect(
        conclusion.receipt.proof.edges.reduce(
          (sum, edge) => sum + edge.maximum,
          0,
        ),
      ).toBe(-1);
    }
  });

  it("projects a ten-thousand assertion supersession chain without recursion", () => {
    const events: TemporalEventV0Alpha3[] = [
      point(0, "start"),
      point(1, "finish"),
    ];
    for (let index = 0; index < 10_000; index += 1) {
      events.push(
        constraint(
          index + 2,
          `duration-${index}`,
          "start",
          "finish",
          { maximum: index },
          "actual",
          index === 0 ? undefined : [`duration-${index - 1}`],
        ),
      );
    }

    const state = projectTemporalStateV0Alpha3(
      run(events),
      "actual",
      events.length - 1,
    );
    expect(state.constraints.map(({ id }) => id)).toEqual(["duration-9999"]);
  });

  it("fails closed when a query exceeds the operation budget", () => {
    const document = run([point(0, "left"), point(1, "right")]);
    expect(() =>
      reasonTemporalQueryV0Alpha3(
        document,
        query({
          type: "point.relations",
          id: "bounded-work",
          recordedThrough: 1,
          leftPointId: "left",
          rightPointId: "right",
        }),
        { maxOperations: 1 },
      ),
    ).toThrowError(/operation limit/);
  });
});

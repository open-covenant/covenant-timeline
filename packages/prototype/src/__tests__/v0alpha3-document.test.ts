import { describe, expect, it } from "vitest";
import {
  parseContractV0Alpha3,
  parseEventV0Alpha3,
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  validateContractV0Alpha3,
  validateEventV0Alpha3,
  validateQueryV0Alpha3,
  validateRunDocumentV0Alpha3,
} from "../v0alpha3/document.js";
import type {
  TemporalEventV0Alpha3,
  TemporalQueryV0Alpha3,
  TimelineContractV0Alpha3,
  TimelineRunDocumentV0Alpha3,
} from "../v0alpha3/types.js";

const EVIDENCE_A = `sha256:${"a".repeat(64)}` as const;
const EVIDENCE_B = `sha256:${"b".repeat(64)}` as const;

const contract: TimelineContractV0Alpha3 = {
  schema: "covenant.timeline.contract.v0alpha3",
  id: "release-temporal.v1",
  subject: { kind: "repository", id: "example/service" },
  axes: [
    {
      id: "elapsed",
      kind: "metric",
      unit: "millisecond",
      origin: "run-start",
    },
    {
      id: "release-order",
      kind: "ordinal",
      unit: "position",
      origin: "first-release",
    },
  ],
  contexts: [
    { id: "actual", mode: "actual" },
    { id: "forecast", mode: "forecast" },
  ],
};

const events: TemporalEventV0Alpha3[] = [
  {
    schema: "covenant.timeline.event.v0alpha3",
    id: "event-0",
    sequence: 0,
    type: "point.declared",
    point: {
      id: "build-start",
      contextId: "actual",
      axisId: "elapsed",
    },
  },
  {
    schema: "covenant.timeline.event.v0alpha3",
    id: "event-1",
    sequence: 1,
    type: "point.declared",
    point: {
      id: "build-end",
      contextId: "actual",
      axisId: "elapsed",
    },
  },
  {
    schema: "covenant.timeline.event.v0alpha3",
    id: "event-2",
    sequence: 2,
    type: "interval.declared",
    interval: {
      id: "build",
      contextId: "actual",
      startPointId: "build-start",
      endPointId: "build-end",
    },
  },
  {
    schema: "covenant.timeline.event.v0alpha3",
    id: "event-3",
    sequence: 3,
    type: "constraint.asserted",
    assertion: {
      id: "build-duration",
      contextId: "actual",
      constraint: {
        fromPointId: "build-start",
        toPointId: "build-end",
        minimum: 5,
        maximum: 10,
      },
      evidenceRefs: [EVIDENCE_A],
    },
  },
  {
    schema: "covenant.timeline.event.v0alpha3",
    id: "event-4",
    sequence: 4,
    type: "fact.asserted",
    assertion: {
      id: "build-status",
      contextId: "actual",
      propositionRef: "build.succeeded",
      validDuring: "build",
      observedAt: "build-end",
      assertedAt: "build-end",
      evidenceRefs: [EVIDENCE_A],
    },
  },
  {
    schema: "covenant.timeline.event.v0alpha3",
    id: "event-5",
    sequence: 5,
    type: "fact.asserted",
    assertion: {
      id: "build-status-corrected",
      contextId: "actual",
      propositionRef: "build.verified",
      validDuring: "build",
      evidenceRefs: [EVIDENCE_B],
      supersedes: ["build-status"],
    },
  },
  {
    schema: "covenant.timeline.event.v0alpha3",
    id: "event-6",
    sequence: 6,
    type: "assertion.retracted",
    assertionId: "build-duration",
    evidenceRefs: [EVIDENCE_B],
  },
];

const run: TimelineRunDocumentV0Alpha3 = {
  schema: "covenant.timeline.run.v0alpha3",
  contract,
  events,
};

const differenceQuery: TemporalQueryV0Alpha3 = {
  schema: "covenant.timeline.query.v0alpha3",
  id: "build-duration-query",
  type: "difference.bounds",
  contextId: "actual",
  recordedThrough: 6,
  fromPointId: "build-start",
  toPointId: "build-end",
};

describe("v0alpha3 temporal documents", () => {
  it("parses a strict contract, event, run, and query", () => {
    expect(validateContractV0Alpha3(contract)).toEqual([]);
    expect(validateEventV0Alpha3(events[0])).toEqual([]);
    expect(validateRunDocumentV0Alpha3(run)).toEqual([]);
    expect(validateQueryV0Alpha3(differenceQuery, run)).toEqual([]);

    expect(parseContractV0Alpha3(contract)).toBe(contract);
    expect(parseEventV0Alpha3(events[0])).toBe(events[0]);
    expect(parseRunDocumentV0Alpha3(run)).toBe(run);
    expect(parseQueryV0Alpha3(differenceQuery, run)).toBe(differenceQuery);
  });

  it("rejects open shapes and invalid contract declarations", () => {
    const issues = validateContractV0Alpha3({
      ...contract,
      extra: true,
      subject: { ...contract.subject, owner: "someone" },
      axes: [
        { ...contract.axes[0], id: "INVALID", kind: "calendar", extra: true },
        contract.axes[0],
      ],
      contexts: [
        { id: "actual", mode: "now" },
        { id: "actual", mode: "actual" },
      ],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "extra", message: "unknown field" },
        { path: "subject.owner", message: "unknown field" },
        {
          path: "axes[0].id",
          message: "must be a lowercase portable identifier",
        },
        { path: "axes[0].kind", message: "must be metric or ordinal" },
        { path: "axes[0].extra", message: "unknown field" },
        { path: "contexts[0].mode", message: expect.any(String) },
        { path: "contexts[1].id", message: "must be unique" },
      ]),
    );
    expect(
      validateContractV0Alpha3({ ...contract, axes: [], contexts: [] }),
    ).toEqual(
      expect.arrayContaining([
        { path: "axes", message: "must not be empty" },
        { path: "contexts", message: "must not be empty" },
      ]),
    );
  });

  it("requires integer, ordered bounds and evidence-backed constraints", () => {
    const event = {
      schema: "covenant.timeline.event.v0alpha3",
      id: "event-0",
      sequence: 0,
      type: "constraint.asserted",
      assertion: {
        id: "duration",
        contextId: "actual",
        constraint: {
          fromPointId: "start",
          toPointId: "end",
        },
        evidenceRefs: [],
      },
    };
    expect(validateEventV0Alpha3(event)).toEqual(
      expect.arrayContaining([
        {
          path: "assertion.constraint",
          message: "must define at least one of minimum or maximum",
        },
        {
          path: "assertion.evidenceRefs",
          message: "must not be empty",
        },
      ]),
    );

    expect(
      validateEventV0Alpha3({
        ...event,
        assertion: { ...event.assertion, evidenceRefs: ["ci/build-log"] },
      }),
    ).toContainEqual({
      path: "assertion.evidenceRefs[0]",
      message: "must be a lowercase SHA-256 content digest",
    });

    const invalidBounds = structuredClone(event);
    invalidBounds.assertion.constraint = {
      ...invalidBounds.assertion.constraint,
      minimum: 2.5,
      maximum: 1,
    };
    expect(validateEventV0Alpha3(invalidBounds)).toContainEqual({
      path: "assertion.constraint.minimum",
      message: "must be a safe integer",
    });

    const reversed = structuredClone(event);
    reversed.assertion.constraint = {
      ...reversed.assertion.constraint,
      minimum: 2,
      maximum: 1,
    };
    expect(validateEventV0Alpha3(reversed)).toContainEqual({
      path: "assertion.constraint.maximum",
      message: "must be greater than or equal to minimum",
    });

    const coordinateEvent = {
      schema: "covenant.timeline.event.v0alpha3",
      id: "event-coordinate",
      sequence: 0,
      type: "coordinate.asserted",
      assertion: {
        id: "build-start-coordinate",
        contextId: "actual",
        pointId: "build-start",
        coordinate: { minimum: 3, maximum: 2 },
        evidenceRefs: [EVIDENCE_A],
      },
    };
    expect(validateEventV0Alpha3(coordinateEvent)).toContainEqual({
      path: "assertion.coordinate.maximum",
      message: "must be greater than or equal to minimum",
    });

    expect(
      validateEventV0Alpha3({
        ...coordinateEvent,
        assertion: { ...coordinateEvent.assertion, coordinate: {} },
      }),
    ).toContainEqual({
      path: "assertion.coordinate",
      message: "must define at least one of minimum or maximum",
    });
  });

  it("enforces contiguous order, declaration order, context, axis, and IDs", () => {
    const invalidRun = {
      ...run,
      events: [
        { ...events[0], sequence: 1 },
        {
          ...events[1],
          id: "event-0",
          point: {
            ...events[1]!.point,
            id: "build-start",
            contextId: "missing",
            axisId: "missing",
          },
        },
        {
          ...events[2],
          interval: {
            ...events[2]!.interval,
            startPointId: "later",
          },
        },
      ],
    };
    const issues = validateRunDocumentV0Alpha3(invalidRun);

    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "events[0].sequence", message: "must equal 0" },
        {
          path: "events[1].id",
          message: "must be unique within the event namespace",
        },
        {
          path: "events[1].point.id",
          message: "must be unique within the temporal object namespace",
        },
        {
          path: "events[1].point.contextId",
          message: "must reference a declared temporal context",
        },
        {
          path: "events[1].point.axisId",
          message: "must reference a declared temporal axis",
        },
        {
          path: "events[2].interval.startPointId",
          message: "must reference an earlier point",
        },
      ]),
    );
  });

  it("requires interval endpoints and constraints to share context and axis", () => {
    const crossAxisPoint: TemporalEventV0Alpha3 = {
      ...events[1]!,
      point: {
        ...events[1]!.point,
        axisId: "release-order",
      },
    };
    const crossAxis = validateRunDocumentV0Alpha3({
      ...run,
      events: [events[0]!, crossAxisPoint, events[2]!],
    });
    expect(crossAxis).toContainEqual({
      path: "events[2].interval.endPointId",
      message: "must reference a point on the same temporal axis",
    });

    const crossContextPoint: TemporalEventV0Alpha3 = {
      ...events[1]!,
      point: {
        ...events[1]!.point,
        contextId: "forecast",
      },
    };
    const crossContext = validateRunDocumentV0Alpha3({
      ...run,
      events: [events[0]!, crossContextPoint, events[2]!],
    });
    expect(crossContext).toContainEqual({
      path: "events[2].interval.endPointId",
      message: "must reference a point in the same temporal context",
    });
  });

  it("requires fact, supersession, and retraction targets to be earlier", () => {
    const wrongFactRefs: TemporalEventV0Alpha3 = {
      ...events[4]!,
      sequence: 2,
      assertion: {
        ...events[4]!.assertion,
        validDuring: "not-yet",
        observedAt: "not-yet",
        supersedes: ["not-yet"],
      },
    };
    const forwardIssues = validateRunDocumentV0Alpha3({
      ...run,
      events: [events[0]!, events[1]!, wrongFactRefs],
    });
    expect(forwardIssues).toEqual(
      expect.arrayContaining([
        {
          path: "events[2].assertion.validDuring",
          message: "must reference an earlier interval",
        },
        {
          path: "events[2].assertion.observedAt",
          message: "must reference an earlier point",
        },
        {
          path: "events[2].assertion.supersedes[0]",
          message: "must reference an earlier assertion",
        },
      ]),
    );

    const wrongKind: TemporalEventV0Alpha3 = {
      ...events[5]!,
      sequence: 4,
      assertion: {
        ...events[5]!.assertion,
        supersedes: ["build-duration"],
      },
    };
    const wrongKindIssues = validateRunDocumentV0Alpha3({
      ...run,
      events: [events[0]!, events[1]!, events[2]!, events[3]!, wrongKind],
    });
    expect(wrongKindIssues).toContainEqual({
      path: "events[4].assertion.supersedes[0]",
      message: "must reference an earlier fact assertion",
    });

    const wrongContext: TemporalEventV0Alpha3 = {
      ...events[5]!,
      assertion: {
        id: "forecast-correction",
        contextId: "forecast",
        propositionRef: "build.verified",
        evidenceRefs: [EVIDENCE_B],
        supersedes: ["build-status"],
      },
    };
    const wrongContextIssues = validateRunDocumentV0Alpha3({
      ...run,
      events: [...events.slice(0, 5), wrongContext],
    });
    expect(wrongContextIssues).toContainEqual({
      path: "events[5].assertion.supersedes[0]",
      message: "must reference an assertion in the same temporal context",
    });

    const forwardRetraction: TemporalEventV0Alpha3 = {
      ...events[6]!,
      sequence: 0,
    };
    expect(
      validateRunDocumentV0Alpha3({ ...run, events: [forwardRetraction] }),
    ).toContainEqual({
      path: "events[0].assertionId",
      message: "must reference an earlier assertion",
    });
  });

  it("binds coordinate revisions to an earlier assertion for the same point", () => {
    const initial: TemporalEventV0Alpha3 = {
      schema: "covenant.timeline.event.v0alpha3",
      id: "event-coordinate-initial",
      sequence: 2,
      type: "coordinate.asserted",
      assertion: {
        id: "build-start-coordinate",
        contextId: "actual",
        pointId: "build-start",
        coordinate: { minimum: 0, maximum: 0 },
        evidenceRefs: [EVIDENCE_A],
      },
    };
    const correction: TemporalEventV0Alpha3 = {
      schema: "covenant.timeline.event.v0alpha3",
      id: "event-coordinate-correction",
      sequence: 3,
      type: "coordinate.asserted",
      assertion: {
        id: "build-end-coordinate",
        contextId: "actual",
        pointId: "build-end",
        coordinate: { minimum: 5, maximum: 10 },
        evidenceRefs: [EVIDENCE_B],
        supersedes: ["build-start-coordinate"],
      },
    };

    expect(
      validateRunDocumentV0Alpha3({
        ...run,
        events: [events[0]!, events[1]!, initial, correction],
      }),
    ).toContainEqual({
      path: "events[3].assertion.supersedes[0]",
      message: "must reference a coordinate assertion for the same point",
    });

    expect(
      validateRunDocumentV0Alpha3({
        ...run,
        events: [
          events[0]!,
          events[1]!,
          initial,
          {
            ...correction,
            assertion: {
              ...correction.assertion,
              id: "build-start-coordinate-corrected",
              pointId: "build-start",
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("binds query references to an explicit knowledge cut", () => {
    expect(
      validateQueryV0Alpha3({ ...differenceQuery, recordedThrough: 0 }, run),
    ).toContainEqual({
      path: "toPointId",
      message: "must reference a point available at the knowledge cut",
    });
    expect(
      validateQueryV0Alpha3({ ...differenceQuery, recordedThrough: 7 }, run),
    ).toContainEqual({
      path: "recordedThrough",
      message: "must identify a sequence within the run",
    });
    expect(
      validateQueryV0Alpha3(
        {
          schema: "covenant.timeline.query.v0alpha3",
          id: "pre-run-consistency",
          type: "context.consistency",
          contextId: "actual",
          recordedThrough: null,
        },
        run,
      ),
    ).toEqual([]);

    const releaseStart: TemporalEventV0Alpha3 = {
      schema: "covenant.timeline.event.v0alpha3",
      id: "event-7",
      sequence: 7,
      type: "point.declared",
      point: {
        id: "release-start",
        contextId: "actual",
        axisId: "release-order",
      },
    };
    const releaseEnd: TemporalEventV0Alpha3 = {
      ...releaseStart,
      id: "event-8",
      sequence: 8,
      point: {
        ...releaseStart.point,
        id: "release-end",
      },
    };
    const releaseInterval: TemporalEventV0Alpha3 = {
      schema: "covenant.timeline.event.v0alpha3",
      id: "event-9",
      sequence: 9,
      type: "interval.declared",
      interval: {
        id: "release-window",
        contextId: "actual",
        startPointId: "release-start",
        endPointId: "release-end",
      },
    };
    const multiAxisRun: TimelineRunDocumentV0Alpha3 = {
      ...run,
      events: [...events, releaseStart, releaseEnd, releaseInterval],
    };
    expect(
      validateQueryV0Alpha3(
        {
          schema: "covenant.timeline.query.v0alpha3",
          id: "cross-axis-query",
          type: "interval.relations",
          contextId: "actual",
          recordedThrough: 9,
          leftIntervalId: "build",
          rightIntervalId: "release-window",
        },
        multiAxisRun,
      ),
    ).toContainEqual({
      path: "rightIntervalId",
      message: "must reference an interval on the same temporal axis",
    });

    expect(() =>
      parseQueryV0Alpha3({ ...differenceQuery, recordedThrough: 0 }, run),
    ).toThrow(/knowledge cut/);
  });

  it("applies canonicalization and collection resource limits", () => {
    expect(validateRunDocumentV0Alpha3(run, { maxEvents: 1 })).toContainEqual({
      path: "events",
      message: "event count must not exceed 1",
    });
    expect(
      validateEventV0Alpha3({
        schema: "covenant.timeline.event.v0alpha3",
        id: "event-coordinate",
        sequence: 0,
        type: "coordinate.asserted",
        assertion: {
          id: "build-start-coordinate",
          contextId: "actual",
          pointId: "build-start",
          coordinate: { minimum: Number.POSITIVE_INFINITY },
          evidenceRefs: [EVIDENCE_A],
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          path: "assertion.coordinate.minimum",
          message: "must be a safe integer",
        },
        {
          path: "$.assertion.coordinate.minimum",
          message: "number must be finite",
        },
      ]),
    );
    expect(() =>
      parseRunDocumentV0Alpha3({
        ...run,
        events: [{ ...events[0], extra: true }],
      }),
    ).toThrow(/unknown field/);
  });
});

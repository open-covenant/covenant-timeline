import { byteDigest, contentDigest, type JsonValue } from "../identity.js";
import {
  TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1,
  TemporalModelProposalErrorV1,
  compileTemporalModelProposalV1,
  createTemporalModelProposalOutputSchemaV1,
  verifyTemporalModelProposalCandidateV1,
  type TemporalModelProposalHostV1,
  type TemporalModelProposalLimitOptionsV1,
  type TemporalModelProposalV1,
} from "../v0alpha3/model-proposal.js";
import { reasonTemporalQueryV0Alpha3 } from "../v0alpha3/kernel.js";
import type {
  TemporalEventV0Alpha3,
  TimelineContractV0Alpha3,
  TimelineRunDocumentV0Alpha3,
} from "../v0alpha3/types.js";
import { describe, expect, it } from "vitest";

const digest = (value: string): `sha256:${string}` =>
  byteDigest(new TextEncoder().encode(value));

const contract: TimelineContractV0Alpha3 = {
  schema: "covenant.timeline.contract.v0alpha3",
  id: "model-proposal-test",
  subject: { kind: "system", id: "example" },
  axes: [
    { id: "day", kind: "metric", unit: "day", origin: "epoch" },
    {
      id: "revision",
      kind: "ordinal",
      unit: "revision",
      origin: "repository-created",
    },
  ],
  contexts: [
    { id: "actual", mode: "actual" },
    { id: "planned", mode: "planned" },
  ],
};

const event = (
  sequence: number,
  value: Omit<TemporalEventV0Alpha3, "id" | "schema" | "sequence">,
): TemporalEventV0Alpha3 =>
  ({
    schema: "covenant.timeline.event.v0alpha3",
    id: `base-event-${sequence}`,
    sequence,
    ...value,
  }) as TemporalEventV0Alpha3;

const events: readonly TemporalEventV0Alpha3[] = [
  event(0, {
    type: "point.declared",
    point: { id: "start", contextId: "actual", axisId: "day" },
  }),
  event(1, {
    type: "point.declared",
    point: { id: "finish", contextId: "actual", axisId: "day" },
  }),
  event(2, {
    type: "point.declared",
    point: { id: "later", contextId: "actual", axisId: "day" },
  }),
  event(3, {
    type: "point.declared",
    point: { id: "planned-start", contextId: "planned", axisId: "day" },
  }),
  event(4, {
    type: "interval.declared",
    interval: {
      id: "window",
      contextId: "actual",
      startPointId: "start",
      endPointId: "finish",
    },
  }),
  event(5, {
    type: "interval.declared",
    interval: {
      id: "next-window",
      contextId: "actual",
      startPointId: "finish",
      endPointId: "later",
    },
  }),
  event(6, {
    type: "coordinate.asserted",
    assertion: {
      id: "start-old",
      contextId: "actual",
      pointId: "start",
      coordinate: { minimum: 1, maximum: 1 },
      evidenceRefs: [digest("old")],
    },
  }),
  event(7, {
    type: "coordinate.asserted",
    assertion: {
      id: "start-current",
      contextId: "actual",
      pointId: "start",
      coordinate: { minimum: 2, maximum: 2 },
      evidenceRefs: [digest("current")],
      supersedes: ["start-old"],
    },
  }),
  event(8, {
    type: "constraint.asserted",
    assertion: {
      id: "duration-current",
      contextId: "actual",
      constraint: {
        fromPointId: "start",
        toPointId: "finish",
        minimum: 5,
        maximum: 5,
      },
      evidenceRefs: [digest("duration")],
    },
  }),
  event(9, {
    type: "coordinate.asserted",
    assertion: {
      id: "planned-current",
      contextId: "planned",
      pointId: "planned-start",
      coordinate: { minimum: 10, maximum: 10 },
      evidenceRefs: [digest("planned")],
    },
  }),
];

const run: TimelineRunDocumentV0Alpha3 = {
  schema: "covenant.timeline.run.v0alpha3",
  contract,
  events,
};

const evidenceText = "At café, build started on day 3 and finished on day 8.";
const correctionText = "Correction: build started on day 4.";

const host = (): TemporalModelProposalHostV1 => ({
  run,
  expectedRequestId: "request-42",
  evidenceCatalog: [
    { id: "source-main", status: "current", text: evidenceText },
    { id: "source-correction", status: "current", text: correctionText },
    { id: "source-stale", status: "stale", text: "Old arrival was day 7." },
  ],
  referenceCatalog: [
    { type: "context", handle: "context-actual", contextId: "actual" },
    { type: "context", handle: "context-planned", contextId: "planned" },
    { type: "point", handle: "point-start", pointId: "start" },
    { type: "point", handle: "point-start-alias", pointId: "start" },
    {
      type: "point",
      handle: "point-planned",
      pointId: "planned-start",
    },
    {
      type: "difference",
      handle: "duration",
      fromPointId: "start",
      toPointId: "finish",
    },
    {
      type: "difference",
      handle: "cross-context",
      fromPointId: "start",
      toPointId: "planned-start",
    },
    {
      type: "point-relation",
      handle: "start-vs-finish",
      leftPointId: "start",
      rightPointId: "finish",
    },
    {
      type: "interval-relation",
      handle: "window-vs-next",
      leftIntervalId: "window",
      rightIntervalId: "next-window",
    },
  ],
  assertionCatalog: [
    { handle: "old-start", assertionId: "start-old" },
    { handle: "current-start", assertionId: "start-current" },
    { handle: "current-duration", assertionId: "duration-current" },
    { handle: "planned-coordinate", assertionId: "planned-current" },
  ],
  knowledgeCutCatalog: [
    { handle: "before-assertions", recordedThrough: 5 },
    { handle: "latest-base", recordedThrough: 9 },
  ],
});

const schemaHost = (): TemporalModelProposalHostV1 => {
  const value = host();
  return {
    ...value,
    referenceCatalog: value.referenceCatalog.filter(
      ({ handle }) => handle !== "cross-context",
    ),
  };
};

const supports = {
  main: [
    {
      evidenceId: "source-main",
      quote: "build started on day 3 and finished on day 8",
    },
  ],
  correction: [
    {
      evidenceId: "source-correction",
      quote: "build started on day 4",
    },
  ],
} as const;

const proposal = (): TemporalModelProposalV1 => ({
  schema: "covenant.timeline.model-proposal.v1",
  requestId: "request-42",
  changes: [
    {
      type: "coordinate",
      pointHandle: "point-start",
      bounds: { type: "exact", value: 4 },
      supports: supports.correction,
      revision: { type: "supersede", assertionHandle: "current-start" },
    },
    {
      type: "constraint",
      differenceHandle: "duration",
      bounds: { type: "closed-range", minimum: 5, maximum: 6 },
      supports: supports.main,
      revision: { type: "supersede", assertionHandle: "current-duration" },
    },
  ],
  query: {
    type: "difference",
    targetHandle: "duration",
    knowledgeCut: { type: "current" },
  },
});

function rejected(
  operation: () => unknown,
): readonly TemporalModelProposalErrorV1["issues"][number][] {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(TemporalModelProposalErrorV1);
    return (error as TemporalModelProposalErrorV1).issues;
  }
  throw new Error("expected proposal rejection");
}

describe("v0alpha3 model proposal output schema", () => {
  it("projects only request-scoped public handles into a bounded schema", () => {
    const schema = createTemporalModelProposalOutputSchemaV1(schemaHost());
    const properties = jsonObject(schema.properties);
    const changes = jsonObject(properties.changes);
    const definitions = jsonObject(schema.$defs);
    const supports = jsonObject(definitions.supports);
    const support = jsonObject(definitions.support);
    const supportProperties = jsonObject(support.properties);
    const evidenceId = jsonObject(supportProperties.evidenceId);

    expect(properties.requestId).toEqual({
      type: "string",
      enum: ["request-42"],
    });
    expect(changes.maxItems).toBe(
      TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxChanges,
    );
    expect(supports.maxItems).toBe(
      TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxSupportsPerChange,
    );
    expect(evidenceId.enum).toEqual(["source-correction", "source-main"]);
    expect(definitions.safeInteger).toEqual({ type: "integer" });
    expect(jsonObject(supportProperties.quote)).toEqual({ type: "string" });

    const encoded = JSON.stringify(schema);
    for (const exposed of [
      "context-actual",
      "point-start",
      "duration",
      "start-vs-finish",
      "window-vs-next",
      "current-start",
      "current-duration",
      "before-assertions",
    ]) {
      expect(encoded).toContain(`"${exposed}"`);
    }
    for (const hidden of [
      evidenceText,
      correctionText,
      "source-stale",
      "old-start",
      "start-current",
      "duration-current",
      digest(evidenceText),
    ]) {
      expect(encoded).not.toContain(hidden);
    }
    expect(deeplyFrozen(schema)).toBe(true);
  });

  it("is invariant to catalog order and evidence contents", () => {
    const original = schemaHost();
    const reorderedBase = schemaHost();
    const reordered: TemporalModelProposalHostV1 = {
      ...reorderedBase,
      evidenceCatalog: [...reorderedBase.evidenceCatalog]
        .reverse()
        .map((entry) => ({ ...entry, text: `replacement for ${entry.id}` })),
      referenceCatalog: [...reorderedBase.referenceCatalog].reverse(),
      assertionCatalog: [...(reorderedBase.assertionCatalog ?? [])].reverse(),
      knowledgeCutCatalog: [
        ...(reorderedBase.knowledgeCutCatalog ?? []),
      ].reverse(),
    };

    expect(createTemporalModelProposalOutputSchemaV1(reordered)).toEqual(
      createTemporalModelProposalOutputSchemaV1(original),
    );
  });

  it("exposes only target-compatible supersession handles", () => {
    const schema = createTemporalModelProposalOutputSchemaV1(schemaHost());
    const definitions = jsonObject(schema.$defs);
    const change = jsonObject(definitions.change);
    const variants = Array.isArray(change.anyOf)
      ? change.anyOf.map(jsonObject)
      : [change];

    expect(changeVariant(variants, "pointHandle", "point-start-alias")).toEqual(
      {
        targetHandles: ["point-start", "point-start-alias"],
        assertionHandles: ["current-start"],
      },
    );
    expect(changeVariant(variants, "pointHandle", "point-planned")).toEqual({
      targetHandles: ["point-planned"],
      assertionHandles: ["planned-coordinate"],
    });
    expect(changeVariant(variants, "differenceHandle", "duration")).toEqual({
      targetHandles: ["duration"],
      assertionHandles: ["current-duration"],
    });
  });

  it("removes unavailable variants and caps provider grammar expansion", () => {
    const queryOnlyHost: TemporalModelProposalHostV1 = {
      ...host(),
      evidenceCatalog: [
        { id: "source-stale", status: "stale", text: "obsolete" },
      ],
      referenceCatalog: [
        { type: "context", handle: "context-actual", contextId: "actual" },
      ],
      assertionCatalog: [],
      knowledgeCutCatalog: [],
    };
    const queryOnly = createTemporalModelProposalOutputSchemaV1(queryOnlyHost);
    const queryOnlyChanges = jsonObject(
      jsonObject(queryOnly.properties).changes,
    );
    const queryOnlyDefinitions = jsonObject(queryOnly.$defs);

    expect(queryOnlyChanges.maxItems).toBe(0);
    expect(queryOnlyDefinitions).not.toHaveProperty("change");
    expect(queryOnlyDefinitions).not.toHaveProperty("support");
    expect(jsonObject(queryOnlyDefinitions.queryIntent)).not.toHaveProperty(
      "anyOf",
    );

    const capped = createTemporalModelProposalOutputSchemaV1(schemaHost(), {
      maxChanges: 32,
      maxSupportsPerChange: 8,
    });
    expect(jsonObject(jsonObject(capped.properties).changes).maxItems).toBe(8);
    expect(jsonObject(jsonObject(capped.$defs).supports).maxItems).toBe(4);
  });

  it("fails when a request exposes no query or too many enum values", () => {
    expect(
      rejected(() =>
        createTemporalModelProposalOutputSchemaV1({
          ...host(),
          referenceCatalog: [
            { type: "point", handle: "point-start", pointId: "start" },
          ],
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.reference",
      path: "host.referenceCatalog",
      message:
        "must expose at least one context, difference, point-relation, or interval-relation query handle",
    });

    const references = Array.from({ length: 510 }, (_, index) => ({
      type: "context" as const,
      handle: `context-${index.toString().padStart(3, "0")}`,
      contextId: "actual",
    }));
    expect(
      rejected(() =>
        createTemporalModelProposalOutputSchemaV1({
          ...host(),
          referenceCatalog: references,
        }),
      ).some(
        ({ code, path, message }) =>
          code === "model-proposal.limit" &&
          path === "host" &&
          message.includes("must not exceed 512"),
      ),
    ).toBe(true);
  });

  it("enforces provider enum limits on the emitted schema", () => {
    const repeatedDifferences = Array.from({ length: 497 }, (_, index) => ({
      type: "difference" as const,
      handle: `difference-${index.toString().padStart(3, "0")}`,
      fromPointId: "start",
      toPointId: "finish",
    }));
    expect(
      rejected(() =>
        createTemporalModelProposalOutputSchemaV1({
          ...host(),
          referenceCatalog: repeatedDifferences,
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.limit",
      path: "host",
      message: expect.stringContaining(
        `must not exceed ${TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxEnumValues}`,
      ),
    });

    const longContexts = Array.from({ length: 251 }, (_, index) => ({
      type: "context" as const,
      handle: `context-${index.toString().padStart(3, "0")}-${"x".repeat(56)}`,
      contextId: "actual",
    }));
    expect(
      rejected(() =>
        createTemporalModelProposalOutputSchemaV1({
          ...host(),
          referenceCatalog: longContexts,
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.limit",
      path: "host",
      message: expect.stringContaining(
        `must not exceed ${TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxStringEnumCharacters} characters`,
      ),
    });
  });

  it("rejects unresolved and incompatible references before projection", () => {
    for (const referenceCatalog of [
      [
        {
          type: "context" as const,
          handle: "context-missing",
          contextId: "missing",
        },
      ],
      [
        {
          type: "point" as const,
          handle: "point-missing",
          pointId: "missing",
        },
        {
          type: "context" as const,
          handle: "context-actual",
          contextId: "actual",
        },
      ],
      [
        {
          type: "difference" as const,
          handle: "difference-cross-context",
          fromPointId: "start",
          toPointId: "planned-start",
        },
      ],
    ]) {
      expect(
        rejected(() =>
          createTemporalModelProposalOutputSchemaV1({
            ...host(),
            referenceCatalog,
          }),
        ).some(({ code }) => code === "model-proposal.reference"),
      ).toBe(true);
    }
  });

  it("rejects host accessors without executing them", () => {
    let getterCalls = 0;
    const hostile = { ...host() };
    Object.defineProperty(hostile, "evidenceCatalog", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("must not execute");
      },
    });

    expect(
      rejected(() =>
        createTemporalModelProposalOutputSchemaV1(
          hostile as TemporalModelProposalHostV1,
        ),
      ),
    ).toContainEqual({
      code: "model-proposal.invalid",
      path: "host.evidenceCatalog",
      message: "must be a data property",
    });
    expect(getterCalls).toBe(0);

    const nonEnumerable = { ...schemaHost() };
    Object.defineProperty(nonEnumerable, "evidenceCatalog", {
      enumerable: false,
      get() {
        getterCalls += 1;
        throw new Error("must not execute");
      },
    });
    expect(
      rejected(() =>
        createTemporalModelProposalOutputSchemaV1(
          nonEnumerable as TemporalModelProposalHostV1,
        ),
      ),
    ).toContainEqual({
      code: "model-proposal.invalid",
      path: "host.evidenceCatalog",
      message: "must be a data property",
    });
    expect(getterCalls).toBe(0);
  });
});

describe("v0alpha3 model proposal compiler", () => {
  it("lowers grounded changes into deterministic ledger candidates", () => {
    const candidate = compileTemporalModelProposalV1(proposal(), host());

    expect(candidate.schema).toBe(
      "covenant.timeline.model-proposal-candidate.v1",
    );
    expect(candidate.requestId).toBe("request-42");
    expect(candidate.candidateEvents).toHaveLength(2);
    expect(candidate.candidateEvents.map(({ sequence }) => sequence)).toEqual([
      10, 11,
    ]);
    expect(
      candidate.candidateEvents.every(({ id }) =>
        /^event-[0-9a-f]{64}$/.test(id),
      ),
    ).toBe(true);
    expect(
      candidate.candidateEvents
        .filter(
          (
            candidateEvent,
          ): candidateEvent is Extract<
            TemporalEventV0Alpha3,
            { type: "coordinate.asserted" | "constraint.asserted" }
          > =>
            candidateEvent.type === "coordinate.asserted" ||
            candidateEvent.type === "constraint.asserted",
        )
        .every(({ assertion }) =>
          /^(coordinate|constraint)-assertion-[0-9a-f]{64}$/.test(assertion.id),
        ),
    ).toBe(true);

    const coordinate = candidate.candidateEvents.find(
      ({ type }) => type === "coordinate.asserted",
    );
    expect(coordinate).toMatchObject({
      type: "coordinate.asserted",
      assertion: {
        contextId: "actual",
        pointId: "start",
        coordinate: { minimum: 4, maximum: 4 },
        evidenceRefs: [digest(correctionText)],
        supersedes: ["start-current"],
      },
    });
    const constraint = candidate.candidateEvents.find(
      ({ type }) => type === "constraint.asserted",
    );
    expect(constraint).toMatchObject({
      type: "constraint.asserted",
      assertion: {
        contextId: "actual",
        constraint: {
          fromPointId: "start",
          toPointId: "finish",
          minimum: 5,
          maximum: 6,
        },
        evidenceRefs: [digest(evidenceText)],
        supersedes: ["duration-current"],
      },
    });
    expect(candidate.candidateQuery).toMatchObject({
      type: "difference.bounds",
      contextId: "actual",
      recordedThrough: 11,
      fromPointId: "start",
      toPointId: "finish",
    });
    expect(candidate.candidateQuery.id).toMatch(/^query-[0-9a-f]{64}$/);
  });

  it("computes exact evidence digests and UTF-8 byte spans", () => {
    const candidate = compileTemporalModelProposalV1(proposal(), host());
    const receipt = candidate.provenance
      .flatMap(({ supports: sourceSupports }) => sourceSupports)
      .find(({ evidenceId }) => evidenceId === "source-main");

    expect(receipt).toEqual({
      evidenceId: "source-main",
      evidenceRef: digest(evidenceText),
      quoteDigest: digest("build started on day 3 and finished on day 8"),
      utf8StartByte: new TextEncoder().encode("At café, ").byteLength,
      utf8EndByte: new TextEncoder().encode(
        "At café, build started on day 3 and finished on day 8",
      ).byteLength,
    });
    const serialized = JSON.stringify(candidate);
    expect(serialized).not.toContain(evidenceText);
    expect(serialized).not.toContain(
      "build started on day 3 and finished on day 8",
    );
  });

  it("is exactly deterministic on retry and canonicalizes change order", () => {
    const input = proposal();
    const first = compileTemporalModelProposalV1(input, host());
    const retry = compileTemporalModelProposalV1(
      structuredClone(input),
      structuredClone(host()),
    );
    const reordered = compileTemporalModelProposalV1(
      { ...input, changes: [...input.changes].reverse() },
      host(),
    );

    expect(retry).toEqual(first);
    expect(reordered.candidateEvents).toEqual(first.candidateEvents);
    expect(reordered.candidateQuery).toEqual(first.candidateQuery);
    expect(reordered.provenance).toEqual(first.provenance);
    expect(reordered.proposalDigest).not.toBe(first.proposalDigest);
  });

  it("binds every generated identifier to its complete candidate body", () => {
    const input = proposal();
    const candidate = compileTemporalModelProposalV1(input, host());

    for (const candidateEvent of candidate.candidateEvents) {
      const { id: eventId, ...eventBody } = candidateEvent;
      expect(eventId).toBe(
        `event-${contentDigest(eventBody as unknown as JsonValue).slice(7)}`,
      );
      if (
        candidateEvent.type === "coordinate.asserted" ||
        candidateEvent.type === "constraint.asserted"
      ) {
        const { id: assertionId, ...assertionBody } = candidateEvent.assertion;
        const prefix =
          candidateEvent.type === "coordinate.asserted"
            ? "coordinate-assertion"
            : "constraint-assertion";
        expect(assertionId).toBe(
          `${prefix}-${contentDigest(assertionBody as unknown as JsonValue).slice(7)}`,
        );
      }
    }
    const { id: queryId, ...queryBody } = candidate.candidateQuery;
    expect(queryId).toBe(
      `query-${contentDigest(queryBody as unknown as JsonValue).slice(7)}`,
    );
    expect(candidate.proposalDigest).toBe(
      contentDigest(input as unknown as JsonValue),
    );
    expect(candidate.baseRunDigest).toBe(
      contentDigest(run as unknown as JsonValue),
    );
  });

  it("does not mutate inputs and deeply freezes the candidate", () => {
    const input = proposal();
    const inputBefore = structuredClone(input);
    const hostInput = host();
    const runBefore = structuredClone(hostInput.run);
    const candidate = compileTemporalModelProposalV1(input, hostInput);

    expect(input).toEqual(inputBefore);
    expect(hostInput.run).toEqual(runBefore);
    expect(hostInput.run.events).toHaveLength(10);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.candidateEvents)).toBe(true);
    expect(Object.isFrozen(candidate.candidateEvents[0])).toBe(true);
    expect(Object.isFrozen(candidate.provenance[0]?.supports)).toBe(true);
  });

  it("verifies the complete candidate against its proposal and host inputs", () => {
    const input = proposal();
    const compilerHost = host();
    const candidate = compileTemporalModelProposalV1(input, compilerHost);

    expect(
      verifyTemporalModelProposalCandidateV1(
        candidate,
        structuredClone(input),
        structuredClone(compilerHost),
      ),
    ).toBe(true);
    expect(
      verifyTemporalModelProposalCandidateV1(
        { ...candidate, proposalDigest: digest("different proposal") },
        input,
        compilerHost,
      ),
    ).toBe(false);
    expect(
      verifyTemporalModelProposalCandidateV1(
        {
          ...candidate,
          provenance: candidate.provenance.map((entry, index) =>
            index === 0
              ? {
                  ...entry,
                  candidateEventId: candidate.candidateEvents[1]!.id,
                }
              : entry,
          ),
        },
        input,
        compilerHost,
      ),
    ).toBe(false);
    expect(
      verifyTemporalModelProposalCandidateV1(
        { ...candidate, unexpected: "field" },
        input,
        compilerHost,
      ),
    ).toBe(false);
  });

  it.each([
    [
      { type: "exact", value: 7 },
      { minimum: 7, maximum: 7 },
    ],
    [{ type: "lower-bound", minimum: 7 }, { minimum: 7 }],
    [{ type: "upper-bound", maximum: 9 }, { maximum: 9 }],
    [
      { type: "closed-range", minimum: 7, maximum: 9 },
      { minimum: 7, maximum: 9 },
    ],
  ] as const)("lowers %s bounds", (bounds, expected) => {
    const input: TemporalModelProposalV1 = {
      ...proposal(),
      changes: [
        {
          type: "coordinate",
          pointHandle: "point-start",
          bounds,
          supports: supports.correction,
          revision: { type: "keep" },
        },
      ],
      query: {
        type: "consistency",
        targetHandle: "context-actual",
        knowledgeCut: { type: "current" },
      },
    };
    const candidate = compileTemporalModelProposalV1(input, host());
    expect(candidate.candidateEvents[0]).toMatchObject({
      type: "coordinate.asserted",
      assertion: { coordinate: expected },
    });
  });

  it("lowers every query intent with host-owned orientation", () => {
    const cases = [
      {
        query: {
          type: "consistency",
          targetHandle: "context-actual",
          knowledgeCut: { type: "current" },
        },
        expected: { type: "context.consistency" },
      },
      {
        query: {
          type: "difference",
          targetHandle: "duration",
          knowledgeCut: { type: "current" },
        },
        expected: {
          type: "difference.bounds",
          fromPointId: "start",
          toPointId: "finish",
        },
      },
      {
        query: {
          type: "point-relation",
          targetHandle: "start-vs-finish",
          knowledgeCut: { type: "current" },
        },
        expected: {
          type: "point.relations",
          leftPointId: "start",
          rightPointId: "finish",
        },
      },
      {
        query: {
          type: "interval-relation",
          targetHandle: "window-vs-next",
          knowledgeCut: { type: "current" },
        },
        expected: {
          type: "interval.relations",
          leftIntervalId: "window",
          rightIntervalId: "next-window",
        },
      },
    ] as const;

    for (const { query, expected } of cases) {
      const candidate = compileTemporalModelProposalV1(
        { ...proposal(), changes: [], query },
        host(),
      );
      expect(candidate.candidateQuery).toMatchObject({
        ...expected,
        contextId: "actual",
        recordedThrough: 9,
      });
    }
  });

  it("resolves current and historical knowledge cuts", () => {
    const current = compileTemporalModelProposalV1(
      { ...proposal(), changes: [] },
      host(),
    );
    const prior = compileTemporalModelProposalV1(
      {
        ...proposal(),
        changes: [],
        query: {
          type: "difference",
          targetHandle: "duration",
          knowledgeCut: {
            type: "prior",
            cutHandle: "before-assertions",
          },
        },
      },
      host(),
    );

    expect(current.candidateQuery.recordedThrough).toBe(9);
    expect(prior.candidateQuery.recordedThrough).toBe(5);
  });

  it("compiles evidence-backed retractions without admitting them", () => {
    const candidate = compileTemporalModelProposalV1(
      {
        ...proposal(),
        changes: [
          {
            type: "retraction",
            assertionHandle: "current-duration",
            supports: supports.correction,
          },
        ],
        query: {
          type: "consistency",
          targetHandle: "context-actual",
          knowledgeCut: { type: "current" },
        },
      },
      host(),
    );

    expect(candidate.candidateEvents[0]).toMatchObject({
      type: "assertion.retracted",
      assertionId: "duration-current",
      evidenceRefs: [digest(correctionText)],
    });
  });

  it("rejects request correlation mismatches", () => {
    expect(
      rejected(() =>
        compileTemporalModelProposalV1(proposal(), {
          ...host(),
          expectedRequestId: "request-elsewhere",
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.reference",
      path: "requestId",
      message: "must match host.expectedRequestId",
    });
  });

  it("rejects unknown, stale, missing, and ambiguous support evidence", () => {
    const cases = [
      {
        evidenceId: "not-cataloged",
        quote: "anything",
        code: "model-proposal.reference",
      },
      {
        evidenceId: "source-stale",
        quote: "Old arrival was day 7",
        code: "model-proposal.stale",
      },
      {
        evidenceId: "source-main",
        quote: "not in source",
        code: "model-proposal.support",
      },
    ] as const;
    for (const support of cases) {
      const input = proposal();
      const change = input.changes[0]!;
      const { code, ...modelSupport } = support;
      const issues = rejected(() =>
        compileTemporalModelProposalV1(
          {
            ...input,
            changes: [{ ...change, supports: [modelSupport] }],
          },
          host(),
        ),
      );
      expect(issues.some((issueEntry) => issueEntry.code === code)).toBe(true);
    }

    const ambiguousHost = host();
    ambiguousHost.evidenceCatalog = [
      ...ambiguousHost.evidenceCatalog,
      {
        id: "source-repeated",
        status: "current",
        text: "same quote, same quote",
      },
    ];
    const issues = rejected(() =>
      compileTemporalModelProposalV1(
        {
          ...proposal(),
          changes: [
            {
              type: "coordinate",
              pointHandle: "point-start",
              bounds: { type: "exact", value: 4 },
              supports: [
                { evidenceId: "source-repeated", quote: "same quote" },
              ],
              revision: { type: "keep" },
            },
          ],
        },
        ambiguousHost,
      ),
    );
    expect(issues).toContainEqual({
      code: "model-proposal.support",
      path: "changes[0].supports[0].quote",
      message: "must occur exactly once in the referenced evidence text",
    });
  });

  it("rejects stale, incompatible, and cross-context assertion references", () => {
    const stale = proposal();
    stale.changes = [
      {
        type: "coordinate",
        pointHandle: "point-start",
        bounds: { type: "exact", value: 4 },
        supports: supports.correction,
        revision: { type: "supersede", assertionHandle: "old-start" },
      },
    ];
    expect(
      rejected(() => compileTemporalModelProposalV1(stale, host())),
    ).toContainEqual({
      code: "model-proposal.stale",
      path: "changes[0].revision.assertionHandle",
      message: "maps to an assertion that is no longer active",
    });

    const incompatible = structuredClone(stale);
    incompatible.changes[0]!.revision = {
      type: "supersede",
      assertionHandle: "current-duration",
    };
    expect(
      rejected(() => compileTemporalModelProposalV1(incompatible, host())).some(
        ({ code }) => code === "model-proposal.reference",
      ),
    ).toBe(true);

    const crossContext = structuredClone(stale);
    crossContext.changes[0]!.revision = {
      type: "supersede",
      assertionHandle: "planned-coordinate",
    };
    expect(
      rejected(() => compileTemporalModelProposalV1(crossContext, host())),
    ).toContainEqual({
      code: "model-proposal.reference",
      path: "changes[0].revision.assertionHandle",
      message: "maps to an assertion in another temporal context",
    });
  });

  it("rejects cross-context ledger and query references through v0alpha3 parsing", () => {
    const input = proposal();
    input.changes = [
      {
        type: "constraint",
        differenceHandle: "cross-context",
        bounds: { type: "exact", value: 1 },
        supports: supports.main,
        revision: { type: "keep" },
      },
    ];
    input.query = {
      type: "consistency",
      targetHandle: "context-actual",
      knowledgeCut: { type: "current" },
    };

    expect(
      rejected(() => compileTemporalModelProposalV1(input, host())).some(
        ({ code, path }) =>
          code === "model-proposal.candidate" &&
          path.includes("candidateRun.events[10]"),
      ),
    ).toBe(true);

    const queryOnly = proposal();
    queryOnly.changes = [];
    queryOnly.query = {
      type: "difference",
      targetHandle: "cross-context",
      knowledgeCut: { type: "current" },
    };
    expect(
      rejected(() => compileTemporalModelProposalV1(queryOnly, host())).some(
        ({ code, path }) =>
          code === "model-proposal.candidate" &&
          path.includes("candidateQuery"),
      ),
    ).toBe(true);
  });

  it("rejects semantic duplicates and same-batch supersession/retraction", () => {
    const duplicate = proposal();
    duplicate.changes = [
      {
        type: "coordinate",
        pointHandle: "point-start",
        bounds: { type: "exact", value: 5 },
        supports: supports.correction,
        revision: { type: "keep" },
      },
      {
        type: "coordinate",
        pointHandle: "point-start-alias",
        bounds: { type: "exact", value: 5 },
        supports: supports.correction,
        revision: { type: "keep" },
      },
    ];
    expect(
      rejected(() => compileTemporalModelProposalV1(duplicate, host())).some(
        ({ code }) => code === "model-proposal.duplicate",
      ),
    ).toBe(true);

    const conflicted = proposal();
    conflicted.changes = [
      conflicted.changes[0]!,
      {
        type: "retraction",
        assertionHandle: "current-start",
        supports: supports.correction,
      },
    ];
    expect(
      rejected(() => compileTemporalModelProposalV1(conflicted, host())),
    ).toContainEqual({
      code: "model-proposal.duplicate",
      path: "changes[1]",
      message: "targets the same assertion as changes[0]",
    });
  });

  it("preserves independent conflicting claims for consistency reasoning", () => {
    const input: TemporalModelProposalV1 = {
      ...proposal(),
      changes: [
        {
          type: "coordinate",
          pointHandle: "point-start",
          bounds: { type: "exact", value: 4 },
          supports: supports.correction,
          revision: { type: "keep" },
        },
        {
          type: "coordinate",
          pointHandle: "point-start-alias",
          bounds: { type: "exact", value: 5 },
          supports: supports.main,
          revision: { type: "keep" },
        },
      ],
      query: {
        type: "consistency",
        targetHandle: "context-actual",
        knowledgeCut: { type: "current" },
      },
    };
    const candidate = compileTemporalModelProposalV1(input, host());
    const candidateRun: TimelineRunDocumentV0Alpha3 = {
      ...run,
      events: [...run.events, ...candidate.candidateEvents],
    };

    expect(candidate.candidateEvents).toHaveLength(2);
    expect(
      reasonTemporalQueryV0Alpha3(candidateRun, candidate.candidateQuery)
        .result,
    ).toEqual({
      type: "context.consistency",
      status: "inconsistent",
    });
  });

  it("derives contexts per change so one proposal can span actual and planned records", () => {
    const candidate = compileTemporalModelProposalV1(
      {
        ...proposal(),
        changes: [
          {
            type: "coordinate",
            pointHandle: "point-start",
            bounds: { type: "exact", value: 4 },
            supports: supports.correction,
            revision: { type: "keep" },
          },
          {
            type: "coordinate",
            pointHandle: "point-planned",
            bounds: { type: "exact", value: 12 },
            supports: supports.main,
            revision: { type: "keep" },
          },
        ],
        query: {
          type: "consistency",
          targetHandle: "context-planned",
          knowledgeCut: { type: "current" },
        },
      },
      host(),
    );

    const contexts = candidate.candidateEvents
      .filter(({ type }) => type === "coordinate.asserted")
      .map((candidateEvent) =>
        candidateEvent.type === "coordinate.asserted"
          ? candidateEvent.assertion.contextId
          : "",
      )
      .sort();
    expect(contexts).toEqual(["actual", "planned"]);
    expect(candidate.candidateQuery).toMatchObject({
      type: "context.consistency",
      contextId: "planned",
      recordedThrough: 11,
    });
  });

  it("rejects malformed bounds, open shapes, and duplicate supports", () => {
    const input = proposal() as unknown as {
      schema: string;
      requestId: string;
      changes: unknown[];
      query: unknown;
      unexpected?: boolean;
    };
    input.unexpected = true;
    input.changes = [
      {
        type: "coordinate",
        pointHandle: "point-start",
        bounds: { type: "closed-range", minimum: 8, maximum: 3 },
        supports: [supports.correction[0], supports.correction[0]],
        revision: { type: "keep", assertionHandle: "invalid-extra" },
      },
    ];

    const issues = rejected(() =>
      compileTemporalModelProposalV1(input, host()),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        {
          code: "model-proposal.invalid",
          path: "unexpected",
          message: "unknown field",
        },
        {
          code: "model-proposal.invalid",
          path: "changes[0].bounds.maximum",
          message: "must be greater than or equal to minimum",
        },
        {
          code: "model-proposal.duplicate",
          path: "changes[0].supports[1]",
          message: "duplicates an earlier support",
        },
        {
          code: "model-proposal.invalid",
          path: "changes[0].revision.assertionHandle",
          message: "unknown field",
        },
      ]),
    );
  });

  it("enforces explicit proposal and catalog limits", () => {
    expect(
      rejected(() =>
        compileTemporalModelProposalV1(proposal(), host(), {
          maxChanges: 1,
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.limit",
      path: "changes",
      message: "must contain at most 1 entries",
    });

    expect(
      rejected(() =>
        compileTemporalModelProposalV1(proposal(), host(), {
          maxEvidenceCatalogEntries: 1,
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.limit",
      path: "host.evidenceCatalog",
      message: "must contain at most 1 entries",
    });

    expect(
      rejected(() =>
        compileTemporalModelProposalV1(proposal(), host(), {
          maxQuoteBytes: 0,
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.limit",
      path: "options.maxQuoteBytes",
      message: "must be a positive safe integer",
    });

    expect(
      rejected(() =>
        compileTemporalModelProposalV1(proposal(), host(), {
          maxChanges: 33,
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.limit",
      path: "options.maxChanges",
      message: "must not exceed the protocol maximum of 32",
    });

    expect(
      rejected(() =>
        compileTemporalModelProposalV1(proposal(), host(), {
          maxSupportsPerChange: 9,
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.limit",
      path: "options.maxSupportsPerChange",
      message: "must not exceed the protocol maximum of 8",
    });

    expect(
      rejected(() =>
        compileTemporalModelProposalV1(proposal(), host(), {
          maxChagnes: 1,
        } as unknown as TemporalModelProposalLimitOptionsV1),
      ),
    ).toContainEqual({
      code: "model-proposal.invalid",
      path: "options.maxChagnes",
      message: "unknown field",
    });
  });

  it("rejects evidence that exceeds per-entry or aggregate byte limits", () => {
    const oversizedHost: TemporalModelProposalHostV1 = {
      ...host(),
      evidenceCatalog: [
        { id: "oversized", status: "current", text: "x".repeat(65_537) },
      ],
    };
    expect(
      rejected(() => compileTemporalModelProposalV1(proposal(), oversizedHost)),
    ).toContainEqual({
      code: "model-proposal.limit",
      path: "host.evidenceCatalog[0].text",
      message: "must not exceed 65536 UTF-8 bytes",
    });

    const aggregateHost: TemporalModelProposalHostV1 = {
      ...host(),
      evidenceCatalog: [
        { id: "first", status: "current", text: "1234" },
        { id: "second", status: "current", text: "5678" },
      ],
    };
    expect(
      rejected(() =>
        compileTemporalModelProposalV1(proposal(), aggregateHost, {
          maxEvidenceBytes: 4,
          maxTotalEvidenceBytes: 6,
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.limit",
      path: "host.evidenceCatalog",
      message: "text must not exceed 6 UTF-8 bytes in total",
    });
  });

  it("bounds hostile proposal errors before detailed validation", () => {
    const hostile = {
      ...proposal(),
      ...Object.fromEntries(
        Array.from({ length: 1_000 }, (_, index) => [
          `unknown-${index}`,
          index,
        ]),
      ),
      "line\nbreak": true,
    };

    try {
      compileTemporalModelProposalV1(hostile, host());
      throw new Error("expected proposal rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(TemporalModelProposalErrorV1);
      const rejection = error as TemporalModelProposalErrorV1;
      expect(rejection.issues.length).toBeLessThanOrEqual(64);
      expect(rejection.message).not.toContain("\n");
      expect(Object.isFrozen(rejection.issues)).toBe(true);
      expect(Object.isFrozen(rejection.issues[0])).toBe(true);
    }

    expect(
      rejected(() =>
        compileTemporalModelProposalV1(
          { ...proposal(), oversized: "x".repeat(1_310_721) },
          host(),
        ),
      ),
    ).toContainEqual({
      code: "model-proposal.limit",
      path: "$",
      message: "must not exceed 1310720 encoded JSON bytes",
    });
  });

  it("does not execute array accessors during JSON preflight", () => {
    let getterCalls = 0;
    const changes: unknown[] = [];
    Object.defineProperty(changes, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("must not execute");
      },
    });

    expect(
      rejected(() =>
        compileTemporalModelProposalV1(
          {
            ...proposal(),
            changes,
          },
          host(),
        ),
      ),
    ).toContainEqual({
      code: "model-proposal.invalid",
      path: "changes[0]",
      message: "must be a data property",
    });
    expect(getterCalls).toBe(0);
  });

  it("bounds malformed base-run diagnostics", () => {
    const invalidHost: TemporalModelProposalHostV1 = {
      ...host(),
      run: {
        ...run,
        events: Array.from({ length: 5_000 }, () => ({})),
      } as unknown as TimelineRunDocumentV0Alpha3,
    };
    const issues = rejected(() =>
      compileTemporalModelProposalV1(proposal(), invalidHost),
    );

    expect(issues).toHaveLength(64);
    expect(
      issues.some(({ path, message }) => {
        return (
          path === "host.run" &&
          message.startsWith("validation omitted ") &&
          message.endsWith(" additional issues")
        );
      }),
    ).toBe(true);
  });

  it("rejects malformed host and option values with domain errors", () => {
    expect(
      rejected(() =>
        compileTemporalModelProposalV1(
          proposal(),
          null as unknown as TemporalModelProposalHostV1,
        ),
      ),
    ).toContainEqual({
      code: "model-proposal.invalid",
      path: "host",
      message: "must be a plain object",
    });

    expect(
      rejected(() =>
        compileTemporalModelProposalV1(proposal(), {
          ...host(),
          expectedRequestId: Symbol(
            "invalid",
          ) as unknown as TemporalModelProposalHostV1["expectedRequestId"],
        }),
      ),
    ).toContainEqual({
      code: "model-proposal.invalid",
      path: "host.expectedRequestId",
      message: "must be a lowercase portable identifier",
    });

    expect(
      rejected(() =>
        compileTemporalModelProposalV1(
          proposal(),
          host(),
          null as unknown as TemporalModelProposalLimitOptionsV1,
        ),
      ),
    ).toContainEqual({
      code: "model-proposal.invalid",
      path: "options",
      message: "must be a plain object",
    });
  });

  it("rejects a prior intent that resolves to the current candidate cut", () => {
    const input = proposal();
    input.changes = [];
    input.query = {
      type: "consistency",
      targetHandle: "context-actual",
      knowledgeCut: { type: "prior", cutHandle: "latest-base" },
    };
    expect(
      rejected(() => compileTemporalModelProposalV1(input, host())),
    ).toContainEqual({
      code: "model-proposal.reference",
      path: "query.knowledgeCut.cutHandle",
      message: "must resolve to a cut earlier than the current candidate cut",
    });
  });
});

function jsonObject(value: JsonValue): Readonly<Record<string, JsonValue>> {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  expect(Array.isArray(value)).toBe(false);
  return value as Readonly<Record<string, JsonValue>>;
}

function changeVariant(
  variants: readonly Readonly<Record<string, JsonValue>>[],
  targetKey: "differenceHandle" | "pointHandle",
  targetHandle: string,
): {
  readonly assertionHandles: readonly JsonValue[];
  readonly targetHandles: readonly JsonValue[];
} {
  for (const variant of variants) {
    const properties = jsonObject(variant.properties);
    if (!Object.hasOwn(properties, targetKey)) continue;
    const targetHandles = jsonObject(properties[targetKey]).enum;
    if (
      !Array.isArray(targetHandles) ||
      !targetHandles.includes(targetHandle)
    ) {
      continue;
    }
    const revision = jsonObject(properties.revision);
    const revisionVariants = Array.isArray(revision.anyOf)
      ? revision.anyOf.map(jsonObject)
      : [revision];
    const supersede = revisionVariants.find((entry) => {
      const revisionProperties = jsonObject(entry.properties);
      return (
        jsonObject(revisionProperties.type).enum as readonly JsonValue[]
      ).includes("supersede");
    });
    const assertionHandles = supersede
      ? jsonObject(jsonObject(supersede.properties).assertionHandle).enum
      : [];
    expect(Array.isArray(assertionHandles)).toBe(true);
    return { assertionHandles, targetHandles };
  }
  throw new Error(`missing change variant for ${targetHandle}`);
}

function deeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(deeplyFrozen);
}

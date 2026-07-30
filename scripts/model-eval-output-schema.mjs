const RESPONSE_SCHEMA = "covenant.timeline.model-eval.response.v1";
const EVENT_SCHEMA = "covenant.timeline.event.v0alpha3";
const QUERY_SCHEMA = "covenant.timeline.query.v0alpha3";
const SAFE_INTEGER = 9_007_199_254_740_991;
const IDENTIFIER_PATTERN = "^[a-z0-9][a-z0-9._:/-]*$";
const DIGEST_PATTERN = "^sha256:[0-9a-f]{64}$";
const MAX_IDENTIFIER_LENGTH = 128;
export const MAX_MODEL_REQUEST_ID_LENGTH = 128;
export const MAX_NARRATIVE_MEMORY_CHARACTERS = 4096;
export const MAX_TIMELINE_EVENTS_PER_RESPONSE = 8;
export const MAX_TIMELINE_REFERENCES_PER_EVENT = 8;

const pointRelations = ["before", "equal", "after"];
const intervalRelations = [
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

function object(properties) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function literal(value) {
  return {
    type: "string",
    enum: [value],
  };
}

function reference(name) {
  return {
    $ref: `#/$defs/${name}`,
  };
}

function nullable(schema) {
  return {
    anyOf: [schema, { type: "null" }],
  };
}

function variantsWithSupersedes(properties) {
  return {
    anyOf: [
      object(properties),
      object({
        ...properties,
        supersedes: reference("nonEmptyIdentifiers"),
      }),
    ],
  };
}

function semanticDefinitions() {
  const relationResult = (type, relations, maximum) => ({
    anyOf: [
      object({
        type: literal(type),
        status: literal("inconsistent"),
        possible: {
          type: "array",
          items: { type: "string", enum: relations },
          maxItems: 0,
        },
      }),
      object({
        type: literal(type),
        status: literal("resolved"),
        possible: {
          type: "array",
          items: { type: "string", enum: relations },
          minItems: 1,
          maxItems: 1,
        },
      }),
      object({
        type: literal(type),
        status: literal("indeterminate"),
        possible: {
          type: "array",
          items: { type: "string", enum: relations },
          minItems: 2,
          maxItems: maximum,
        },
      }),
    ],
  });

  return {
    safeInteger: {
      type: "integer",
      minimum: -SAFE_INTEGER,
      maximum: SAFE_INTEGER,
    },
    consistencyResult: {
      anyOf: [
        object({
          type: literal("context.consistency"),
          status: literal("consistent"),
        }),
        object({
          type: literal("context.consistency"),
          status: literal("inconsistent"),
        }),
      ],
    },
    differenceBoundsResult: {
      anyOf: [
        object({
          type: literal("difference.bounds"),
          status: literal("bounded"),
          minimum: reference("safeInteger"),
          maximum: reference("safeInteger"),
        }),
        object({
          type: literal("difference.bounds"),
          status: literal("partially-bounded"),
          minimum: reference("safeInteger"),
          maximum: { type: "null" },
        }),
        object({
          type: literal("difference.bounds"),
          status: literal("partially-bounded"),
          minimum: { type: "null" },
          maximum: reference("safeInteger"),
        }),
        object({
          type: literal("difference.bounds"),
          status: literal("unbounded"),
          minimum: { type: "null" },
          maximum: { type: "null" },
        }),
        object({
          type: literal("difference.bounds"),
          status: literal("inconsistent"),
          minimum: { type: "null" },
          maximum: { type: "null" },
        }),
      ],
    },
    pointRelationsResult: relationResult(
      "point.relations",
      pointRelations,
      pointRelations.length,
    ),
    intervalRelationsResult: relationResult(
      "interval.relations",
      intervalRelations,
      intervalRelations.length,
    ),
    semanticResult: {
      anyOf: [
        reference("consistencyResult"),
        reference("differenceBoundsResult"),
        reference("pointRelationsResult"),
        reference("intervalRelationsResult"),
      ],
    },
  };
}

function timelineDefinitions() {
  const identifier = {
    type: "string",
    maxLength: MAX_IDENTIFIER_LENGTH,
    pattern: IDENTIFIER_PATTERN,
  };
  const safeInteger = {
    type: "integer",
    minimum: -SAFE_INTEGER,
    maximum: SAFE_INTEGER,
  };
  const sequence = {
    type: "integer",
    minimum: 0,
    maximum: SAFE_INTEGER,
  };
  const evidenceRefs = {
    type: "array",
    items: {
      type: "string",
      pattern: DIGEST_PATTERN,
    },
    minItems: 1,
    maxItems: MAX_TIMELINE_REFERENCES_PER_EVENT,
  };
  const nonEmptyIdentifiers = {
    type: "array",
    items: identifier,
    minItems: 1,
    maxItems: MAX_TIMELINE_REFERENCES_PER_EVENT,
  };

  const coordinate = {
    anyOf: [
      object({
        minimum: reference("safeInteger"),
      }),
      object({
        maximum: reference("safeInteger"),
      }),
      object({
        minimum: reference("safeInteger"),
        maximum: reference("safeInteger"),
      }),
    ],
  };
  const differenceConstraint = {
    anyOf: [
      object({
        fromPointId: reference("identifier"),
        toPointId: reference("identifier"),
        minimum: reference("safeInteger"),
      }),
      object({
        fromPointId: reference("identifier"),
        toPointId: reference("identifier"),
        maximum: reference("safeInteger"),
      }),
      object({
        fromPointId: reference("identifier"),
        toPointId: reference("identifier"),
        minimum: reference("safeInteger"),
        maximum: reference("safeInteger"),
      }),
    ],
  };
  const coordinateAssertion = variantsWithSupersedes({
    id: reference("identifier"),
    contextId: reference("identifier"),
    pointId: reference("identifier"),
    coordinate: reference("coordinate"),
    evidenceRefs: reference("evidenceRefs"),
  });
  const constraintAssertion = variantsWithSupersedes({
    id: reference("identifier"),
    contextId: reference("identifier"),
    constraint: reference("differenceConstraint"),
    evidenceRefs: reference("evidenceRefs"),
  });
  const coordinateEvent = object({
    schema: literal(EVENT_SCHEMA),
    id: reference("identifier"),
    sequence: reference("sequence"),
    type: literal("coordinate.asserted"),
    assertion: reference("coordinateAssertion"),
  });
  const constraintEvent = object({
    schema: literal(EVENT_SCHEMA),
    id: reference("identifier"),
    sequence: reference("sequence"),
    type: literal("constraint.asserted"),
    assertion: reference("constraintAssertion"),
  });
  const retractionEvent = object({
    schema: literal(EVENT_SCHEMA),
    id: reference("identifier"),
    sequence: reference("sequence"),
    type: literal("assertion.retracted"),
    assertionId: reference("identifier"),
    evidenceRefs: reference("evidenceRefs"),
  });
  const recordedThrough = nullable(sequence);
  const queryBase = {
    schema: literal(QUERY_SCHEMA),
    id: reference("identifier"),
    contextId: reference("identifier"),
    recordedThrough: reference("recordedThrough"),
  };

  return {
    identifier,
    safeInteger,
    sequence,
    evidenceRefs,
    nonEmptyIdentifiers,
    coordinate,
    differenceConstraint,
    coordinateAssertion,
    constraintAssertion,
    event: {
      anyOf: [coordinateEvent, constraintEvent, retractionEvent],
    },
    recordedThrough,
    query: {
      anyOf: [
        object({
          ...queryBase,
          type: literal("context.consistency"),
        }),
        object({
          ...queryBase,
          type: literal("difference.bounds"),
          fromPointId: reference("identifier"),
          toPointId: reference("identifier"),
        }),
        object({
          ...queryBase,
          type: literal("point.relations"),
          leftPointId: reference("identifier"),
          rightPointId: reference("identifier"),
        }),
        object({
          ...queryBase,
          type: literal("interval.relations"),
          leftIntervalId: reference("identifier"),
          rightIntervalId: reference("identifier"),
        }),
      ],
    },
  };
}

export function createModelEvalOutputSchema(arm) {
  const common = {
    schema: literal(RESPONSE_SCHEMA),
    requestId: {
      type: "string",
      minLength: 1,
      maxLength: MAX_MODEL_REQUEST_ID_LENGTH,
    },
  };
  let schema;

  if (arm === "direct") {
    schema = {
      ...object({
        ...common,
        answer: reference("semanticResult"),
      }),
      $defs: semanticDefinitions(),
    };
  } else if (arm === "narrative-memory") {
    schema = {
      ...object({
        ...common,
        answer: reference("semanticResult"),
        memory: {
          type: "string",
          maxLength: MAX_NARRATIVE_MEMORY_CHARACTERS,
        },
      }),
      $defs: semanticDefinitions(),
    };
  } else if (arm === "timeline") {
    schema = {
      ...object({
        ...common,
        events: {
          type: "array",
          items: reference("event"),
          maxItems: MAX_TIMELINE_EVENTS_PER_RESPONSE,
        },
        query: reference("query"),
      }),
      $defs: timelineDefinitions(),
    };
  } else {
    throw new Error(`unsupported benchmark arm ${JSON.stringify(arm)}`);
  }

  return schema;
}

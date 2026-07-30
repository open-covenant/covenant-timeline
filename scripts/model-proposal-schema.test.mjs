import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1,
  compileTemporalModelProposalV1,
  createTemporalModelProposalOutputSchemaV1,
} from "../packages/prototype/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const proposalSchemaId =
  "https://covenant-timeline.org/schemas/model-proposal/v1/proposal.schema.json";
const candidateSchemaId =
  "https://covenant-timeline.org/schemas/model-proposal/v1/candidate.schema.json";

const [
  commonSchema,
  querySchema,
  proposalSchema,
  candidateSchema,
  run,
  documentation,
] = await Promise.all([
  readJson("schemas/v0alpha3/common.schema.json"),
  readJson("schemas/v0alpha3/query.schema.json"),
  readJson("schemas/model-proposal/v1/proposal.schema.json"),
  readJson("schemas/model-proposal/v1/candidate.schema.json"),
  readJson("conformance/v0alpha3/runs/software-release.json"),
  readFile(join(root, "docs/model-proposal.md"), "utf8"),
]);

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const schema of [
  commonSchema,
  querySchema,
  proposalSchema,
  candidateSchema,
]) {
  ajv.addSchema(schema);
}

const validateProposal = requireValidator(proposalSchemaId);
const validateCandidate = requireValidator(candidateSchemaId);
const requestId = "release-correction-17";
const quote =
  "Deployment began 5,400 seconds after the security review finished.";
const proposal = {
  schema: "covenant.timeline.model-proposal.v1",
  requestId,
  changes: [
    {
      type: "constraint",
      differenceHandle: "review-to-deploy",
      bounds: { type: "exact", value: 5_400 },
      supports: [{ evidenceId: "correction-log", quote }],
      revision: {
        type: "supersede",
        assertionHandle: "current-review-to-deploy",
      },
    },
  ],
  query: {
    type: "difference",
    targetHandle: "review-to-deploy",
    knowledgeCut: { type: "current" },
  },
};
const proposalHost = {
  run,
  expectedRequestId: requestId,
  evidenceCatalog: [
    {
      id: "correction-log",
      status: "current",
      text: `Correction received Thursday. ${quote}`,
    },
    {
      id: "obsolete-log",
      status: "stale",
      text: "Deployment delay was 3,600 seconds.",
    },
  ],
  referenceCatalog: [
    {
      type: "difference",
      handle: "review-to-deploy",
      fromPointId: "review-start",
      toPointId: "deploy-start",
    },
  ],
  assertionCatalog: [
    {
      handle: "current-review-to-deploy",
      assertionId: "constraint.deploy-delay.v2",
    },
  ],
};
const documentedProposal = readMarkedJson(
  documentation,
  "model-proposal-input",
);
const documentedCandidate = readMarkedJson(
  documentation,
  "model-proposal-candidate",
);

test("proposal schema is closed and covers the public variants", () => {
  assertStructuredOutputObjectsAreClosed(proposalSchema);
  assert.equal(JSON.stringify(proposalSchema).includes('"oneOf"'), false);
  assert.equal(JSON.stringify(proposalSchema).includes('"const"'), false);
  assertValid(validateProposal, proposal);
  assert.deepEqual(documentedProposal, proposal);

  const variants = [
    {
      ...proposal,
      changes: [
        {
          type: "coordinate",
          pointHandle: "deploy",
          bounds: { type: "lower-bound", minimum: 100 },
          supports: [{ evidenceId: "log", quote: "at least 100" }],
          revision: { type: "keep" },
        },
      ],
      query: {
        type: "consistency",
        targetHandle: "actual-context",
        knowledgeCut: { type: "current" },
      },
    },
    {
      ...proposal,
      changes: [
        {
          type: "constraint",
          differenceHandle: "review-to-deploy",
          bounds: { type: "upper-bound", maximum: 200 },
          supports: [{ evidenceId: "log", quote: "no more than 200" }],
          revision: { type: "keep" },
        },
      ],
      query: {
        type: "point-relation",
        targetHandle: "review-vs-deploy",
        knowledgeCut: { type: "prior", cutHandle: "before-correction" },
      },
    },
    {
      ...proposal,
      changes: [
        {
          type: "retraction",
          assertionHandle: "obsolete",
          supports: [{ evidenceId: "log", quote: "entry withdrawn" }],
        },
      ],
      query: {
        type: "interval-relation",
        targetHandle: "review-vs-deploy-window",
        knowledgeCut: { type: "current" },
      },
    },
    {
      ...proposal,
      changes: [
        {
          type: "coordinate",
          pointHandle: "deploy",
          bounds: {
            type: "closed-range",
            minimum: 100,
            maximum: 200,
          },
          supports: [{ evidenceId: "log", quote: "between 100 and 200" }],
          revision: { type: "keep" },
        },
      ],
    },
  ];

  for (const variant of variants) assertValid(validateProposal, variant);
});

test("proposal schema rejects unknown fields, missing fields, and excess input", () => {
  const extraRoot = { ...proposal, unexpected: true };
  assertInvalid(validateProposal, extraRoot);

  const extraChange = structuredClone(proposal);
  extraChange.changes[0].unexpected = true;
  assertInvalid(validateProposal, extraChange);

  const missingRevision = structuredClone(proposal);
  delete missingRevision.changes[0].revision;
  assertInvalid(validateProposal, missingRevision);

  const excessChanges = structuredClone(proposal);
  excessChanges.changes = Array.from({ length: 33 }, () =>
    structuredClone(proposal.changes[0]),
  );
  assertInvalid(validateProposal, excessChanges);

  const excessSupports = structuredClone(proposal);
  excessSupports.changes[0].supports = Array.from(
    { length: 9 },
    (_, index) => ({
      evidenceId: `source-${index}`,
      quote: `quote ${index}`,
    }),
  );
  assertInvalid(validateProposal, excessSupports);
});

test("compiler output conforms to the candidate schema", () => {
  const candidate = compileTemporalModelProposalV1(proposal, proposalHost);

  assertValid(validateCandidate, candidate);
  assert.deepEqual(documentedCandidate, candidate);
  assert.equal(candidate.requestId, requestId);
  assert.equal(candidate.candidateEvents.length, 1);
  assert.equal(candidate.provenance.length, 1);
  assert.equal(candidate.provenance[0].supports[0].quote, undefined);
  assert.match(
    candidate.provenance[0].supports[0].quoteDigest,
    /^sha256:[0-9a-f]{64}$/,
  );

  const extra = { ...candidate, admitted: true };
  assertInvalid(validateCandidate, extra);

  const declaration = structuredClone(candidate);
  declaration.candidateEvents[0] = {
    schema: "covenant.timeline.event.v0alpha3",
    id: "event-model-declaration",
    sequence: run.events.length,
    type: "point.declared",
    point: {
      id: "model-point",
      contextId: "actual",
      axisId: "release-seconds",
    },
  };
  assertInvalid(validateCandidate, declaration);
});

test("request-scoped output schema validates without leaking source data", () => {
  const outputSchema = createTemporalModelProposalOutputSchemaV1(proposalHost);
  const validateOutput = ajv.compile(outputSchema);

  assertStructuredOutputObjectsAreClosed(outputSchema);
  assertProviderSchemaDialect(outputSchema);
  assertProviderEnumLimits(outputSchema);
  assertValid(validateOutput, proposal);
  assertInvalid(validateOutput, {
    ...proposal,
    requestId: "another-request",
  });
  assertInvalid(validateOutput, {
    ...proposal,
    changes: [
      {
        ...proposal.changes[0],
        supports: [{ evidenceId: "obsolete-log", quote }],
      },
    ],
  });

  const encoded = JSON.stringify(outputSchema);
  assert.equal(encoded.includes("Correction received Thursday"), false);
  assert.equal(encoded.includes("3,600 seconds"), false);
  assert.equal(encoded.includes("constraint.deploy-delay.v2"), false);
  assert.equal(encoded.includes('"maxLength"'), false);
  assert.deepEqual(outputSchema.$defs.safeInteger, { type: "integer" });
});

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

function requireValidator(id) {
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error(`schema is not registered: ${id}`);
  return validate;
}

function assertValid(validate, value) {
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}

function assertInvalid(validate, value) {
  assert.equal(validate(value), false);
}

function assertStructuredOutputObjectsAreClosed(schema) {
  visit(schema);

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.type === "object") {
      assert.equal(value.additionalProperties, false);
      assert.deepEqual(
        [...value.required].sort(),
        Object.keys(value.properties).sort(),
      );
    }
    Object.values(value).forEach(visit);
  }
}

function assertProviderEnumLimits(schema) {
  let enumValues = 0;

  visit(schema);
  assert.ok(
    enumValues <= TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxEnumValues,
  );

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.enum)) {
      enumValues += value.enum.length;
      if (
        value.enum.length >
        TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.stringEnumCharacterThreshold
      ) {
        const characters = value.enum.reduce(
          (total, entry) =>
            total + (typeof entry === "string" ? Array.from(entry).length : 0),
          0,
        );
        assert.ok(
          characters <=
            TEMPORAL_MODEL_PROPOSAL_OUTPUT_SCHEMA_CAPS_V1.maxStringEnumCharacters,
        );
      }
    }
    Object.values(value).forEach(visit);
  }
}

function assertProviderSchemaDialect(schema) {
  const keywords = new Set([
    "$defs",
    "$ref",
    "additionalProperties",
    "anyOf",
    "enum",
    "items",
    "maxItems",
    "minItems",
    "properties",
    "required",
    "type",
  ]);
  let propertyCount = 0;
  let stringCharacters = 0;

  assert.equal(schema.type, "object");
  assert.equal(Object.hasOwn(schema, "anyOf"), false);
  visit(schema, "$", 1);
  assert.ok(propertyCount <= 5_000);
  assert.ok(stringCharacters <= 120_000);

  function visit(value, path, depth) {
    assert.ok(depth <= 10, `${path} exceeds provider nesting depth`);
    assert.equal(
      value !== null && typeof value === "object" && !Array.isArray(value),
      true,
      `${path} must be a schema object`,
    );
    for (const key of Object.keys(value)) {
      assert.equal(keywords.has(key), true, `${path} uses ${key}`);
    }
    if (value.type === "object") {
      propertyCount += Object.keys(value.properties).length;
      for (const [name, child] of Object.entries(value.properties)) {
        stringCharacters += Array.from(name).length;
        visit(child, `${path}.properties.${name}`, depth + 1);
      }
    }
    if (value.$defs) {
      for (const [name, child] of Object.entries(value.$defs)) {
        stringCharacters += Array.from(name).length;
        visit(child, `${path}.$defs.${name}`, depth);
      }
    }
    if (value.items) visit(value.items, `${path}.items`, depth + 1);
    if (value.anyOf) {
      value.anyOf.forEach((child, index) =>
        visit(child, `${path}.anyOf[${index}]`, depth),
      );
    }
    if (value.enum) {
      stringCharacters += value.enum.reduce(
        (total, entry) =>
          total + (typeof entry === "string" ? Array.from(entry).length : 0),
        0,
      );
    }
  }
}

function readMarkedJson(markdown, name) {
  const expression = new RegExp(
    `<!-- ${name}:start -->\\s+\`\`\`json\\s+([\\s\\S]*?)\\s+\`\`\`\\s+<!-- ${name}:end -->`,
  );
  const match = markdown.match(expression);
  if (!match) throw new Error(`documentation block is missing: ${name}`);
  return JSON.parse(match[1]);
}

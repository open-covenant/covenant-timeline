import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  byteDigest,
  canonicalJson,
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "../packages/prototype/dist/index.js";
import {
  MAX_TIMELINE_EVENTS_PER_RESPONSE,
  MAX_TIMELINE_REFERENCES_PER_EVENT,
} from "./model-eval-output-schema.mjs";
import { parseStrictJson } from "./strict-json.mjs";

export const ARMS = ["direct", "narrative-memory", "timeline"];
export const BENCHMARK = "model-interface-v1";
export const CASE_SCHEMA = "covenant.timeline.model-eval.case.v1";
export const CONFIG_SCHEMA = "covenant.timeline.model-eval.config.v1";
export const REQUEST_SCHEMA = "covenant.timeline.model-eval.request.v1";
export const RESPONSE_SCHEMA = "covenant.timeline.model-eval.response.v1";
export const ADAPTER_ERROR_SCHEMA =
  "covenant.timeline.model-eval.adapter-error.v1";
export const RESULT_SCHEMA = "covenant.timeline.model-eval.result.v1";
export const DIAGNOSTICS_SCHEMA = "covenant.timeline.model-eval.diagnostics.v1";
export const CONTINUITY_BUDGET_BYTES = 4 * 1024;
export const MAX_REPEATS = 20;
export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_RESULTS_BYTES = 128 * 1024 * 1024;
export const MAX_TIMEOUT_MS = 10 * 60 * 1000;
export const PROMPT_PATHS = {
  direct: "benchmarks/model-interface/v1/prompts/direct.md",
  "narrative-memory":
    "benchmarks/model-interface/v1/prompts/narrative-memory.md",
  timeline: "benchmarks/model-interface/v1/prompts/timeline.md",
};

export const FAMILIES = [
  "bounded-indeterminate",
  "planned-actual-isolation",
  "delayed-observation-historical-cuts",
  "correction-supersession-retraction",
  "contradictions",
  "interval-relations",
];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultCasesPath = join(
  root,
  "benchmarks/model-interface/v1/cases.jsonl",
);
const resultSchemaPath = join(
  root,
  "benchmarks/model-interface/v1/result.schema.json",
);
const scoreSchemaPath = join(
  root,
  "benchmarks/model-interface/v1/score.schema.json",
);
const diagnosticsSchemaPath = join(
  root,
  "benchmarks/model-interface/v1/diagnostics.schema.json",
);
const schemaDirectory = join(root, "schemas/v0alpha3");
const schemaFiles = [
  "common.schema.json",
  "contract.schema.json",
  "event.schema.json",
  "query.schema.json",
  "conclusion.schema.json",
];
const identifierPattern = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const adapterErrorCodePattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const maxConfigBytes = 64 * 1024;
const maxCorpusBytes = 8 * 1024 * 1024;
const credentialKeyPattern =
  /(^|[_-])(?:api[_-]?(?:key|token)|access[_-]?(?:key|token)|auth(?:entication|orization)?(?:[_-]?(?:key|token))?|bearer(?:[_-]?token)?|client[_-]?secret|credentials?|key|password|passwd|private[_-]?key|refresh[_-]?token|secret(?:[_-]?(?:access[_-]?key|key|token))?|session[_-]?token|signing[_-]?key|token)([_-]|$)/;

export class ModelEvalError extends Error {
  constructor(message, { code = "eval.invalid", stage = "protocol" } = {}) {
    super(message);
    this.name = "ModelEvalError";
    this.code = code;
    this.stage = stage;
  }
}

export async function createModelEvalValidators() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });
  addFormats(ajv);

  for (const file of schemaFiles) {
    ajv.addSchema(
      parseStrictJson(
        await readFile(join(schemaDirectory, file), "utf8"),
        file,
      ),
    );
  }
  const resultSchema = parseStrictJson(
    await readFile(resultSchemaPath, "utf8"),
    resultSchemaPath,
  );
  ajv.addSchema(resultSchema);
  const scoreSchema = parseStrictJson(
    await readFile(scoreSchemaPath, "utf8"),
    scoreSchemaPath,
  );
  ajv.addSchema(scoreSchema);
  const diagnosticsSchema = parseStrictJson(
    await readFile(diagnosticsSchemaPath, "utf8"),
    diagnosticsSchemaPath,
  );
  ajv.addSchema(diagnosticsSchema);

  return {
    config: requireValidator(
      ajv,
      `${resultSchema.$id}#/$defs/runConfig`,
      "run config",
    ),
    event: requireValidator(
      ajv,
      "https://covenant-timeline.org/schemas/v0alpha3/event.schema.json",
      "event",
    ),
    query: requireValidator(
      ajv,
      "https://covenant-timeline.org/schemas/v0alpha3/query.schema.json",
      "query",
    ),
    result: requireValidator(ajv, resultSchema.$id, "benchmark result"),
    score: requireValidator(ajv, scoreSchema.$id, "benchmark score"),
    diagnostics: requireValidator(
      ajv,
      diagnosticsSchema.$id,
      "benchmark diagnostics",
    ),
    semanticResult: requireValidator(
      ajv,
      "https://covenant-timeline.org/schemas/v0alpha3/conclusion.schema.json#/$defs/semanticResult",
      "semantic result",
    ),
    usage: requireValidator(ajv, `${resultSchema.$id}#/$defs/usage`, "usage"),
  };
}

export async function loadRunConfig(path, validator) {
  const config = parseStrictJson(
    await readBoundedText(path, maxConfigBytes),
    path,
  );
  assertValid(validator, config, path);
  assertNoCredentialFields(
    config.generation.parameters,
    `${path}.generation.parameters`,
  );
  return config;
}

export async function loadBenchmarkCases(path = defaultCasesPath, validators) {
  validators ??= await createModelEvalValidators();
  const cases = await readJsonLines(path, maxCorpusBytes);
  const ids = new Set();
  const modelCaseIds = new Set();
  const familyCounts = new Map(FAMILIES.map((family) => [family, 0]));

  for (const [index, testCase] of cases.entries()) {
    const label = `${path}:${index + 1}`;
    assertRecord(testCase, label);
    assertExactKeys(
      testCase,
      [
        "schema",
        "id",
        "family",
        "entities",
        "contract",
        "setupEvents",
        "evidence",
        "cuts",
      ],
      label,
    );
    if (testCase.schema !== CASE_SCHEMA) {
      fail(`${label}: unsupported case schema`);
    }
    assertIdentifier(testCase.id, `${label}.id`);
    if (ids.has(testCase.id))
      fail(`${label}: duplicate case id ${testCase.id}`);
    ids.add(testCase.id);

    if (!FAMILIES.includes(testCase.family)) {
      fail(
        `${label}.family: unknown family ${JSON.stringify(testCase.family)}`,
      );
    }
    familyCounts.set(testCase.family, familyCounts.get(testCase.family) + 1);
    validateEntities(testCase.entities, `${label}.entities`);
    const modelCaseId = testCase.contract?.id;
    if (
      typeof modelCaseId !== "string" ||
      !/^case-[0-9]{2}$/.test(modelCaseId) ||
      testCase.contract?.subject?.id !== modelCaseId
    ) {
      fail(
        `${label}.contract: contract and subject IDs must use the opaque case-NN identifier`,
      );
    }
    if (modelCaseIds.has(modelCaseId)) {
      fail(`${label}.contract.id: duplicate ${modelCaseId}`);
    }
    modelCaseIds.add(modelCaseId);

    if (!Array.isArray(testCase.setupEvents)) {
      fail(`${label}.setupEvents: must be an array`);
    }
    for (const [eventIndex, event] of testCase.setupEvents.entries()) {
      if (
        event?.type !== "point.declared" &&
        event?.type !== "interval.declared"
      ) {
        fail(
          `${label}.setupEvents[${eventIndex}]: setup may only declare points or intervals`,
        );
      }
    }

    let accumulatedEvents = [...testCase.setupEvents];
    parseRunDocumentV0Alpha3({
      schema: "covenant.timeline.run.v0alpha3",
      contract: testCase.contract,
      events: accumulatedEvents,
    });

    validateEvidence(testCase.evidence, label);
    if (!Array.isArray(testCase.cuts) || testCase.cuts.length !== 3) {
      fail(`${label}.cuts: expected exactly three cuts`);
    }

    for (const [cutIndex, cut] of testCase.cuts.entries()) {
      const cutLabel = `${label}.cuts[${cutIndex}]`;
      assertRecord(cut, cutLabel);
      assertExactKeys(
        cut,
        [
          "index",
          "question",
          "traits",
          "expectedResult",
          "goldQuery",
          "goldEvents",
        ],
        cutLabel,
      );
      if (cut.index !== cutIndex) {
        fail(`${cutLabel}.index: must equal ${cutIndex}`);
      }
      if (typeof cut.question !== "string" || cut.question.length === 0) {
        fail(`${cutLabel}.question: must be a non-empty string`);
      }
      validateTraits(cut.traits, `${cutLabel}.traits`);
      assertValid(
        validators.semanticResult,
        cut.expectedResult,
        `${cutLabel}.expectedResult`,
      );
      if (!Array.isArray(cut.goldEvents)) {
        fail(`${cutLabel}.goldEvents: must be an array`);
      }
      for (const [eventIndex, event] of cut.goldEvents.entries()) {
        assertValid(
          validators.event,
          event,
          `${cutLabel}.goldEvents[${eventIndex}]`,
        );
        assertVisibleEvidenceRefs(
          event,
          currentEvidence(testCase, cutIndex),
          `${cutLabel}.goldEvents[${eventIndex}]`,
        );
      }

      accumulatedEvents = [...accumulatedEvents, ...cut.goldEvents];
      const run = parseRunDocumentV0Alpha3({
        schema: "covenant.timeline.run.v0alpha3",
        contract: testCase.contract,
        events: accumulatedEvents,
      });
      assertValid(validators.query, cut.goldQuery, `${cutLabel}.goldQuery`);
      const query = parseQueryV0Alpha3(cut.goldQuery, run);
      const conclusion = reasonTemporalQueryV0Alpha3(run, query);
      if (!verifyTemporalConclusionV0Alpha3(run, query, conclusion)) {
        fail(`${cutLabel}: gold proof did not verify`);
      }
      if (!canonicalEqual(conclusion.result, cut.expectedResult)) {
        fail(
          `${cutLabel}.expectedResult: kernel returned ${canonicalJson(conclusion.result)}`,
        );
      }
    }
  }

  if (cases.length !== 12) {
    fail(`${path}: expected 12 cases, found ${cases.length}`);
  }
  for (const family of FAMILIES) {
    if (familyCounts.get(family) !== 2) {
      fail(
        `${path}: expected two ${family} cases, found ${familyCounts.get(family)}`,
      );
    }
  }

  return cases;
}

export async function readJsonLines(path, maxBytes = MAX_RESULTS_BYTES) {
  const text = await readBoundedText(path, maxBytes);
  const withoutFinalNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (withoutFinalNewline.length === 0) return [];

  return withoutFinalNewline.split("\n").map((line, index) => {
    if (line.trim().length === 0) {
      fail(`${path}:${index + 1}: blank JSONL record`);
    }
    return parseStrictJson(line, `${path}:${index + 1}`);
  });
}

export async function digestFile(path, maxBytes = MAX_RESULTS_BYTES) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new ModelEvalError(`${path}: must be a file`);
  if (metadata.size > maxBytes) {
    throw new ModelEvalError(
      `${path}: file uses ${metadata.size} bytes; limit is ${maxBytes}`,
    );
  }
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      throw new ModelEvalError(
        `${path}: file exceeded the ${maxBytes}-byte limit while reading`,
      );
    }
    hash.update(chunk);
  }
  return `sha256:${hash.digest("hex")}`;
}

async function readBoundedText(path, maxBytes) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new ModelEvalError(`${path}: must be a file`);
  if (metadata.size > maxBytes) {
    throw new ModelEvalError(
      `${path}: file uses ${metadata.size} bytes; limit is ${maxBytes}`,
    );
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      throw new ModelEvalError(
        `${path}: file exceeded the ${maxBytes}-byte limit while reading`,
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

export function visibleEvidence(testCase, cut) {
  return testCase.evidence.filter((entry) => entry.cut <= cut);
}

export function currentEvidence(testCase, cut) {
  return testCase.evidence.filter((entry) => entry.cut === cut);
}

export function memoryBudgetBytes() {
  return CONTINUITY_BUDGET_BYTES;
}

export function continuityStateBytes(
  priorRun,
  knowledgeCuts,
  setupEventCount = 0,
) {
  if (
    !Number.isSafeInteger(setupEventCount) ||
    setupEventCount < 0 ||
    setupEventCount > priorRun.events.length
  ) {
    throw new ModelEvalError("setupEventCount is outside priorRun.events");
  }
  return Buffer.byteLength(
    canonicalJson({
      events: priorRun.events.slice(setupEventCount),
      knowledgeCuts,
    }),
    "utf8",
  );
}

export function assertVisibleEvidenceRefs(event, evidence, label = "event") {
  const visible = new Set(evidence.map(({ digest }) => digest));
  for (const reference of eventEvidenceRefs(event)) {
    if (!visible.has(reference)) {
      throw new ModelEvalError(
        `${label}: evidence reference ${reference} is not visible`,
        {
          code: "evidence.not-visible",
          stage: "admission",
        },
      );
    }
  }
}

export function assertModelTimelineDelta(
  events,
  label = "adapter response.events",
) {
  if (events.length > MAX_TIMELINE_EVENTS_PER_RESPONSE) {
    throw new ModelEvalError(
      `${label}: must contain at most ${MAX_TIMELINE_EVENTS_PER_RESPONSE} events`,
      {
        code: "event.delta-limit",
        stage: "admission",
      },
    );
  }

  const fingerprints = new Map();
  for (const [index, event] of events.entries()) {
    const evidenceRefs = eventEvidenceRefs(event);
    if (evidenceRefs.length > MAX_TIMELINE_REFERENCES_PER_EVENT) {
      throw new ModelEvalError(
        `${label}[${index}]: evidenceRefs must contain at most ${MAX_TIMELINE_REFERENCES_PER_EVENT} entries`,
        {
          code: "event.reference-limit",
          stage: "admission",
        },
      );
    }
    const supersedes = event?.assertion?.supersedes ?? [];
    if (supersedes.length > MAX_TIMELINE_REFERENCES_PER_EVENT) {
      throw new ModelEvalError(
        `${label}[${index}]: supersedes must contain at most ${MAX_TIMELINE_REFERENCES_PER_EVENT} entries`,
        {
          code: "event.reference-limit",
          stage: "admission",
        },
      );
    }

    const fingerprint = modelEventFingerprint(event);
    const duplicateIndex = fingerprints.get(fingerprint);
    if (duplicateIndex !== undefined) {
      throw new ModelEvalError(
        `${label}[${index}]: duplicates the temporal claim in ${label}[${duplicateIndex}]`,
        {
          code: "event.duplicate-claim",
          stage: "admission",
        },
      );
    }
    fingerprints.set(fingerprint, index);
  }
}

export function eventEvidenceRefs(event) {
  if (event?.type === "assertion.retracted") {
    return event.evidenceRefs ?? [];
  }
  return event?.assertion?.evidenceRefs ?? [];
}

function modelEventFingerprint(event) {
  if (event.type === "assertion.retracted") {
    return canonicalJson({
      type: event.type,
      assertionId: event.assertionId,
      evidenceRefs: normalizedReferences(event.evidenceRefs),
    });
  }

  if (event.assertion === undefined) {
    const { schema: _schema, id: _id, sequence: _sequence, ...claim } = event;
    return canonicalJson(claim);
  }

  const { id: _id, evidenceRefs, supersedes, ...claim } = event.assertion;
  return canonicalJson({
    type: event.type,
    assertion: {
      ...claim,
      evidenceRefs: normalizedReferences(evidenceRefs),
      ...(supersedes === undefined
        ? {}
        : { supersedes: normalizedReferences(supersedes) }),
    },
  });
}

function normalizedReferences(references) {
  return [...references].sort();
}

export function canonicalEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function digestText(text) {
  return byteDigest(new TextEncoder().encode(text));
}

export function assertValid(validator, value, label) {
  if (validator(value)) return;
  const issues = (validator.errors ?? [])
    .map(
      ({ instancePath, message }) =>
        `${instancePath || "$"} ${message ?? "is invalid"}`,
    )
    .join("; ");
  fail(`${label}: ${issues}`);
}

export function validateAdapterResponse(response, request, validators) {
  assertRecord(response, "adapter response");
  const common = ["schema", "requestId"];
  if (response.schema === ADAPTER_ERROR_SCHEMA) {
    assertExactKeys(response, [...common, "error"], "adapter response", [
      "usage",
    ]);
    if (response.requestId !== request.requestId) {
      throw new ModelEvalError("adapter response: requestId mismatch", {
        code: "response.request-id",
      });
    }
    if (response.usage !== undefined) {
      assertResponseValid(
        validators.usage,
        response.usage,
        "adapter response.usage",
        "response.usage",
      );
    }
    validateAdapterError(response.error);
    return;
  }

  const fields =
    request.arm === "direct"
      ? [...common, "answer"]
      : request.arm === "narrative-memory"
        ? [...common, "answer", "memory"]
        : [...common, "events", "query"];
  assertExactKeys(response, fields, "adapter response", ["usage"]);

  if (response.schema !== RESPONSE_SCHEMA) {
    throw new ModelEvalError("adapter response: unsupported schema", {
      code: "response.schema",
    });
  }
  if (response.requestId !== request.requestId) {
    throw new ModelEvalError("adapter response: requestId mismatch", {
      code: "response.request-id",
    });
  }
  if (response.usage !== undefined) {
    assertResponseValid(
      validators.usage,
      response.usage,
      "adapter response.usage",
      "response.usage",
    );
  }
  if (request.arm === "direct" || request.arm === "narrative-memory") {
    assertResponseValid(
      validators.semanticResult,
      response.answer,
      "adapter response.answer",
      "response.answer",
    );
  }
  if (
    request.arm === "narrative-memory" &&
    typeof response.memory !== "string"
  ) {
    throw new ModelEvalError("adapter response.memory: must be a string", {
      code: "response.memory",
    });
  }
  if (request.arm === "timeline") {
    if (!Array.isArray(response.events)) {
      throw new ModelEvalError("adapter response.events: must be an array", {
        code: "response.events",
      });
    }
    response.events.forEach((event, index) =>
      assertResponseValid(
        validators.event,
        event,
        `adapter response.events[${index}]`,
        "response.event",
      ),
    );
    assertResponseValid(
      validators.query,
      response.query,
      "adapter response.query",
      "response.query",
    );
  }
}

function validateAdapterError(error) {
  assertRecord(error, "adapter response.error");
  assertExactKeys(
    error,
    ["code", "message", "scope"],
    "adapter response.error",
  );
  if (
    typeof error.code !== "string" ||
    !adapterErrorCodePattern.test(error.code)
  ) {
    throw new ModelEvalError(
      "adapter response.error.code: must be a valid error code",
      { code: "response.error" },
    );
  }
  if (
    typeof error.message !== "string" ||
    error.message.length === 0 ||
    Array.from(error.message).length > 480
  ) {
    throw new ModelEvalError(
      "adapter response.error.message: must use 1 through 480 characters",
      { code: "response.error" },
    );
  }
  if (!["observation", "run"].includes(error.scope)) {
    throw new ModelEvalError(
      "adapter response.error.scope: must be observation or run",
      { code: "response.error" },
    );
  }
}

function assertResponseValid(validator, value, label, code) {
  try {
    assertValid(validator, value, label);
  } catch (error) {
    throw new ModelEvalError(
      error instanceof Error ? error.message : String(error),
      { code, stage: "protocol" },
    );
  }
}

function validateEvidence(evidence, label) {
  if (!Array.isArray(evidence) || evidence.length !== 3) {
    fail(`${label}.evidence: expected exactly three entries`);
  }
  const ids = new Set();
  const cuts = new Set();
  for (const [index, entry] of evidence.entries()) {
    const entryLabel = `${label}.evidence[${index}]`;
    assertRecord(entry, entryLabel);
    assertExactKeys(entry, ["id", "cut", "text", "digest"], entryLabel);
    assertIdentifier(entry.id, `${entryLabel}.id`);
    if (ids.has(entry.id)) fail(`${entryLabel}.id: duplicate ${entry.id}`);
    ids.add(entry.id);
    if (!Number.isInteger(entry.cut) || entry.cut < 0 || entry.cut > 2) {
      fail(`${entryLabel}.cut: must be 0, 1, or 2`);
    }
    if (entry.id !== `record-${entry.cut}`) {
      fail(`${entryLabel}.id: must equal record-${entry.cut}`);
    }
    if (cuts.has(entry.cut)) {
      fail(`${entryLabel}.cut: duplicate cut ${entry.cut}`);
    }
    cuts.add(entry.cut);
    if (typeof entry.text !== "string" || entry.text.length === 0) {
      fail(`${entryLabel}.text: must be a non-empty string`);
    }
    const digest = digestText(entry.text);
    if (entry.digest !== digest) {
      fail(`${entryLabel}.digest: expected ${digest}`);
    }
  }
}

function validateEntities(entities, label) {
  assertRecord(entities, label);
  if (Object.keys(entities).length === 0) {
    fail(`${label}: must not be empty`);
  }
  for (const [id, description] of Object.entries(entities)) {
    assertIdentifier(id, `${label} key`);
    if (typeof description !== "string" || description.length === 0) {
      fail(`${label}.${id}: must be a non-empty string`);
    }
  }
}

function validateTraits(traits, label) {
  if (!Array.isArray(traits) || new Set(traits).size !== traits.length) {
    fail(`${label}: must be an array of unique identifiers`);
  }
  traits.forEach((trait, index) =>
    assertIdentifier(trait, `${label}[${index}]`),
  );
}

function assertRecord(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label}: must be an object`);
  }
}

function assertExactKeys(value, required, label, optional = []) {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${label}: missing ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label}: unexpected ${key}`);
  }
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    fail(`${label}: must be a valid identifier`);
  }
}

export function assertNoCredentialFields(value, label) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (entry !== null && typeof entry === "object") {
        assertNoCredentialFields(entry, `${label}[${index}]`);
      }
    });
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key
      .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase();
    if (credentialKeyPattern.test(normalized)) {
      fail(
        `${label}.${key}: credentials must be passed through the adapter environment`,
      );
    }
    if (entry !== null && typeof entry === "object") {
      assertNoCredentialFields(entry, `${label}.${key}`);
    }
  }
}

function requireValidator(ajv, id, label) {
  const validator = ajv.getSchema(id);
  if (!validator) throw new Error(`${label} schema is not registered`);
  return validator;
}

function fail(message) {
  throw new ModelEvalError(message, {
    code: "benchmark.invalid",
    stage: "protocol",
  });
}

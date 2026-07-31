#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  TemporalModelProposalErrorV1,
  canonicalJson,
  compileTemporalModelProposalV1,
  contentDigest,
  verifyTemporalModelProposalCandidateV1,
} from "../packages/prototype/dist/index.js";
import {
  assertNoCredentialFields,
  assertValid,
  canonicalEqual,
  digestText,
  loadBenchmarkCasesArtifact,
  readJsonLinesArtifact,
} from "./model-interface-eval.mjs";
import {
  MODEL_PROPOSAL_BOUNDARY_BENCHMARK,
  ModelProposalBoundaryError,
  completeBoundaryCut,
  createBoundaryAdapterRequest,
  createBoundaryObservation,
  createBoundaryReferenceScope,
  createBoundaryTrajectory,
  evaluateBoundaryProposal,
} from "./model-proposal-boundary.mjs";
import {
  createRunDocument,
  projectSemanticState,
} from "./model-proposal-fixtures.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const benchmarkDirectory = join(root, "benchmarks/model-proposal-boundary/v1");
const defaultCasesPath = join(
  root,
  "benchmarks/model-interface/v1/cases.jsonl",
);
const promptPath = join(benchmarkDirectory, "prompts/proposal.md");
const resultSchemaPath = join(benchmarkDirectory, "result.schema.json");
const scoreSchemaPath = join(benchmarkDirectory, "score.schema.json");
const schemaPaths = [
  "schemas/v0alpha3/common.schema.json",
  "schemas/v0alpha3/contract.schema.json",
  "schemas/v0alpha3/event.schema.json",
  "schemas/v0alpha3/query.schema.json",
  "schemas/v0alpha3/conclusion.schema.json",
  "schemas/model-proposal/v1/proposal.schema.json",
  "schemas/model-proposal/v1/candidate.schema.json",
];
const SCORE_SCHEMA = "covenant.timeline.model-proposal-eval.score.v1";
const MAX_ERROR_CHARACTERS = 480;
const FAMILIES = [
  "bounded-indeterminate",
  "planned-actual-isolation",
  "delayed-observation-historical-cuts",
  "correction-supersession-retraction",
  "contradictions",
  "interval-relations",
];

export async function scoreModelProposalEval({
  results: resultsPath,
  cases: casesPath = defaultCasesPath,
}) {
  const validators = await createValidators();
  const [corpusArtifact, resultsArtifact] = await Promise.all([
    loadBenchmarkCasesArtifact(casesPath),
    readJsonLinesArtifact(resultsPath),
  ]);
  const cases = corpusArtifact.cases;
  const results = resultsArtifact.records;
  if (results.length === 0) throw new Error("results file is empty");

  const corpusDigest = corpusArtifact.digest;
  const prompt = await readFile(promptPath, "utf8");
  const promptDigest = digestText(prompt);
  const caseById = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const run = validateResults(results, {
    caseById,
    corpusDigest,
    promptDigest,
    resultsPath,
    validators,
  });
  const selectedCases = run.selection.cases.map((caseId) => {
    const testCase = caseById.get(caseId);
    if (!testCase) {
      throw new Error(`run selection contains unknown case ${caseId}`);
    }
    return testCase;
  });
  const indexed = indexResults(results, selectedCases, run.selection);
  const observations = replayResults({
    records: indexed.records,
    selectedCases,
    repeats: run.selection.repeats,
    prompt,
    run,
  });
  const selectedFamilies = FAMILIES.filter((family) =>
    selectedCases.some((testCase) => testCase.family === family),
  );
  const coverage = {
    ...indexed.coverage,
    cases: selectedCases.length,
    cutsPerCase: 3,
    repeats: run.selection.repeats,
  };
  const score = {
    schema: SCORE_SCHEMA,
    benchmark: MODEL_PROPOSAL_BOUNDARY_BENCHMARK,
    run,
    resultsDigest: resultsArtifact.digest,
    corpusDigest,
    coverage,
    outcomes: {
      ok: results.filter(({ status }) => status === "ok").length,
      error: results.filter(({ status }) => status === "error").length,
    },
    metrics: metricsFor(observations),
    families: Object.fromEntries(
      selectedFamilies.map((family) => [
        family,
        metricsFor(
          observations.filter((observation) => observation.family === family),
        ),
      ]),
    ),
    failures: failureCounts(results),
  };
  assertValid(validators.score, score, "benchmark score");
  return score;
}

async function createValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const path of schemaPaths) {
    ajv.addSchema(
      parseStrictJson(await readFile(join(root, path), "utf8"), path),
    );
  }
  const resultSchema = parseStrictJson(
    await readFile(resultSchemaPath, "utf8"),
    resultSchemaPath,
  );
  const scoreSchema = parseStrictJson(
    await readFile(scoreSchemaPath, "utf8"),
    scoreSchemaPath,
  );
  ajv.addSchema(resultSchema);
  ajv.addSchema(scoreSchema);
  return {
    result: requiredValidator(ajv, resultSchema.$id, "benchmark result"),
    score: requiredValidator(ajv, scoreSchema.$id, "benchmark score"),
  };
}

function requiredValidator(ajv, id, label) {
  const validator = ajv.getSchema(id);
  if (!validator) throw new Error(`missing ${label} validator`);
  return validator;
}

function validateResults(
  results,
  { caseById, corpusDigest, promptDigest, resultsPath, validators },
) {
  let run;
  let runDigest;
  const requestKeys = new Map();

  for (const [index, result] of results.entries()) {
    const label = `${resultsPath}:${index + 1}`;
    assertValid(validators.result, result, label);
    if (result.benchmark !== MODEL_PROPOSAL_BOUNDARY_BENCHMARK) {
      throw new Error(`${label}: benchmark mismatch`);
    }
    const testCase = caseById.get(result.caseId);
    if (testCase) {
      const cut = testCase.cuts[result.cut];
      if (!cut) throw new Error(`${label}: unknown cut ${result.cut}`);
      if (result.family !== testCase.family) {
        throw new Error(`${label}: family does not match corpus`);
      }
      if (!canonicalEqual(result.traits, cut.traits)) {
        throw new Error(`${label}: traits do not match corpus`);
      }
    }
    validatePipelineShape(result, label);
    const key = resultKey(result.caseId, result.repeat, result.cut);
    const priorKey = requestKeys.get(result.requestId);
    if (priorKey !== undefined && priorKey !== key) {
      throw new Error(
        `${label}: requestId ${result.requestId} is reused across observations`,
      );
    }
    requestKeys.set(result.requestId, key);
    assertNoCredentialFields(
      result.run.config.generation.parameters,
      `${label}.run.config.generation.parameters`,
    );
    if (contentDigest(result.run.config) !== result.run.configDigest) {
      throw new Error(`${label}: configDigest does not match run.config`);
    }
    if (
      /^[0-9a-f]{40,64}$/u.test(result.run.config.benchmarkRevision) &&
      result.run.config.benchmarkRevision !== result.run.sourceRevision
    ) {
      throw new Error(
        `${label}: benchmarkRevision does not match run.sourceRevision`,
      );
    }
    if (result.run.sourceDirty !== false) {
      throw new Error(`${label}: benchmark source state is not clean`);
    }
    const digest = contentDigest(result.run);
    runDigest ??= digest;
    if (digest !== runDigest) {
      throw new Error(`${label}: result file contains multiple run records`);
    }
    run ??= result.run;
    validateArtifactIntegrity(result, label);
  }

  if (run.corpusDigest !== corpusDigest) {
    throw new Error("results were produced from a different corpus");
  }
  if (run.promptDigest !== promptDigest) {
    throw new Error("results were produced from a different prompt");
  }
  return run;
}

function validateArtifactIntegrity(result, label) {
  if (digestText(result.requestText) !== result.requestDigest) {
    throw new Error(`${label}: requestDigest does not match requestText`);
  }
  const request = parseStrictJson(result.requestText, `${label}.requestText`);
  if (canonicalJson(request) !== result.requestText) {
    throw new Error(`${label}: requestText is not canonical JSON`);
  }
  if (
    request.requestId !== result.requestId ||
    request.benchmark !== MODEL_PROPOSAL_BOUNDARY_BENCHMARK ||
    !canonicalEqual(request.config, result.run.config) ||
    request.configDigest !== result.run.configDigest
  ) {
    throw new Error(`${label}: request metadata does not match result`);
  }
  const outputSchema = parseStrictJson(
    result.outputSchemaJson,
    `${label}.outputSchemaJson`,
  );
  if (canonicalJson(outputSchema) !== result.outputSchemaJson) {
    throw new Error(`${label}: outputSchemaJson is not canonical JSON`);
  }
  if (digestText(result.outputSchemaJson) !== result.outputSchemaDigest) {
    throw new Error(
      `${label}: outputSchemaDigest does not match outputSchemaJson`,
    );
  }
  if (
    !canonicalEqual(request.outputSchema, outputSchema) ||
    request.outputSchemaDigest !== result.outputSchemaDigest
  ) {
    throw new Error(`${label}: request output schema binding does not match`);
  }
  if ((result.responseText === null) !== (result.responseDigest === null)) {
    throw new Error(
      `${label}: responseText and responseDigest must both be present`,
    );
  }
  if (
    result.responseText !== null &&
    digestText(result.responseText) !== result.responseDigest
  ) {
    throw new Error(`${label}: responseDigest does not match responseText`);
  }
  validateSafeResponseIntegrity(result, label);
}

function indexResults(results, selectedCases, selection) {
  const expected = new Set();
  for (let repeat = 0; repeat < selection.repeats; repeat += 1) {
    for (const testCase of selectedCases) {
      for (const cut of testCase.cuts) {
        expected.add(resultKey(testCase.id, repeat, cut.index));
      }
    }
  }

  const records = new Map();
  let unexpected = 0;
  for (const result of results) {
    const key = resultKey(result.caseId, result.repeat, result.cut);
    if (!expected.has(key)) {
      unexpected += 1;
      continue;
    }
    const entries = records.get(key) ?? [];
    entries.push(result);
    records.set(key, entries);
  }
  const missing = [...expected].filter(
    (key) => (records.get(key)?.length ?? 0) === 0,
  ).length;
  const duplicate = [...records.values()].reduce(
    (count, entries) => count + Math.max(0, entries.length - 1),
    0,
  );
  return {
    records,
    coverage: {
      expected: expected.size,
      observed: results.length,
      missing,
      duplicate,
      unexpected,
      complete: missing === 0 && duplicate === 0 && unexpected === 0,
    },
  };
}

function validatePipelineShape(result, label) {
  if (result.status === "ok") return;
  const stage = result.error.stage;
  if (stage === "adapter" || stage === "protocol") {
    requireNull(
      result,
      [
        "proposal",
        "responseSchemaValid",
        "compiled",
        "candidate",
        "candidateVerified",
        "applied",
        "conclusion",
        "proofVerified",
      ],
      label,
    );
    return;
  }
  if (stage === "response-schema") {
    if (result.responseSchemaValid !== false) {
      throw new Error(`${label}: response-schema failure was not rejected`);
    }
    return;
  }
  if (stage === "compilation") {
    if (result.responseSchemaValid !== true || result.compiled !== false) {
      throw new Error(`${label}: compilation failure has invalid state`);
    }
    return;
  }
  if (stage === "candidate-verification") {
    if (
      result.responseSchemaValid !== true ||
      result.compiled !== true ||
      result.candidateVerified !== false ||
      result.applied === true ||
      result.conclusion !== null ||
      result.proofVerified !== null
    ) {
      throw new Error(
        `${label}: candidate-verification failure has invalid state`,
      );
    }
    return;
  }
  if (stage === "application") {
    if (
      result.responseSchemaValid !== true ||
      result.compiled !== true ||
      result.candidateVerified !== true ||
      result.applied !== false ||
      result.conclusion !== null ||
      result.proofVerified !== null
    ) {
      throw new Error(`${label}: application failure has invalid state`);
    }
    return;
  }
  if (stage === "reasoning") {
    if (
      result.applied !== true ||
      result.conclusion !== null ||
      result.proofVerified !== null
    ) {
      throw new Error(`${label}: reasoning failure has invalid state`);
    }
    return;
  }
  if (
    result.applied !== true ||
    result.conclusion === null ||
    result.proofVerified !== false
  ) {
    throw new Error(`${label}: proof-verification failure has invalid state`);
  }
}

function replayResults({ records, selectedCases, repeats, prompt, run }) {
  const observations = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const testCase of selectedCases) {
      const referenceScope = createBoundaryReferenceScope(testCase);
      let trajectory = createBoundaryTrajectory(testCase);
      let continuityAvailable = true;
      for (const cut of testCase.cuts) {
        const entries =
          records.get(resultKey(testCase.id, repeat, cut.index)) ?? [];
        if (!continuityAvailable || entries.length !== 1) {
          if (continuityAvailable && entries.length > 1) {
            for (const result of entries) {
              const observation = createBoundaryObservation({
                testCase,
                cut,
                trajectory,
                referenceScope,
                requestId: result.requestId,
              });
              validateStoredRequest(result, observation, prompt, run);
              validateStoredResponse(result, observation);
              replayPipeline({
                result,
                observation,
                trajectory,
                testCase,
                cut,
                referenceScope,
              });
            }
          }
          observations.push(
            unusableObservation({
              results: entries,
              family: testCase.family,
              testCase,
              cut,
            }),
          );
          continuityAvailable = false;
          continue;
        }
        const [result] = entries;
        const observation = createBoundaryObservation({
          testCase,
          cut,
          trajectory,
          referenceScope,
          requestId: result.requestId,
        });
        validateStoredRequest(result, observation, prompt, run);
        validateStoredResponse(result, observation);
        const replay = replayPipeline({
          result,
          observation,
          trajectory,
          testCase,
          cut,
          referenceScope,
        });
        observations.push({
          result,
          resourceResults: [result],
          family: testCase.family,
          ...observationMetrics({
            result,
            cut,
            testCase,
            trajectory,
            referenceScope,
            candidateRun: replay.candidateRun,
          }),
        });
        trajectory = replay.trajectory;
      }
    }
  }
  return observations;
}

function unusableObservation({ results, family, testCase, cut }) {
  return {
    result: results.length === 1 ? results[0] : null,
    resourceResults: results,
    family,
    responseSchemaValid: false,
    compilerValid: false,
    candidateVerified: false,
    applied: false,
    assertionCounts: {
      truePositive: 0,
      predicted: 0,
      expected: deltaAtoms(cut.goldEvents, goldPriorRun(testCase, cut.index))
        .size,
    },
    projectedStateExact: false,
    queryExact: false,
    answerExact: false,
    proofVerified: false,
    endToEndExact: false,
  };
}

function validateStoredRequest(result, observation, prompt, run) {
  const label = result.requestId;
  if (digestText(result.requestText) !== result.requestDigest) {
    throw new Error(`${label}: requestDigest does not match requestText`);
  }
  const request = parseStrictJson(result.requestText, `${label}.requestText`);
  if (canonicalJson(request) !== result.requestText) {
    throw new Error(`${label}: requestText is not canonical JSON`);
  }
  const expectedRequest = createBoundaryAdapterRequest({
    requestId: result.requestId,
    prompt,
    observation,
    config: run.config,
  });
  if (!canonicalEqual(request, expectedRequest)) {
    throw new Error(`${label}: stored request does not match benchmark state`);
  }
  if (result.outputSchemaJson !== observation.outputSchemaText) {
    throw new Error(`${label}: outputSchemaJson does not match request host`);
  }
  if (digestText(result.outputSchemaJson) !== result.outputSchemaDigest) {
    throw new Error(
      `${label}: outputSchemaDigest does not match outputSchemaJson`,
    );
  }
  if (result.outputSchemaDigest !== observation.outputSchemaDigest) {
    throw new Error(`${label}: output schema digest does not match request`);
  }
}

function validateStoredResponse(result, observation) {
  const label = result.requestId;
  if ((result.responseText === null) !== (result.responseDigest === null)) {
    throw new Error(
      `${label}: responseText and responseDigest must both be present`,
    );
  }
  if (result.responseText === null) {
    if (
      result.status !== "error" ||
      (result.error.stage !== "adapter" && result.error.stage !== "protocol")
    ) {
      throw new Error(`${label}: missing response is not an adapter failure`);
    }
    return;
  }
  if (digestText(result.responseText) !== result.responseDigest) {
    throw new Error(`${label}: responseDigest does not match responseText`);
  }

  let response;
  try {
    response = parseStrictJson(result.responseText, `${label}.responseText`);
  } catch (error) {
    if (result.status === "error" && result.error.stage === "protocol") return;
    throw error;
  }
  if (!isRecord(response)) {
    if (result.status === "error" && result.error.stage === "protocol") return;
    throw new Error(`${label}: adapter response must be an object`);
  }
  if (response.schema === "covenant.timeline.model-eval.adapter-error.v1") {
    validateAdapterErrorResponse(result, response);
    return;
  }
  const { usage = null, ...proposal } = response;
  if (!canonicalEqual(usage, result.usage)) {
    throw new Error(`${label}: usage does not match stored response`);
  }
  const validate = compileOutputSchema(observation.outputSchema);
  const schemaValid = validate(proposal);
  if (result.responseSchemaValid !== schemaValid) {
    throw new Error(
      `${label}: responseSchemaValid does not match the stored response`,
    );
  }
  if (schemaValid && !canonicalEqual(proposal, result.proposal)) {
    throw new Error(`${label}: proposal does not match stored response`);
  }
  if (
    !schemaValid &&
    (result.status !== "error" ||
      result.error.stage !== "response-schema" ||
      result.error.code !== "proposal.schema" ||
      result.error.message !== outputSchemaFailureMessage(validate.errors) ||
      result.proposal !== null)
  ) {
    throw new Error(`${label}: invalid response has the wrong failure stage`);
  }
}

function validateSafeResponseIntegrity(result, label) {
  if (result.responseText === null) return;
  let response;
  try {
    response = parseStrictJson(result.responseText, `${label}.responseText`);
  } catch (error) {
    if (result.status === "error" && result.error.stage === "protocol") return;
    throw error;
  }
  if (!isRecord(response)) {
    if (result.status === "error" && result.error.stage === "protocol") return;
    throw new Error(`${label}: adapter response must be an object`);
  }
  if (response.schema === "covenant.timeline.model-eval.adapter-error.v1") {
    validateAdapterErrorResponse(result, response);
    return;
  }
  const { usage = null, ...proposal } = response;
  if (!canonicalEqual(usage, result.usage)) {
    throw new Error(`${label}: usage does not match stored response`);
  }
  if (
    result.responseSchemaValid === true &&
    !canonicalEqual(proposal, result.proposal)
  ) {
    throw new Error(`${label}: proposal does not match stored response`);
  }
}

function compileOutputSchema(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return ajv.compile(schema);
}

function outputSchemaFailureMessage(errors) {
  const issues = (errors ?? [])
    .slice(0, 8)
    .map(
      ({ instancePath, message }) =>
        `${instancePath || "$"} ${message ?? "is invalid"}`,
    )
    .join("; ");
  return boundedBoundaryMessage(
    `provider proposal failed its output schema: ${issues}`,
  );
}

function mapEvaluationError(error) {
  if (error.stage === "compiler") {
    return {
      stage: "compilation",
      code: error.code,
      message: boundedErrorMessage(error.message),
    };
  }
  if (error.stage === "continuity") {
    return {
      stage: "application",
      code: error.code,
      message: boundedErrorMessage(error.message),
    };
  }
  throw new Error(`unsupported evaluation error stage ${error.stage}`);
}

function boundedBoundaryMessage(value) {
  const sanitized = String(value).replace(/[\u0000-\u001f\u007f]/gu, " ");
  return sanitized.length <= MAX_ERROR_CHARACTERS
    ? sanitized
    : `${sanitized.slice(0, MAX_ERROR_CHARACTERS - 3)}...`;
}

function boundedErrorMessage(value) {
  const source = String(value);
  const wellFormed =
    typeof source.toWellFormed === "function"
      ? source.toWellFormed()
      : source.replaceAll(
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu,
          "\uFFFD",
        );
  const sanitized = wellFormed.replace(/[\u0000-\u001f\u007f]/gu, " ");
  return (
    Array.from(sanitized).slice(0, MAX_ERROR_CHARACTERS).join("") ||
    "benchmark observation failed"
  );
}

function validateAdapterErrorResponse(result, response) {
  const label = result.requestId;
  const keys = Object.keys(response).sort();
  const expected = [
    "error",
    "requestId",
    "schema",
    ...(Object.hasOwn(response, "usage") ? ["usage"] : []),
  ].sort();
  if (!canonicalEqual(keys, expected)) {
    throw new Error(`${label}: adapter error response has unsupported fields`);
  }
  if (
    response.requestId !== result.requestId ||
    !isRecord(response.error) ||
    !canonicalEqual(Object.keys(response.error).sort(), [
      "code",
      "message",
      "scope",
    ]) ||
    typeof response.error.code !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(response.error.code) ||
    typeof response.error.message !== "string" ||
    response.error.message.length === 0 ||
    response.error.message.length > MAX_ERROR_CHARACTERS ||
    response.error.scope !== "observation" ||
    result.status !== "error" ||
    result.error.stage !== "adapter" ||
    response.error.code !== result.error.code ||
    response.error.message !== result.error.message
  ) {
    throw new Error(`${label}: adapter error does not match result`);
  }
  if (!canonicalEqual(response.usage ?? null, result.usage)) {
    throw new Error(`${label}: usage does not match adapter error`);
  }
}

function replayPipeline({
  result,
  observation,
  trajectory,
  testCase,
  cut,
  referenceScope,
}) {
  let candidate = null;
  if (result.responseSchemaValid === true) {
    try {
      candidate = compileTemporalModelProposalV1(
        result.proposal,
        observation.host,
        {
          maxChanges: 8,
          maxSupportsPerChange: 4,
        },
      );
    } catch (error) {
      if (!(error instanceof TemporalModelProposalErrorV1)) throw error;
      if (
        result.status !== "error" ||
        result.error.stage !== "compilation" ||
        result.compiled !== false ||
        result.error.code !== error.code ||
        result.error.message !== boundedErrorMessage(error.message)
      ) {
        throw new Error(
          `${result.requestId}: compiler failure does not reproduce`,
        );
      }
    }
    if (candidate !== null) {
      if (result.compiled !== true) {
        throw new Error(
          `${result.requestId}: compiler accepted a recorded failure`,
        );
      }
      if (!canonicalEqual(candidate, result.candidate)) {
        throw new Error(
          `${result.requestId}: candidate does not match recompilation`,
        );
      }
      const verified = verifyTemporalModelProposalCandidateV1(
        candidate,
        result.proposal,
        observation.host,
        {
          maxChanges: 8,
          maxSupportsPerChange: 4,
        },
      );
      if (result.candidateVerified !== verified) {
        throw new Error(
          `${result.requestId}: candidateVerified does not reproduce`,
        );
      }
    }
  }

  if (candidate === null || result.candidateVerified !== true) {
    return {
      candidateRun: null,
      trajectory: completeBoundaryCut(trajectory, cut.index),
    };
  }

  let evaluated;
  try {
    evaluated = evaluateBoundaryProposal({
      proposal: result.proposal,
      observation,
      trajectory,
      testCase,
      cut,
      referenceScope,
    });
  } catch (error) {
    if (
      error instanceof ModelProposalBoundaryError &&
      error.code === "proposal.proof-verification"
    ) {
      if (
        result.status !== "error" ||
        result.error.stage !== "proof-verification" ||
        result.error.code !== error.code ||
        result.error.message !== boundedErrorMessage(error.message)
      ) {
        throw new Error(
          `${result.requestId}: proof failure does not reproduce`,
        );
      }
      return {
        candidateRun: null,
        trajectory: completeBoundaryCut(trajectory, cut.index),
      };
    }
    throw error;
  }
  if (
    evaluated.compiled !== true ||
    !canonicalEqual(evaluated.candidate, candidate)
  ) {
    throw new Error(
      `${result.requestId}: proposal compilation changed during replay`,
    );
  }
  if (result.applied !== evaluated.applied) {
    throw new Error(`${result.requestId}: applied outcome does not reproduce`);
  }

  if (evaluated.error) {
    const expectedError = mapEvaluationError(evaluated.error);
    if (
      result.status !== "error" ||
      !canonicalEqual(result.error, expectedError) ||
      result.conclusion !== null ||
      result.proofVerified !== null
    ) {
      throw new Error(
        `${result.requestId}: application failure does not reproduce`,
      );
    }
  } else if (
    result.status !== "ok" ||
    result.error !== null ||
    !canonicalEqual(result.conclusion, evaluated.conclusion) ||
    result.proofVerified !== evaluated.proofVerified
  ) {
    throw new Error(
      `${result.requestId}: successful evaluation does not reproduce`,
    );
  }

  const candidateRun =
    evaluated.applied === true
      ? createRunDocument(testCase.contract, [
          ...trajectory.run.events,
          ...candidate.candidateEvents,
        ])
      : null;
  return {
    candidateRun,
    trajectory: evaluated.trajectory,
  };
}

function observationMetrics({
  result,
  cut,
  testCase,
  trajectory,
  referenceScope,
  candidateRun,
}) {
  const goldRun = goldRunAtCut(testCase, cut.index);
  const expectedState = stateAtoms(projectSemanticState(goldRun));
  const predictedState =
    candidateRun === null
      ? new Set()
      : stateAtoms(projectSemanticState(candidateRun));
  const stateCounts = setCounts(predictedState, expectedState);
  const expectedAssertions = deltaAtoms(
    cut.goldEvents,
    goldPriorRun(testCase, cut.index),
  );
  let assertionCounts;
  if (result.compiled === true && result.candidate !== null) {
    assertionCounts = setCounts(
      deltaAtoms(result.candidate.candidateEvents, trajectory.run),
      expectedAssertions,
    );
  } else if (result.responseSchemaValid === true) {
    assertionCounts = {
      truePositive: 0,
      predicted: result.proposal.changes.length,
      expected: expectedAssertions.size,
    };
  } else {
    assertionCounts = {
      truePositive: 0,
      predicted: 0,
      expected: expectedAssertions.size,
    };
  }
  const projectedStateExact =
    result.applied === true &&
    stateCounts.predicted === stateCounts.expected &&
    stateCounts.truePositive === stateCounts.expected;
  const queryExact =
    result.compiled === true &&
    proposalQueryExact({
      proposal: result.proposal,
      testCase,
      cut,
      trajectory,
      referenceScope,
    });
  const answerExact =
    result.conclusion !== null &&
    canonicalEqual(result.conclusion.result, cut.expectedResult);
  const proofVerified = result.proofVerified === true;
  return {
    responseSchemaValid: result.responseSchemaValid === true,
    compilerValid: result.compiled === true,
    candidateVerified: result.candidateVerified === true,
    applied: result.applied === true,
    assertionCounts,
    projectedStateExact,
    queryExact,
    answerExact,
    proofVerified,
    endToEndExact:
      result.responseSchemaValid === true &&
      result.compiled === true &&
      result.candidateVerified === true &&
      result.applied === true &&
      projectedStateExact &&
      queryExact &&
      answerExact &&
      proofVerified,
  };
}

function metricsFor(observations) {
  const assertions = observations.reduce(
    (total, observation) => ({
      truePositive:
        total.truePositive + observation.assertionCounts.truePositive,
      predicted: total.predicted + observation.assertionCounts.predicted,
      expected: total.expected + observation.assertionCounts.expected,
    }),
    { truePositive: 0, predicted: 0, expected: 0 },
  );
  const precision = rate(assertions.truePositive, assertions.predicted);
  const recall = rate(assertions.truePositive, assertions.expected);
  return {
    responseSchemaValidRate: binaryRate(observations, "responseSchemaValid"),
    compilerValidRate: binaryRate(observations, "compilerValid"),
    candidateVerificationRate: binaryRate(observations, "candidateVerified"),
    appliedRate: binaryRate(observations, "applied"),
    representationExactAssertionPrecision: precision,
    representationExactAssertionRecall: recall,
    representationExactAssertionF1: f1(precision.value, recall.value),
    projectedStateExactRate: binaryRate(observations, "projectedStateExact"),
    queryExactRate: binaryRate(observations, "queryExact"),
    answerExactRate: binaryRate(observations, "answerExact"),
    proofVerificationRate: binaryRate(observations, "proofVerified"),
    endToEndExactRate: binaryRate(observations, "endToEndExact"),
    latencyMs: distribution(
      observations.flatMap(({ resourceResults }) =>
        resourceResults.map(({ latencyMs }) => latencyMs),
      ),
    ),
    inputTokens: totals(
      observations
        .flatMap(({ resourceResults }) =>
          resourceResults.map(({ usage }) => usage?.inputTokens),
        )
        .filter((value) => typeof value === "number"),
    ),
    outputTokens: totals(
      observations
        .flatMap(({ resourceResults }) =>
          resourceResults.map(({ usage }) => usage?.outputTokens),
        )
        .filter((value) => typeof value === "number"),
    ),
    costUsd: totals(
      observations
        .flatMap(({ resourceResults }) =>
          resourceResults.map(({ usage }) => usage?.costUsd),
        )
        .filter((value) => typeof value === "number"),
    ),
  };
}

function binaryRate(observations, field) {
  return rate(
    observations.filter((observation) => observation[field]).length,
    observations.length,
  );
}

function rate(numerator, denominator) {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
  };
}

function f1(precision, recall) {
  if (precision === null && recall === null) return null;
  if (precision === null || recall === null) return 0;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function distribution(values) {
  if (values.length === 0) {
    return { count: 0, mean: null, p50: null, p95: null };
  }
  const ordered = [...values].sort((left, right) => left - right);
  const total = finiteSum(ordered);
  return {
    count: ordered.length,
    mean: total / ordered.length,
    p50: percentile(ordered, 0.5),
    p95: percentile(ordered, 0.95),
  };
}

function percentile(ordered, quantile) {
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)];
}

function totals(values) {
  if (values.length === 0) {
    return { count: 0, total: null, mean: null };
  }
  const total = finiteSum(values);
  return { count: values.length, total, mean: total / values.length };
}

function finiteSum(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total)) {
    throw new Error("score aggregate exceeds the finite number range");
  }
  return total;
}

function failureCounts(results) {
  const stages = {};
  const codes = {};
  let total = 0;
  for (const result of results) {
    if (result.error === null) continue;
    total += 1;
    stages[result.error.stage] = (stages[result.error.stage] ?? 0) + 1;
    codes[result.error.code] = (codes[result.error.code] ?? 0) + 1;
  }
  return {
    total,
    stages: sortObject(stages),
    codes: sortObject(codes),
  };
}

function stateAtoms(states) {
  return new Set(
    states.flatMap((state) =>
      ["coordinates", "constraints", "facts"].flatMap((kind) =>
        state[kind].map((assertion) =>
          canonicalJson({
            contextId: state.contextId,
            kind,
            assertion: normalizeAssertionSets(assertion),
          }),
        ),
      ),
    ),
  );
}

function deltaAtoms(events, priorRun) {
  return new Set(
    events.map((event) => canonicalJson(normalizeDeltaEvent(event, priorRun))),
  );
}

function normalizeDeltaEvent(event, priorRun) {
  if (event.type === "assertion.retracted") {
    return {
      type: event.type,
      target: assertionSemantics(priorRun, event.assertionId),
      evidenceRefs: [...event.evidenceRefs].sort(),
    };
  }
  const {
    id: _id,
    supersedes = [],
    evidenceRefs,
    ...assertion
  } = event.assertion;
  const revision = supersedes
    .map((id) => assertionSemantics(priorRun, id))
    .sort(compareCanonical);
  return {
    type: event.type,
    assertion: {
      ...assertion,
      evidenceRefs: [...evidenceRefs].sort(),
    },
    revision: revision.length === 0 ? "keep" : revision,
  };
}

function assertionSemantics(run, assertionId) {
  for (const event of run.events) {
    if (event.assertion?.id !== assertionId) continue;
    const {
      id: _id,
      supersedes: _supersedes,
      evidenceRefs,
      ...body
    } = event.assertion;
    return {
      type: event.type,
      body: { ...body, evidenceRefs: [...evidenceRefs].sort() },
    };
  }
  return { missing: true };
}

function normalizeAssertionSets(assertion) {
  return {
    ...assertion,
    evidenceRefs: [...assertion.evidenceRefs].sort(),
  };
}

function compareCanonical(left, right) {
  return canonicalJson(left).localeCompare(canonicalJson(right), "en");
}

function setCounts(actual, expected) {
  let truePositive = 0;
  for (const value of actual) {
    if (expected.has(value)) truePositive += 1;
  }
  return {
    truePositive,
    predicted: actual.size,
    expected: expected.size,
  };
}

function proposalQueryExact({
  proposal,
  testCase,
  cut,
  trajectory,
  referenceScope,
}) {
  const query = proposal?.query;
  const reference = referenceScope.byHandle.get(query?.targetHandle);
  if (!reference || !queryTypeMatchesReference(query.type, reference.type)) {
    return false;
  }
  if (
    canonicalJson(queryBodyFromReference(query.type, reference)) !==
    canonicalJson(queryBody(cut.goldQuery))
  ) {
    return false;
  }
  const expectedCut = expectedKnowledgeCut(testCase, cut);
  if (query.knowledgeCut?.type !== expectedCut.type) return false;
  if (expectedCut.type === "current") return true;
  const selected = trajectory.knowledgeCuts.find(
    ({ handle }) => handle === query.knowledgeCut.cutHandle,
  );
  return selected?.cutIndex === expectedCut.cutIndex;
}

function expectedKnowledgeCut(testCase, cut) {
  const sequences = [];
  let events = testCase.setupEvents.length;
  for (const candidateCut of testCase.cuts) {
    events += candidateCut.goldEvents.length;
    sequences.push(events === 0 ? null : events - 1);
  }
  if (cut.goldQuery.recordedThrough === sequences[cut.index]) {
    return { type: "current" };
  }
  const cutIndex = sequences
    .slice(0, cut.index)
    .findIndex((sequence) => sequence === cut.goldQuery.recordedThrough);
  return cutIndex < 0 ? { type: "invalid" } : { type: "prior", cutIndex };
}

function queryBody(query) {
  if (query.type === "context.consistency") {
    return { type: query.type, contextId: query.contextId };
  }
  if (query.type === "difference.bounds") {
    return {
      type: query.type,
      fromPointId: query.fromPointId,
      toPointId: query.toPointId,
    };
  }
  if (query.type === "point.relations") {
    return {
      type: query.type,
      leftPointId: query.leftPointId,
      rightPointId: query.rightPointId,
    };
  }
  return {
    type: query.type,
    leftIntervalId: query.leftIntervalId,
    rightIntervalId: query.rightIntervalId,
  };
}

function queryBodyFromReference(type, reference) {
  if (type === "consistency" && reference.type === "context") {
    return { type: "context.consistency", contextId: reference.contextId };
  }
  if (type === "difference" && reference.type === "difference") {
    return {
      type: "difference.bounds",
      fromPointId: reference.fromPointId,
      toPointId: reference.toPointId,
    };
  }
  if (type === "point-relation" && reference.type === "point-relation") {
    return {
      type: "point.relations",
      leftPointId: reference.leftPointId,
      rightPointId: reference.rightPointId,
    };
  }
  if (type === "interval-relation" && reference.type === "interval-relation") {
    return {
      type: "interval.relations",
      leftIntervalId: reference.leftIntervalId,
      rightIntervalId: reference.rightIntervalId,
    };
  }
  return { type: "invalid" };
}

function queryTypeMatchesReference(queryType, referenceType) {
  return (
    (queryType === "consistency" && referenceType === "context") ||
    (queryType === "difference" && referenceType === "difference") ||
    (queryType === "point-relation" && referenceType === "point-relation") ||
    (queryType === "interval-relation" && referenceType === "interval-relation")
  );
}

function goldRunAtCut(testCase, cutIndex) {
  return createRunDocument(testCase.contract, [
    ...testCase.setupEvents,
    ...testCase.cuts
      .slice(0, cutIndex + 1)
      .flatMap(({ goldEvents }) => goldEvents),
  ]);
}

function goldPriorRun(testCase, cutIndex) {
  return createRunDocument(testCase.contract, [
    ...testCase.setupEvents,
    ...testCase.cuts.slice(0, cutIndex).flatMap(({ goldEvents }) => goldEvents),
  ]);
}

function sortObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function resultKey(caseId, repeat, cut) {
  return `${caseId}|${repeat}|${cut}`;
}

function requireNull(value, fields, label) {
  for (const field of fields) {
    if (value[field] !== null) {
      throw new Error(`${label}: ${field} must be null`);
    }
  }
}

function parseArguments(argv) {
  const options = { cases: defaultCasesPath, results: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${flag} requires a value`);
    index += 1;
    if (flag === "--cases") options.cases = value;
    else if (flag === "--results") options.results = value;
    else throw new Error(`unknown option ${flag}`);
  }
  if (!options.results) throw new Error("--results is required");
  return options;
}

async function main() {
  const score = await scoreModelProposalEval(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${canonicalJson(score)}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

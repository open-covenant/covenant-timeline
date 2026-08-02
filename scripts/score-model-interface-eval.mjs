#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isMain } from "./mcp-agent-pilot-lib.mjs";
import {
  canonicalJson,
  contentDigest,
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  projectTemporalStateV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "../packages/prototype/dist/index.js";
import {
  ARMS,
  BENCHMARK,
  FAMILIES,
  PROMPT_PATHS,
  REQUEST_SCHEMA,
  assertModelTimelineDelta,
  assertNoCredentialFields,
  assertStructuredEventOrder,
  assertValid,
  assertVisibleEvidenceRefs,
  canonicalEqual,
  continuityStateBytes,
  createModelEvalValidators,
  currentEvidence,
  digestText,
  loadBenchmarkCasesArtifact,
  memoryBudgetBytes,
  readJsonLinesArtifact,
  validateAdapterResponse,
  visibleEvidence,
} from "./model-interface-eval.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const defaultCasesPath = "benchmarks/model-interface/v1/cases.jsonl";

export async function scoreModelInterfaceEval({
  results: resultsPath,
  cases: casesPath = defaultCasesPath,
}) {
  return (
    await scoreModelInterfaceEvalArtifacts({
      results: resultsPath,
      cases: casesPath,
    })
  ).score;
}

export async function scoreModelInterfaceEvalArtifacts({
  results: resultsPath,
  cases: casesPath = defaultCasesPath,
}) {
  const validators = await createModelEvalValidators();
  const [corpusArtifact, resultsArtifact] = await Promise.all([
    loadBenchmarkCasesArtifact(casesPath, validators),
    readJsonLinesArtifact(resultsPath),
  ]);
  const cases = corpusArtifact.cases;
  const results = resultsArtifact.records;
  if (results.length === 0) throw new Error("results file is empty");
  const corpusDigest = corpusArtifact.digest;
  const prompts = Object.fromEntries(
    await Promise.all(
      ARMS.map(async (arm) => [arm, await readFile(PROMPT_PATHS[arm], "utf8")]),
    ),
  );
  const promptDigests = Object.fromEntries(
    ARMS.map((arm) => [arm, digestText(prompts[arm])]),
  );

  const caseById = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const records = new Map();
  const requests = new Map();
  const requestIds = new Set();
  let runDigest;

  for (const [index, result] of results.entries()) {
    const label = `${resultsPath}:${index + 1}`;
    assertValid(validators.result, result, label);
    assertNoCredentialFields(
      result.run.config.generation.parameters,
      `${label}.run.config.generation.parameters`,
    );
    validateResult(result, caseById, label);
    requests.set(
      result.requestId,
      validateStoredRequest(result, caseById, prompts, label),
    );
    validateRawResponse(result, validators, label);
    if (requestIds.has(result.requestId)) {
      throw new Error(`${label}: duplicate requestId ${result.requestId}`);
    }
    requestIds.add(result.requestId);
    const key = resultKey(result);
    if (records.has(key)) throw new Error(`${label}: duplicate result ${key}`);
    records.set(key, result);

    const digest = contentDigest(result.run);
    runDigest ??= digest;
    if (digest !== runDigest) {
      throw new Error(`${label}: result file contains multiple run records`);
    }
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
  }
  if (results[0].run.corpusDigest !== corpusDigest) {
    throw new Error("results were produced from a different corpus");
  }
  if (!canonicalEqual(results[0].run.promptDigests, promptDigests)) {
    throw new Error("results were produced from different prompt files");
  }
  const selection = results[0].run.selection;
  if (
    selection.priorStateMode === "teacher-forced" &&
    (selection.arms.length !== 1 || selection.arms[0] !== "timeline")
  ) {
    throw new Error("teacher-forced artifacts may contain only Timeline");
  }
  const selectedCases = selection.cases.map((id) => {
    const testCase = caseById.get(id);
    if (!testCase) throw new Error(`run selection contains unknown case ${id}`);
    return testCase;
  });
  for (const result of results) {
    if (
      !selection.arms.includes(result.arm) ||
      !selection.cases.includes(result.caseId) ||
      result.repeat >= selection.repeats
    ) {
      throw new Error(
        `${result.requestId}: result is outside the recorded run selection`,
      );
    }
  }

  const observations = [];
  for (let repeat = 0; repeat < selection.repeats; repeat += 1) {
    for (const testCase of selectedCases) {
      for (const arm of selection.arms) {
        for (const cut of testCase.cuts) {
          const result =
            records.get(
              resultKey({
                caseId: testCase.id,
                arm,
                repeat,
                cut: cut.index,
              }),
            ) ?? null;
          const answerExact =
            result?.status === "ok" &&
            canonicalEqual(result.answer, cut.expectedResult);
          observations.push({
            arm,
            answerExact,
            cut,
            exact: answerExact,
            family: testCase.family,
            repeat,
            result,
            testCase,
          });
        }
      }
    }
  }
  if (selection.arms.includes("timeline")) {
    attachTimelineDiagnostics(
      observations,
      selectedCases,
      selection.repeats,
      requests,
      selection.priorStateMode,
    );
  }
  if (selection.arms.includes("structured-extraction")) {
    attachStructuredExtractionDiagnostics(
      observations,
      selectedCases,
      selection.repeats,
      requests,
    );
  }
  if (selection.arms.includes("narrative-memory")) {
    validateNarrativeContinuity(
      observations,
      selectedCases,
      selection.repeats,
      requests,
    );
  }

  const coverage = {
    expected: observations.length,
    observed: results.length,
    missing: observations.length - results.length,
    complete: observations.length === results.length,
    repeats: selection.repeats,
  };
  const arms = Object.fromEntries(
    selection.arms.map((arm) => [
      arm,
      metricsFor(
        observations.filter((entry) => entry.arm === arm),
        arm,
      ),
    ]),
  );
  const selectedFamilies = FAMILIES.filter((family) =>
    selectedCases.some((testCase) => testCase.family === family),
  );
  const families = Object.fromEntries(
    selectedFamilies.map((family) => {
      const familyObservations = observations.filter(
        (entry) => entry.family === family,
      );
      return [
        family,
        {
          arms: Object.fromEntries(
            selection.arms.map((arm) => [
              arm,
              metricsFor(
                familyObservations.filter((entry) => entry.arm === arm),
                arm,
              ),
            ]),
          ),
          paired: pairedMetrics(familyObservations),
        },
      ];
    }),
  );
  const repeatMetrics = Array.from(
    { length: selection.repeats },
    (_, repeat) => {
      const repeatObservations = observations.filter(
        (entry) => entry.repeat === repeat,
      );
      return {
        repeat,
        arms: Object.fromEntries(
          selection.arms.map((arm) => [
            arm,
            metricsFor(
              repeatObservations.filter((entry) => entry.arm === arm),
              arm,
            ),
          ]),
        ),
        paired: pairedMetrics(repeatObservations),
      };
    },
  );

  const score = {
    schema: "covenant.timeline.model-eval.score.v1",
    benchmark: BENCHMARK,
    diagnosticOnly: selection.priorStateMode === "teacher-forced",
    run: results[0].run,
    resultsDigest: resultsArtifact.digest,
    corpusDigest,
    coverage,
    arms,
    teacherForcedPriorCuts:
      selection.priorStateMode === "teacher-forced"
        ? metricsFor(
            observations.filter(
              (entry) => entry.arm === "timeline" && entry.cut.index > 0,
            ),
            "timeline",
            observations,
          )
        : null,
    families,
    repeatMetrics,
    paired: pairedMetrics(observations),
    failures: failureCounts(results),
  };
  assertValid(validators.score, score, "benchmark score");
  return { score, cases, results };
}

function validateResult(result, caseById, label) {
  if (result.benchmark !== BENCHMARK) {
    throw new Error(`${label}: benchmark mismatch`);
  }
  const testCase = caseById.get(result.caseId);
  if (!testCase) throw new Error(`${label}: unknown case ${result.caseId}`);
  const cut = testCase.cuts[result.cut];
  if (!cut) throw new Error(`${label}: unknown cut ${result.cut}`);
  if (result.family !== testCase.family) {
    throw new Error(`${label}: family does not match corpus`);
  }
  if (!canonicalEqual(result.traits, cut.traits)) {
    throw new Error(`${label}: traits do not match corpus`);
  }
  if (result.status === "ok" && result.error !== null) {
    throw new Error(`${label}: successful result has an error`);
  }
  if (result.status === "error" && result.error === null) {
    throw new Error(`${label}: failed result has no error`);
  }

  if (result.arm === "direct") {
    requireNull(
      result,
      [
        "proposedEvents",
        "proposedQuery",
        "admitted",
        "conclusion",
        "proofVerified",
        "memory",
        "memoryBytes",
        "memoryBudgetBytes",
        "stateBytes",
        "stateBudgetBytes",
      ],
      label,
    );
    if (result.status === "ok" && result.answer === null) {
      throw new Error(`${label}: successful direct result has no answer`);
    }
  } else if (result.arm === "narrative-memory") {
    requireNull(
      result,
      [
        "proposedEvents",
        "proposedQuery",
        "admitted",
        "conclusion",
        "proofVerified",
        "stateBytes",
        "stateBudgetBytes",
      ],
      label,
    );
    const expectedBudget = memoryBudgetBytes(testCase, result.cut);
    if (result.memoryBudgetBytes !== expectedBudget) {
      throw new Error(`${label}: memory budget does not match corpus`);
    }
    if (
      result.memory !== null &&
      result.memoryBytes !== Buffer.byteLength(result.memory, "utf8")
    ) {
      throw new Error(`${label}: memoryBytes does not match memory`);
    }
    if ((result.memory === null) !== (result.memoryBytes === null)) {
      throw new Error(`${label}: memory and memoryBytes must both be present`);
    }
    if (result.status === "ok") {
      if (result.answer === null || result.memory === null) {
        throw new Error(`${label}: successful narrative result is incomplete`);
      }
      if (result.memoryBytes > expectedBudget) {
        throw new Error(`${label}: successful narrative memory exceeds budget`);
      }
    }
  } else {
    requireNull(result, ["memory", "memoryBytes", "memoryBudgetBytes"], label);
    const expectedBudget = memoryBudgetBytes(testCase, result.cut);
    if (result.stateBudgetBytes !== expectedBudget) {
      throw new Error(`${label}: state budget does not match corpus`);
    }
    if (result.stateBytes !== null && result.stateBytes < 1) {
      throw new Error(`${label}: stateBytes must be positive when present`);
    }
    if (
      result.stateBytes !== null &&
      result.stateBytes > expectedBudget &&
      (result.status !== "error" ||
        result.admitted !== false ||
        result.error.stage !== "admission" ||
        result.error.code !== "state.over-budget")
    ) {
      throw new Error(`${label}: over-budget Timeline state was not rejected`);
    }
    if (
      result.error?.code === "state.over-budget" &&
      (result.stateBytes === null || result.stateBytes <= expectedBudget)
    ) {
      throw new Error(`${label}: state.over-budget does not exceed the budget`);
    }
    if (result.status === "ok") {
      if (
        result.admitted !== true ||
        result.proposedEvents === null ||
        result.proposedQuery === null ||
        result.conclusion === null ||
        result.proofVerified !== true ||
        result.stateBytes === null
      ) {
        throw new Error(`${label}: successful Timeline result is incomplete`);
      }
      if (result.stateBytes > expectedBudget) {
        throw new Error(`${label}: successful Timeline state exceeds budget`);
      }
      if (!canonicalEqual(result.answer, result.conclusion.result)) {
        throw new Error(`${label}: answer does not match conclusion`);
      }
    }
    const deltaError = validateStoredDelta(result, testCase, label);
    if (deltaError !== null) {
      if (
        result.status !== "error" ||
        result.admitted !== false ||
        result.error.stage !== "admission" ||
        result.error.code !== deltaError.code ||
        result.stateBytes !== null
      ) {
        throw new Error(
          `${label}: stored admission failure does not match proposed events`,
        );
      }
    }
  }
}

function validateStoredRequest(result, caseById, prompts, label) {
  if (digestText(result.requestText) !== result.requestDigest) {
    throw new Error(`${label}: requestDigest does not match requestText`);
  }
  const request = parseStrictJson(result.requestText, `${label}.requestText`);
  if (canonicalJson(request) !== result.requestText) {
    throw new Error(`${label}: requestText is not canonical JSON`);
  }
  assertObjectKeys(
    request,
    [
      "schema",
      "requestId",
      "benchmark",
      "config",
      "configDigest",
      "caseId",
      "arm",
      "repeat",
      "cut",
      "prompt",
      "input",
    ],
    `${label}.requestText`,
  );
  const testCase = caseById.get(result.caseId);
  if (
    request.schema !== REQUEST_SCHEMA ||
    request.requestId !== result.requestId ||
    request.benchmark !== BENCHMARK ||
    !canonicalEqual(request.config, result.run.config) ||
    request.configDigest !== result.run.configDigest ||
    request.caseId !== testCase.contract.id ||
    request.arm !== result.arm ||
    request.repeat !== result.repeat ||
    request.cut !== result.cut ||
    request.prompt !== prompts[result.arm]
  ) {
    throw new Error(`${label}: stored request metadata does not match result`);
  }

  const rolling =
    result.arm === "narrative-memory" || result.arm === "timeline";
  const expectedKeys = [
    "entities",
    "contract",
    "setupEvents",
    "question",
    "evidence",
    ...(result.arm === "narrative-memory"
      ? ["memory", "memoryBudgetBytes"]
      : []),
    ...(result.arm === "timeline"
      ? ["priorRun", "knowledgeCuts", "stateBudgetBytes"]
      : []),
    ...(result.arm === "structured-extraction" ? ["stateBudgetBytes"] : []),
  ];
  assertObjectKeys(request.input, expectedKeys, `${label}.requestText.input`);
  const cut = testCase.cuts[result.cut];
  if (
    !canonicalEqual(request.input.entities, testCase.entities) ||
    !canonicalEqual(request.input.contract, testCase.contract) ||
    !canonicalEqual(request.input.setupEvents, testCase.setupEvents) ||
    request.input.question !== cut.question ||
    !canonicalEqual(
      request.input.evidence,
      rolling
        ? currentEvidence(testCase, result.cut)
        : visibleEvidence(testCase, result.cut),
    )
  ) {
    throw new Error(`${label}: stored request input does not match corpus`);
  }
  if (
    result.arm === "narrative-memory" &&
    (typeof request.input.memory !== "string" ||
      request.input.memoryBudgetBytes !==
        memoryBudgetBytes(testCase, result.cut))
  ) {
    throw new Error(`${label}: stored narrative continuity input is invalid`);
  }
  if (result.arm === "timeline") {
    assertObjectKeys(
      request.input.priorRun,
      ["schema", "contract", "events"],
      `${label}.requestText.input.priorRun`,
    );
    if (
      request.input.priorRun?.schema !== "covenant.timeline.run.v0alpha3" ||
      !canonicalEqual(request.input.priorRun.contract, testCase.contract) ||
      !Array.isArray(request.input.priorRun.events) ||
      !Array.isArray(request.input.knowledgeCuts) ||
      request.input.stateBudgetBytes !== memoryBudgetBytes(testCase, result.cut)
    ) {
      throw new Error(`${label}: stored Timeline continuity input is invalid`);
    }
  }
  if (
    result.arm === "structured-extraction" &&
    request.input.stateBudgetBytes !== memoryBudgetBytes(testCase, result.cut)
  ) {
    throw new Error(`${label}: stored structured-extraction budget is invalid`);
  }
  return request;
}

function assertObjectKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!canonicalEqual(actual, wanted)) {
    throw new Error(`${label}: fields do not match the request protocol`);
  }
}

function validateStoredDelta(result, testCase, label) {
  try {
    assertModelTimelineDelta(
      result.proposedEvents ?? [],
      `${label}.proposedEvents`,
    );
  } catch (error) {
    return {
      code:
        error && typeof error === "object" && "code" in error
          ? error.code
          : "event.delta-invalid",
    };
  }
  for (const [index, event] of (result.proposedEvents ?? []).entries()) {
    if (event.type === "point.declared" || event.type === "interval.declared") {
      return { code: "event.declaration-not-allowed" };
    }
    try {
      assertVisibleEvidenceRefs(
        event,
        result.arm === "structured-extraction"
          ? visibleEvidence(testCase, result.cut)
          : currentEvidence(testCase, result.cut),
        `${label}.proposedEvents[${index}]`,
      );
    } catch (error) {
      return {
        code:
          error && typeof error === "object" && "code" in error
            ? error.code
            : "evidence.not-visible",
      };
    }
  }
  if (result.arm === "structured-extraction") {
    try {
      assertStructuredEventOrder(
        result.proposedEvents ?? [],
        visibleEvidence(testCase, result.cut),
        `${label}.proposedEvents`,
      );
    } catch (error) {
      return {
        code:
          error && typeof error === "object" && "code" in error
            ? error.code
            : "event.evidence-order",
      };
    }
  }
  return null;
}

function validateRawResponse(result, validators, label) {
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
    validateAdapterResponse(
      response,
      { arm: result.arm, requestId: result.requestId },
      validators,
    );
  } catch (error) {
    if (result.status === "error" && result.error.stage === "protocol") return;
    throw new Error(
      `${label}: stored response does not reproduce: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (result.status === "error" && result.error.stage === "protocol") {
    throw new Error(`${label}: valid stored response has a protocol error`);
  }
  if (!canonicalEqual(response.usage ?? null, result.usage)) {
    throw new Error(`${label}: usage does not match stored response`);
  }
  if (response.error !== undefined) {
    if (response.error.scope !== "observation") {
      throw new Error(
        `${label}: stored adapter error must be observation-scoped`,
      );
    }
    if (
      result.status !== "error" ||
      result.error.stage !== "adapter" ||
      result.error.code !== response.error.code ||
      result.error.message !== response.error.message
    ) {
      throw new Error(`${label}: adapter error does not match stored response`);
    }
    return;
  }
  if (result.arm === "direct") {
    if (result.status !== "ok") {
      throw new Error(`${label}: valid direct response was recorded as failed`);
    }
    if (!canonicalEqual(response.answer, result.answer)) {
      throw new Error(`${label}: answer does not match stored response`);
    }
    return;
  }
  if (result.arm === "narrative-memory") {
    if (
      !canonicalEqual(response.answer, result.answer) ||
      response.memory !== result.memory
    ) {
      throw new Error(
        `${label}: narrative output does not match stored response`,
      );
    }
    const overBudget = result.memoryBytes > result.memoryBudgetBytes;
    if (
      (!overBudget && result.status !== "ok") ||
      (overBudget &&
        (result.status !== "error" ||
          result.error.stage !== "memory" ||
          result.error.code !== "memory.over-budget"))
    ) {
      throw new Error(
        `${label}: narrative status does not match its memory budget`,
      );
    }
    return;
  }
  if (
    !canonicalEqual(response.events, result.proposedEvents) ||
    !canonicalEqual(response.query, result.proposedQuery)
  ) {
    throw new Error(
      `${label}: structured output does not match stored response`,
    );
  }
}

function attachTimelineDiagnostics(
  observations,
  cases,
  repeats,
  requests,
  priorStateMode,
) {
  const timeline = new Map(
    observations
      .filter((entry) => entry.arm === "timeline")
      .map((entry) => [
        resultKey({
          caseId: entry.testCase.id,
          arm: "timeline",
          repeat: entry.repeat,
          cut: entry.cut.index,
        }),
        entry,
      ]),
  );

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const testCase of cases) {
      let predictedPrior = [...testCase.setupEvents];
      let goldPrior = [...testCase.setupEvents];
      const predictedKnowledgeCuts = [];
      const goldKnowledgeCuts = [];
      let missingEarlierCut = false;

      for (const cut of testCase.cuts) {
        if (priorStateMode === "teacher-forced") {
          predictedPrior = [...goldPrior];
          predictedKnowledgeCuts.splice(
            0,
            predictedKnowledgeCuts.length,
            ...goldKnowledgeCuts,
          );
        }
        const observation = timeline.get(
          resultKey({
            caseId: testCase.id,
            arm: "timeline",
            repeat,
            cut: cut.index,
          }),
        );
        if (!observation.result) {
          missingEarlierCut = true;
        } else if (missingEarlierCut) {
          throw new Error(
            `${testCase.id} repeat ${repeat}: Timeline results contain a gap`,
          );
        }
        const request = observation.result
          ? requests.get(observation.result.requestId)
          : null;
        if (
          request &&
          (!canonicalEqual(request.input.priorRun.events, predictedPrior) ||
            !canonicalEqual(
              request.input.knowledgeCuts,
              predictedKnowledgeCuts,
            ))
        ) {
          throw new Error(
            `${testCase.id} repeat ${repeat} cut ${cut.index}: Timeline request continuity does not match prior results`,
          );
        }
        const proposed = observation.result?.proposedEvents ?? [];
        const predictedCandidate = [...predictedPrior, ...proposed];
        const goldCandidate = [...goldPrior, ...cut.goldEvents];
        const predictedCandidateCuts = [
          ...predictedKnowledgeCuts,
          knowledgeCut(cut.index, predictedCandidate),
        ];
        const goldCandidateCuts = [
          ...goldKnowledgeCuts,
          knowledgeCut(cut.index, goldCandidate),
        ];
        const predictedTuples = normalizeAssertionDelta(
          predictedPrior,
          proposed,
        );
        const goldTuples = normalizeAssertionDelta(goldPrior, cut.goldEvents);
        observation.assertions = multisetComparison(
          predictedTuples,
          goldTuples,
        );
        observation.queryExact =
          observation.result?.proposedQuery !== null &&
          observation.result?.proposedQuery !== undefined &&
          canonicalEqual(
            normalizeQuery(
              observation.result.proposedQuery,
              predictedCandidateCuts,
            ),
            normalizeQuery(cut.goldQuery, goldCandidateCuts),
          );

        const resultLabel = `${testCase.id} repeat ${repeat} cut ${cut.index}`;
        const predictedRun = observation.result
          ? reproduceTimelineResult(
              observation.result,
              testCase,
              cut,
              predictedCandidate,
              predictedCandidateCuts,
              resultLabel,
            )
          : null;

        const goldRun = parseRunDocumentV0Alpha3({
          schema: "covenant.timeline.run.v0alpha3",
          contract: testCase.contract,
          events: goldCandidate,
        });
        observation.stateSemanticExact =
          observation.result?.admitted === true &&
          canonicalEqual(
            projectedStateSignature(predictedRun, testCase.setupEvents),
            projectedStateSignature(goldRun, testCase.setupEvents),
          );
        observation.endToEndExact =
          observation.answerExact &&
          observation.result?.admitted === true &&
          observation.result.proofVerified === true &&
          observation.queryExact &&
          observation.stateSemanticExact;

        if (
          priorStateMode === "rolling" &&
          observation.result?.admitted === true
        ) {
          predictedPrior = predictedCandidate;
        }
        if (priorStateMode === "rolling") {
          predictedKnowledgeCuts.push(knowledgeCut(cut.index, predictedPrior));
        }
        goldPrior = goldCandidate;
        goldKnowledgeCuts.push(knowledgeCut(cut.index, goldPrior));
      }
    }
  }
}

function attachStructuredExtractionDiagnostics(
  observations,
  cases,
  repeats,
  requests,
) {
  const records = new Map(
    observations
      .filter((entry) => entry.arm === "structured-extraction")
      .map((entry) => [
        resultKey({
          caseId: entry.testCase.id,
          arm: entry.arm,
          repeat: entry.repeat,
          cut: entry.cut.index,
        }),
        entry,
      ]),
  );

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const testCase of cases) {
      const goldEvents = [...testCase.setupEvents];
      const goldKnowledgeCuts = [];
      for (const cut of testCase.cuts) {
        goldEvents.push(...cut.goldEvents);
        goldKnowledgeCuts.push(knowledgeCut(cut.index, goldEvents));
        const observation = records.get(
          resultKey({
            caseId: testCase.id,
            arm: "structured-extraction",
            repeat,
            cut: cut.index,
          }),
        );
        if (!observation?.result) continue;

        const request = requests.get(observation.result.requestId);
        if (
          !canonicalEqual(
            request.input.evidence,
            visibleEvidence(testCase, cut.index),
          )
        ) {
          throw new Error(
            `${testCase.id} repeat ${repeat} cut ${cut.index}: structured extraction did not receive the complete visible record`,
          );
        }

        const proposed = observation.result.proposedEvents ?? [];
        const candidateEvents = [...testCase.setupEvents, ...proposed];
        const candidateKnowledgeCuts = inferStructuredKnowledgeCuts(
          testCase,
          cut.index,
          proposed,
        );
        observation.assertions = multisetComparison(
          normalizeAssertionDelta(testCase.setupEvents, proposed),
          normalizeAssertionDelta(
            testCase.setupEvents,
            goldEvents.slice(testCase.setupEvents.length),
          ),
        );
        observation.queryExact =
          observation.result.proposedQuery !== null &&
          canonicalEqual(
            normalizeQuery(
              observation.result.proposedQuery,
              candidateKnowledgeCuts,
            ),
            normalizeQuery(cut.goldQuery, goldKnowledgeCuts),
          );

        const label = `${testCase.id} repeat ${repeat} cut ${cut.index}`;
        const predictedRun = reproduceTimelineResult(
          observation.result,
          testCase,
          cut,
          candidateEvents,
          [],
          label,
        );
        const goldRun = parseRunDocumentV0Alpha3({
          schema: "covenant.timeline.run.v0alpha3",
          contract: testCase.contract,
          events: goldEvents,
        });
        observation.stateSemanticExact =
          observation.result.admitted === true &&
          canonicalEqual(
            projectedStateSignature(predictedRun, testCase.setupEvents),
            projectedStateSignature(goldRun, testCase.setupEvents),
          );
        observation.endToEndExact =
          observation.answerExact &&
          observation.result.admitted === true &&
          observation.result.proofVerified === true &&
          observation.queryExact &&
          observation.stateSemanticExact;
      }
    }
  }
}

function inferStructuredKnowledgeCuts(testCase, currentCut, events) {
  const evidenceCut = new Map(
    testCase.evidence.map((evidence) => [evidence.digest, evidence.cut]),
  );
  let eventIndex = 0;
  let recordedThrough =
    testCase.setupEvents.length === 0 ? null : testCase.setupEvents.length - 1;
  return testCase.cuts.slice(0, currentCut + 1).map((cut) => {
    while (eventIndex < events.length) {
      const event = events[eventIndex];
      const references =
        event.type === "assertion.retracted"
          ? event.evidenceRefs
          : event.assertion.evidenceRefs;
      const eventCut = Math.max(
        ...references.map(
          (reference) => evidenceCut.get(reference) ?? Infinity,
        ),
      );
      if (eventCut > cut.index) break;
      recordedThrough = event.sequence;
      eventIndex += 1;
    }
    return { cut: cut.index, recordedThrough };
  });
}

function reproduceTimelineResult(
  result,
  testCase,
  cut,
  candidateEvents,
  candidateCuts,
  label,
) {
  if (result.proposedEvents === null) {
    if (
      result.status !== "error" ||
      result.admitted !== false ||
      result.stateBytes !== null
    ) {
      throw new Error(`${label}: missing Timeline response has derived state`);
    }
    return null;
  }

  const deltaError = validateStoredDelta(result, testCase, label);
  if (deltaError !== null) {
    assertTimelineFailure(result, "admission", deltaError.code, label, {
      admitted: false,
      stateBytes: null,
      answer: null,
      conclusion: null,
      proofVerified: null,
    });
    return null;
  }

  let run;
  try {
    run = parseRunDocumentV0Alpha3({
      schema: "covenant.timeline.run.v0alpha3",
      contract: testCase.contract,
      events: candidateEvents,
    });
  } catch {
    assertTimelineFailure(result, "admission", "run.rejected", label, {
      admitted: false,
      stateBytes: null,
      answer: null,
      conclusion: null,
      proofVerified: null,
    });
    return null;
  }

  const stateBytes = continuityStateBytes(
    run,
    candidateCuts,
    testCase.setupEvents.length,
  );
  if (result.stateBytes !== stateBytes) {
    throw new Error(`${label}: stateBytes does not match candidate state`);
  }
  if (stateBytes > result.stateBudgetBytes) {
    assertTimelineFailure(result, "admission", "state.over-budget", label, {
      admitted: false,
      stateBytes,
      answer: null,
      conclusion: null,
      proofVerified: null,
    });
    return run;
  }
  if (result.admitted !== true) {
    throw new Error(`${label}: admissible Timeline state was not admitted`);
  }

  let query;
  try {
    query = parseQueryV0Alpha3(result.proposedQuery, run);
  } catch {
    assertTimelineFailure(result, "query", "query.rejected", label, {
      admitted: true,
      stateBytes,
      answer: null,
      conclusion: null,
      proofVerified: null,
    });
    return run;
  }

  let conclusion;
  try {
    conclusion = reasonTemporalQueryV0Alpha3(run, query);
  } catch {
    assertTimelineFailure(result, "reasoning", "reasoning.failed", label, {
      admitted: true,
      stateBytes,
      answer: null,
      conclusion: null,
      proofVerified: null,
    });
    return run;
  }

  const proofVerified = verifyTemporalConclusionV0Alpha3(
    run,
    query,
    conclusion,
  );
  if (!proofVerified) {
    assertTimelineFailure(result, "reasoning", "proof.rejected", label, {
      admitted: true,
      stateBytes,
      answer: conclusion.result,
      conclusion,
      proofVerified: false,
    });
    return run;
  }
  if (
    result.status !== "ok" ||
    result.error !== null ||
    result.proofVerified !== true ||
    !canonicalEqual(result.answer, conclusion.result) ||
    !canonicalEqual(result.conclusion, conclusion)
  ) {
    throw new Error(`${label}: successful Timeline result does not reproduce`);
  }
  return run;
}

function assertTimelineFailure(result, stage, code, label, expectedDerived) {
  if (
    result.status !== "error" ||
    result.error?.stage !== stage ||
    result.error.code !== code
  ) {
    throw new Error(`${label}: Timeline failure classification does not match`);
  }
  for (const [field, expected] of Object.entries(expectedDerived)) {
    if (!canonicalEqual(result[field], expected)) {
      throw new Error(`${label}: ${field} does not match Timeline failure`);
    }
  }
}

function validateNarrativeContinuity(observations, cases, repeats, requests) {
  const narrative = new Map(
    observations
      .filter((entry) => entry.arm === "narrative-memory")
      .map((entry) => [
        resultKey({
          caseId: entry.testCase.id,
          arm: "narrative-memory",
          repeat: entry.repeat,
          cut: entry.cut.index,
        }),
        entry,
      ]),
  );

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const testCase of cases) {
      let memory = "";
      let missingEarlierCut = false;
      for (const cut of testCase.cuts) {
        const observation = narrative.get(
          resultKey({
            caseId: testCase.id,
            arm: "narrative-memory",
            repeat,
            cut: cut.index,
          }),
        );
        if (!observation.result) {
          missingEarlierCut = true;
          continue;
        }
        if (missingEarlierCut) {
          throw new Error(
            `${testCase.id} repeat ${repeat}: narrative results contain a gap`,
          );
        }
        const request = requests.get(observation.result.requestId);
        if (request.input.memory !== memory) {
          throw new Error(
            `${testCase.id} repeat ${repeat} cut ${cut.index}: narrative request continuity does not match prior results`,
          );
        }
        if (observation.result.status === "ok") {
          memory = observation.result.memory;
        }
      }
    }
  }
}

function knowledgeCut(cut, events) {
  return {
    cut,
    recordedThrough: events.length === 0 ? null : events.length - 1,
  };
}

export function projectedStateSignature(run, setupEvents) {
  const recordedThrough =
    run.events.length === 0 ? null : run.events.length - 1;
  const points = setupEvents
    .filter((event) => event.type === "point.declared")
    .map((event) => event.point);
  const intervals = setupEvents
    .filter((event) => event.type === "interval.declared")
    .map((event) => event.interval);
  const queries = [];
  const activeAssertions = [];
  let queryNumber = 0;
  const addQuery = (query) => {
    queryNumber += 1;
    queries.push({
      schema: "covenant.timeline.query.v0alpha3",
      id: `projection-${queryNumber}`,
      recordedThrough,
      ...query,
    });
  };

  for (const { id: contextId } of run.contract.contexts) {
    addQuery({ contextId, type: "context.consistency" });
    activeAssertions.push(
      ...normalizeProjectedAssertions(
        projectTemporalStateV0Alpha3(run, contextId, recordedThrough),
      ),
    );
  }
  for (const group of groupBy(
    points,
    (point) => `${point.contextId}|${point.axisId}`,
  ).values()) {
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        addQuery({
          contextId: group[left].contextId,
          type: "difference.bounds",
          fromPointId: group[left].id,
          toPointId: group[right].id,
        });
        addQuery({
          contextId: group[left].contextId,
          type: "point.relations",
          leftPointId: group[left].id,
          rightPointId: group[right].id,
        });
      }
    }
  }
  for (const group of groupBy(
    intervals,
    (interval) => interval.contextId,
  ).values()) {
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        addQuery({
          contextId: group[left].contextId,
          type: "interval.relations",
          leftIntervalId: group[left].id,
          rightIntervalId: group[right].id,
        });
      }
    }
  }

  return {
    activeAssertions: activeAssertions.sort(compareCanonical),
    consequences: queries.map((query) => {
      const parsed = parseQueryV0Alpha3(query, run);
      return reasonTemporalQueryV0Alpha3(run, parsed).result;
    }),
  };
}

function normalizeProjectedAssertions(projection) {
  const normalized = [];
  for (const assertion of projection.coordinates) {
    const common = {
      contextId: assertion.contextId,
      pointId: assertion.pointId,
      evidenceRefs: [...assertion.evidenceRefs].sort(),
    };
    if (assertion.coordinate.minimum !== undefined) {
      normalized.push({
        type: "coordinate.minimum",
        ...common,
        value: assertion.coordinate.minimum,
      });
    }
    if (assertion.coordinate.maximum !== undefined) {
      normalized.push({
        type: "coordinate.maximum",
        ...common,
        value: assertion.coordinate.maximum,
      });
    }
  }
  for (const assertion of projection.constraints) {
    const common = {
      contextId: assertion.contextId,
      fromPointId: assertion.constraint.fromPointId,
      toPointId: assertion.constraint.toPointId,
      evidenceRefs: [...assertion.evidenceRefs].sort(),
    };
    if (assertion.constraint.minimum !== undefined) {
      normalized.push({
        type: "constraint.minimum",
        ...common,
        value: assertion.constraint.minimum,
      });
    }
    if (assertion.constraint.maximum !== undefined) {
      normalized.push({
        type: "constraint.maximum",
        ...common,
        value: assertion.constraint.maximum,
      });
    }
  }
  for (const assertion of projection.facts) {
    normalized.push({
      type: "fact",
      contextId: assertion.contextId,
      propositionRef: assertion.propositionRef,
      ...(assertion.validDuring ? { validDuring: assertion.validDuring } : {}),
      ...(assertion.observedAt ? { observedAt: assertion.observedAt } : {}),
      ...(assertion.assertedAt ? { assertedAt: assertion.assertedAt } : {}),
      evidenceRefs: [...assertion.evidenceRefs].sort(),
    });
  }
  return normalized;
}

function compareCanonical(left, right) {
  return canonicalJson(left).localeCompare(canonicalJson(right), "en");
}

function groupBy(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function metricsFor(observations, arm, historyObservations = observations) {
  const answerExact = observations.filter((entry) => entry.answerExact).length;
  const unsupported = observations.filter((entry) =>
    entry.cut.traits.includes("unsupported-definite-risk"),
  );
  const contradictions = observations.filter((entry) =>
    entry.cut.traits.includes("contradiction"),
  );
  const corrections = observations.filter((entry) =>
    entry.cut.traits.includes("correction"),
  );
  const historical = observations.filter((entry) =>
    entry.cut.traits.includes("historical"),
  );
  const predictedContradictions = contradictions.filter(
    (entry) =>
      entry.result?.status === "ok" &&
      entry.result.answer?.status === "inconsistent",
  );
  const actualContradictions = contradictions.filter(
    (entry) => entry.cut.expectedResult.status === "inconsistent",
  );
  const trueContradictions = predictedContradictions.filter(
    (entry) =>
      entry.cut.expectedResult.status === "inconsistent" &&
      entry.result.answer.type === entry.cut.expectedResult.type,
  );
  const consistencyEligible = observations.filter(
    (entry) => entry.cut.expectedResult.status !== "inconsistent",
  );
  const metrics = {
    answerExactRate: rate(answerExact, observations.length),
    unsupportedDefiniteRate: rate(
      unsupported.filter((entry) => isUnsupportedDefinite(entry)).length,
      unsupported.length,
    ),
    contradictionPrecision: rate(
      trueContradictions.length,
      predictedContradictions.length,
    ),
    contradictionRecall: rate(
      trueContradictions.length,
      actualContradictions.length,
    ),
    falseInconsistencyRate: rate(
      consistencyEligible.filter(
        (entry) =>
          entry.result?.status === "ok" &&
          entry.result.answer?.status === "inconsistent",
      ).length,
      consistencyEligible.length,
    ),
    correctionAccuracy: rate(
      corrections.filter((entry) => entry.exact).length,
      corrections.length,
    ),
    historicalReconstructionAccuracy: rate(
      historical.filter(
        (entry) => entry.exact && matchesInitialCut(entry, historyObservations),
      ).length,
      historical.length,
    ),
    latencyMs: distribution(
      observations
        .map((entry) => entry.result?.latencyMs)
        .filter((value) => value !== undefined),
    ),
    inputTokens: totals(
      observations
        .map((entry) => entry.result?.usage?.inputTokens)
        .filter((value) => typeof value === "number"),
    ),
    outputTokens: totals(
      observations
        .map((entry) => entry.result?.usage?.outputTokens)
        .filter((value) => typeof value === "number"),
    ),
    costUsd: totals(
      observations
        .map((entry) => entry.result?.usage?.costUsd)
        .filter((value) => typeof value === "number"),
    ),
  };

  if (arm === "structured-extraction" || arm === "timeline") {
    const assertionCounts = observations.reduce(
      (total, entry) => ({
        truePositive:
          total.truePositive + (entry.assertions?.truePositive ?? 0),
        predicted: total.predicted + (entry.assertions?.predicted ?? 0),
        expected: total.expected + (entry.assertions?.expected ?? 0),
      }),
      { truePositive: 0, predicted: 0, expected: 0 },
    );
    const precision = rate(
      assertionCounts.truePositive,
      assertionCounts.predicted,
    );
    const recall = rate(assertionCounts.truePositive, assertionCounts.expected);
    metrics.admissionRate = rate(
      observations.filter((entry) => entry.result?.admitted === true).length,
      observations.length,
    );
    metrics.representationExactAssertionPrecision = precision;
    metrics.representationExactAssertionRecall = recall;
    metrics.representationExactAssertionF1 = f1(precision.value, recall.value);
    metrics.projectedStateExactRate = rate(
      observations.filter((entry) => entry.stateSemanticExact).length,
      observations.length,
    );
    metrics.endToEndExactRate = rate(
      observations.filter((entry) => entry.endToEndExact).length,
      observations.length,
    );
    metrics.queryExactRate = rate(
      observations.filter((entry) => entry.queryExact).length,
      observations.length,
    );
    metrics.proofVerificationRate = rate(
      observations.filter((entry) => entry.result?.proofVerified === true)
        .length,
      observations.length,
    );
  }
  return metrics;
}

function isUnsupportedDefinite(observation) {
  if (observation.result?.status !== "ok" || !observation.result.answer) {
    return false;
  }
  const expected = observation.cut.expectedResult;
  const actual = observation.result.answer;
  if (expected.type !== actual.type) return false;

  if (expected.type === "difference.bounds") {
    return (
      (expected.minimum === null && actual.minimum !== null) ||
      (expected.maximum === null && actual.maximum !== null)
    );
  }
  if (
    expected.type === "point.relations" ||
    expected.type === "interval.relations"
  ) {
    if (expected.status !== "indeterminate") return false;
    if (actual.status === "resolved") return true;
    if (actual.status !== "indeterminate") return false;
    return expected.possible.some(
      (relation) => !actual.possible.includes(relation),
    );
  }
  return false;
}

function matchesInitialCut(observation, observations) {
  const initial = observations.find(
    (candidate) =>
      candidate.arm === observation.arm &&
      candidate.repeat === observation.repeat &&
      candidate.testCase.id === observation.testCase.id &&
      candidate.cut.index === 0,
  );
  return (
    initial?.result?.status === "ok" &&
    canonicalEqual(observation.result?.answer, initial.result.answer)
  );
}

function pairedMetrics(observations) {
  const arms = new Set(observations.map(({ arm }) => arm));
  return {
    timelineVsNarrativeMemory:
      arms.has("timeline") && arms.has("narrative-memory")
        ? compareArms(observations, "timeline", "narrative-memory")
        : null,
    timelineVsStructuredExtraction:
      arms.has("timeline") && arms.has("structured-extraction")
        ? compareArms(observations, "timeline", "structured-extraction")
        : null,
    timelineVsDirect:
      arms.has("timeline") && arms.has("direct")
        ? compareArms(observations, "timeline", "direct")
        : null,
  };
}

function compareArms(observations, candidateArm, baselineArm) {
  const selected = new Map(
    observations.map((entry) => [
      `${entry.testCase.id}|${entry.repeat}|${entry.cut.index}|${entry.arm}`,
      entry,
    ]),
  );
  let win = 0;
  let loss = 0;
  let bothCorrect = 0;
  let bothIncorrect = 0;
  const clusterDeltas = new Map();

  for (const entry of observations.filter(
    (item) => item.arm === candidateArm,
  )) {
    const baseline = selected.get(
      `${entry.testCase.id}|${entry.repeat}|${entry.cut.index}|${baselineArm}`,
    );
    if (entry.answerExact && !baseline.answerExact) win += 1;
    else if (!entry.answerExact && baseline.answerExact) loss += 1;
    else if (entry.answerExact) bothCorrect += 1;
    else bothIncorrect += 1;
    const deltas = clusterDeltas.get(entry.testCase.id) ?? [];
    deltas.push(Number(entry.answerExact) - Number(baseline.answerExact));
    clusterDeltas.set(entry.testCase.id, deltas);
  }
  const total = win + loss + bothCorrect + bothIncorrect;
  const caseMeans = [...clusterDeltas.values()].map(
    (values) => values.reduce((sum, value) => sum + value, 0) / values.length,
  );
  return {
    win,
    loss,
    tie: bothCorrect + bothIncorrect,
    bothCorrect,
    bothIncorrect,
    answerExactDifference: total === 0 ? null : (win - loss) / total,
    caseClusterCount: caseMeans.length,
    caseClusterSignFlipP: exactSignFlipP(caseMeans),
  };
}

export function exactSignFlipP(values) {
  if (values.length === 0) return null;
  if (values.length > 20) {
    throw new Error("exact sign-flip comparison supports at most 20 clusters");
  }
  const observed =
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const permutations = 2 ** values.length;
  let atLeastObserved = 0;
  for (let mask = 0; mask < permutations; mask += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += (mask & (2 ** index) ? 1 : -1) * values[index];
    }
    if (total / values.length >= observed - 1e-12) {
      atLeastObserved += 1;
    }
  }
  return atLeastObserved / permutations;
}

function normalizeAssertionDelta(priorEvents, delta) {
  const references = new Map();
  for (const event of priorEvents) registerAssertion(event, references);

  const tuples = [];
  for (const event of delta) {
    const tuple = normalizeAssertion(event, references);
    if (tuple !== null) tuples.push(canonicalJson(tuple));
    registerAssertion(event, references);
  }
  return tuples;
}

function normalizeAssertion(event, references) {
  if (event.type === "assertion.retracted") {
    return {
      type: event.type,
      assertion: resolveAssertion(event.assertionId, references),
      evidenceRefs: [...event.evidenceRefs].sort(),
    };
  }
  if (!event.assertion) return null;
  const { id: _id, supersedes, evidenceRefs, ...semantic } = event.assertion;
  return {
    type: event.type,
    assertion: {
      ...semantic,
      evidenceRefs: [...evidenceRefs].sort(),
      ...(supersedes
        ? {
            supersedes: supersedes
              .map((id) => resolveAssertion(id, references))
              .sort(),
          }
        : {}),
    },
  };
}

function registerAssertion(event, references) {
  if (!event.assertion?.id) return;
  const {
    id,
    supersedes: _supersedes,
    evidenceRefs,
    ...semantic
  } = event.assertion;
  references.set(
    id,
    contentDigest({
      type: event.type,
      assertion: {
        ...semantic,
        evidenceRefs: [...evidenceRefs].sort(),
      },
    }),
  );
}

function resolveAssertion(id, references) {
  return references.get(id) ?? `unresolved:${id}`;
}

function normalizeQuery(query, knowledgeCuts) {
  const { id: _id, recordedThrough, ...semantic } = query;
  const matchingCuts = knowledgeCuts
    .filter((entry) => entry.recordedThrough === recordedThrough)
    .map((entry) => entry.cut);
  return {
    ...semantic,
    knowledgeCut:
      matchingCuts.length === 0
        ? { status: "unmapped", recordedThrough }
        : { status: "mapped", cuts: matchingCuts },
  };
}

function multisetComparison(predictedValues, expectedValues) {
  const predicted = frequencies(predictedValues);
  const expected = frequencies(expectedValues);
  let truePositive = 0;
  for (const [value, count] of predicted) {
    truePositive += Math.min(count, expected.get(value) ?? 0);
  }
  return {
    truePositive,
    predicted: predictedValues.length,
    expected: expectedValues.length,
  };
}

function frequencies(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
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
  if (values.length === 0) return { count: 0, total: null, mean: null };
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
  for (const result of results) {
    if (!result.error) continue;
    stages[result.error.stage] = (stages[result.error.stage] ?? 0) + 1;
    codes[result.error.code] = (codes[result.error.code] ?? 0) + 1;
  }
  return { stages: sortObject(stages), codes: sortObject(codes) };
}

function sortObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
}

function resultKey({ caseId, arm, repeat, cut }) {
  return `${caseId}|${arm}|${repeat}|${cut}`;
}

function requireNull(result, fields, label) {
  for (const field of fields) {
    if (result[field] !== null) {
      throw new Error(`${label}: ${field} must be null for ${result.arm}`);
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
  const score = await scoreModelInterfaceEval(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${canonicalJson(score)}\n`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  contentDigest,
} from "../packages/prototype/dist/index.js";
import {
  assertValid,
  canonicalEqual,
  createModelEvalValidators,
  digestFile,
} from "./model-interface-eval.mjs";
import {
  readSourceState,
  runtimeStateDigest,
} from "./run-model-interface-eval.mjs";
import { scoreModelInterfaceEvalArtifacts } from "./score-model-interface-eval.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const heldoutCasesPath = join(
  root,
  "benchmarks/model-interface/v1/heldout-cases.jsonl",
);
const primaryArms = ["narrative-memory", "structured-extraction", "timeline"];
const officialAdapter = join(
  root,
  "scripts/openai-responses-model-eval-adapter.mjs",
);
const frozenCorpusDigest =
  "sha256:efda86ec8f737da4f5d9108233105034ce7360c45123a2accc73f7a5c354d7ef";
const frozenPromptDigests = {
  direct:
    "sha256:ee101bc5d19f5c36e3b7462835a71238dc01e087105026a631e5c136fe89dafc",
  "narrative-memory":
    "sha256:8a7a1688c32e1cf80b82fc1fe52a1355941315fe5b790e1ac6a9ea1cc8744508",
  "structured-extraction":
    "sha256:253c4f12fca5dfd50f50185393625892efa4f517c7d8b4b13a0d3d0e9ccab1e7",
  timeline:
    "sha256:cf9de9bef2c8e71b3ee27e17fea938df7cb5d7e20aa017fb30de13e0ed7864ce",
};
const operationalCode =
  /^(?:provider\.transport|provider\.http-(?:429|5[0-9]{2}))$/u;

export async function evaluateModelInterfaceGate({
  results: resultsPath,
  teacherResults: teacherResultsPath,
  cases: casesPath = heldoutCasesPath,
}) {
  if (
    typeof teacherResultsPath !== "string" ||
    teacherResultsPath.length === 0
  ) {
    throw new Error("--teacher-results is required");
  }
  const [
    primaryArtifact,
    teacherArtifact,
    currentSource,
    expectedRuntimeDigest,
  ] = await Promise.all([
    scoreModelInterfaceEvalArtifacts({
      results: resultsPath,
      cases: casesPath,
    }),
    scoreModelInterfaceEvalArtifacts({
      results: teacherResultsPath,
      cases: casesPath,
    }),
    readSourceState(),
    runtimeStateDigest([process.execPath, officialAdapter]),
  ]);
  const { score, results, cases } = primaryArtifact;
  const { score: teacherScore, results: teacherResults } = teacherArtifact;
  assertFrozenPrimary(score, cases, currentSource, expectedRuntimeDigest);
  assertFrozenTeacher(
    teacherScore,
    score,
    cases,
    currentSource,
    expectedRuntimeDigest,
  );

  const gate = await createGate({
    score,
    teacherScore,
    results,
    teacherResults,
  });
  await assertStableInputs({
    cases: casesPath,
    corpusDigest: score.corpusDigest,
    results: resultsPath,
    resultsDigest: score.resultsDigest,
    teacherResults: teacherResultsPath,
    teacherResultsDigest: teacherScore.resultsDigest,
    source: currentSource,
    runtimeDigest: expectedRuntimeDigest,
  });
  return gate;
}

export async function createGate({
  score,
  teacherScore,
  results,
  teacherResults,
}) {
  const timelineResults = results.filter(({ arm }) => arm === "timeline");
  const operationalErrorCodes = [
    ...new Set(
      [...results, ...teacherResults]
        .map(({ error }) => error?.code)
        .filter(
          (code) => typeof code === "string" && operationalCode.test(code),
        ),
    ),
  ].sort();
  const checks = [];
  const add = (id, actual, requirement, passed) => {
    checks.push({ id, actual, requirement, passed });
  };
  const timeline = score.arms.timeline;

  add(
    "coverage.complete",
    score.coverage.observed,
    "324 of 324 observations",
    score.coverage.complete &&
      score.coverage.expected === 324 &&
      score.coverage.observed === 324,
  );
  add(
    "timeline.response-schema-valid",
    timelineResults.filter(
      ({ error }) => error?.stage !== "adapter" && error?.stage !== "protocol",
    ).length,
    "at least 106 of 108",
    timelineResults.filter(
      ({ error }) => error?.stage !== "adapter" && error?.stage !== "protocol",
    ).length >= 106,
  );
  addRateCheck(checks, "timeline.admission", timeline.admissionRate, 106, 108);
  addRateCheck(
    checks,
    "timeline.query-exact",
    timeline.queryExactRate,
    106,
    108,
  );
  addRateCheck(
    checks,
    "timeline.proof-verified",
    timeline.proofVerificationRate,
    106,
    108,
  );
  addValueCheck(
    checks,
    "timeline.assertion-precision",
    timeline.representationExactAssertionPrecision.value,
    0.95,
  );
  addValueCheck(
    checks,
    "timeline.assertion-recall",
    timeline.representationExactAssertionRecall.value,
    0.9,
  );
  addValueCheck(
    checks,
    "timeline.assertion-f1",
    timeline.representationExactAssertionF1,
    0.92,
  );
  addRateCheck(
    checks,
    "timeline.projected-state-exact",
    timeline.projectedStateExactRate,
    98,
    108,
  );
  addRateCheck(
    checks,
    "timeline.answer-exact",
    timeline.answerExactRate,
    98,
    108,
  );
  addRateCheck(
    checks,
    "timeline.end-to-end-exact",
    timeline.endToEndExactRate,
    92,
    108,
  );
  add(
    "timeline.unsupported-definite",
    timeline.unsupportedDefiniteRate.numerator,
    "exactly 0",
    timeline.unsupportedDefiniteRate.numerator === 0,
  );

  addComparisonChecks(
    checks,
    "narrative-memory",
    score.paired.timelineVsNarrativeMemory,
  );
  addComparisonChecks(
    checks,
    "structured-extraction",
    score.paired.timelineVsStructuredExtraction,
  );

  for (const repeat of score.repeatMetrics) {
    const metrics = repeat.arms.timeline;
    const prefix = `repeat-${repeat.repeat}`;
    addValueCheck(
      checks,
      `${prefix}.assertion-precision`,
      metrics.representationExactAssertionPrecision.value,
      0.9,
    );
    addValueCheck(
      checks,
      `${prefix}.assertion-recall`,
      metrics.representationExactAssertionRecall.value,
      0.85,
    );
    addValueCheck(
      checks,
      `${prefix}.assertion-f1`,
      metrics.representationExactAssertionF1,
      0.875,
    );
    addRateCheck(
      checks,
      `${prefix}.answer-exact`,
      metrics.answerExactRate,
      31,
      36,
    );
    addRateCheck(
      checks,
      `${prefix}.end-to-end-exact`,
      metrics.endToEndExactRate,
      29,
      36,
    );
    addNonNegativeComparison(
      checks,
      `${prefix}.vs-narrative-memory`,
      repeat.paired.timelineVsNarrativeMemory,
    );
    addNonNegativeComparison(
      checks,
      `${prefix}.vs-structured-extraction`,
      repeat.paired.timelineVsStructuredExtraction,
    );
  }

  const failedChecks = checks
    .filter(({ passed }) => !passed)
    .map(({ id }) => id);
  const operationalValid = operationalErrorCodes.length === 0;
  const gate = {
    schema: "covenant.timeline.model-eval.gate.v1",
    benchmark: "model-interface-v1",
    decision: !operationalValid
      ? "inconclusive"
      : failedChecks.length === 0
        ? "continue"
        : "kill",
    operationalValid,
    operationalErrorCodes,
    run: score.run,
    resultsDigest: score.resultsDigest,
    corpusDigest: score.corpusDigest,
    scoreDigest: contentDigest(score),
    teacherDiagnostic: {
      attemptId: teacherScore.run.attemptId,
      startedAt: teacherScore.run.startedAt,
      resultsDigest: teacherScore.resultsDigest,
      scoreDigest: contentDigest(teacherScore),
      observations: teacherScore.coverage.observed,
      priorCutObservations:
        teacherScore.teacherForcedPriorCuts.endToEndExactRate.denominator,
      assertionF1:
        teacherScore.teacherForcedPriorCuts.representationExactAssertionF1,
      answerExactRate:
        teacherScore.teacherForcedPriorCuts.answerExactRate.value,
      endToEndExactRate:
        teacherScore.teacherForcedPriorCuts.endToEndExactRate.value,
    },
    checks,
    failedChecks,
  };
  const validators = await createModelEvalValidators();
  assertValid(validators.gate, gate, "frontier-model gate");
  return gate;
}

async function assertStableInputs({
  cases,
  corpusDigest,
  results,
  resultsDigest,
  teacherResults,
  teacherResultsDigest,
  source,
  runtimeDigest,
}) {
  const [
    finalCorpusDigest,
    finalResultsDigest,
    finalTeacherResultsDigest,
    finalSource,
    finalRuntimeDigest,
  ] = await Promise.all([
    digestFile(cases),
    digestFile(results),
    digestFile(teacherResults),
    readSourceState(),
    runtimeStateDigest([process.execPath, officialAdapter]),
  ]);
  if (
    finalCorpusDigest !== corpusDigest ||
    finalResultsDigest !== resultsDigest ||
    finalTeacherResultsDigest !== teacherResultsDigest ||
    finalSource.revision !== source.revision ||
    finalSource.status !== source.status ||
    finalSource.stateDigest !== source.stateDigest ||
    finalRuntimeDigest !== runtimeDigest
  ) {
    throw new Error("gate inputs changed while the decision was computed");
  }
}

export function assertFrozenPrimary(
  score,
  cases,
  currentSource,
  expectedRuntimeDigest,
) {
  const { config, selection, sourceDirty } = score.run;
  if (score.diagnosticOnly || selection.priorStateMode !== "rolling") {
    throw new Error("the primary gate accepts only rolling artifacts");
  }
  if (sourceDirty !== false) {
    throw new Error("the primary gate requires a clean source revision");
  }
  assertSourceAndRuntime(score, currentSource, expectedRuntimeDigest);
  if (
    score.corpusDigest !== frozenCorpusDigest ||
    !canonicalEqual(score.run.promptDigests, frozenPromptDigests) ||
    !canonicalEqual(
      selection.cases,
      cases.map(({ id }) => id),
    )
  ) {
    throw new Error("the primary gate requires the frozen held-out corpus");
  }
  if (
    selection.repeats !== 3 ||
    selection.timeoutMs !== 120_000 ||
    !canonicalEqual([...selection.arms].sort(), [...primaryArms].sort())
  ) {
    throw new Error("the run selection does not match the preregistration");
  }
  if (
    config.adapter.id !== "openai-responses" ||
    config.adapter.version !== "1" ||
    config.model.provider !== "openai" ||
    config.model.id !== "gpt-5.6-sol" ||
    config.model.revision !== "gpt-5.6-sol" ||
    config.generation.temperature !== null ||
    config.generation.seed !== null ||
    config.generation.maxOutputTokens !== 16_384 ||
    !canonicalEqual(config.generation.parameters, {
      reasoningEffort: "high",
      structuredOutput: true,
      verbosity: "low",
    })
  ) {
    throw new Error(
      "the model configuration does not match the preregistration",
    );
  }
}

export function assertFrozenTeacher(
  teacherScore,
  primaryScore,
  cases,
  currentSource,
  expectedRuntimeDigest,
) {
  const { selection } = teacherScore.run;
  if (
    !teacherScore.diagnosticOnly ||
    selection.priorStateMode !== "teacher-forced" ||
    selection.repeats !== 3 ||
    selection.timeoutMs !== 120_000 ||
    !canonicalEqual(selection.arms, ["timeline"]) ||
    !canonicalEqual(
      selection.cases,
      cases.map(({ id }) => id),
    )
  ) {
    throw new Error(
      "the teacher diagnostic does not match the preregistration",
    );
  }
  if (
    teacherScore.corpusDigest !== frozenCorpusDigest ||
    !canonicalEqual(teacherScore.run.promptDigests, frozenPromptDigests) ||
    !canonicalEqual(teacherScore.run.config, primaryScore.run.config) ||
    teacherScore.run.configDigest !== primaryScore.run.configDigest ||
    teacherScore.run.sourceRevision !== primaryScore.run.sourceRevision ||
    teacherScore.run.sourceStateDigest !== primaryScore.run.sourceStateDigest ||
    teacherScore.run.attemptId === primaryScore.run.attemptId
  ) {
    throw new Error(
      "the teacher diagnostic is not bound to the primary configuration",
    );
  }
  assertSourceAndRuntime(teacherScore, currentSource, expectedRuntimeDigest);
  if (
    !teacherScore.coverage.complete ||
    teacherScore.coverage.expected !== 108 ||
    teacherScore.coverage.observed !== 108 ||
    teacherScore.teacherForcedPriorCuts === null ||
    teacherScore.teacherForcedPriorCuts.endToEndExactRate.denominator !== 72 ||
    teacherScore.teacherForcedPriorCuts.representationExactAssertionRecall
      .denominator !== 72
  ) {
    throw new Error("the teacher diagnostic is incomplete");
  }
}

function assertSourceAndRuntime(score, currentSource, expectedRuntimeDigest) {
  if (
    currentSource.dirty !== false ||
    score.run.sourceRevision !== currentSource.revision ||
    score.run.sourceStateDigest !== currentSource.stateDigest
  ) {
    throw new Error(
      "the gate checkout does not match the benchmark source revision",
    );
  }
  if (score.run.runtimeDigest !== expectedRuntimeDigest) {
    throw new Error(
      "the benchmark did not use the frozen OpenAI adapter runtime",
    );
  }
}

function addRateCheck(checks, id, rate, numerator, denominator) {
  checks.push({
    id,
    actual: rate.numerator,
    requirement: `at least ${numerator} of ${denominator}`,
    passed: rate.denominator === denominator && rate.numerator >= numerator,
  });
}

function addValueCheck(checks, id, actual, minimum) {
  checks.push({
    id,
    actual,
    requirement: `at least ${minimum}`,
    passed: typeof actual === "number" && actual >= minimum,
  });
}

function addComparisonChecks(checks, baseline, comparison) {
  checks.push({
    id: `timeline.vs-${baseline}.difference`,
    actual: comparison?.answerExactDifference ?? null,
    requirement: "at least 0.10 across 108 paired observations",
    passed:
      comparison?.win + comparison?.loss + comparison?.tie === 108 &&
      comparison.answerExactDifference >= 0.1,
  });
  checks.push({
    id: `timeline.vs-${baseline}.case-cluster-p`,
    actual: comparison?.caseClusterSignFlipP ?? null,
    requirement: "at most 0.05 across exactly 12 case clusters",
    passed:
      comparison?.caseClusterCount === 12 &&
      comparison.caseClusterSignFlipP <= 0.05,
  });
}

function addNonNegativeComparison(checks, id, comparison) {
  checks.push({
    id,
    actual: comparison?.answerExactDifference ?? null,
    requirement: "at least 0",
    passed:
      typeof comparison?.answerExactDifference === "number" &&
      comparison.answerExactDifference >= 0,
  });
}

function parseArguments(argv) {
  const options = {
    cases: heldoutCasesPath,
    results: null,
    teacherResults: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${flag} requires a value`);
    index += 1;
    if (flag === "--cases") options.cases = value;
    else if (flag === "--results") options.results = value;
    else if (flag === "--teacher-results") options.teacherResults = value;
    else throw new Error(`unknown option ${flag}`);
  }
  if (!options.results) throw new Error("--results is required");
  if (!options.teacherResults) throw new Error("--teacher-results is required");
  return options;
}

async function main() {
  const gate = await evaluateModelInterfaceGate(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${canonicalJson(gate)}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

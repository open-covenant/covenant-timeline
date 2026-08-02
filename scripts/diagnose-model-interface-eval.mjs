#!/usr/bin/env node

import {
  canonicalJson,
  parseRunDocumentV0Alpha3,
} from "../packages/prototype/dist/index.js";
import {
  BENCHMARK,
  DIAGNOSTICS_SCHEMA,
  assertValid,
  canonicalEqual,
  createModelEvalValidators,
  digestFile,
  loadBenchmarkCases,
  readJsonLines,
} from "./model-interface-eval.mjs";
import { isMain } from "./mcp-agent-pilot-lib.mjs";
import {
  projectedStateSignature,
  scoreModelInterfaceEval,
} from "./score-model-interface-eval.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const defaultCasesPath = "benchmarks/model-interface/v1/cases.jsonl";

export async function diagnoseModelInterfaceEval({
  results: resultsPath,
  cases: casesPath = defaultCasesPath,
}) {
  const [initialCorpusDigest, initialResultsDigest] = await Promise.all([
    digestFile(casesPath),
    digestFile(resultsPath),
  ]);
  const score = await scoreModelInterfaceEval({
    results: resultsPath,
    cases: casesPath,
  });
  if (
    score.corpusDigest !== initialCorpusDigest ||
    score.resultsDigest !== initialResultsDigest
  ) {
    throw new Error("benchmark inputs changed while diagnostics were computed");
  }
  const validators = await createModelEvalValidators();
  const [cases, results] = await Promise.all([
    loadBenchmarkCases(casesPath, validators),
    readJsonLines(resultsPath),
  ]);
  await assertStableInputs({
    casesPath,
    corpusDigest: score.corpusDigest,
    resultsPath,
    resultsDigest: score.resultsDigest,
  });

  const caseById = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const records = new Map(results.map((result) => [resultKey(result), result]));
  const trajectories = [];

  for (let repeat = 0; repeat < score.run.selection.repeats; repeat += 1) {
    for (const caseId of score.run.selection.cases) {
      const testCase = caseById.get(caseId);
      for (const arm of score.run.selection.arms) {
        if (arm === "direct" || arm === "structured-extraction") {
          for (const cut of testCase.cuts) {
            trajectories.push(
              createTrajectory({
                arm,
                cuts: [cut.index],
                priorStateMode: score.run.selection.priorStateMode,
                records,
                repeat,
                testCase,
              }),
            );
          }
          continue;
        }
        trajectories.push(
          createTrajectory({
            arm,
            cuts: testCase.cuts.map(({ index }) => index),
            priorStateMode: score.run.selection.priorStateMode,
            records,
            repeat,
            testCase,
          }),
        );
      }
    }
  }

  const diagnostics = {
    schema: DIAGNOSTICS_SCHEMA,
    benchmark: BENCHMARK,
    run: score.run,
    resultsDigest: score.resultsDigest,
    corpusDigest: score.corpusDigest,
    coverage: score.coverage,
    summary: summarize(trajectories),
    trajectories,
  };
  assertDiagnosticsInvariants(diagnostics);
  assertValid(validators.diagnostics, diagnostics, "benchmark diagnostics");
  await assertStableInputs({
    casesPath,
    corpusDigest: score.corpusDigest,
    resultsPath,
    resultsDigest: score.resultsDigest,
  });
  return diagnostics;
}

function createTrajectory({
  arm,
  cuts,
  priorStateMode,
  records,
  repeat,
  testCase,
}) {
  const resultRecords = cuts
    .map((cut) =>
      records.get(
        resultKey({
          arm,
          caseId: testCase.id,
          cut,
          repeat,
        }),
      ),
    )
    .filter((result) => result !== undefined);
  const firstErrorIndex = resultRecords.findIndex(
    ({ status }) => status === "error",
  );
  const observations = resultRecords.map((result, index) => {
    const admittedWithError =
      result.status === "error" && result.admitted === true;
    return {
      cut: result.cut,
      status: result.status,
      error: errorRef(result.error),
      afterFirstRecordedError:
        firstErrorIndex !== -1 && index > firstErrorIndex,
      priorProjectedState:
        arm === "timeline" ? timelinePriorState(testCase, result) : null,
      admittedWithError,
    };
  });
  const firstError =
    firstErrorIndex === -1 ? null : resultRecords[firstErrorIndex];
  const timelinePrior = priorProjectedStateCounts(observations);
  const admittedErrors = admittedWithErrorCounts(observations);

  return {
    arm,
    caseId: testCase.id,
    family: testCase.family,
    repeat,
    scope:
      arm === "direct" || arm === "structured-extraction"
        ? "independent"
        : arm === "timeline" && priorStateMode === "teacher-forced"
          ? "teacher-forced"
          : "rolling",
    cuts,
    expectedObservationCount: cuts.length,
    recordedObservationCount: observations.length,
    firstRecordedError:
      firstError === null
        ? null
        : {
            cut: firstError.cut,
            stage: firstError.error.stage,
            code: firstError.error.code,
          },
    observations,
    observationsAfterFirstRecordedError: observations
      .filter(({ afterFirstRecordedError }) => afterFirstRecordedError)
      .map(({ cut }) => cut),
    priorProjectedState: arm === "timeline" ? timelinePrior : null,
    admittedWithError: admittedErrors,
  };
}

function timelinePriorState(testCase, result) {
  const request = parseStrictJson(
    result.requestText,
    `${result.requestId}.requestText`,
  );
  const predicted = parseRunDocumentV0Alpha3(request.input.priorRun);
  const goldEvents = [
    ...testCase.setupEvents,
    ...testCase.cuts
      .slice(0, result.cut)
      .flatMap(({ goldEvents: events }) => events),
  ];
  const gold = parseRunDocumentV0Alpha3({
    schema: "covenant.timeline.run.v0alpha3",
    contract: testCase.contract,
    events: goldEvents,
  });
  return canonicalEqual(
    projectedStateSignature(predicted, testCase.setupEvents),
    projectedStateSignature(gold, testCase.setupEvents),
  )
    ? "exact"
    : "degraded";
}

function summarize(trajectories) {
  const observations = trajectories.flatMap(
    (trajectory) => trajectory.observations,
  );
  return {
    trajectoryCount: trajectories.length,
    trajectoriesWithRecordedError: trajectories.filter(
      ({ firstRecordedError }) => firstRecordedError !== null,
    ).length,
    recordedObservationCount: observations.length,
    errorObservationCount: observations.filter(
      ({ status }) => status === "error",
    ).length,
    observationsAfterFirstRecordedErrorCount: observations.filter(
      ({ afterFirstRecordedError }) => afterFirstRecordedError,
    ).length,
    priorProjectedState: priorProjectedStateCounts(observations),
    admittedWithError: admittedWithErrorCounts(observations),
  };
}

function priorProjectedStateCounts(observations) {
  const states = observations
    .map(({ priorProjectedState }) => priorProjectedState)
    .filter((state) => state !== null);
  return {
    exact: states.filter((state) => state === "exact").length,
    degraded: states.filter((state) => state === "degraded").length,
    total: states.length,
  };
}

function admittedWithErrorCounts(observations) {
  const errors = observations.filter(
    ({ admittedWithError }) => admittedWithError,
  );
  return {
    total: errors.length,
    stages: counts(errors.map(({ error }) => error.stage)),
    codes: counts(errors.map(({ error }) => error.code)),
  };
}

function counts(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return Object.fromEntries(
    [...result].sort(([left], [right]) => left.localeCompare(right, "en")),
  );
}

function errorRef(error) {
  return error === null ? null : { stage: error.stage, code: error.code };
}

function assertDiagnosticsInvariants(diagnostics) {
  const expected = diagnostics.trajectories.reduce(
    (total, trajectory) => total + trajectory.expectedObservationCount,
    0,
  );
  const recorded = diagnostics.trajectories.reduce(
    (total, trajectory) => total + trajectory.recordedObservationCount,
    0,
  );
  if (
    expected !== diagnostics.coverage.expected ||
    recorded !== diagnostics.coverage.observed ||
    diagnostics.trajectories.length !== diagnostics.summary.trajectoryCount ||
    recorded !== diagnostics.summary.recordedObservationCount
  ) {
    throw new Error("diagnostic coverage does not match the validated score");
  }
  const observations = diagnostics.trajectories.flatMap(
    ({ observations: entries }) => entries,
  );
  if (
    diagnostics.summary.trajectoriesWithRecordedError !==
      diagnostics.trajectories.filter(
        ({ firstRecordedError }) => firstRecordedError !== null,
      ).length ||
    diagnostics.summary.errorObservationCount !==
      observations.filter(({ status }) => status === "error").length ||
    diagnostics.summary.observationsAfterFirstRecordedErrorCount !==
      observations.filter(
        ({ afterFirstRecordedError }) => afterFirstRecordedError,
      ).length
  ) {
    throw new Error("diagnostic summary does not match its trajectories");
  }
  assertPriorCounts(diagnostics.summary.priorProjectedState);
  assertAdmittedErrorCounts(diagnostics.summary.admittedWithError);
  for (const trajectory of diagnostics.trajectories) {
    if (
      trajectory.expectedObservationCount !== trajectory.cuts.length ||
      trajectory.recordedObservationCount !== trajectory.observations.length ||
      trajectory.observationsAfterFirstRecordedError.length !==
        trajectory.observations.filter(
          ({ afterFirstRecordedError }) => afterFirstRecordedError,
        ).length
    ) {
      throw new Error("diagnostic trajectory counts do not match observations");
    }
    if (trajectory.priorProjectedState !== null) {
      assertPriorCounts(trajectory.priorProjectedState);
    }
    assertAdmittedErrorCounts(trajectory.admittedWithError);
  }
}

function assertPriorCounts(counts) {
  if (counts.exact + counts.degraded !== counts.total) {
    throw new Error("diagnostic prior-state counts do not match their total");
  }
}

function assertAdmittedErrorCounts(counts) {
  const stageTotal = Object.values(counts.stages).reduce(
    (total, count) => total + count,
    0,
  );
  const codeTotal = Object.values(counts.codes).reduce(
    (total, count) => total + count,
    0,
  );
  if (stageTotal !== counts.total || codeTotal !== counts.total) {
    throw new Error(
      "diagnostic admitted-error counts do not match their total",
    );
  }
}

async function assertStableInputs({
  casesPath,
  corpusDigest,
  resultsPath,
  resultsDigest,
}) {
  const [currentCorpusDigest, currentResultsDigest] = await Promise.all([
    digestFile(casesPath),
    digestFile(resultsPath),
  ]);
  if (
    currentCorpusDigest !== corpusDigest ||
    currentResultsDigest !== resultsDigest
  ) {
    throw new Error("benchmark inputs changed while diagnostics were computed");
  }
}

function resultKey({ caseId, arm, repeat, cut }) {
  return `${caseId}|${arm}|${repeat}|${cut}`;
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
  const diagnostics = await diagnoseModelInterfaceEval(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${canonicalJson(diagnostics)}\n`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

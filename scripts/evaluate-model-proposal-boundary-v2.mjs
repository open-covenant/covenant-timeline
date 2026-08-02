#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { isMain } from "./mcp-agent-pilot-lib.mjs";
import {
  canonicalJson,
  contentDigest,
} from "../packages/prototype/dist/index.js";
import {
  digestFile,
  loadBenchmarkCasesArtifact,
  readJsonLinesArtifact,
} from "./model-interface-eval.mjs";
import {
  createModelProposalEvalValidators,
  readSourceState,
  runtimeStateDigest,
} from "./run-model-proposal-eval.mjs";
import { scoreModelProposalEval } from "./score-model-proposal-eval.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const benchmarkDirectory = join(root, "benchmarks/model-proposal-boundary/v2");
const defaultCasesPath = join(benchmarkDirectory, "cases.jsonl");
const defaultSupportsPath = join(
  benchmarkDirectory,
  "acceptable-supports.json",
);
const gateSchemaPath = join(benchmarkDirectory, "gate.schema.json");
const ledgerSchemaPath = join(benchmarkDirectory, "attempt-ledger.schema.json");
const officialAdapter = join(
  root,
  "scripts/openai-responses-model-eval-adapter.mjs",
);
const frozenCorpusDigest =
  "sha256:a0055e7b5aa701819a7ca422e6915cc9c622bb04ed2214b1cf8d2606152fdeb4";
const frozenSupportsDigest =
  "sha256:69fb8a40f7ac4429d5e83da287d15f6e27a7a5e8f062821786744b9a78d8fa39";
const frozenPromptDigest =
  "sha256:34809fd6d1ba493c0b5d9da1f4e809d4a030cb38307207e9954685ceadd08e9b";
const operationalCode =
  /^(?:provider\.transport|provider\.http-(?:429|5[0-9]{2}))$/u;
const maxLedgerBytes = 1024 * 1024;

export async function evaluateModelProposalBoundaryV2Gate({
  results,
  ledger,
  output,
  cases = defaultCasesPath,
  supports = defaultSupportsPath,
}) {
  if (!ledger) throw new Error("an initialized --ledger is required");
  if (output) await assertArtifactOutputAvailable(output);
  const [
    score,
    resultArtifact,
    corpusArtifact,
    supportDocument,
    source,
    runtime,
  ] = await Promise.all([
    scoreModelProposalEval({ results, cases }),
    readJsonLinesArtifact(results),
    loadBenchmarkCasesArtifact(cases, undefined, { multipleEvidence: true }),
    loadSupports(supports),
    readSourceState(),
    runtimeStateDigest([process.execPath, officialAdapter]),
  ]);
  await assertFrozenInputs({
    cases,
    supports,
    corpusArtifact,
    supportDocument,
    score,
    source,
    runtime,
  });
  const grounding = scoreGrounding({
    cases: corpusArtifact.cases,
    results: resultArtifact.records,
    supportDocument,
    repeats: score.run.selection.repeats,
  });
  let gate = createModelProposalBoundaryV2Gate({
    score,
    results: resultArtifact.records,
    grounding,
  });
  assertGateConsistency(gate);
  const ledgerResult = await retainAttempt({ ledger, gate });
  gate = bindGateToAttemptLedger(gate, ledgerResult);
  assertGateConsistency(gate);
  await validateGate(gate);
  if (output) await writeModelProposalBoundaryV2Artifact(output, gate);
  return gate;
}

export async function initializeModelProposalBoundaryV2Ledger({
  ledger,
  config: configPath,
}) {
  if (!ledger) throw new Error("--ledger is required");
  if (!configPath) throw new Error("--config is required");
  await assertOutsideCheckout(ledger, "attempt ledger");
  const [config, corpusArtifact, supportDocument, source, runtime] =
    await Promise.all([
      loadJson(configPath, 64 * 1024),
      loadBenchmarkCasesArtifact(defaultCasesPath, undefined, {
        multipleEvidence: true,
      }),
      loadSupports(defaultSupportsPath),
      readSourceState(),
      runtimeStateDigest([process.execPath, officialAdapter]),
    ]);
  const validators = await createModelProposalEvalValidators();
  if (!validators.config(config)) {
    throw new Error("configuration does not satisfy the proposal-run schema");
  }
  assertFrozenConfig(config);
  if (source.dirty !== false) {
    throw new Error("attempt ledger initialization requires a clean checkout");
  }
  if (config.benchmarkRevision !== source.revision) {
    throw new Error(
      "configuration revision does not match the source revision",
    );
  }
  if (corpusArtifact.digest !== frozenCorpusDigest) {
    throw new Error("v2 corpus digest does not match the preregistration");
  }
  if ((await digestFile(defaultSupportsPath)) !== frozenSupportsDigest) {
    throw new Error(
      "v2 acceptable-support digest does not match the preregistration",
    );
  }
  validateSupportDocument(supportDocument, corpusArtifact.cases);
  const ledgerDocument = {
    schema: "covenant.timeline.model-proposal-attempt-ledger.v2",
    ledgerId: randomUUID(),
    initializedAt: new Date().toISOString(),
    benchmark: "model-proposal-boundary-v2",
    bindings: {
      sourceRevision: source.revision,
      sourceStateDigest: source.stateDigest,
      runtimeDigest: runtime,
      corpusDigest: frozenCorpusDigest,
      acceptableSupportsDigest: frozenSupportsDigest,
      promptDigest: frozenPromptDigest,
      configDigest: contentDigest(config),
    },
    attempts: [],
    authoritativeAttemptId: null,
    closed: false,
  };
  await validateLedger(ledgerDocument);
  await writeModelProposalBoundaryV2Artifact(ledger, ledgerDocument);
  return ledgerDocument;
}

export async function prepareModelProposalBoundaryV2Attempt({ ledger }) {
  await assertOutsideCheckout(ledger, "attempt ledger");
  const lockPath = `${ledger}.lock`;
  const lock = await acquireLedgerLock(lockPath);
  try {
    const document = await loadJson(ledger, maxLedgerBytes);
    await validateLedger(document);
    const attempt = {
      ordinal: document.attempts.length + 1,
      attemptId: randomUUID(),
      preparedAt: new Date().toISOString(),
      status: "pending",
    };
    const updated = registerPreparedAttempt(document, attempt);
    await validateLedger(updated);
    await replaceCanonical(ledger, updated);
    return { ledger: updated, attempt };
  } finally {
    await releaseLedgerLock(lock, lockPath);
  }
}

export async function claimModelProposalBoundaryV2Attempt({ ledger, output }) {
  if (!ledger) throw new Error("--ledger is required");
  if (!output) throw new Error("--output is required");
  await assertOutsideCheckout(ledger, "attempt ledger");
  await assertArtifactOutputAvailable(output);
  const resultsPathDigest = await resultPathDigest(output);
  const lockPath = `${ledger}.lock`;
  const lock = await acquireLedgerLock(lockPath);
  try {
    const document = await loadJson(ledger, maxLedgerBytes);
    await validateLedger(document);
    const pending = document.attempts.at(-1);
    if (!pending || pending.status !== "pending") {
      throw new Error("attempt ledger has no prepared attempt to claim");
    }
    const claimed = {
      ...pending,
      claimedAt: new Date().toISOString(),
      status: "claimed",
      resultsArtifactId: randomUUID(),
      resultsPathDigest,
    };
    const updated = {
      ...document,
      attempts: document.attempts.map((attempt, index) =>
        index === document.attempts.length - 1 ? claimed : attempt,
      ),
    };
    await validateLedger(updated);
    await replaceCanonical(ledger, updated);
    return { ledger: updated, attempt: claimed };
  } finally {
    await releaseLedgerLock(lock, lockPath);
  }
}

export function createModelProposalBoundaryV2Gate({
  score,
  results,
  grounding,
}) {
  const checks = [];
  const add = (id, actual, requirement, passed) => {
    checks.push({ id, actual, requirement, passed });
  };
  const metrics = score.metrics;

  add(
    "coverage.complete",
    score.coverage.observed,
    "108 of 108 observations",
    score.coverage.complete &&
      score.coverage.expected === 108 &&
      score.coverage.observed === 108,
  );
  addRate(
    checks,
    "response-schema-valid",
    metrics.responseSchemaValidRate,
    106,
  );
  addRate(checks, "compiler-valid", metrics.compilerValidRate, 106);
  addRate(
    checks,
    "candidate-verification",
    metrics.candidateVerificationRate,
    106,
  );
  addRate(checks, "applied", metrics.appliedRate, 106);
  addValue(
    checks,
    "assertion-precision",
    metrics.representationExactAssertionPrecision.value,
    0.97,
  );
  addValue(
    checks,
    "assertion-recall",
    metrics.representationExactAssertionRecall.value,
    0.95,
  );
  addValue(
    checks,
    "assertion-f1",
    metrics.representationExactAssertionF1,
    0.96,
  );
  addRate(
    checks,
    "projected-state-exact",
    metrics.projectedStateExactRate,
    103,
  );
  addRate(checks, "query-exact", metrics.queryExactRate, 106);
  addRate(checks, "answer-exact", metrics.answerExactRate, 103);
  addRate(checks, "end-to-end-exact", metrics.endToEndExactRate, 103);
  add(
    "proofs.verify-for-every-applied-candidate",
    metrics.proofVerificationRate.numerator,
    `exactly ${metrics.appliedRate.numerator}`,
    metrics.proofVerificationRate.numerator === metrics.appliedRate.numerator,
  );
  addValue(checks, "support-precision", grounding.overall.precision, 0.98);
  addValue(checks, "support-recall", grounding.overall.recall, 0.95);
  addValue(checks, "support-f1", grounding.overall.f1, 0.96);

  for (const repeat of score.repeatMetrics) {
    const prefix = `repeat-${repeat.repeat}`;
    addValue(
      checks,
      `${prefix}.assertion-f1`,
      repeat.metrics.representationExactAssertionF1,
      0.92,
    );
    addRate(
      checks,
      `${prefix}.end-to-end-exact`,
      repeat.metrics.endToEndExactRate,
      32,
    );
    addValue(
      checks,
      `${prefix}.support-f1`,
      grounding.repeats[repeat.repeat].f1,
      0.92,
    );
  }

  const operationalErrors = [
    ...new Set(
      results
        .map(({ error }) => error?.code)
        .filter(
          (code) => typeof code === "string" && operationalCode.test(code),
        ),
    ),
  ].sort();
  const failedChecks = checks
    .filter(({ passed }) => !passed)
    .map(({ id }) => id);
  const decision =
    operationalErrors.length > 0
      ? "inconclusive"
      : failedChecks.length === 0
        ? "continue"
        : "kill";

  return {
    schema: "covenant.timeline.model-proposal-gate.v2",
    decision,
    claim: "proposal-interface-reliability",
    checks,
    failedChecks,
    operationalErrors,
    grounding,
    bindings: {
      attemptId: score.run.attemptId,
      startedAt: score.run.startedAt,
      resultsArtifactId: score.run.resultsArtifactId,
      resultsPathDigest: score.run.resultsPathDigest,
      sourceRevision: score.run.sourceRevision,
      sourceStateDigest: score.run.sourceStateDigest,
      runtimeDigest: score.run.runtimeDigest,
      corpusDigest: score.corpusDigest,
      acceptableSupportsDigest: frozenSupportsDigest,
      promptDigest: score.run.promptDigest,
      configDigest: score.run.configDigest,
      resultsDigest: score.resultsDigest,
    },
  };
}

export function bindGateToAttemptLedger(
  gate,
  { ledger: ledgerDocument, ordinal },
) {
  const attempt = ledgerDocument.attempts[ordinal - 1];
  return {
    ...gate,
    bindings: {
      ...gate.bindings,
      attemptLedgerId: ledgerDocument.ledgerId,
      attemptOrdinal: ordinal,
      attemptLedgerDigest: contentDigest(ledgerDocument),
      authoritative:
        ledgerDocument.authoritativeAttemptId === attempt.attemptId,
    },
  };
}

export function registerPreparedAttempt(ledger, attempt) {
  if (
    ledger.closed ||
    ledger.attempts.length >= 2 ||
    ledger.attempts.some(({ status }) => status !== "complete")
  ) {
    throw new Error("attempt ledger cannot prepare another attempt");
  }
  if (
    attempt.ordinal !== ledger.attempts.length + 1 ||
    Date.parse(attempt.preparedAt) <
      Date.parse(ledger.attempts.at(-1)?.claimedAt ?? ledger.initializedAt)
  ) {
    throw new Error("prepared attempt does not follow the retained ledger");
  }
  return { ...ledger, attempts: [...ledger.attempts, attempt] };
}

export function completePreparedAttempt(ledger, gate) {
  assertLedgerBindings(ledger, gate);
  const existingIndex = ledger.attempts.findIndex(
    ({ attemptId }) => attemptId === gate.bindings.attemptId,
  );
  if (existingIndex < 0) {
    throw new Error("attempt was not registered before inference");
  }
  const existing = ledger.attempts[existingIndex];
  if (existing.status === "complete") {
    const observed = attemptRecord(gate, existingIndex + 1, existing);
    if (canonicalJson(existing) !== canonicalJson(observed)) {
      throw new Error("attempt ID is already bound to different results");
    }
    return { ledger, ordinal: existingIndex + 1, changed: false };
  }
  if (existing.status !== "claimed") {
    throw new Error("attempt was not claimed by the formal runner");
  }
  if (existingIndex !== ledger.attempts.length - 1) {
    throw new Error("only the current pending attempt can be completed");
  }
  if (ledger.closed) throw new Error("attempt ledger is closed");
  if (
    gate.bindings.startedAt !== existing.claimedAt ||
    gate.bindings.resultsArtifactId !== existing.resultsArtifactId ||
    gate.bindings.resultsPathDigest !== existing.resultsPathDigest
  ) {
    throw new Error("results do not match the claimed attempt artifact");
  }
  const ordinal = existingIndex + 1;
  const attempt = attemptRecord(gate, ordinal, existing);
  const attempts = ledger.attempts.map((entry, index) =>
    index === existingIndex ? attempt : entry,
  );
  const authoritativeAttemptId =
    gate.decision === "inconclusive" ? null : gate.bindings.attemptId;
  return {
    ledger: {
      ...ledger,
      attempts,
      authoritativeAttemptId,
      closed: authoritativeAttemptId !== null || attempts.length === 2,
    },
    ordinal,
    changed: true,
  };
}

export function assertGateConsistency(gate) {
  const ids = gate.checks.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("gate check identifiers must be unique");
  }
  for (const check of gate.checks) {
    if (check.passed !== checkPassesRequirement(check)) {
      throw new Error(`gate check ${check.id} contradicts its requirement`);
    }
  }
  const failedChecks = gate.checks
    .filter(({ passed }) => !passed)
    .map(({ id }) => id);
  if (canonicalJson(gate.failedChecks) !== canonicalJson(failedChecks)) {
    throw new Error("gate failedChecks do not match failed checks");
  }
  if (
    gate.operationalErrors.some((code) => !operationalCode.test(code)) ||
    canonicalJson(gate.operationalErrors) !==
      canonicalJson([...new Set(gate.operationalErrors)].sort())
  ) {
    throw new Error("gate operational errors are invalid");
  }
  const expectedDecision =
    gate.operationalErrors.length > 0
      ? "inconclusive"
      : failedChecks.length === 0
        ? "continue"
        : "kill";
  if (gate.decision !== expectedDecision) {
    throw new Error("gate decision is inconsistent with its checks");
  }
  if (
    gate.bindings.authoritative !== undefined &&
    gate.bindings.authoritative !== (gate.decision !== "inconclusive")
  ) {
    throw new Error("gate authority is inconsistent with its decision");
  }
  for (const score of [gate.grounding.overall, ...gate.grounding.repeats]) {
    assertGroundingScore(score);
  }
  const aggregate = gate.grounding.repeats.reduce(
    (total, score) => ({
      accepted: total.accepted + score.accepted,
      predicted: total.predicted + score.predicted,
      expected: total.expected + score.expected,
    }),
    emptyCounts(),
  );
  if (
    aggregate.accepted !== gate.grounding.overall.accepted ||
    aggregate.predicted !== gate.grounding.overall.predicted ||
    aggregate.expected !== gate.grounding.overall.expected
  ) {
    throw new Error("aggregate grounding counts do not match repeat counts");
  }
}

function checkPassesRequirement({ actual, requirement }) {
  if (requirement === "108 of 108 observations") return actual === 108;
  const minimum = requirement.match(
    /^at least ([0-9]+(?:\.[0-9]+)?)(?: of [0-9]+)?$/u,
  );
  if (minimum) {
    return typeof actual === "number" && actual >= Number(minimum[1]);
  }
  const exact = requirement.match(/^exactly ([0-9]+)$/u);
  if (exact) return actual === Number(exact[1]);
  throw new Error(`unsupported gate requirement ${requirement}`);
}

export function scoreGrounding({ cases, results, supportDocument, repeats }) {
  const caseById = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const repeatCounts = Array.from({ length: repeats }, () => emptyCounts());

  for (const result of results) {
    const testCase = caseById.get(result.caseId);
    if (!testCase || result.repeat < 0 || result.repeat >= repeats) continue;
    const cut = testCase.cuts[result.cut];
    if (!cut) continue;
    const expected = supportDocument.cases[result.caseId]?.[result.cut] ?? [];
    const predicted = result.proposal?.changes ?? [];
    addGroundingObservation(repeatCounts[result.repeat], expected, predicted);
  }

  const repeatsScored = repeatCounts.map(finishCounts);
  const aggregate = repeatCounts.reduce(
    (total, current) => ({
      accepted: total.accepted + current.accepted,
      predicted: total.predicted + current.predicted,
      expected: total.expected + current.expected,
    }),
    emptyCounts(),
  );
  return { overall: finishCounts(aggregate), repeats: repeatsScored };
}

export async function assertFrozenInputs({
  cases,
  supports,
  corpusArtifact,
  supportDocument,
  score,
  source,
  runtime,
}) {
  if (corpusArtifact.digest !== frozenCorpusDigest) {
    throw new Error("v2 corpus digest does not match the preregistration");
  }
  if ((await digestFile(supports)) !== frozenSupportsDigest) {
    throw new Error(
      "v2 acceptable-support digest does not match the preregistration",
    );
  }
  if (score.run.promptDigest !== frozenPromptDigest) {
    throw new Error(
      "proposal prompt digest does not match the preregistration",
    );
  }
  if (score.corpusDigest !== corpusArtifact.digest) {
    throw new Error("score corpus digest does not match the frozen corpus");
  }
  if (source.dirty !== false) {
    throw new Error("the gate requires a clean source checkout");
  }
  if (
    score.run.sourceRevision !== source.revision ||
    score.run.sourceStateDigest !== source.stateDigest
  ) {
    throw new Error("results do not match the current source state");
  }
  if (score.run.runtimeDigest !== runtime) {
    throw new Error("results do not match the official OpenAI adapter runtime");
  }
  if (
    typeof score.run.attemptId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      score.run.attemptId,
    )
  ) {
    throw new Error("results do not contain a valid v2 attempt ID");
  }
  const startedAt =
    typeof score.run.startedAt === "string"
      ? Date.parse(score.run.startedAt)
      : Number.NaN;
  if (
    !Number.isFinite(startedAt) ||
    new Date(startedAt).toISOString() !== score.run.startedAt
  ) {
    throw new Error("results do not contain a valid UTC start time");
  }
  if (
    typeof score.run.resultsArtifactId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      score.run.resultsArtifactId,
    ) ||
    typeof score.run.resultsPathDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(score.run.resultsPathDigest)
  ) {
    throw new Error("results do not match a claimed v2 output artifact");
  }
  if (
    score.run.selection.repeats !== 3 ||
    score.run.selection.timeoutMs !== 120_000
  ) {
    throw new Error(
      "the v2 gate requires three repeats and a 120000 ms timeout",
    );
  }
  if (
    !Array.isArray(score.repeatMetrics) ||
    score.repeatMetrics.length !== 3 ||
    score.repeatMetrics.some(({ repeat }, index) => repeat !== index)
  ) {
    throw new Error("the v2 gate requires metrics for all three repeats");
  }
  const expectedCases = corpusArtifact.cases.map(({ id }) => id);
  if (
    canonicalJson(score.run.selection.cases) !== canonicalJson(expectedCases)
  ) {
    throw new Error("the v2 gate requires the complete frozen case order");
  }
  assertFrozenConfig(score.run.config);
  validateSupportDocument(supportDocument, corpusArtifact.cases);
  if (resolve(cases) !== resolve(defaultCasesPath)) {
    throw new Error(
      "the v2 gate accepts only the repository-owned corpus path",
    );
  }
  if (resolve(supports) !== resolve(defaultSupportsPath)) {
    throw new Error(
      "the v2 gate accepts only the repository-owned acceptable-support path",
    );
  }
}

function assertFrozenConfig(config) {
  const expected = {
    schema: "covenant.timeline.model-proposal-eval.config.v1",
    adapter: { id: "openai-responses", version: "1" },
    model: {
      provider: "openai",
      id: "gpt-5.6-sol",
      revision: "gpt-5.6-sol",
    },
    generation: {
      temperature: null,
      seed: null,
      maxOutputTokens: 16_384,
      parameters: {
        structuredOutput: true,
        reasoningEffort: "high",
        verbosity: "low",
      },
    },
  };
  const observed = {
    schema: config.schema,
    adapter: config.adapter,
    model: config.model,
    generation: config.generation,
  };
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new Error("run configuration does not match the v2 preregistration");
  }
  contentDigest(config);
}

async function loadSupports(path) {
  const document = parseStrictJson(await readFile(path, "utf8"), path);
  if (
    document?.schema !== "covenant.timeline.model-proposal-supports.v2" ||
    document.cases === null ||
    typeof document.cases !== "object" ||
    Array.isArray(document.cases)
  ) {
    throw new Error("acceptable-support document is invalid");
  }
  return document;
}

async function loadJson(path, maximumBytes) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${path} must be a regular file`);
  }
  if (metadata.size > maximumBytes) {
    throw new Error(`${path} exceeds ${maximumBytes} bytes`);
  }
  return parseStrictJson(await readFile(path, "utf8"), path);
}

async function retainAttempt({ ledger: ledgerPath, gate }) {
  await assertOutsideCheckout(ledgerPath, "attempt ledger");
  const lockPath = `${ledgerPath}.lock`;
  const lock = await acquireLedgerLock(lockPath);
  try {
    const ledger = await loadJson(ledgerPath, maxLedgerBytes);
    await validateLedger(ledger);
    const completed = completePreparedAttempt(ledger, gate);
    await validateLedger(completed.ledger);
    if (completed.changed) await replaceCanonical(ledgerPath, completed.ledger);
    return { ledger: completed.ledger, ordinal: completed.ordinal };
  } finally {
    await releaseLedgerLock(lock, lockPath);
  }
}

function attemptRecord(gate, ordinal, claimed) {
  return {
    ordinal,
    attemptId: gate.bindings.attemptId,
    preparedAt: claimed.preparedAt,
    claimedAt: claimed.claimedAt,
    status: "complete",
    resultsArtifactId: claimed.resultsArtifactId,
    resultsPathDigest: claimed.resultsPathDigest,
    resultsDigest: gate.bindings.resultsDigest,
    decision: gate.decision,
    failedChecks: gate.failedChecks,
    operationalErrors: gate.operationalErrors,
  };
}

function assertLedgerBindings(ledger, gate) {
  const observed = {
    sourceRevision: gate.bindings.sourceRevision,
    sourceStateDigest: gate.bindings.sourceStateDigest,
    runtimeDigest: gate.bindings.runtimeDigest,
    corpusDigest: gate.bindings.corpusDigest,
    acceptableSupportsDigest: gate.bindings.acceptableSupportsDigest,
    promptDigest: gate.bindings.promptDigest,
    configDigest: gate.bindings.configDigest,
  };
  if (canonicalJson(ledger.bindings) !== canonicalJson(observed)) {
    throw new Error("attempt does not match the initialized ledger bindings");
  }
}

async function validateGate(gate) {
  const schema = parseStrictJson(
    await readFile(gateSchemaPath, "utf8"),
    gateSchemaPath,
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (validate(gate)) return;
  const message = (validate.errors ?? [])
    .slice(0, 8)
    .map(
      ({ instancePath, message: issue }) => `${instancePath || "$"} ${issue}`,
    )
    .join("; ");
  throw new Error(`v2 gate artifact is invalid: ${message}`);
}

async function validateLedger(ledger) {
  const schema = parseStrictJson(
    await readFile(ledgerSchemaPath, "utf8"),
    ledgerSchemaPath,
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(ledger)) {
    const message = (validate.errors ?? [])
      .slice(0, 8)
      .map(
        ({ instancePath, message: issue }) => `${instancePath || "$"} ${issue}`,
      )
      .join("; ");
    throw new Error(`v2 attempt ledger is invalid: ${message}`);
  }
  assertLedgerConsistency(ledger);
}

function assertLedgerConsistency(ledger) {
  if (
    new Set(ledger.attempts.map(({ attemptId }) => attemptId)).size !==
    ledger.attempts.length
  ) {
    throw new Error("attempt ledger reuses an attempt ID");
  }
  for (const [index, attempt] of ledger.attempts.entries()) {
    if (attempt.ordinal !== index + 1) {
      throw new Error("attempt ledger ordinals are not contiguous");
    }
    const prior = ledger.attempts[index - 1];
    const priorTime = Date.parse(prior?.claimedAt ?? ledger.initializedAt);
    if (Date.parse(attempt.preparedAt) < priorTime) {
      throw new Error("attempt was prepared before the preceding ledger event");
    }
    if (
      attempt.status !== "pending" &&
      Date.parse(attempt.claimedAt) < Date.parse(attempt.preparedAt)
    ) {
      throw new Error("attempt was claimed before preparation");
    }
    if (attempt.status !== "complete" && index !== ledger.attempts.length - 1) {
      throw new Error("only the last attempt may be active");
    }
    if (
      attempt.status === "complete" &&
      ((attempt.decision === "continue" &&
        (attempt.failedChecks.length > 0 ||
          attempt.operationalErrors.length > 0)) ||
        (attempt.decision === "kill" &&
          (attempt.failedChecks.length === 0 ||
            attempt.operationalErrors.length > 0)) ||
        (attempt.decision === "inconclusive" &&
          attempt.operationalErrors.length === 0))
    ) {
      throw new Error("retained attempt decision is inconsistent");
    }
    if (
      index === 0 &&
      attempt.status === "complete" &&
      attempt.decision !== "inconclusive" &&
      ledger.attempts.length > 1
    ) {
      throw new Error(
        "attempt ledger continued after an authoritative attempt",
      );
    }
  }
  const valid = ledger.attempts.find(
    ({ status, decision }) =>
      status === "complete" && decision !== "inconclusive",
  );
  if ((valid?.attemptId ?? null) !== ledger.authoritativeAttemptId) {
    throw new Error("authoritative attempt is not the first valid attempt");
  }
  const shouldClose =
    valid !== undefined ||
    (ledger.attempts.length === 2 && ledger.attempts[1].status === "complete");
  if (ledger.closed !== shouldClose) {
    throw new Error("attempt ledger closed state is inconsistent");
  }
}

function validateSupportDocument(document, cases) {
  const expectedCaseIds = cases.map(({ id }) => id).sort();
  const observedCaseIds = Object.keys(document.cases).sort();
  if (canonicalJson(expectedCaseIds) !== canonicalJson(observedCaseIds)) {
    throw new Error("acceptable-support cases do not match the corpus");
  }
  for (const testCase of cases) {
    for (const cut of testCase.cuts) {
      const expected = document.cases[testCase.id]?.[cut.index];
      if (
        !Array.isArray(expected) ||
        expected.length !== cut.goldEvents.length
      ) {
        throw new Error(
          `${testCase.id} cut ${cut.index}: support count mismatch`,
        );
      }
      const evidence = new Map(
        testCase.evidence
          .filter(({ cut: evidenceCut }) => evidenceCut === cut.index)
          .map((entry) => [entry.id, entry]),
      );
      const evidenceIdByDigest = new Map(
        [...evidence.values()].map((entry) => [entry.digest, entry.id]),
      );
      const referencedEvidence = cut.goldEvents.map((event) => {
        const references =
          event.type === "assertion.retracted"
            ? event.evidenceRefs
            : event.assertion.evidenceRefs;
        if (references.length !== 1) {
          throw new Error(
            `${testCase.id} cut ${cut.index}: gold change must have one support`,
          );
        }
        return evidenceIdByDigest.get(references[0]);
      });
      if (
        referencedEvidence.some((id) => id === undefined) ||
        new Set(referencedEvidence).size !== referencedEvidence.length ||
        canonicalJson([...referencedEvidence].sort()) !==
          canonicalJson(expected.map(({ evidenceId }) => evidenceId).sort())
      ) {
        throw new Error(
          `${testCase.id} cut ${cut.index}: supports do not map one-to-one to gold changes`,
        );
      }
      const changeKeys = new Set();
      for (const { change, evidenceId, quotes } of expected) {
        const text = evidence.get(evidenceId)?.text;
        const changeKey = canonicalJson(change);
        if (
          !text ||
          !Array.isArray(quotes) ||
          quotes.length === 0 ||
          changeKeys.has(changeKey)
        ) {
          throw new Error(
            `${testCase.id} cut ${cut.index}: invalid support entry`,
          );
        }
        changeKeys.add(changeKey);
        for (const quote of quotes) {
          if (
            typeof quote !== "string" ||
            quote.length === 0 ||
            text.indexOf(quote) < 0 ||
            text.indexOf(quote) !== text.lastIndexOf(quote)
          ) {
            throw new Error(
              `${testCase.id} cut ${cut.index}: support is not unique`,
            );
          }
        }
      }
    }
  }
}

function addGroundingObservation(counts, expected, predicted) {
  counts.expected += expected.length;
  const unmatched = new Set(expected.map((_, index) => index));
  for (const change of predicted) {
    const supports = change.supports ?? [];
    counts.predicted += supports.length;
    const changeKey = canonicalJson(withoutSupports(change));
    const slot = [...unmatched].find(
      (index) => canonicalJson(expected[index].change) === changeKey,
    );
    if (slot === undefined) continue;
    unmatched.delete(slot);
    const accepted = expected[slot];
    if (
      supports.some(
        ({ evidenceId, quote }) =>
          evidenceId === accepted.evidenceId && accepted.quotes.includes(quote),
      )
    ) {
      counts.accepted += 1;
    }
  }
}

function withoutSupports(change) {
  const { supports: _supports, ...claim } = change;
  return claim;
}

function emptyCounts() {
  return { accepted: 0, predicted: 0, expected: 0 };
}

function finishCounts({ accepted, predicted, expected }) {
  const precision = predicted === 0 ? null : accepted / predicted;
  const recall = expected === 0 ? null : accepted / expected;
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return { accepted, predicted, expected, precision, recall, f1 };
}

function assertGroundingScore(score) {
  if (
    score.accepted > score.predicted ||
    score.accepted > score.expected ||
    canonicalJson(score) !== canonicalJson(finishCounts(score))
  ) {
    throw new Error("grounding score is inconsistent with its counts");
  }
}

function addRate(checks, id, rate, minimum) {
  checks.push({
    id,
    actual: rate.numerator,
    requirement: `at least ${minimum} of ${rate.denominator}`,
    passed: rate.denominator > 0 && rate.numerator >= minimum,
  });
}

function addValue(checks, id, actual, minimum) {
  checks.push({
    id,
    actual,
    requirement: `at least ${minimum}`,
    passed: typeof actual === "number" && actual >= minimum,
  });
}

async function acquireLedgerLock(path) {
  return open(path, "wx", 0o600).catch((error) => {
    if (error.code === "EEXIST") {
      throw new Error("attempt ledger is locked by another evaluator");
    }
    throw error;
  });
}

async function releaseLedgerLock(lock, path) {
  await lock.close().catch(() => undefined);
  await rm(path, { force: true });
}

async function assertOutsideCheckout(path, label) {
  const target = resolve(path);
  const [checkout, parent] = await Promise.all([
    realpath(root),
    realpath(dirname(target)),
  ]);
  const resolvedTarget = join(parent, basename(target));
  const fromCheckout = relative(checkout, resolvedTarget);
  if (
    fromCheckout === "" ||
    (!fromCheckout.startsWith(`..${sep}`) && !isAbsolute(fromCheckout))
  ) {
    throw new Error(`${label} must be outside the repository checkout`);
  }
}

async function assertArtifactOutputAvailable(path) {
  await assertOutsideCheckout(path, "artifact output");
  try {
    await lstat(resolve(path));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`artifact output already exists: ${path}`);
}

export async function resultPathDigest(path) {
  const parent = await realpath(dirname(resolve(path)));
  const canonicalPath = join(parent, basename(resolve(path)));
  return contentDigest({ canonicalPath });
}

export async function writeModelProposalBoundaryV2Artifact(path, value) {
  await assertOutsideCheckout(path, "artifact output");
  const target = resolve(path);
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.partial`,
  );
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function replaceCanonical(path, value) {
  const target = resolve(path);
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.partial`,
  );
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function parseArguments(argv) {
  const options = {
    cases: defaultCasesPath,
    config: null,
    initLedger: false,
    ledger: null,
    output: null,
    prepareAttempt: false,
    supports: defaultSupportsPath,
    results: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--init-ledger") {
      options.initLedger = true;
      continue;
    }
    if (flag === "--prepare-attempt") {
      options.prepareAttempt = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${flag} requires a value`);
    index += 1;
    if (flag === "--cases") options.cases = value;
    else if (flag === "--config") options.config = value;
    else if (flag === "--ledger") options.ledger = value;
    else if (flag === "--output") options.output = value;
    else if (flag === "--supports") options.supports = value;
    else if (flag === "--results") options.results = value;
    else throw new Error(`unknown option ${flag}`);
  }
  if (!options.ledger) throw new Error("--ledger is required");
  if (options.initLedger && options.prepareAttempt) {
    throw new Error("select only one ledger operation");
  }
  if (options.initLedger && !options.config) {
    throw new Error("--config is required with --init-ledger");
  }
  if (!options.initLedger && !options.prepareAttempt && !options.results) {
    throw new Error("--results is required");
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.initLedger) {
    const ledger = await initializeModelProposalBoundaryV2Ledger(options);
    process.stdout.write(`${canonicalJson(ledger)}\n`);
    return;
  }
  if (options.prepareAttempt) {
    if (options.output) await assertArtifactOutputAvailable(options.output);
    const prepared = await prepareModelProposalBoundaryV2Attempt(options);
    if (options.output) {
      await writeModelProposalBoundaryV2Artifact(
        options.output,
        prepared.attempt,
      );
    } else {
      process.stdout.write(`${canonicalJson(prepared.attempt)}\n`);
    }
    return;
  }
  const gate = await evaluateModelProposalBoundaryV2Gate(options);
  if (!options.output) process.stdout.write(`${canonicalJson(gate)}\n`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

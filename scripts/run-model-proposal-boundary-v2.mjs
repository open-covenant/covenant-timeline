#!/usr/bin/env node

import { claimModelProposalBoundaryV2Attempt } from "./evaluate-model-proposal-boundary-v2.mjs";
import { isMain } from "./mcp-agent-pilot-lib.mjs";
import { runModelProposalEval } from "./run-model-proposal-eval.mjs";

export async function runModelProposalBoundaryV2Attempt(
  options,
  dependencies = {},
) {
  const claimed = await claimModelProposalBoundaryV2Attempt({
    ledger: options.ledger,
    output: options.output,
  });
  const attempt = claimed.attempt;
  const run = dependencies.run ?? runModelProposalEval;
  return run({
    adapter: options.adapter,
    attemptId: attempt.attemptId,
    caseIds: [],
    cases: options.cases,
    config: options.config,
    output: options.output,
    overwrite: false,
    repeats: options.repeats,
    resultsArtifactId: attempt.resultsArtifactId,
    resultsPathDigest: attempt.resultsPathDigest,
    startedAt: attempt.claimedAt,
    timeoutMs: options.timeoutMs,
  });
}

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("adapter command is required after --");
  }
  const options = {
    adapter: argv.slice(separator + 1),
    cases: "benchmarks/model-proposal-boundary/v2/cases.jsonl",
    config: null,
    ledger: null,
    output: null,
    repeats: 3,
    timeoutMs: 120_000,
  };
  const flags = argv.slice(0, separator);
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const value = flags[index + 1];
    if (value === undefined) throw new Error(`${flag} requires a value`);
    index += 1;
    if (flag === "--cases") options.cases = value;
    else if (flag === "--config") options.config = value;
    else if (flag === "--ledger") options.ledger = value;
    else if (flag === "--output") options.output = value;
    else if (flag === "--repeats")
      options.repeats = positiveInteger(value, flag);
    else if (flag === "--timeout-ms") {
      options.timeoutMs = positiveInteger(value, flag);
    } else throw new Error(`unknown option ${flag}`);
  }
  for (const field of ["config", "ledger", "output"]) {
    if (!options[field]) throw new Error(`--${field} is required`);
  }
  return options;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

async function main() {
  const result = await runModelProposalBoundaryV2Attempt(
    parseArguments(process.argv.slice(2)),
  );
  process.stderr.write(
    `wrote ${result.completed} result records to ${result.output}\n`,
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

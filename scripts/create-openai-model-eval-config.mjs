#!/usr/bin/env node

import { execFile } from "node:child_process";
import { open, readFile, realpath } from "node:fs/promises";
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
import { promisify } from "node:util";
import { isMain } from "./mcp-agent-pilot-lib.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const templatePaths = new Map([
  [
    "model-interface-v1",
    join(
      root,
      "benchmarks/model-interface/v1/configs/openai-responses.example.json",
    ),
  ],
  [
    "model-proposal-boundary-v1",
    join(
      root,
      "benchmarks/model-proposal-boundary/v1/configs/openai-responses.example.json",
    ),
  ],
]);
const sourceRevisionPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const reasoningEfforts = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const verbosities = new Set(["low", "medium", "high"]);

function parseArguments(args) {
  let benchmark = "model-interface-v1";
  let maxOutputTokens;
  let output;
  let model;
  let reasoningEffort;
  let verbosity;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      argument === "--benchmark" ||
      argument === "--max-output-tokens" ||
      argument === "--output" ||
      argument === "--model" ||
      argument === "--reasoning-effort" ||
      argument === "--verbosity"
    ) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      if (argument === "--benchmark") benchmark = value;
      else if (argument === "--max-output-tokens") {
        maxOutputTokens = Number(value);
      } else if (argument === "--output") output = value;
      else if (argument === "--model") model = value;
      else if (argument === "--reasoning-effort") reasoningEffort = value;
      else verbosity = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  if (!templatePaths.has(benchmark)) {
    throw new Error(
      "--benchmark must be model-interface-v1 or model-proposal-boundary-v1",
    );
  }
  if (output === undefined) throw new Error("--output is required");
  if (model !== undefined && (model.length === 0 || model.length > 200)) {
    throw new Error("--model must be between 1 and 200 characters");
  }
  if (
    maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(maxOutputTokens) ||
      maxOutputTokens < 16 ||
      maxOutputTokens > 1_000_000)
  ) {
    throw new Error(
      "--max-output-tokens must be an integer from 16 through 1000000",
    );
  }
  if (reasoningEffort !== undefined && !reasoningEfforts.has(reasoningEffort)) {
    throw new Error("--reasoning-effort is unsupported");
  }
  if (verbosity !== undefined && !verbosities.has(verbosity)) {
    throw new Error("--verbosity must be low, medium, or high");
  }
  return {
    benchmark,
    maxOutputTokens,
    model,
    output,
    reasoningEffort,
    verbosity,
  };
}

async function assertOutsideCheckout(outputPath) {
  const [checkout, parent] = await Promise.all([
    realpath(root),
    realpath(dirname(outputPath)),
  ]);
  const target = join(parent, basename(outputPath));
  const pathFromCheckout = relative(checkout, target);
  if (
    pathFromCheckout === "" ||
    (!pathFromCheckout.startsWith(`..${sep}`) && !isAbsolute(pathFromCheckout))
  ) {
    throw new Error("output must be outside the repository checkout");
  }
}

async function currentSourceRevision() {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--verify", "HEAD"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  const revision = stdout.trim();
  if (!sourceRevisionPattern.test(revision)) {
    throw new Error("git returned an invalid source revision");
  }
  return revision;
}

export async function createOpenAIModelEvalConfig({
  benchmark = "model-interface-v1",
  maxOutputTokens,
  model,
  output,
  reasoningEffort,
  sourceRevision,
  verbosity,
}) {
  const templatePath = templatePaths.get(benchmark);
  if (!templatePath) {
    throw new Error(
      "benchmark must be model-interface-v1 or model-proposal-boundary-v1",
    );
  }
  if (!sourceRevisionPattern.test(sourceRevision)) {
    throw new Error("sourceRevision must be a full Git object id");
  }
  if (
    maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(maxOutputTokens) ||
      maxOutputTokens < 16 ||
      maxOutputTokens > 1_000_000)
  ) {
    throw new Error(
      "maxOutputTokens must be an integer from 16 through 1000000",
    );
  }
  if (reasoningEffort !== undefined && !reasoningEfforts.has(reasoningEffort)) {
    throw new Error("reasoningEffort is unsupported");
  }
  if (verbosity !== undefined && !verbosities.has(verbosity)) {
    throw new Error("verbosity must be low, medium, or high");
  }

  const outputPath = resolve(output);
  await assertOutsideCheckout(outputPath);

  const config = parseStrictJson(
    await readFile(templatePath, "utf8"),
    templatePath,
  );
  config.benchmarkRevision = sourceRevision;
  if (model !== undefined) {
    config.model.id = model;
    config.model.revision = model;
  }
  if (maxOutputTokens !== undefined) {
    config.generation.maxOutputTokens = maxOutputTokens;
  }
  if (reasoningEffort !== undefined) {
    config.generation.parameters.reasoningEffort = reasoningEffort;
  }
  if (verbosity !== undefined) {
    config.generation.parameters.verbosity = verbosity;
  }

  const file = await open(outputPath, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8");
  } finally {
    await file.close();
  }
  return outputPath;
}

export async function main(
  args = process.argv.slice(2),
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    const options = parseArguments(args);
    const output = await createOpenAIModelEvalConfig({
      ...options,
      sourceRevision: await currentSourceRevision(),
    });
    stdout.write(`${output}\n`);
    return 0;
  } catch (error) {
    stderr.write(`create OpenAI model-eval config: ${error.message}\n`);
    return 1;
  }
}

const isEntrypoint = isMain(import.meta.url);

if (isEntrypoint) {
  process.exitCode = await main();
}

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
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseStrictJson } from "./strict-json.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const templatePath = join(
  root,
  "benchmarks/model-interface/v1/configs/ollama.example.json",
);
const sourceRevisionPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const modelPattern = /^[a-z0-9][a-z0-9._:/-]{0,199}$/iu;
const modelDigestPattern = /^sha256:[0-9a-f]{64}$/u;
const runtimeVersionPattern =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const cloudModelPattern = /(?:^|[:/-])cloud$/iu;
const thinkingLevels = new Set(["low", "medium", "high"]);

function parseArguments(args) {
  let digest;
  let model;
  let output;
  let runtimeVersion;
  let thinking = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      argument === "--digest" ||
      argument === "--model" ||
      argument === "--output" ||
      argument === "--runtime-version" ||
      argument === "--thinking"
    ) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      if (argument === "--digest") digest = value;
      else if (argument === "--model") model = value;
      else if (argument === "--output") output = value;
      else if (argument === "--runtime-version") runtimeVersion = value;
      else {
        if (value !== "false" && !thinkingLevels.has(value)) {
          throw new Error("--thinking must be false, low, medium, or high");
        }
        thinking = value === "false" ? false : value;
      }
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  if (model === undefined) throw new Error("--model is required");
  if (!modelPattern.test(model) || model.includes("://")) {
    throw new Error("--model must be a valid installed Ollama model name");
  }
  if (cloudModelPattern.test(model)) {
    throw new Error("--model must refer to a local Ollama model");
  }
  if (digest === undefined) throw new Error("--digest is required");
  if (!modelDigestPattern.test(digest)) {
    throw new Error("--digest must be a lowercase sha256 model digest");
  }
  if (runtimeVersion === undefined) {
    throw new Error("--runtime-version is required");
  }
  if (!runtimeVersionPattern.test(runtimeVersion)) {
    throw new Error(
      "--runtime-version must be an exact Ollama semantic version",
    );
  }
  if (output === undefined) throw new Error("--output is required");
  return { digest, model, output, runtimeVersion, thinking };
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

export async function createOllamaModelEvalConfig({
  digest,
  model,
  output,
  runtimeVersion,
  sourceRevision,
  thinking = false,
}) {
  if (
    typeof sourceRevision !== "string" ||
    !sourceRevisionPattern.test(sourceRevision)
  ) {
    throw new Error("sourceRevision must be a full Git object id");
  }
  if (
    typeof model !== "string" ||
    !modelPattern.test(model) ||
    model.includes("://")
  ) {
    throw new Error("model must be a valid installed Ollama model name");
  }
  if (cloudModelPattern.test(model)) {
    throw new Error("model must refer to a local Ollama model");
  }
  if (typeof digest !== "string" || !modelDigestPattern.test(digest)) {
    throw new Error("digest must be a lowercase sha256 model digest");
  }
  if (
    typeof runtimeVersion !== "string" ||
    !runtimeVersionPattern.test(runtimeVersion)
  ) {
    throw new Error("runtimeVersion must be an exact Ollama semantic version");
  }
  if (thinking !== false && !thinkingLevels.has(thinking)) {
    throw new Error("thinking must be false, low, medium, or high");
  }
  if (typeof output !== "string" || output.length === 0) {
    throw new Error("output must be a non-empty path");
  }

  const outputPath = resolve(output);
  await assertOutsideCheckout(outputPath);

  const config = parseStrictJson(
    await readFile(templatePath, "utf8"),
    templatePath,
  );
  config.benchmarkRevision = sourceRevision;
  config.model.id = model;
  config.model.revision = digest;
  config.generation.parameters.runtimeVersion = runtimeVersion;
  config.generation.parameters.thinking = thinking;

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
    const output = await createOllamaModelEvalConfig({
      ...options,
      sourceRevision: await currentSourceRevision(),
    });
    stdout.write(`${output}\n`);
    return 0;
  } catch (error) {
    stderr.write(`create Ollama model-eval config: ${error.message}\n`);
    return 1;
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  process.exitCode = await main();
}

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
  "benchmarks/model-interface/v1/configs/openai-responses.example.json",
);
const sourceRevisionPattern = /^[0-9a-f]{40,64}$/u;

function parseArguments(args) {
  let output;
  let model;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output" || argument === "--model") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      if (argument === "--output") output = value;
      else model = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  if (output === undefined) throw new Error("--output is required");
  if (model !== undefined && (model.length === 0 || model.length > 200)) {
    throw new Error("--model must be between 1 and 200 characters");
  }
  return { model, output };
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
  model,
  output,
  sourceRevision,
}) {
  if (!sourceRevisionPattern.test(sourceRevision)) {
    throw new Error("sourceRevision must be a full Git object id");
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

const isEntrypoint =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  process.exitCode = await main();
}

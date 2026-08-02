#!/usr/bin/env node

import {
  assertPilotRuntime,
  capturePilotRuntime,
} from "./mcp-real-model-pilot-runtime.mjs";
import { isMain } from "./mcp-agent-pilot-lib.mjs";

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("pilot requires an adapter command after --");
  }
  const [mode, ...raw] = argv.slice(0, separator);
  const adapter = argv.slice(separator + 1);
  const options = {
    mode,
    adapter: { command: adapter[0], args: adapter.slice(1) },
    allowDirty: false,
  };
  for (let index = 0; index < raw.length; ) {
    const option = raw[index];
    if (option === "--allow-dirty") {
      options.allowDirty = true;
      index += 1;
      continue;
    }
    const value = raw[index + 1];
    if (!value) throw new Error(`missing value for ${option}`);
    if (option === "--input") options.input = value;
    else if (option === "--state") options.state = value;
    else if (option === "--config") options.config = value;
    else if (option === "--out") options.out = value;
    else throw new Error(`unknown option ${option}`);
    index += 2;
  }
  if (
    !["start", "resume"].includes(mode) ||
    !options.input ||
    !options.state ||
    !options.config ||
    (mode === "resume" && !options.out)
  ) {
    throw new Error(
      "usage: mcp-real-model-pilot-bootstrap <start|resume> --input <dir> --state <dir> --config <file> [--out <dir>] [--allow-dirty] -- <adapter> [args...]",
    );
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const runtimeBinding = await capturePilotRuntime({
    profile: options.allowDirty
      ? "development-unbound-adapter"
      : "formal-openai",
  });
  const implementation = await loadBoundPilot(runtimeBinding);
  const report =
    options.mode === "start"
      ? await implementation.runStart({ ...options, runtimeBinding })
      : await implementation.runResume({ ...options, runtimeBinding });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

export async function loadBoundPilot(
  runtimeBinding,
  { load = () => import("./mcp-real-model-pilot.mjs"), runtimeOptions } = {},
) {
  const implementation = await load();
  await assertPilotRuntime(runtimeBinding, runtimeOptions);
  return implementation;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `mcp-real-model-pilot: ${error instanceof Error ? error.message : "failed"}\n`,
    );
    process.exitCode = 1;
  });
}

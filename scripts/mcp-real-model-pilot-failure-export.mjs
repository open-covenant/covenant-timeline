#!/usr/bin/env node

import { isMain } from "./mcp-agent-pilot-lib.mjs";
import { exportFailedAttempt } from "./mcp-real-model-pilot-failure-artifact.mjs";

export async function runFailureExport(state, output) {
  if (!state || !output) {
    throw new Error(
      "usage: mcp-real-model-pilot-failure-export <state> <output>",
    );
  }
  return exportFailedAttempt({ state, output });
}

const isEntrypoint = isMain(import.meta.url);

if (isEntrypoint) {
  try {
    const result = await runFailureExport(process.argv[2], process.argv[3]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("mcp-real-model-pilot-failure-export: failed\n");
    process.exitCode = 1;
  }
}

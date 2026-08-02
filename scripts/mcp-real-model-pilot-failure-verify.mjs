#!/usr/bin/env node

import { isMain } from "./mcp-agent-pilot-lib.mjs";
import { verifyFailedAttempt } from "./mcp-real-model-pilot-failure-artifact.mjs";

export async function runFailureVerification(directory) {
  if (!directory) {
    throw new Error(
      "usage: mcp-real-model-pilot-failure-verify <failed-attempt>",
    );
  }
  return verifyFailedAttempt(directory);
}

const isEntrypoint = isMain(import.meta.url);

if (isEntrypoint) {
  try {
    const result = await runFailureVerification(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("mcp-real-model-pilot-failure-verify: failed\n");
    process.exitCode = 1;
  }
}

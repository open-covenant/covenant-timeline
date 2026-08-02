#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyFailedAttempt } from "./mcp-real-model-pilot-failure-artifact.mjs";

export async function runFailureVerification(directory) {
  if (!directory) {
    throw new Error(
      "usage: mcp-real-model-pilot-failure-verify <failed-attempt>",
    );
  }
  return verifyFailedAttempt(directory);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  try {
    const result = await runFailureVerification(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("mcp-real-model-pilot-failure-verify: failed\n");
    process.exitCode = 1;
  }
}

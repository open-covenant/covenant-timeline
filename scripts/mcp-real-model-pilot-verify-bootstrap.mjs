#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPilotRuntime,
  capturePilotRuntime,
} from "./mcp-real-model-pilot-runtime.mjs";

async function main() {
  const { directory, allowDirty, requireRuntimeMatch } = parseArguments(
    process.argv.slice(2),
  );
  const artifactPath = join(resolve(directory), "artifact.json");
  const artifactStat = await lstat(artifactPath);
  if (!artifactStat.isFile() || artifactStat.size > 128 * 1024) {
    throw new Error(
      "real-model pilot artifact manifest exceeds its byte limit",
    );
  }
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const profile = artifact?.runtime?.profile;
  const runtimeBinding = await capturePilotRuntime({ profile });
  const verifier = await import("./mcp-real-model-pilot-verify.mjs");
  await assertPilotRuntime(runtimeBinding);
  const report = await verifier.verifyRealModelPilot(directory, {
    allowDirty,
    requireRuntimeMatch,
    runtimeBinding,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function parseArguments(argv) {
  const positionals = argv.filter((argument) => !argument.startsWith("--"));
  const directory = positionals[0];
  const flags = new Set(argv.filter((argument) => argument.startsWith("--")));
  const unknown = [...flags].filter(
    (flag) => flag !== "--allow-dirty" && flag !== "--require-runtime-match",
  );
  if (!directory || positionals.length !== 1 || unknown.length > 0) {
    throw new Error(
      "usage: mcp-real-model-pilot-verify-bootstrap <artifact> [--allow-dirty] [--require-runtime-match]",
    );
  }
  return {
    directory,
    allowDirty: flags.has("--allow-dirty"),
    requireRuntimeMatch: flags.has("--require-runtime-match"),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    process.stderr.write(
      `mcp-real-model-pilot-verify: ${error instanceof Error ? error.message : "verification failed"}\n`,
    );
    process.exitCode = 1;
  });
}

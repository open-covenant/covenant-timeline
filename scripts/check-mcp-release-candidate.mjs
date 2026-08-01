#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.argv.length !== 2) {
  throw new Error("usage: check-mcp-release-candidate.mjs");
}

const root = resolve(import.meta.dirname, "..");
const mcpDirectory = join(root, "packages/mcp-server");
const coreManifest = JSON.parse(
  await readFile(join(root, "packages/prototype/package.json"), "utf8"),
);
const mcpManifest = JSON.parse(
  await readFile(join(mcpDirectory, "package.json"), "utf8"),
);
const corePin = mcpManifest.dependencies?.["@covenant-org/timeline"];

if (corePin !== `workspace:${coreManifest.version}`) {
  throw new Error(
    `MCP package must pin workspace:${coreManifest.version} before registry validation`,
  );
}

const directory = await mkdtemp(
  join(tmpdir(), "timeline-mcp-release-candidate-"),
);

try {
  run(command("pnpm"), ["pack", "--pack-destination", directory], {
    cwd: mcpDirectory,
  });
  const archives = (await readdir(directory)).filter((file) =>
    file.endsWith(".tgz"),
  );
  if (archives.length !== 1) {
    throw new Error(
      `expected one MCP release-candidate archive, received ${archives.length}`,
    );
  }

  const output = run(
    process.execPath,
    [
      join(root, "scripts/check-mcp-registry-install.mjs"),
      join(directory, archives[0]),
    ],
    { cwd: root },
  );
  process.stdout.write(output);
} finally {
  await rm(directory, { recursive: true, force: true });
}

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(executable, args, options) {
  const result = spawnSync(executable, args, {
    ...options,
    encoding: "utf8",
    env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
    shell: process.platform === "win32" && executable.endsWith(".cmd"),
  });
  if (result.status !== 0) {
    throw new Error(
      [result.error?.message, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim(),
    );
  }
  return result.stdout;
}

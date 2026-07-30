import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/check-mcp-release.mjs");
const manifest = JSON.parse(
  await readFile(resolve(root, "packages/mcp-server/package.json"), "utf8"),
);
const releaseTag = `timeline-mcp-v${manifest.version}`;

async function createFixture(changelog) {
  const directory = await mkdtemp(resolve(tmpdir(), "timeline-mcp-release-"));
  await mkdir(resolve(directory, "packages/mcp-server"), { recursive: true });
  await mkdir(resolve(directory, ".github/workflows"), { recursive: true });

  await Promise.all([
    copyFile(
      resolve(root, "packages/mcp-server/package.json"),
      resolve(directory, "packages/mcp-server/package.json"),
    ),
    copyFile(
      resolve(root, "packages/mcp-server/LICENSE"),
      resolve(directory, "packages/mcp-server/LICENSE"),
    ),
    copyFile(
      resolve(root, "packages/mcp-server/README.md"),
      resolve(directory, "packages/mcp-server/README.md"),
    ),
    copyFile(
      resolve(root, ".github/workflows/release-mcp.yml"),
      resolve(directory, ".github/workflows/release-mcp.yml"),
    ),
    writeFile(resolve(directory, "CHANGELOG.md"), changelog),
  ]);

  return directory;
}

function runCheck(directory, tag) {
  return spawnSync(process.execPath, [script, ...(tag ? [tag] : [])], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_NAME: "" },
  });
}

test("validates an unreleased MCP package without a dated changelog entry", async () => {
  const directory = await createFixture("# Changelog\n\n## Unreleased\n");

  try {
    const result = runCheck(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no tag/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires a dated changelog entry for a release tag", async () => {
  const directory = await createFixture("# Changelog\n\n## Unreleased\n");

  try {
    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(
        `CHANGELOG.md has no MCP ${manifest.version} release entry`,
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts a release tag with a matching dated changelog entry", async () => {
  const changelog = [
    "# Changelog",
    "",
    `## @covenant-org/timeline-mcp ${manifest.version} - 2026-07-30`,
    "",
  ].join("\n");
  const directory = await createFixture(changelog);

  try {
    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`${releaseTag})`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

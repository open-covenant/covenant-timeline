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

test("requires the tag workflow to verify registry dependencies", async () => {
  const directory = await createFixture("# Changelog\n\n## Unreleased\n");
  const workflowPath = resolve(directory, ".github/workflows/release-mcp.yml");

  try {
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow
        .replace("- name: Verify registry dependency graph", "- name: Check")
        .replace(
          "scripts/check-mcp-registry-install.mjs",
          "scripts/disabled.mjs",
        ),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(
        "MCP release must verify its registry dependency graph",
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires publication to depend on registry verification", async () => {
  const directory = await createFixture("# Changelog\n\n## Unreleased\n");
  const workflowPath = resolve(directory, ".github/workflows/release-mcp.yml");

  try {
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow.replace(
        "    needs: registry-compatibility\n",
        "    needs: omitted\n",
      ),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(
        "MCP publication must depend on registry verification",
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects registry verification inside the publication job", async () => {
  const directory = await createFixture("# Changelog\n\n## Unreleased\n");
  const workflowPath = resolve(directory, ".github/workflows/release-mcp.yml");
  const guard = [
    "      - name: Verify registry dependency graph",
    "        run: >-",
    "          node scripts/check-mcp-registry-install.mjs",
    '          "${{ steps.artifact.outputs.archive }}"',
    "",
  ].join("\n");

  try {
    const workflow = await readFile(workflowPath, "utf8");
    assert.ok(workflow.includes(guard));
    await writeFile(workflowPath, `${workflow.replace(guard, "")}\n${guard}`);
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(
        "MCP registry dependency verification must not run in the publication job",
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects additional permissions in the registry verification job", async () => {
  const directory = await createFixture("# Changelog\n\n## Unreleased\n");
  const workflowPath = resolve(directory, ".github/workflows/release-mcp.yml");

  try {
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow.replace(
        "    permissions:\n      contents: read\n",
        "    permissions:\n      contents: read\n      packages: write\n",
      ),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(
        "MCP registry dependency verification job must not receive publication credentials",
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects artifact transfer from the registry verification job", async () => {
  const directory = await createFixture("# Changelog\n\n## Unreleased\n");
  const workflowPath = resolve(directory, ".github/workflows/release-mcp.yml");

  try {
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow.replace(
        "      - name: Verify registry dependency graph\n",
        [
          "      - uses: actions/upload-artifact@untrusted",
          "        with:",
          "          name: registry-package",
          "          path: disposable.tgz",
          "",
          "      - name: Verify registry dependency graph",
          "",
        ].join("\n"),
      ),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(
        "MCP registry compatibility artifacts must remain disposable and isolated",
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects registry job outputs consumed by publication", async () => {
  const directory = await createFixture("# Changelog\n\n## Unreleased\n");
  const workflowPath = resolve(directory, ".github/workflows/release-mcp.yml");

  try {
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow
        .replace(
          "    permissions:\n      contents: read\n    steps:\n",
          [
            "    permissions:",
            "      contents: read",
            "    outputs:",
            "      archive: ${{ steps.artifact.outputs.archive }}",
            "    steps:",
            "",
          ].join("\n"),
        )
        .replace(
          "    environment: npm\n",
          [
            "    environment: npm",
            "    env:",
            "      ARCHIVE: ${{ needs.registry-compatibility.outputs.archive }}",
            "",
          ].join("\n"),
        ),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(
        "MCP registry compatibility artifacts must remain disposable and isolated",
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
const candidateChangelog = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  `### \`@covenant-org/timeline-mcp\` ${manifest.version} candidate`,
  "",
].join("\n");

async function createFixture(changelog) {
  const directory = await mkdtemp(resolve(tmpdir(), "timeline-mcp-release-"));
  await mkdir(resolve(directory, "packages/mcp-server"), { recursive: true });
  await mkdir(resolve(directory, "packages/mcp-server/src"), {
    recursive: true,
  });
  await mkdir(resolve(directory, "packages/prototype"), { recursive: true });
  await mkdir(resolve(directory, ".github/workflows"), { recursive: true });
  await mkdir(resolve(directory, "docs"), { recursive: true });

  await Promise.all([
    copyFile(resolve(root, "README.md"), resolve(directory, "README.md")),
    copyFile(
      resolve(root, "docs/getting-started.md"),
      resolve(directory, "docs/getting-started.md"),
    ),
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
      resolve(root, "packages/mcp-server/src/constants.ts"),
      resolve(directory, "packages/mcp-server/src/constants.ts"),
    ),
    copyFile(
      resolve(root, "packages/prototype/package.json"),
      resolve(directory, "packages/prototype/package.json"),
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

async function makeMcpReleaseCopy(directory, { packageReadme = true } = {}) {
  const readmePath = resolve(directory, "README.md");
  const guidePath = resolve(directory, "docs/getting-started.md");
  const packageReadmePath = resolve(directory, "packages/mcp-server/README.md");
  const install = `npm install --save-exact @covenant-org/timeline-mcp@${manifest.version}`;
  const readme = (await readFile(readmePath, "utf8"))
    .replace(
      "[Connect a source-built MCP agent](#connect-an-agent-from-a-source-checkout)",
      "[Connect an MCP agent](#connect-an-agent)",
    )
    .replace(
      "## Connect an agent from a source checkout",
      "## Connect an agent",
    )
    .replace(
      "The local MCP server keeps typed temporal state durable across agent sessions.",
      `The local MCP server keeps typed temporal state durable across agent sessions.\n\n${install}`,
    )
    .replace(
      "The MCP package remains a source release candidate. Build it from a checkout:",
      "The MCP package is published.",
    )
    .replace(
      `\`@covenant-org/timeline-mcp@${manifest.version}\` is currently available from source.`,
      `\`@covenant-org/timeline-mcp@${manifest.version}\` is published.`,
    )
    .replace(
      `\`@covenant-org/timeline-mcp@${manifest.version}\` is not yet published. Build it from\na checkout:`,
      `\`@covenant-org/timeline-mcp@${manifest.version}\` is published.`,
    )
    .replace(
      `\`@covenant-org/timeline-mcp@${manifest.version}\` candidates are available from source.`,
      `\`@covenant-org/timeline-mcp@${manifest.version}\` is published.`,
    );
  const guide = (await readFile(guidePath, "utf8"))
    .replace("## Connect a source-built MCP agent", "## Connect an MCP agent")
    .replace(
      "`@covenant-org/timeline-mcp@0.0.0-alpha.1` is not yet published to npm. Build\nthe server from this repository:",
      `Install the MCP server with ${install}. To evaluate source, build the repository:`,
    );
  const writes = [writeFile(readmePath, readme), writeFile(guidePath, guide)];
  if (packageReadme) {
    const packageSource = await readFile(packageReadmePath, "utf8");
    writes.push(
      writeFile(
        packageReadmePath,
        packageSource
          .replace(
            "## Build from source",
            `## Install\n\n\`\`\`sh\n${install}\n\`\`\`\n\n## Build from source`,
          )
          .replace(
            "The MCP package is not yet published.",
            "The MCP package is published. Build from source to evaluate unreleased changes.",
          )
          .replace(
            `\`@covenant-org/timeline-mcp@${manifest.version}\` is not yet published. Use Node.js 22\nor 24 and build it from a source checkout:`,
            `\`@covenant-org/timeline-mcp@${manifest.version}\` is published. Source builds require Node.js 22 or 24.`,
          ),
      ),
    );
  }
  await Promise.all(writes);
}

test("validates an unreleased MCP package without a dated changelog entry", async () => {
  const directory = await createFixture(candidateChangelog);

  try {
    const result = runCheck(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no tag/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("allows the finalized MCP release entry to land before the tag", async () => {
  const changelog = `# Changelog\n\n## @covenant-org/timeline-mcp ${manifest.version} - 2026-08-01\n`;
  const directory = await createFixture(changelog);

  try {
    const result = runCheck(directory);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects simultaneous MCP candidate and finalized entries", async () => {
  const changelog = `${candidateChangelog}\n## @covenant-org/timeline-mcp ${manifest.version} - 2026-08-01\n`;
  const directory = await createFixture(changelog);

  try {
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /either .* candidate entry .* not both/);
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
        `CHANGELOG.md has no finalized MCP ${manifest.version} release entry`,
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
    await makeMcpReleaseCopy(directory);
    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`${releaseTag})`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an MCP tag that would freeze candidate onboarding copy", async () => {
  const changelog = [
    "# Changelog",
    "",
    `## @covenant-org/timeline-mcp ${manifest.version} - 2026-07-30`,
    "",
  ].join("\n");
  const directory = await createFixture(changelog);

  try {
    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /update immutable onboarding copy/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an MCP tag with stale copy in the packed README", async () => {
  const changelog = [
    "# Changelog",
    "",
    `## @covenant-org/timeline-mcp ${manifest.version} - 2026-07-30`,
    "",
  ].join("\n");
  const directory = await createFixture(changelog);

  try {
    await makeMcpReleaseCopy(directory, { packageReadme: false });
    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /update immutable onboarding copy/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires fail-closed MCP GitHub release reconciliation", async () => {
  const directory = await createFixture(candidateChangelog);
  const workflowPath = resolve(directory, ".github/workflows/release-mcp.yml");

  try {
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow.replace(
        "scripts/check-github-release-state.mjs",
        "scripts/disabled-release-state-check.mjs",
      ),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /create retry-safe GitHub assets/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires a portable MCP checksum sidecar filename", async () => {
  const directory = await createFixture(candidateChangelog);
  const workflowPath = resolve(directory, ".github/workflows/release-mcp.yml");

  try {
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow.replace(
        'sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256"',
        'sha256sum "$archive" > "$archive.sha256"',
      ),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /portable archive filename/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires the runtime server version to load the MCP manifest", async () => {
  const directory = await createFixture(candidateChangelog);
  const constantsPath = resolve(
    directory,
    "packages/mcp-server/src/constants.ts",
  );

  try {
    const source = await readFile(constantsPath, "utf8");
    await writeFile(
      constantsPath,
      source.replace('load("../package.json")', 'load("../other.json")'),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /server version must load its package manifest/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires the runtime Timeline version to load the core manifest", async () => {
  const directory = await createFixture(candidateChangelog);
  const constantsPath = resolve(
    directory,
    "packages/mcp-server/src/constants.ts",
  );

  try {
    const source = await readFile(constantsPath, "utf8");
    await writeFile(
      constantsPath,
      source.replace(
        'load("@covenant-org/timeline/package.json")',
        'load("@covenant-org/timeline/other.json")',
      ),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Timeline version must load the core package manifest/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires the tag workflow to verify registry dependencies", async () => {
  const directory = await createFixture(candidateChangelog);
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
  const directory = await createFixture(candidateChangelog);
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
  const directory = await createFixture(candidateChangelog);
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
  const directory = await createFixture(candidateChangelog);
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
  const directory = await createFixture(candidateChangelog);
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
  const directory = await createFixture(candidateChangelog);
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

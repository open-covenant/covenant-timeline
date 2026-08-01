import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const script = join(root, "scripts/check-release.mjs");
const manifest = JSON.parse(
  await readFile(join(root, "packages/prototype/package.json"), "utf8"),
);
const releaseTag = `timeline-v${manifest.version}`;

test("allows truthful candidate copy before a tag exists", async () => {
  await withFixture(async (directory) => {
    const result = runCheck(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no tag/);
  });
});

test("rejects a tag that would freeze candidate onboarding copy", async () => {
  await withFixture(async (directory) => {
    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /update immutable onboarding copy/);
  });
});

test("accepts a tag after core onboarding copy names the published version", async () => {
  await withFixture(async (directory) => {
    const readmePath = join(directory, "README.md");
    const guidePath = join(directory, "docs/getting-started.md");
    const readme = (await readFile(readmePath, "utf8"))
      .replaceAll(
        "npm install --save-exact @covenant-org/timeline@0.0.0-alpha.2",
        `npm install --save-exact @covenant-org/timeline@${manifest.version}`,
      )
      .replace(
        "alpha.3 core and alpha.1 MCP release candidates",
        "published alpha.3 core and alpha.1 MCP release candidate",
      )
      .replace(
        "The published `0.0.0-alpha.2` package contains",
        `The published \`${manifest.version}\` package contains`,
      )
      .replace(
        "The `0.0.0-alpha.2` package contains the",
        `The \`${manifest.version}\` package contains the`,
      )
      .replace(
        "[`@covenant-org/timeline@0.0.0-alpha.2`](https://www.npmjs.com/package/@covenant-org/timeline/v/0.0.0-alpha.2)\nis the recommended entry point",
        `[\`@covenant-org/timeline@${manifest.version}\`](https://www.npmjs.com/package/@covenant-org/timeline/v/${manifest.version})\nis the recommended entry point`,
      );
    const guide = (await readFile(guidePath, "utf8"))
      .replace(
        "npm install --save-exact @covenant-org/timeline@0.0.0-alpha.2",
        `npm install --save-exact @covenant-org/timeline@${manifest.version}`,
      )
      .replace(
        "The published alpha.2 package contains",
        "The published alpha.3 package contains",
      )
      .replace("source alpha.3 release candidate", "published alpha.3 package");
    await Promise.all([
      writeFile(readmePath, readme),
      writeFile(guidePath, guide),
    ]);

    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("requires exact-byte npm publication reconciliation", async () => {
  await withFixture(async (directory) => {
    const workflowPath = join(directory, ".github/workflows/release.yml");
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow.replace(
        "scripts/publish-npm-package.mjs",
        "scripts/disabled-publisher.mjs",
      ),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /reconcile immutable npm publication/);
  });
});

async function withFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "timeline-release-test-"));
  try {
    await Promise.all([
      mkdir(join(directory, ".github/workflows"), { recursive: true }),
      mkdir(join(directory, "docs"), { recursive: true }),
      mkdir(join(directory, "packages/prototype"), { recursive: true }),
      mkdir(join(directory, "scripts"), { recursive: true }),
    ]);
    await Promise.all([
      copyFile(join(root, "CHANGELOG.md"), join(directory, "CHANGELOG.md")),
      copyFile(join(root, "README.md"), join(directory, "README.md")),
      copyFile(
        join(root, "docs/getting-started.md"),
        join(directory, "docs/getting-started.md"),
      ),
      copyFile(
        join(root, ".github/workflows/release.yml"),
        join(directory, ".github/workflows/release.yml"),
      ),
      copyFile(
        join(root, "packages/prototype/package.json"),
        join(directory, "packages/prototype/package.json"),
      ),
      copyFile(
        join(root, "packages/prototype/LICENSE"),
        join(directory, "packages/prototype/LICENSE"),
      ),
      copyFile(
        join(root, "scripts/publish-npm-package.mjs"),
        join(directory, "scripts/publish-npm-package.mjs"),
      ),
    ]);
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runCheck(directory, tag) {
  return spawnSync(process.execPath, [script, ...(tag ? [tag] : [])], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_NAME: "" },
  });
}

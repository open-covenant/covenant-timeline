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

test("allows the finalized release entry to land before the tag", async () => {
  await withFixture(async (directory) => {
    await finalizeCoreChangelog(directory);

    const result = runCheck(directory);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("rejects simultaneous candidate and finalized release entries", async () => {
  await withFixture(async (directory) => {
    const changelogPath = join(directory, "CHANGELOG.md");
    const changelog = await readFile(changelogPath, "utf8");
    await writeFile(
      changelogPath,
      `${changelog}\n## ${manifest.version} - 2026-08-01\n`,
    );

    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /either .* candidate entry .* not both/);
  });
});

test("rejects a tag that would freeze candidate onboarding copy", async () => {
  await withFixture(async (directory) => {
    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /update immutable onboarding copy/);
  });
});

test("requires a dated changelog entry only when the release tag exists", async () => {
  await withFixture(async (directory) => {
    await makeCoreReleaseCopy(directory);

    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no finalized .* release entry/);
  });
});

test("accepts a tag after core onboarding copy names the published version", async () => {
  await withFixture(async (directory) => {
    await finalizeCoreChangelog(directory);
    await makeCoreReleaseCopy(directory);

    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("rejects a tag with stale copy in the packed core README", async () => {
  await withFixture(async (directory) => {
    await finalizeCoreChangelog(directory);
    await makeCoreReleaseCopy(directory, { packageReadme: false });

    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /update immutable onboarding copy/);
  });
});

test("rejects a stale scoped npm exec command in release copy", async () => {
  await withFixture(async (directory) => {
    await finalizeCoreChangelog(directory);
    await makeCoreReleaseCopy(directory);
    const packageReadmePath = join(directory, "packages/prototype/README.md");
    const packageReadme = await readFile(packageReadmePath, "utf8");
    await writeFile(
      packageReadmePath,
      packageReadme.replace(
        `npm exec --package=@covenant-org/timeline@${manifest.version}`,
        "npm exec --package=@covenant-org/timeline@0.0.0-alpha.2",
      ),
    );

    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /update immutable onboarding copy/);
  });
});

test("rejects a stale recommended package version in release copy", async () => {
  await withFixture(async (directory) => {
    await finalizeCoreChangelog(directory);
    await makeCoreReleaseCopy(directory);
    const readmePath = join(directory, "README.md");
    const readme = await readFile(readmePath, "utf8");
    await writeFile(
      readmePath,
      `${readme}\n\`@covenant-org/timeline@0.0.0-alpha.2\` is the recommended entry point.\n`,
    );

    const result = runCheck(directory, releaseTag);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /update immutable onboarding copy/);
  });
});

test("requires exact-byte npm publication reconciliation", async () => {
  await withFixture(async (directory) => {
    const publisherPath = join(directory, "scripts/publish-npm-package.mjs");
    const publisher = await readFile(publisherPath, "utf8");
    await writeFile(
      publisherPath,
      publisher.replace(
        "verifyExisting(recovered, expected, download)",
        "verifyExistingDisabled(recovered, expected, download)",
      ),
    );
    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /reconcile immutable npm publication/);
  });
});

test("requires durable release assets before npm publication", async () => {
  await withFixture(async (directory) => {
    const workflowPath = join(directory, ".github/workflows/release.yml");
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow.replace(
        "      - name: Retain release assets",
        "      - name: Stage",
      ),
    );

    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /create retry-safe GitHub assets/);
  });
});

test("requires fail-closed GitHub release reconciliation", async () => {
  await withFixture(async (directory) => {
    const workflowPath = join(directory, ".github/workflows/release.yml");
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
  });
});

test("requires a portable checksum sidecar filename", async () => {
  await withFixture(async (directory) => {
    const workflowPath = join(directory, ".github/workflows/release.yml");
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
  });
});

test("rejects release asset retention after npm publication", async () => {
  await withFixture(async (directory) => {
    const workflowPath = join(directory, ".github/workflows/release.yml");
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow
        .replace(
          "      - name: Retain release assets",
          "      - name: Temporary release step",
        )
        .replace(
          "      - name: Publish to npm",
          "      - name: Retain release assets",
        )
        .replace(
          "      - name: Temporary release step",
          "      - name: Publish to npm",
        ),
    );

    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /durable before npm publication/);
  });
});

test("requires scoped write permission for durable release assets", async () => {
  await withFixture(async (directory) => {
    const workflowPath = join(directory, ".github/workflows/release.yml");
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow.replace("      contents: write", "      contents: read"),
    );

    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /retain durable release assets/);
  });
});

test("rejects permissions beyond the release job's exact requirements", async () => {
  await withFixture(async (directory) => {
    const workflowPath = join(directory, ".github/workflows/release.yml");
    const workflow = await readFile(workflowPath, "utf8");
    await writeFile(
      workflowPath,
      workflow.replace(
        "      id-token: write",
        "      id-token: write\n      packages: write",
      ),
    );

    const result = runCheck(directory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /publication permissions must be exact/);
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
        join(root, "packages/prototype/README.md"),
        join(directory, "packages/prototype/README.md"),
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

async function finalizeCoreChangelog(directory) {
  await writeFile(
    join(directory, "CHANGELOG.md"),
    `# Changelog\n\n## ${manifest.version} - 2026-08-01\n`,
  );
}

async function makeCoreReleaseCopy(directory, { packageReadme = true } = {}) {
  const paths = [
    join(directory, "README.md"),
    join(directory, "docs/getting-started.md"),
  ];
  if (packageReadme)
    paths.push(join(directory, "packages/prototype/README.md"));

  await Promise.all(
    paths.map(async (path) => {
      const source = await readFile(path, "utf8");
      await writeFile(
        path,
        source
          .replaceAll(
            "@covenant-org/timeline@0.0.0-alpha.2",
            `@covenant-org/timeline@${manifest.version}`,
          )
          .replaceAll(
            "source alpha.3 release candidate",
            "published alpha.3 package",
          )
          .replaceAll(
            "The alpha.3 source candidate",
            "The published alpha.3 package",
          )
          .replaceAll(
            "currently available from a source checkout",
            "published in this package",
          )
          .replaceAll("candidates", "releases")
          .replaceAll("candidate", "release"),
      );
    }),
  );
}

function runCheck(directory, tag) {
  return spawnSync(process.execPath, [script, ...(tag ? [tag] : [])], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_NAME: "" },
  });
}

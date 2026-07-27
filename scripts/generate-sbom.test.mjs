import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

for (const packageDirectory of ["packages/prototype", "packages/mcp-server"]) {
  test(`emits the complete ${packageDirectory} production graph`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-sbom-"));
    const output = join(directory, "sbom.json");

    try {
      await run(
        process.execPath,
        ["scripts/generate-sbom.mjs", output, packageDirectory],
        {
          cwd: root,
          env: {
            ...process.env,
            GITHUB_SHA: "0".repeat(40),
            SOURCE_DATE_EPOCH: "0",
          },
        },
      );

      const document = JSON.parse(await readFile(output, "utf8"));
      const manifest = JSON.parse(
        await readFile(join(root, packageDirectory, "package.json"), "utf8"),
      );
      const expected = await resolvedGraph(manifest.name);
      const actualPackages = new Set(
        document.packages.map((entry) => `${entry.name}@${entry.versionInfo}`),
      );
      const idToPackage = new Map(
        document.packages.map((entry) => [
          entry.SPDXID,
          `${entry.name}@${entry.versionInfo}`,
        ]),
      );
      const actualRelationships = new Set(
        document.relationships
          .filter((entry) => entry.relationshipType === "DEPENDS_ON")
          .map(
            (entry) =>
              `${idToPackage.get(entry.spdxElementId)}\0${idToPackage.get(entry.relatedSpdxElement)}`,
          ),
      );

      assert.deepEqual(actualPackages, expected.packages);
      assert.deepEqual(actualRelationships, expected.relationships);
      const describes = document.relationships.filter(
        (entry) =>
          entry.spdxElementId === "SPDXRef-DOCUMENT" &&
          entry.relationshipType === "DESCRIBES",
      );
      assert.equal(describes.length, 1);
      assert.equal(
        idToPackage.get(describes[0].relatedSpdxElement),
        `${manifest.name}@${manifest.version}`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

async function resolvedGraph(packageName) {
  const { stdout } = await run(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "--filter",
      packageName,
      "list",
      "--prod",
      "--json",
      "--depth",
      "Infinity",
    ],
    { cwd: root },
  );
  const [listedRoot] = JSON.parse(stdout);
  const packages = new Set();
  const relationships = new Set();
  const traversed = new Set();

  async function visit(node, parent) {
    const manifest = JSON.parse(
      await readFile(join(node.path, "package.json"), "utf8"),
    );
    const key = `${manifest.name}@${manifest.version}`;
    packages.add(key);
    if (parent) relationships.add(`${parent}\0${key}`);
    if (traversed.has(key)) return;
    traversed.add(key);
    for (const dependency of Object.values(node.dependencies ?? {})) {
      await visit(dependency, key);
    }
  }

  await visit(listedRoot);
  return { packages, relationships };
}

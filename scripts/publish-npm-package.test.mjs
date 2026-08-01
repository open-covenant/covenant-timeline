import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reconcileNpmPackage } from "./publish-npm-package.mjs";

const packageName = "@covenant-org/timeline";
const version = "0.0.0-alpha.3";
const distTag = "next";

test("accepts an existing immutable version only when bytes match", async () => {
  await withArchive(async ({ archive, bytes }) => {
    let published = false;
    const result = await reconcileNpmPackage(
      { archive, packageName, version, distTag },
      {
        inspect: async () => metadata(bytes),
        download: async () => bytes,
        publish: async () => {
          published = true;
        },
      },
    );
    assert.equal(result.status, "existing");
    assert.equal(published, false);
  });
});

test("publishes an absent immutable version", async () => {
  await withArchive(async ({ archive }) => {
    let published;
    const result = await reconcileNpmPackage(
      { archive, packageName, version, distTag },
      {
        inspect: async () => null,
        publish: async (value) => {
          published = value;
        },
      },
    );
    assert.equal(result.status, "published");
    assert.equal(published.archive, archive);
    assert.equal(published.distTag, distTag);
  });
});

test("recovers when publication succeeds but its response is lost", async () => {
  await withArchive(async ({ archive, bytes }) => {
    let inspections = 0;
    const result = await reconcileNpmPackage(
      { archive, packageName, version, distTag },
      {
        inspect: async () => (inspections++ === 0 ? null : metadata(bytes)),
        download: async () => bytes,
        publish: async () => {
          throw new Error("publication response lost");
        },
      },
    );
    assert.equal(result.status, "recovered");
    assert.equal(inspections, 2);
  });
});

test("rejects an existing version with different bytes", async () => {
  await withArchive(async ({ archive }) => {
    const observed = Buffer.from("different archive");
    await assert.rejects(
      reconcileNpmPackage(
        { archive, packageName, version, distTag },
        {
          inspect: async () => metadata(observed),
          download: async () => observed,
          publish: async () => assert.fail("must not publish over a version"),
        },
      ),
      /differs from the release archive/,
    );
  });
});

test("rejects registry integrity disagreement", async () => {
  await withArchive(async ({ archive, bytes }) => {
    const invalid = { ...metadata(bytes), integrity: "sha512-invalid" };
    await assert.rejects(
      reconcileNpmPackage(
        { archive, packageName, version, distTag },
        {
          inspect: async () => invalid,
          download: async () => bytes,
          publish: async () => assert.fail("must not publish over a version"),
        },
      ),
      /integrity is invalid/,
    );
  });
});

test("preserves the publish failure when the version remains absent", async () => {
  await withArchive(async ({ archive }) => {
    const failure = new Error("publication failed");
    await assert.rejects(
      reconcileNpmPackage(
        { archive, packageName, version, distTag },
        {
          inspect: async () => null,
          publish: async () => {
            throw failure;
          },
        },
      ),
      (error) => error === failure,
    );
  });
});

async function withArchive(run) {
  const directory = await mkdtemp(join(tmpdir(), "timeline-publish-test-"));
  const archive = join(directory, "timeline.tgz");
  const bytes = Buffer.from("release archive");
  try {
    await writeFile(archive, bytes);
    await run({ archive, bytes });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function metadata(bytes) {
  return {
    tarball:
      "https://registry.npmjs.org/@covenant-org/timeline/-/timeline-0.0.0-alpha.3.tgz",
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    shasum: createHash("sha1").update(bytes).digest("hex"),
  };
}

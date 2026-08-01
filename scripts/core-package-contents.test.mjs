import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCoreArchiveEntries,
  assertCoreArchiveFiles,
  coreArchiveFilesForVersion,
  expectedCoreAlpha2ArchiveFiles,
  expectedCoreArchiveFiles,
  maxCoreArchiveUnpackedBytes,
} from "./core-package-contents.mjs";

test("accepts the closed core package file set", () => {
  assert.deepEqual(assertCoreArchiveFiles(expectedCoreArchiveFiles), {
    fileCount: expectedCoreArchiveFiles.length,
    unpackedSize: 0,
  });
});

test("keeps historical and candidate archive profiles explicit", () => {
  assert.equal(
    expectedCoreArchiveFiles.length - expectedCoreAlpha2ArchiveFiles.length,
    4,
  );
  assert.equal(
    coreArchiveFilesForVersion("0.0.0-alpha.2"),
    expectedCoreAlpha2ArchiveFiles,
  );
  assert.equal(
    coreArchiveFilesForVersion("0.0.0-alpha.3"),
    expectedCoreArchiveFiles,
  );
  assert.throws(
    () => coreArchiveFilesForVersion("0.0.0-alpha.4"),
    /unsupported core archive profile/,
  );
});

test("rejects missing, unexpected, duplicate, and non-regular members", () => {
  assert.throws(
    () => assertCoreArchiveFiles(expectedCoreArchiveFiles.slice(1)),
    /missing core archive files/,
  );
  assert.throws(
    () =>
      assertCoreArchiveFiles([
        ...expectedCoreArchiveFiles,
        "package/unexpected.js",
      ]),
    /unexpected core archive files/,
  );
  assert.throws(
    () =>
      assertCoreArchiveFiles([
        ...expectedCoreArchiveFiles,
        expectedCoreArchiveFiles[0],
      ]),
    /duplicate core archive members/,
  );

  const entries = expectedCoreArchiveFiles.map((name) => ({
    name,
    size: 0,
    type: "-",
  }));
  entries[0] = { ...entries[0], type: "l" };
  assert.throws(
    () => assertCoreArchiveEntries(entries),
    /non-regular core archive members/,
  );
});

test("bounds total unpacked size and can bind an exact total", () => {
  const entries = expectedCoreArchiveFiles.map((name) => ({
    name,
    size: 0,
    type: "-",
  }));
  entries[0] = { ...entries[0], size: 42 };
  assert.deepEqual(
    assertCoreArchiveEntries(entries, { expectedUnpackedSize: 42 }),
    { fileCount: expectedCoreArchiveFiles.length, unpackedSize: 42 },
  );
  assert.throws(
    () => assertCoreArchiveEntries(entries, { expectedUnpackedSize: 43 }),
    /core archive unpacked size must be 43/,
  );
  entries[0] = { ...entries[0], size: maxCoreArchiveUnpackedBytes + 1 };
  assert.throws(
    () => assertCoreArchiveEntries(entries),
    /core archive exceeds/,
  );
});

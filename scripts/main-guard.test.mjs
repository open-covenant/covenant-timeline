import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isMain } from "./mcp-agent-pilot-lib.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("main-module identity resolves path aliases and fails closed", () => {
  const file = fileURLToPath(import.meta.url);
  assert.equal(isMain(import.meta.url, file), true);
  assert.equal(
    isMain(import.meta.url, join(tmpdir(), "missing-main.mjs")),
    false,
  );
});

test("the formal bootstrap executes through a directory alias", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "timeline-main-alias-"));
  try {
    const alias = join(temporary, "source");
    try {
      await symlink(
        root,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (
        process.platform === "win32" &&
        ["EACCES", "EPERM"].includes(error?.code)
      ) {
        t.skip("directory aliases are unavailable on this Windows runner");
        return;
      }
      throw error;
    }

    const result = spawnSync(
      process.execPath,
      [join(alias, "scripts/mcp-real-model-pilot-bootstrap.mjs")],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pilot requires an adapter command/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("root entrypoints use the canonical main-module guard", async () => {
  const files = [
    ...(await javascriptFiles(join(root, "scripts"))),
    ...(await javascriptFiles(join(root, "examples"))),
  ];
  const rawGuards = [];
  const guarded = [];

  for (const file of files) {
    if (file.endsWith(".test.mjs")) continue;
    const source = await readFile(file, "utf8");
    if (source.includes("process.argv[1]"))
      rawGuards.push(relative(root, file).replaceAll("\\", "/"));
    if (source.includes("isMain(import.meta.url)")) guarded.push(file);
  }

  assert.deepEqual(rawGuards, ["scripts/mcp-agent-pilot-lib.mjs"]);
  assert.equal(guarded.length, 27);
});

async function javascriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await javascriptFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(path);
  }
  return files;
}

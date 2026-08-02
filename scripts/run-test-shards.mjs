#!/usr/bin/env node

import { spawn } from "node:child_process";

const [file, rawCount] = process.argv.slice(2);
const count = Number(rawCount);

if (!file || !Number.isSafeInteger(count) || count < 2 || count > 32) {
  throw new Error("usage: run-test-shards <test-file> <shard-count>");
}

const results = await Promise.allSettled(
  Array.from({ length: count }, (_, index) => runShard(file, index, count)),
);

for (const [index, result] of results.entries()) {
  if (
    result.status === "rejected" ||
    result.value.code !== 0 ||
    result.value.signal !== null
  ) {
    const detail =
      result.status === "rejected"
        ? result.reason instanceof Error
          ? result.reason.message
          : "could not start"
        : (result.value.signal ?? `exit ${result.value.code}`);
    process.stderr.write(
      `test shard ${index + 1}/${count} failed: ${detail}\n`,
    );
    process.exitCode = 1;
  }
}

function runShard(testFile, index, total) {
  return new Promise((resolve, reject) => {
    const id = `${index + 1}/${total}`;
    process.stderr.write(`starting test shard ${id}\n`);
    const child = spawn(process.execPath, ["--test", testFile], {
      env: { ...process.env, TIMELINE_PILOT_TEST_SHARD: id },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

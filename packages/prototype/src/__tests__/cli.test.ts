import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isCliEntry, runCli } from "../cli.js";
import type { TimelineRunDocument } from "../index.js";
import { contract } from "./contract.test.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("timeline CLI", () => {
  it("validates, replays, inspects, and verifies a run", async () => {
    const file = await writeRun();

    expect((await invoke(["validate", file])).code).toBe(0);

    const replayed = await invoke(["replay", file, "--json"]);
    expect(replayed.code).toBe(0);
    expect(JSON.parse(replayed.stdout)).toMatchObject({
      schema: "covenant.timeline.report.v0alpha1",
      runId: "cli-run",
    });

    const inspected = await invoke(["inspect", file]);
    expect(inspected.stdout).toContain("CHECKPOINTS");
    expect(inspected.stdout).toContain("release-ready: pending");

    const verified = await invoke(["verify", file]);
    expect(verified.code).toBe(1);
    expect(verified.stderr).toContain("FAILED cli-run");
    expect(verified.stderr).toContain("pending checkpoints: release-ready");
  });

  it("reports malformed JSON without a stack trace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-cli-"));
    directories.push(directory);
    const file = join(directory, "invalid.json");
    await writeFile(file, "{", "utf8");

    const result = await invoke(["validate", file, "--json"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      code: "timeline.input.invalid_json",
    });
  });

  it("recognizes an installed bin symlink as the CLI entry point", () => {
    expect(isCliEntry("node_modules/.bin/timeline", () => "dist/cli.js")).toBe(
      true,
    );
  });
});

async function writeRun(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "timeline-cli-"));
  directories.push(directory);
  const file = join(directory, "run.json");
  const run: TimelineRunDocument = {
    schema: "covenant.timeline.run.v0alpha1",
    runId: "cli-run",
    contract,
    events: [],
  };
  await writeFile(file, JSON.stringify(run), "utf8");
  return file;
}

async function invoke(argv: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, {
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { code, stdout, stderr };
}

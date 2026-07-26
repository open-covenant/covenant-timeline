import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_INPUT_BYTES, isCliEntry, runCli } from "../cli.js";
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
    expect(verified.stderr).toContain("STRUCTURAL VERIFICATION FAILED cli-run");
    expect(verified.stderr).toContain("evaluation requirement coverage");
    expect(verified.stderr).toContain("policy binding unverified event label");
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

  it("reports duplicate JSON keys and read failures with stable codes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-cli-"));
    directories.push(directory);
    const duplicate = join(directory, "duplicate.json");
    await writeFile(
      duplicate,
      '{"schema":"covenant.timeline.run.v0alpha1","runId":"one","runId":"two","contract":{},"events":[]}',
      "utf8",
    );

    const duplicateResult = await invoke(["validate", duplicate, "--json"]);
    expect(JSON.parse(duplicateResult.stderr)).toMatchObject({
      code: "timeline.input.invalid_json",
      issues: [{ code: "duplicate_key", path: "$.runId" }],
    });

    const missingResult = await invoke([
      "validate",
      join(directory, "missing.json"),
      "--json",
    ]);
    expect(JSON.parse(missingResult.stderr)).toMatchObject({
      code: "timeline.input.read_failed",
    });
  });

  it("prints the package version", async () => {
    const result = await invoke(["--version"]);

    expect(result).toEqual({
      code: 0,
      stdout: "0.0.0-alpha.1\n",
      stderr: "",
    });
  });

  it("reasons over a temporal run and emits a proof receipt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-cli-"));
    directories.push(directory);
    const runFile = join(directory, "temporal-run.json");
    const queryFile = join(directory, "temporal-query.json");
    await writeFile(
      runFile,
      JSON.stringify({
        schema: "covenant.timeline.run.v0alpha3",
        contract: {
          schema: "covenant.timeline.contract.v0alpha3",
          id: "cli.temporal.v1",
          subject: { kind: "workflow", id: "example" },
          axes: [
            {
              id: "elapsed",
              kind: "metric",
              unit: "tick",
              origin: "workflow.origin.v1",
            },
          ],
          contexts: [{ id: "actual", mode: "actual" }],
        },
        events: [
          {
            schema: "covenant.timeline.event.v0alpha3",
            id: "event-0",
            sequence: 0,
            type: "point.declared",
            point: {
              id: "start",
              contextId: "actual",
              axisId: "elapsed",
            },
          },
          {
            schema: "covenant.timeline.event.v0alpha3",
            id: "event-1",
            sequence: 1,
            type: "point.declared",
            point: { id: "end", contextId: "actual", axisId: "elapsed" },
          },
          {
            schema: "covenant.timeline.event.v0alpha3",
            id: "event-2",
            sequence: 2,
            type: "coordinate.asserted",
            assertion: {
              id: "start-coordinate",
              contextId: "actual",
              pointId: "start",
              coordinate: { minimum: 0, maximum: 0 },
              evidenceRefs: [
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              ],
            },
          },
          {
            schema: "covenant.timeline.event.v0alpha3",
            id: "event-3",
            sequence: 3,
            type: "constraint.asserted",
            assertion: {
              id: "duration",
              contextId: "actual",
              constraint: {
                fromPointId: "start",
                toPointId: "end",
                minimum: 5,
                maximum: 10,
              },
              evidenceRefs: [
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              ],
            },
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      queryFile,
      JSON.stringify({
        schema: "covenant.timeline.query.v0alpha3",
        id: "query.duration",
        contextId: "actual",
        recordedThrough: 3,
        type: "difference.bounds",
        fromPointId: "start",
        toPointId: "end",
      }),
      "utf8",
    );

    const result = await invoke(["reason", runFile, queryFile, "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "covenant.timeline.conclusion.v0alpha3",
      queryId: "query.duration",
      result: {
        type: "difference.bounds",
        status: "bounded",
        minimum: 5,
        maximum: 10,
      },
      receipt: { proof: { kind: "bounds" } },
    });
  });

  it("rejects input above the CLI byte ceiling", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-cli-"));
    directories.push(directory);
    const file = join(directory, "oversized.json");
    await writeFile(file, Buffer.alloc(DEFAULT_MAX_INPUT_BYTES + 1));

    const result = await invoke(["validate", file, "--json"]);

    expect(JSON.parse(result.stderr)).toMatchObject({
      code: "timeline.input.too_large",
    });
  });

  it("rejects invalid UTF-8 before JSON parsing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-cli-"));
    directories.push(directory);
    const file = join(directory, "invalid-utf8.json");
    await writeFile(file, Buffer.from([0xff]));

    const result = await invoke(["validate", file, "--json"]);

    expect(JSON.parse(result.stderr)).toMatchObject({
      code: "timeline.input.invalid_json",
      issues: [{ detail: "input is not valid UTF-8" }],
    });
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

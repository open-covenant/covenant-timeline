import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runCorrectionDemo } from "./demo.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("installed correction demo", () => {
  test("reloads and verifies both knowledge cuts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-mcp-demo-test-"));
    directories.push(directory);

    const demo = await runCorrectionDemo(directory);

    expect(demo.schema).toBe("covenant.timeline.mcp-demo.v1");
    expect(demo.eventCount).toBe(6);
    expect(demo.reloadedFromDisk).toBe(true);
    expect(demo.before.verified).toBe(true);
    expect(demo.before.query.recordedThrough).toBe(3);
    expect(demo.before.conclusion.result).toEqual({
      type: "difference.bounds",
      status: "bounded",
      minimum: -100,
      maximum: -100,
    });
    expect(demo.after.verified).toBe(true);
    expect(demo.after.query.recordedThrough).toBe(5);
    expect(demo.after.conclusion.result).toEqual({
      type: "difference.bounds",
      status: "bounded",
      minimum: 100,
      maximum: 100,
    });
    expect(demo.before.conclusion.receipt.stateDigest).not.toBe(
      demo.after.conclusion.receipt.stateDigest,
    );
    expect(demo.run.events).toHaveLength(demo.eventCount);
  });
});

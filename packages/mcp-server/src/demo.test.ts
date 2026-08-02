import {
  canonicalJson,
  contentDigest,
  type JsonValue,
} from "@covenant-org/timeline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseMcpRunEnvelopeV0Alpha2 } from "./store.js";
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
    const demo = await runDemo();
    const timeline = parseMcpRunEnvelopeV0Alpha2(demo.timeline);

    expect(demo.schema).toBe("covenant.timeline.mcp-demo.v1");
    expect(demo.scenario).toBe("late-security-review-correction");
    expect(demo.reloadedFromDisk).toBe(true);
    expect(timeline.revision).toBe(5);
    expect(timeline.admissions).toHaveLength(5);
    expect(
      timeline.admissions.every(
        ({ policyDigest }) =>
          policyDigest ===
          contentDigest(demo.admissionPolicy as unknown as JsonValue),
      ),
    ).toBe(true);
    expect(demo.before.verified).toBe(true);
    expect(demo.before.query.recordedThrough).toBe(3);
    expect(demo.before.conclusion.result).toEqual({
      type: "difference.bounds",
      status: "bounded",
      minimum: -100,
      maximum: -100,
    });
    expect(demo.after.verified).toBe(true);
    expect(demo.after.query.recordedThrough).toBe(4);
    expect(demo.after.conclusion.result).toEqual({
      type: "difference.bounds",
      status: "bounded",
      minimum: 100,
      maximum: 100,
    });
    expect(demo.before.conclusion.receipt.stateDigest).not.toBe(
      demo.after.conclusion.receipt.stateDigest,
    );
  });

  test("emits identical portable output from independent stores", async () => {
    const first = await runDemo();
    const second = await runDemo();
    expect(canonicalJson(first as unknown as JsonValue)).toBe(
      canonicalJson(second as unknown as JsonValue),
    );
  });
});

async function runDemo() {
  const directory = await mkdtemp(join(tmpdir(), "timeline-mcp-demo-test-"));
  directories.push(directory);
  return runCorrectionDemo(directory);
}

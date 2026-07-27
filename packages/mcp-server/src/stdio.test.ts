import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, test } from "vitest";
import {
  appendEventOutputSchema,
  createRunOutputSchema,
  listRunsOutputSchema,
  projectStateOutputSchema,
  reasonOutputSchema,
} from "./schemas.js";
import {
  afterQuery,
  beforeQuery,
  correctionEvents,
  releaseContract,
} from "./__tests__/fixtures.js";
import { DEFAULT_MAX_MESSAGE_BYTES } from "./constants.js";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

describe("timeline-mcp stdio", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  test("preserves projected state and verified reasoning across restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-mcp-stdio-"));
    directories.push(directory);
    const contract = releaseContract();

    const first = await connect(directory);
    try {
      const created = createRunOutputSchema.parse(
        (
          await first.client.callTool({
            name: "timeline_create_run",
            arguments: { contract },
          })
        ).structuredContent,
      );
      let runDigest = created.timeline.runDigest;

      for (const event of correctionEvents) {
        const appended = appendEventOutputSchema.parse(
          (
            await first.client.callTool({
              name: "timeline_append_event",
              arguments: {
                runId: contract.id,
                expectedRunDigest: runDigest,
                event,
              },
            })
          ).structuredContent,
        );
        expect(appended.appended).toBe(true);
        runDigest = appended.timeline.runDigest;
      }

      const listed = listRunsOutputSchema.parse(
        (
          await first.client.callTool({
            name: "timeline_list_runs",
            arguments: {},
          })
        ).structuredContent,
      );
      expect(listed.timelines).toEqual([
        expect.objectContaining({
          runId: contract.id,
          eventCount: correctionEvents.length,
          latestRecordedThrough: correctionEvents.length - 1,
          runDigest,
        }),
      ]);
    } finally {
      await first.client.close();
    }
    expect(first.stderr()).toBe("");

    const restarted = await connect(directory);
    try {
      const listed = listRunsOutputSchema.parse(
        (
          await restarted.client.callTool({
            name: "timeline_list_runs",
            arguments: {},
          })
        ).structuredContent,
      );
      expect(listed.timelines).toEqual([
        expect.objectContaining({
          runId: contract.id,
          revision: correctionEvents.length,
          eventCount: correctionEvents.length,
        }),
      ]);

      const before = projectStateOutputSchema.parse(
        (
          await restarted.client.callTool({
            name: "timeline_project_state",
            arguments: {
              runId: contract.id,
              contextId: "actual",
              recordedThrough: 3,
            },
          })
        ).structuredContent,
      );
      expect(before.state.coordinates.map(({ id }) => id).sort()).toEqual([
        "deploy.v1",
        "review.v1",
      ]);

      const after = projectStateOutputSchema.parse(
        (
          await restarted.client.callTool({
            name: "timeline_project_state",
            arguments: {
              runId: contract.id,
              contextId: "actual",
              recordedThrough: 5,
            },
          })
        ).structuredContent,
      );
      expect(after.state.coordinates.map(({ id }) => id).sort()).toEqual([
        "deploy.v1",
        "review.v2",
      ]);

      await expectDifference(restarted.client, contract.id, beforeQuery, -100);
      await expectDifference(restarted.client, contract.id, afterQuery, 100);
    } finally {
      await restarted.client.close();
    }
    expect(restarted.stderr()).toBe("");
  });

  test("closes on protocol input above the byte limit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-mcp-stdio-"));
    directories.push(directory);
    const child = spawn(process.execPath, [cliPath, "--data-dir", directory], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.stdin.end(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { padding: "x".repeat(DEFAULT_MAX_MESSAGE_BYTES) },
      })}\n`,
    );

    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    expect(exit).toEqual({ code: 0, signal: null });
    expect(Buffer.concat(stdout).toString("utf8")).toBe("");
    expect(Buffer.concat(stderr).toString("utf8")).toBe(
      "timeline-mcp: invalid protocol input\n",
    );
  });
});

async function connect(directory: string): Promise<{
  client: Client;
  stderr: () => string;
}> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "--data-dir", directory],
    stderr: "pipe",
  });
  const stderr: Buffer[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
  });

  const client = new Client({
    name: "timeline-mcp-stdio-test",
    version: "0.0.0",
  });
  await client.connect(transport);
  return {
    client,
    stderr: () => Buffer.concat(stderr).toString("utf8"),
  };
}

async function expectDifference(
  client: Client,
  runId: string,
  query: typeof beforeQuery | typeof afterQuery,
  expected: number,
): Promise<void> {
  const reasoned = reasonOutputSchema.parse(
    (
      await client.callTool({
        name: "timeline_reason",
        arguments: { runId, query },
      })
    ).structuredContent,
  );
  const result = reasoned.conclusion.result;
  if (result.type !== "difference.bounds") {
    throw new Error("expected difference-bounds result");
  }

  expect(reasoned.verified).toBe(true);
  expect(result).toMatchObject({
    status: "bounded",
    minimum: expected,
    maximum: expected,
  });
  expect(reasoned.conclusion.receipt.stateDigest).toMatch(
    /^sha256:[0-9a-f]{64}$/,
  );
}

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  parseRunDocumentV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
  type JsonValue,
  type TemporalConclusionV0Alpha3,
} from "@covenant-org/timeline";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { correctionEvents, releaseContract } from "./__tests__/fixtures.js";
import {
  appendEventOutputSchema,
  createRunOutputSchema,
  listRunsOutputSchema,
  projectStateOutputSchema,
  reasonOutputSchema,
} from "./schemas.js";
import {
  createTimelineMcpServer,
  FileMcpRunStore,
  type McpRunStore,
} from "./index.js";

const toolNames = [
  "timeline_create_run",
  "timeline_list_runs",
  "timeline_append_event",
  "timeline_project_state",
  "timeline_reason",
];

describe("Timeline MCP server", () => {
  let directory: string;
  let connection: Awaited<ReturnType<typeof connect>>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "timeline-mcp-server-"));
    connection = await connect(new FileMcpRunStore(directory));
  });

  afterEach(async () => {
    await connection.close();
    await rm(directory, { recursive: true, force: true });
  });

  test("exposes the exact bounded tool surface", async () => {
    const listed = await connection.client.listTools();

    expect(listed.tools.map(({ name }) => name)).toEqual(toolNames);
    expect(listed.tools.every(({ outputSchema }) => outputSchema)).toBe(true);
  });

  test("exports encoded run resources and sanitizes resource failures", async () => {
    const contract = releaseContract("agent/release:42");
    await connection.client.callTool({
      name: "timeline_create_run",
      arguments: { contract },
    });

    const listed = await connection.client.listResources();
    expect(listed.resources).toEqual([
      expect.objectContaining({
        name: contract.id,
        uri: "timeline://run/agent%2Frelease%3A42",
        mimeType: "application/json",
      }),
    ]);
    const resource = await connection.client.readResource({
      uri: listed.resources[0]!.uri,
    });
    const content = resource.contents[0];
    if (!content || !("text" in content)) {
      throw new Error("timeline resource did not contain JSON text");
    }
    expect(parseRunDocumentV0Alpha3(JSON.parse(content.text)).contract.id).toBe(
      contract.id,
    );

    await connection.close();
    const secret = "private-storage-detail";
    connection = await connect(failingStore(secret));
    const listFailure = await connection.client
      .listResources()
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(String(listFailure)).toContain(
      "timeline.mcp.internal: request failed",
    );
    expect(String(listFailure)).not.toContain(secret);

    await expect(
      connection.client.readResource({
        uri: "timeline://run/agent.release",
      }),
    ).rejects.toThrow("timeline.mcp.internal: request failed");
    await expect(
      connection.client.readResource({
        uri: "timeline://run/agent.release",
      }),
    ).rejects.not.toThrow(secret);
  });

  test("replays a corrected release and exports independently verifiable receipts", async () => {
    const contract = releaseContract();
    const created = createRunOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_create_run",
          arguments: { contract },
        })
      ).structuredContent,
    );

    expect(created).toMatchObject({
      created: true,
      timeline: {
        runId: contract.id,
        revision: 0,
        latestRecordedThrough: null,
      },
      admission: {
        mode: "structural-only",
        assertionAuthority: "unverified",
        evidencePayloads: "external",
      },
    });

    const listed = listRunsOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_list_runs",
          arguments: {},
        })
      ).structuredContent,
    );
    expect(listed.timelines).toEqual([created.timeline]);

    let runDigest = created.timeline.runDigest;
    for (const [sequence, event] of correctionEvents.entries()) {
      const appended = appendEventOutputSchema.parse(
        (
          await connection.client.callTool({
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
      expect(appended.event).toMatchObject({
        id: event.id,
        schema: "covenant.timeline.event.v0alpha3",
        sequence,
      });
      runDigest = appended.timeline.runDigest;
    }

    const beforeState = projectStateOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_project_state",
          arguments: {
            runId: contract.id,
            contextId: "actual",
            recordedThrough: 3,
          },
        })
      ).structuredContent,
    );
    expect(beforeState.state.recordedThrough).toBe(3);
    expect(beforeState.state.coordinates.map(({ id }) => id).sort()).toEqual([
      "deploy.v1",
      "review.v1",
    ]);

    const afterState = projectStateOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_project_state",
          arguments: {
            runId: contract.id,
            contextId: "actual",
            recordedThrough: 5,
          },
        })
      ).structuredContent,
    );
    expect(afterState.state.recordedThrough).toBe(5);
    expect(afterState.state.coordinates.map(({ id }) => id).sort()).toEqual([
      "deploy.v1",
      "review.v2",
    ]);

    const before = reasonOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_reason",
          arguments: {
            runId: contract.id,
            query: {
              id: "query.review-minus-deploy.before",
              contextId: "actual",
              recordedThrough: 3,
              type: "difference.bounds",
              fromPointId: "deployed",
              toPointId: "review-finished",
            },
          },
        })
      ).structuredContent,
    );
    expect(before).toMatchObject({
      verified: true,
      conclusion: {
        result: {
          type: "difference.bounds",
          status: "bounded",
          minimum: -100,
          maximum: -100,
        },
      },
    });

    const after = reasonOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_reason",
          arguments: {
            runId: contract.id,
            query: {
              id: "query.review-minus-deploy.after",
              contextId: "actual",
              recordedThrough: 5,
              type: "difference.bounds",
              fromPointId: "deployed",
              toPointId: "review-finished",
            },
          },
        })
      ).structuredContent,
    );
    expect(after).toMatchObject({
      verified: true,
      conclusion: {
        result: {
          type: "difference.bounds",
          status: "bounded",
          minimum: 100,
          maximum: 100,
        },
      },
    });

    const relation = reasonOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_reason",
          arguments: {
            runId: contract.id,
            query: {
              id: "query.review-after-deploy",
              contextId: "actual",
              recordedThrough: 5,
              type: "point.relations",
              leftPointId: "review-finished",
              rightPointId: "deployed",
            },
          },
        })
      ).structuredContent,
    );
    expect(relation).toMatchObject({
      verified: true,
      conclusion: {
        result: {
          type: "point.relations",
          status: "resolved",
          possible: ["after"],
        },
      },
    });

    const resource = await connection.client.readResource({
      uri: "timeline://run/agent.release",
    });
    const contents = resource.contents[0];
    if (!contents || !("text" in contents)) {
      throw new Error("timeline resource did not contain JSON text");
    }

    const run = parseRunDocumentV0Alpha3(JSON.parse(contents.text));
    expect(contents.mimeType).toBe("application/json");
    expect(contents.text).toBe(canonicalJson(run as unknown as JsonValue));
    expect(
      verifyTemporalConclusionV0Alpha3(
        run,
        before.query,
        before.conclusion as TemporalConclusionV0Alpha3,
      ),
    ).toBe(true);
    expect(
      verifyTemporalConclusionV0Alpha3(
        run,
        after.query,
        after.conclusion as TemporalConclusionV0Alpha3,
      ),
    ).toBe(true);
  });

  test("returns stable safe envelopes for known and unexpected failures", async () => {
    const missing = await connection.client.callTool({
      name: "timeline_project_state",
      arguments: {
        runId: "missing.run",
        contextId: "actual",
        recordedThrough: null,
      },
    });

    expect(missing).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "timeline.mcp.store.not-found: timeline does not exist",
        },
      ],
    });

    await connection.close();
    const secret = "postgres://operator:secret@private.example/timeline";
    connection = await connect(failingStore(secret));
    const failed = await connection.client.callTool({
      name: "timeline_list_runs",
      arguments: {},
    });

    expect(failed).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "timeline.mcp.internal: request failed",
        },
      ],
    });
    expect(JSON.stringify(failed)).not.toContain(secret);
  });
});

async function connect(store: McpRunStore) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createTimelineMcpServer(store);
  const client = new Client({
    name: "timeline-mcp-tests",
    version: "0.0.0",
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}

function failingStore(secret: string): McpRunStore {
  const fail = async (): Promise<never> => {
    throw new Error(secret);
  };

  return {
    list: fail,
    load: fail,
    require: fail,
    create: fail,
    append: fail,
  };
}

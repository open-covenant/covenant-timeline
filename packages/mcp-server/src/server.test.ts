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
import { MAX_LIST_PAGE_SIZE } from "./constants.js";

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

  test("describes the input semantics an agent must preserve", async () => {
    const tools = await connection.client.listTools();
    const create = tools.tools.find(
      ({ name }) => name === "timeline_create_run",
    );
    const list = tools.tools.find(({ name }) => name === "timeline_list_runs");
    const append = tools.tools.find(
      ({ name }) => name === "timeline_append_event",
    );
    const project = tools.tools.find(
      ({ name }) => name === "timeline_project_state",
    );
    const reason = tools.tools.find(({ name }) => name === "timeline_reason");

    expect(create?.inputSchema).toMatchObject({
      properties: {
        contract: {
          description: expect.stringContaining("never replaces"),
        },
      },
    });
    expect(append?.inputSchema).toMatchObject({
      properties: {
        expectedRunDigest: {
          description: expect.stringContaining("compare-and-swap"),
        },
        event: {
          description: expect.stringContaining(
            "Do not send schema or sequence",
          ),
        },
      },
    });
    expect(list?.inputSchema).toMatchObject({
      properties: {
        cursor: {
          description: expect.stringContaining("preceding"),
        },
        limit: {
          description: expect.stringContaining(
            `never exceeds ${MAX_LIST_PAGE_SIZE}`,
          ),
        },
      },
    });
    expect(project?.inputSchema).toMatchObject({
      properties: {
        recordedThrough: {
          description: expect.stringContaining("null selects the empty prefix"),
        },
      },
    });
    const reasonSchema = JSON.stringify(reason?.inputSchema);
    expect(reasonSchema).toContain("toPointId - fromPointId");
    expect(reasonSchema).toContain("Always pin recordedThrough explicitly");
  });

  test("paginates run discovery without scanning the complete catalog", async () => {
    const store = new FileMcpRunStore(directory);
    const runIds = [];
    for (let index = 0; index < MAX_LIST_PAGE_SIZE + 2; index += 1) {
      const runId = `agent.catalog-${String(index).padStart(2, "0")}`;
      await store.create(releaseContract(runId));
      runIds.push(runId);
    }

    const first = listRunsOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_list_runs",
          arguments: {},
        })
      ).structuredContent,
    );
    expect(first.timelines).toHaveLength(MAX_LIST_PAGE_SIZE);
    expect(first.nextCursor).toMatch(/^v1\.[0-9a-f]{64}\.[0-9a-f]{64}$/);

    const second = listRunsOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_list_runs",
          arguments: {
            cursor: first.nextCursor,
          },
        })
      ).structuredContent,
    );
    expect(second.timelines).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(
      [...first.timelines, ...second.timelines]
        .map(({ runId }) => runId)
        .sort(),
    ).toEqual(runIds.sort());

    const resources = await connection.client.listResources();
    expect(resources.resources).toEqual([]);
    const templates = await connection.client.listResourceTemplates();
    expect(templates.resourceTemplates).toEqual([
      expect.objectContaining({
        name: "timeline-run",
        uriTemplate: "timeline://run/{runId}",
      }),
    ]);
  });

  test("reads encoded run resources and sanitizes resource failures", async () => {
    const contract = releaseContract("agent/release:42");
    await connection.client.callTool({
      name: "timeline_create_run",
      arguments: { contract },
    });

    const listed = await connection.client.listResources();
    expect(listed.resources).toEqual([]);
    const resource = await connection.client.readResource({
      uri: "timeline://run/agent%2Frelease%3A42",
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
    listPage: fail,
    load: fail,
    require: fail,
    create: fail,
    append: fail,
  };
}

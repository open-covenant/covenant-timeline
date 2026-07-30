import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import {
  canonicalJson,
  parseQueryV0Alpha3,
  projectTemporalStateV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
  type JsonValue,
} from "@covenant-org/timeline";
import {
  MCP_ADMISSION,
  MCP_DOCUMENT_LIMITS,
  MCP_KERNEL_LIMITS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from "./constants.js";
import { asTimelineMcpError, TimelineMcpError } from "./errors.js";
import {
  appendEventInputSchema,
  appendEventOutputSchema,
  createRunInputSchema,
  createRunOutputSchema,
  listRunsInputSchema,
  listRunsOutputSchema,
  projectStateInputSchema,
  projectStateOutputSchema,
  reasonInputSchema,
  reasonOutputSchema,
} from "./schemas.js";
import { metadataForEnvelope, type McpRunStore } from "./store.js";

export interface TimelineMcpServerOptions {
  version?: string;
}

export function createTimelineMcpServer(
  store: McpRunStore,
  options: TimelineMcpServerOptions = {},
): McpServer {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      title: "Covenant Timeline",
      version: options.version ?? MCP_SERVER_VERSION,
    },
    {
      instructions:
        "Create one run from a pinned contract, then carry the returned runDigest into each new event append. Event drafts omit schema and sequence; the server assigns both. After a restart, list runs to recover the current digest before writing. Project or reason at an explicit recordedThrough cut; null selects the empty prefix. Difference bounds answer toPointId - fromPointId. Direct writes are structurally validated but unauthenticated. Evidence references are external SHA-256 labels; the server does not retain or authenticate evidence payloads. A verified receipt establishes derivation from admitted records, not source truth. Normalize civil time before admission.",
    },
  );

  server.registerTool(
    "timeline_create_run",
    {
      title: "Create Timeline Run",
      description:
        "Create an empty v0alpha3 run from an exact contract. The contract ID becomes the run ID. Repeating the same contract is idempotent and never resets existing history.",
      inputSchema: createRunInputSchema,
      outputSchema: createRunOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ contract }) =>
      runTool(async () => {
        const result = await store.create(contract);
        return {
          created: result.created,
          timeline: metadataForEnvelope(result.envelope),
          admission: MCP_ADMISSION,
        };
      }),
  );

  server.registerTool(
    "timeline_list_runs",
    {
      title: "List Timeline Runs",
      description:
        "List one bounded page of locally stored run metadata, including each latest record cut and whole-run digest. Continue with nextCursor until it is null.",
      inputSchema: listRunsInputSchema,
      outputSchema: listRunsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (options) =>
      runTool(async () => ({
        ...(await store.listPage(options)),
      })),
  );

  server.registerTool(
    "timeline_append_event",
    {
      title: "Append Timeline Event",
      description:
        "Append one typed event under optimistic concurrency. The server assigns schema and sequence, validates the complete candidate run, and treats evidence references as unauthenticated external digests.",
      inputSchema: appendEventInputSchema,
      outputSchema: appendEventOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ runId, event, expectedRunDigest }) =>
      runTool(async () => {
        const result = await store.append(runId, event, expectedRunDigest);
        return {
          appended: result.appended,
          event: result.event,
          timeline: metadataForEnvelope(result.envelope),
          admission: MCP_ADMISSION,
        };
      }),
  );

  server.registerTool(
    "timeline_project_state",
    {
      title: "Project Timeline State",
      description:
        "Project active points, intervals, assertions, and facts for one context at an explicit record cut. null selects the empty prefix.",
      inputSchema: projectStateInputSchema,
      outputSchema: projectStateOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ runId, contextId, recordedThrough }) =>
      runTool(async () => {
        const envelope = await store.require(runId);
        try {
          return {
            timeline: metadataForEnvelope(envelope),
            state: projectTemporalStateV0Alpha3(
              envelope.run,
              contextId,
              recordedThrough,
              MCP_KERNEL_LIMITS,
            ),
          };
        } catch {
          throw new TimelineMcpError(
            "timeline.mcp.input.invalid",
            "state projection is invalid for this timeline",
          );
        }
      }),
  );

  server.registerTool(
    "timeline_reason",
    {
      title: "Reason Over Timeline",
      description:
        "Answer one exact v0alpha3 consistency, difference-bounds, point-relation, or interval-relation query at an explicit record cut and return its complete verified receipt.",
      inputSchema: reasonInputSchema,
      outputSchema: reasonOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ runId, query: draft }) =>
      runTool(async () => {
        const envelope = await store.require(runId);
        try {
          const query = parseQueryV0Alpha3(
            {
              ...draft,
              schema: "covenant.timeline.query.v0alpha3",
            },
            envelope.run,
            MCP_DOCUMENT_LIMITS,
          );
          const conclusion = reasonTemporalQueryV0Alpha3(
            envelope.run,
            query,
            MCP_KERNEL_LIMITS,
          );
          if (
            !verifyTemporalConclusionV0Alpha3(
              envelope.run,
              query,
              conclusion,
              MCP_KERNEL_LIMITS,
            )
          ) {
            throw new TimelineMcpError(
              "timeline.mcp.internal",
              "generated conclusion failed verification",
            );
          }
          return {
            timeline: metadataForEnvelope(envelope),
            query,
            conclusion,
            verified: true as const,
          };
        } catch (error) {
          if (error instanceof TimelineMcpError) throw error;
          throw new TimelineMcpError(
            "timeline.mcp.input.invalid",
            "query is invalid for this timeline",
          );
        }
      }),
  );

  const runTemplate: ResourceTemplate = new ResourceTemplate(
    "timeline://run/{runId}",
    {
      list: undefined,
    },
  );

  server.registerResource(
    "timeline-run",
    runTemplate,
    {
      title: "Portable Timeline Run",
      description:
        "Canonical v0alpha3 run bytes required to verify Timeline reasoning receipts.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      try {
        const runId = singleVariable(variables.runId);
        const envelope = await store.require(runId);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: canonicalJson(envelope.run as unknown as JsonValue),
            },
          ],
        };
      } catch (error) {
        const safe = asTimelineMcpError(error);
        throw new Error(`${safe.code}: ${safe.message}`);
      }
    },
  );

  return server;
}

async function runTool(operation: () => Promise<Record<string, unknown>>) {
  try {
    const value = await operation();
    return {
      content: [
        {
          type: "text" as const,
          text: canonicalJson(value as JsonValue),
        },
      ],
      structuredContent: value,
    };
  } catch (error) {
    const safe = asTimelineMcpError(error);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `${safe.code}: ${safe.message}`,
        },
      ],
    };
  }
}

function singleVariable(value: string | string[] | undefined): string {
  if (typeof value !== "string") {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "timeline resource ID is invalid",
    );
  }
  try {
    return decodeURIComponent(value);
  } catch {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "timeline resource ID is invalid",
    );
  }
}

function runResourceUri(runId: string): string {
  return `timeline://run/${encodeURIComponent(runId)}`;
}

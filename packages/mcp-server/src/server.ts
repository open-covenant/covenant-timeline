import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import {
  canonicalJson,
  compileTemporalModelProposalV1,
  parseQueryV0Alpha3,
  projectTemporalStateV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  TemporalModelProposalErrorV1,
  verifyTemporalConclusionV0Alpha3,
  type JsonValue,
  type TemporalConclusionV0Alpha3,
  type TemporalModelProposalCandidateV1,
  type TimelineRunDocumentV0Alpha3,
} from "@covenant-org/timeline";
import {
  MCP_DOCUMENT_LIMITS,
  MCP_KERNEL_LIMITS,
  MCP_MODEL_PROPOSAL_LIMITS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from "./constants.js";
import { asTimelineMcpError, TimelineMcpError } from "./errors.js";
import {
  sealVerifiedModelProposalAdmission,
  type VerifiedModelProposalAdmissionPermit,
} from "./model-admission.js";
import {
  admitModelProposalInputSchema,
  admitModelProposalOutputSchema,
  appendEventInputSchema,
  appendEventOutputSchema,
  createRunInputSchema,
  createRunOutputSchema,
  listRunsInputSchema,
  listRunsOutputSchema,
  previewModelProposalInputSchema,
  previewModelProposalOutputSchema,
  privateToolInputSchema,
  projectStateInputSchema,
  projectStateOutputSchema,
  reasonInputSchema,
  reasonOutputSchema,
  type PreviewModelProposalInput,
} from "./schemas.js";
import {
  bindRunPrefix,
  metadataForEnvelope,
  type McpRunStore,
} from "./store.js";
import type {
  ExpectedRunPrefixV0Alpha2,
  McpRunEnvelopeV0Alpha2,
} from "./types.js";

export interface TimelineMcpServerOptions {
  role?: TimelineMcpServerRole;
}

export type TimelineMcpServerRole = "model" | "operator";

export function createTimelineMcpServer(
  store: McpRunStore,
  options: TimelineMcpServerOptions = {},
): McpServer {
  const role = options.role ?? "model";
  if (role !== "model" && role !== "operator") {
    throw new TypeError("role must be model or operator");
  }
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      title: "Covenant Timeline",
      version: MCP_SERVER_VERSION,
    },
    {
      instructions:
        role === "operator"
          ? "Operator role can create runs and admit exact event batches under an explicit authority and policy digest. Preview model proposals before admission, retain the returned candidate digest, and pass proposal inputs that recompile to that candidate. The server does not retain preview sessions. After a restart, list runs to recover the current prefix. Project or reason at an explicit recordedThrough cut; null selects the empty prefix. A verified receipt establishes derivation from admitted records, not source truth."
          : "Model role is read-only. It can list runs, preview model proposals without persistence, project admitted state, and request verified conclusions. It cannot create, append, or admit records. Project or reason at an explicit recordedThrough cut; null selects the empty prefix. A verified receipt establishes derivation from admitted records, not source truth.",
    },
  );

  if (role === "operator") {
    server.registerTool(
      "timeline_create_run",
      {
        title: "Create Timeline Run",
        description:
          "Create an empty v0alpha3 run from an exact contract. The contract ID becomes the run ID. Repeating the same contract is idempotent and never resets existing history.",
        inputSchema: privateToolInputSchema(createRunInputSchema),
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
          };
        }),
    );
  }

  server.registerTool(
    "timeline_list_runs",
    {
      title: "List Timeline Runs",
      description:
        "List one bounded page of locally stored run metadata, including each latest record cut and whole-run digest. Continue with nextCursor until it is null.",
      inputSchema: privateToolInputSchema(listRunsInputSchema),
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

  if (role === "operator") {
    server.registerTool(
      "timeline_append_event",
      {
        title: "Append Timeline Event",
        description:
          "Append one typed event under optimistic concurrency. The server assigns schema and sequence, validates the complete candidate run, and treats evidence references as unauthenticated external digests.",
        inputSchema: privateToolInputSchema(appendEventInputSchema),
        outputSchema: appendEventOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ runId, event, expectedRunDigest, admission }) =>
        runTool(async () => {
          const result = await store.append(
            runId,
            event,
            expectedRunDigest,
            admission,
          );
          return {
            appended: result.appended,
            event: result.event,
            timeline: metadataForEnvelope(result.envelope),
            admissionRecord: result.admissionRecord,
          };
        }),
    );
  }

  server.registerTool(
    "timeline_preview_model_proposal",
    {
      title: "Preview Timeline Model Proposal",
      description:
        "Compile one request-correlated model proposal against an exact run prefix and return its content-bound candidate, verified preview conclusion, and provenance without writing. Catalogs and evidence are caller-supplied and unauthenticated. Evidence text is never stored or returned.",
      inputSchema: privateToolInputSchema(previewModelProposalInputSchema),
      outputSchema: previewModelProposalOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      runId,
      expectedRevision,
      expectedRunDigest,
      expectedRequestId,
      proposal,
      evidenceCatalog,
      referenceCatalog,
      assertionCatalog,
      knowledgeCutCatalog,
    }) =>
      runTool(async () => {
        const envelope = await store.require(runId);
        const preview = compilePreview(envelope, {
          expectedRevision,
          expectedRunDigest,
          expectedRequestId,
          proposal,
          evidenceCatalog,
          referenceCatalog,
          assertionCatalog,
          knowledgeCutCatalog,
        });
        return {
          ...previewOutput(preview),
          timeline: metadataForEnvelope(envelope),
        };
      }),
  );

  if (role === "operator") {
    server.registerTool(
      "timeline_admit_model_proposal",
      {
        title: "Admit Timeline Model Proposal",
        description:
          "Recompile a proposal, require the resulting candidate to match the operator-supplied candidate digest, and atomically append it under a host-controlled authority and policy record. Preview sessions are not retained by the server.",
        inputSchema: privateToolInputSchema(admitModelProposalInputSchema),
        outputSchema: admitModelProposalOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ candidateDigest, admission, ...input }) =>
        runTool(async () => {
          const envelope = await store.require(input.runId);
          const preview = compilePreview(envelope, input);
          if (preview.candidateDigest !== candidateDigest) {
            throw new TimelineMcpError(
              "timeline.mcp.store.conflict",
              "candidate digest does not match the compiled proposal",
            );
          }
          const result = await store.admitVerifiedModelProposal(
            preview.admissionPermit,
            admission,
          );
          return {
            candidateDigest,
            requestId: preview.candidate.requestId,
            proposalDigest: preview.candidate.proposalDigest,
            baseRevision: input.expectedRevision,
            baseRunDigest: preview.candidate.baseRunDigest,
            events: result.events,
            query: preview.candidate.candidateQuery,
            provenance: preview.candidate.provenance,
            admissionStatus: result.admissionStatus,
            timeline: metadataForEnvelope(result.envelope),
            admissionRecord: result.admissionRecord,
          };
        }),
    );
  }

  server.registerTool(
    "timeline_project_state",
    {
      title: "Project Timeline State",
      description:
        "Project active points, intervals, assertions, and facts for one context at an explicit record cut. null selects the empty prefix.",
      inputSchema: privateToolInputSchema(projectStateInputSchema),
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
      inputSchema: privateToolInputSchema(reasonInputSchema),
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

  const auditTemplate: ResourceTemplate = new ResourceTemplate(
    "timeline://audit/{runId}",
    { list: undefined },
  );
  server.registerResource(
    "timeline-audit",
    auditTemplate,
    {
      title: "Timeline Admission Audit",
      description:
        "Canonical stored envelope containing the portable run and every content-bound admission decision.",
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
              text: canonicalJson(envelope as unknown as JsonValue),
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

interface CompiledPreview {
  candidate: TemporalModelProposalCandidateV1;
  candidateDigest: `sha256:${string}`;
  conclusion: TemporalConclusionV0Alpha3;
  expected: ExpectedRunPrefixV0Alpha2;
  admissionPermit: VerifiedModelProposalAdmissionPermit;
}

type ProposalCompilationInput = Omit<PreviewModelProposalInput, "runId">;

function compilePreview(
  envelope: McpRunEnvelopeV0Alpha2,
  input: ProposalCompilationInput,
): CompiledPreview {
  const expected = {
    revision: input.expectedRevision,
    runDigest: input.expectedRunDigest,
  };
  const run = bindRunPrefix(envelope, expected);
  let candidate: TemporalModelProposalCandidateV1;
  try {
    candidate = compileTemporalModelProposalV1(
      input.proposal,
      {
        run,
        expectedRequestId: input.expectedRequestId,
        evidenceCatalog: input.evidenceCatalog,
        referenceCatalog: input.referenceCatalog,
        ...(input.assertionCatalog
          ? { assertionCatalog: input.assertionCatalog }
          : {}),
        ...(input.knowledgeCutCatalog
          ? { knowledgeCutCatalog: input.knowledgeCutCatalog }
          : {}),
      },
      MCP_MODEL_PROPOSAL_LIMITS,
    );
  } catch (error) {
    if (error instanceof TemporalModelProposalErrorV1) {
      throw new TimelineMcpError(
        "timeline.mcp.input.invalid",
        "model proposal is invalid",
      );
    }
    throw error;
  }

  const candidateRun: TimelineRunDocumentV0Alpha3 = {
    ...run,
    events: [...run.events, ...candidate.candidateEvents],
  };
  try {
    const conclusion = reasonTemporalQueryV0Alpha3(
      candidateRun,
      candidate.candidateQuery,
      MCP_KERNEL_LIMITS,
    );
    if (
      !verifyTemporalConclusionV0Alpha3(
        candidateRun,
        candidate.candidateQuery,
        conclusion,
        MCP_KERNEL_LIMITS,
      )
    ) {
      throw new TimelineMcpError(
        "timeline.mcp.internal",
        "preview conclusion failed verification",
      );
    }
    const admissionPermit = sealVerifiedModelProposalAdmission(
      envelope.runId,
      candidate,
      input.proposal,
      expected,
    );
    return {
      candidate,
      candidateDigest: admissionPermit.artifact.candidateDigest,
      conclusion,
      expected,
      admissionPermit,
    };
  } catch (error) {
    if (error instanceof TimelineMcpError) throw error;
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "model proposal preview is invalid",
    );
  }
}

function previewOutput(preview: CompiledPreview) {
  return {
    candidateDigest: preview.candidateDigest,
    requestId: preview.candidate.requestId,
    proposalDigest: preview.candidate.proposalDigest,
    baseRevision: preview.expected.revision,
    baseRunDigest: preview.candidate.baseRunDigest,
    events: preview.candidate.candidateEvents,
    query: preview.candidate.candidateQuery,
    provenance: preview.candidate.provenance,
    conclusion: preview.conclusion,
    persistence: "not-admitted" as const,
    verified: true as const,
  };
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

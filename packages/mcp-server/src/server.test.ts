import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  byteDigest,
  canonicalJson,
  contentDigest,
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
  admitModelProposalOutputSchema,
  appendEventOutputSchema,
  createRunOutputSchema,
  listRunsOutputSchema,
  previewModelProposalInputSchema,
  previewModelProposalOutputSchema,
  projectStateOutputSchema,
  reasonOutputSchema,
} from "./schemas.js";
import {
  createTimelineMcpServer,
  FileMcpRunStore,
  type McpRunStore,
} from "./index.js";
import { MAX_LIST_PAGE_SIZE, MCP_SERVER_VERSION } from "./constants.js";

const toolNames = [
  "timeline_create_run",
  "timeline_list_runs",
  "timeline_append_event",
  "timeline_preview_model_proposal",
  "timeline_admit_model_proposal",
  "timeline_project_state",
  "timeline_reason",
];
const admission = {
  authorityId: "operator.test",
  policyRef: "policy:test/v1",
  policyDigest: byteDigest(new TextEncoder().encode("test admission policy")),
} as const;

describe("Timeline MCP server", () => {
  let directory: string;
  let connection: Awaited<ReturnType<typeof connect>>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "timeline-mcp-server-"));
    connection = await connect(new FileMcpRunStore(directory), "operator");
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

  test("defaults to the read-only model tool surface", async () => {
    const model = await connect(new FileMcpRunStore(directory));
    try {
      const listed = await model.client.listTools();
      expect(listed.tools.map(({ name }) => name)).toEqual([
        "timeline_list_runs",
        "timeline_preview_model_proposal",
        "timeline_project_state",
        "timeline_reason",
      ]);
    } finally {
      await model.close();
    }
  });

  test("rejects an invalid programmatic role", () => {
    expect(() =>
      createTimelineMcpServer(new FileMcpRunStore(directory), {
        role: "combined" as never,
      }),
    ).toThrow("role must be model or operator");
  });

  test("always advertises the package version", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createTimelineMcpServer(new FileMcpRunStore(directory), {
      version: "9.9.9",
    } as never);
    const client = new Client({ name: "version-test", version: "0.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(client.getServerVersion()).toMatchObject({
      name: "covenant-timeline",
      version: MCP_SERVER_VERSION,
    });

    await Promise.all([client.close(), server.close()]);
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
    const preview = tools.tools.find(
      ({ name }) => name === "timeline_preview_model_proposal",
    );
    const admit = tools.tools.find(
      ({ name }) => name === "timeline_admit_model_proposal",
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
    expect(preview?.inputSchema).toMatchObject({
      properties: {
        expectedRevision: {
          description: expect.stringContaining("exact append-only prefix"),
        },
        evidenceCatalog: {
          description: expect.stringContaining("never stored or returned"),
        },
      },
    });
    expect(preview?.outputSchema).toMatchObject({
      required: expect.arrayContaining(["persistence"]),
      properties: { persistence: { const: "not-admitted" } },
    });
    expect(admit?.outputSchema).toMatchObject({
      required: expect.arrayContaining(["admissionStatus"]),
      properties: {
        admissionStatus: {
          enum: ["admitted", "already-admitted", "empty-candidate"],
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

  test("does not reflect rejected tool input", async () => {
    const untrustedKey = "line\n\u001b[31msecret";
    const result = await connection.client.callTool({
      name: "timeline_list_runs",
      arguments: { [untrustedKey]: true },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Input validation error: Invalid arguments for tool timeline_list_runs: tool input is invalid",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
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
      expect.objectContaining({
        name: "timeline-audit",
        uriTemplate: "timeline://audit/{runId}",
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

  test("previews without mutation and admits the exact candidate atomically", async () => {
    const timeline = await createModelBase(connection);
    const requestId = "request.release-correction";
    const deployQuote = "Deploy finished at 200.";
    const reviewQuote = "Review finished at 300.";
    const evidenceText = `Private header 🕰️ ${deployQuote} ${reviewQuote} Private footer.`;
    const evidenceRef = byteDigest(new TextEncoder().encode(evidenceText));
    const arguments_ = {
      runId: "agent.release",
      expectedRevision: timeline.revision,
      expectedRunDigest: timeline.runDigest,
      expectedRequestId: requestId,
      proposal: {
        schema: "covenant.timeline.model-proposal.v1",
        requestId,
        changes: [
          {
            type: "coordinate",
            pointHandle: "deploy",
            bounds: { type: "exact", value: 200 },
            supports: [{ evidenceId: "record.release", quote: deployQuote }],
            revision: { type: "keep" },
          },
          {
            type: "coordinate",
            pointHandle: "review",
            bounds: { type: "exact", value: 300 },
            supports: [{ evidenceId: "record.release", quote: reviewQuote }],
            revision: { type: "keep" },
          },
        ],
        query: {
          type: "difference",
          targetHandle: "review-minus-deploy",
          knowledgeCut: { type: "current" },
        },
      },
      evidenceCatalog: [
        { id: "record.release", status: "current", text: evidenceText },
      ],
      referenceCatalog: modelReferences(),
    } as const;

    const response = await connection.client.callTool({
      name: "timeline_preview_model_proposal",
      arguments: arguments_,
    });
    const previewed = previewModelProposalOutputSchema.parse(
      response.structuredContent,
    );

    expect(previewed).toMatchObject({
      requestId,
      baseRevision: 2,
      baseRunDigest: timeline.runDigest,
      timeline: {
        revision: 2,
        latestRecordedThrough: 1,
      },
      query: {
        schema: "covenant.timeline.query.v0alpha3",
        type: "difference.bounds",
        contextId: "actual",
        recordedThrough: 3,
        fromPointId: "deployed",
        toPointId: "review-finished",
      },
      conclusion: {
        result: {
          type: "difference.bounds",
          status: "bounded",
          minimum: 100,
          maximum: 100,
        },
      },
      persistence: "not-admitted",
      verified: true,
    });
    const { persistence: _, ...missingPersistence } = previewed;
    expect(
      previewModelProposalOutputSchema.safeParse(missingPersistence).success,
    ).toBe(false);
    expect(
      previewModelProposalOutputSchema.safeParse({
        ...previewed,
        persistence: "admitted",
      }).success,
    ).toBe(false);
    expect(previewed.events).toHaveLength(2);
    expect(
      previewed.events.every(
        (event) =>
          event.type === "coordinate.asserted" &&
          event.assertion.evidenceRefs[0] === evidenceRef,
      ),
    ).toBe(true);
    const reviewSupport = previewed.provenance
      .flatMap(({ supports }) => supports)
      .find(
        ({ quoteDigest }) =>
          quoteDigest === byteDigest(new TextEncoder().encode(reviewQuote)),
      );
    const reviewStart = Buffer.byteLength(
      evidenceText.slice(0, evidenceText.indexOf(reviewQuote)),
      "utf8",
    );
    expect(reviewSupport).toEqual({
      evidenceId: "record.release",
      evidenceRef,
      quoteDigest: byteDigest(new TextEncoder().encode(reviewQuote)),
      utf8StartByte: reviewStart,
      utf8EndByte: reviewStart + Buffer.byteLength(reviewQuote, "utf8"),
    });
    expect(JSON.stringify(response)).not.toContain(evidenceText);
    expect(JSON.stringify(response)).not.toContain(reviewQuote);

    const rejected = await connection.client.callTool({
      name: "timeline_admit_model_proposal",
      arguments: {
        ...arguments_,
        candidateDigest: `sha256:${"f".repeat(64)}`,
        admission,
      },
    });
    expect(rejected).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "timeline.mcp.store.conflict: candidate digest does not match the compiled proposal",
        },
      ],
    });
    const afterRejectedAdmission = listRunsOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_list_runs",
          arguments: {},
        })
      ).structuredContent,
    );
    expect(afterRejectedAdmission.timelines).toEqual([
      expect.objectContaining({
        runId: "agent.release",
        revision: 2,
        admissionCount: 2,
        runDigest: timeline.runDigest,
      }),
    ]);

    const admitted = admitModelProposalOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_admit_model_proposal",
          arguments: {
            ...arguments_,
            candidateDigest: previewed.candidateDigest,
            admission,
          },
        })
      ).structuredContent,
    );
    expect(admitted).toMatchObject({
      admissionStatus: "admitted",
      candidateDigest: previewed.candidateDigest,
      timeline: { revision: 4, admissionCount: 3 },
      admissionRecord: {
        kind: "model-proposal",
        authorityId: admission.authorityId,
        policyRef: admission.policyRef,
        policyDigest: admission.policyDigest,
        eventIds: previewed.events.map(({ id }) => id),
      },
    });
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...admitted,
        admissionStatus: "empty-candidate",
      }).success,
    ).toBe(false);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...admitted,
        admissionStatus: "unknown",
      }).success,
    ).toBe(false);
    const { admissionStatus: __, ...missingAdmissionStatus } = admitted;
    expect(
      admitModelProposalOutputSchema.safeParse(missingAdmissionStatus).success,
    ).toBe(false);

    const reasoned = reasonOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_reason",
          arguments: {
            runId: "agent.release",
            query: admitted.query,
          },
        })
      ).structuredContent,
    );
    expect(reasoned).toMatchObject({
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

    const resource = await connection.client.readResource({
      uri: "timeline://run/agent.release",
    });
    const content = resource.contents[0];
    if (!content || !("text" in content)) {
      throw new Error("timeline resource did not contain JSON text");
    }
    expect(content.text).toContain(evidenceRef);
    expect(content.text).not.toContain(evidenceText);
    expect(content.text).not.toContain(reviewQuote);

    const later = appendEventOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_append_event",
          arguments: {
            runId: "agent.release",
            expectedRunDigest: admitted.timeline.runDigest,
            event: {
              id: "event.follow-up-declared",
              type: "point.declared",
              point: {
                id: "follow-up",
                contextId: "actual",
                axisId: "utc-seconds",
              },
            },
            admission,
          },
        })
      ).structuredContent,
    );
    const retried = admitModelProposalOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_admit_model_proposal",
          arguments: {
            ...arguments_,
            candidateDigest: previewed.candidateDigest,
            admission,
          },
        })
      ).structuredContent,
    );
    expect(retried.admissionStatus).toBe("already-admitted");
    expect(retried.events).toEqual(admitted.events);
    expect(retried.query).toEqual(admitted.query);
    expect(retried.timeline).toEqual(later.timeline);

    const audit = await connection.client.readResource({
      uri: "timeline://audit/agent.release",
    });
    const auditContent = audit.contents[0];
    if (!auditContent || !("text" in auditContent)) {
      throw new Error("timeline audit resource did not contain JSON text");
    }
    const envelope = JSON.parse(auditContent.text);
    expect(envelope.schema).toBe("covenant.timeline.mcp-run.v0alpha2");
    expect(envelope.admissions).toContainEqual(admitted.admissionRecord);
  });

  test("rejects invalid model proposal output event provenance", async () => {
    const timeline = await createModelBase(connection);
    const applied = await applyCoordinateProposal(connection, {
      timeline,
      requestId: "request.output-schema",
      evidenceId: "record.output-schema",
      evidenceText: "Review finished at 300.",
      quote: "Review finished at 300.",
      value: 300,
    });
    const [event] = applied.events;
    const [provenance] = applied.provenance;
    if (!event || !provenance) {
      throw new Error("proposal did not return one event and provenance entry");
    }

    expect(
      admitModelProposalOutputSchema.safeParse({
        ...applied,
        provenance: [],
      }).success,
    ).toBe(false);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...applied,
        provenance: [
          {
            ...provenance,
            candidateEventId: "event.wrong",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...applied,
        provenance: [
          {
            ...provenance,
            supports: [],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...applied,
        provenance: [
          {
            ...provenance,
            evidenceRefs: [`sha256:${"f".repeat(64)}`],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...applied,
        provenance: [
          {
            ...provenance,
            supports: provenance.supports.map((support) => ({
              ...support,
              evidenceRef: `sha256:${"f".repeat(64)}`,
            })),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...applied,
        events: [
          {
            schema: "covenant.timeline.event.v0alpha3",
            sequence: event.sequence,
            id: "event.point-declared",
            type: "point.declared",
            point: {
              id: "unrelated",
              contextId: "actual",
              axisId: "utc-seconds",
            },
          },
        ],
        provenance: [
          {
            ...provenance,
            candidateEventId: "event.point-declared",
          },
        ],
      }).success,
    ).toBe(false);

    const admissionRecord = applied.admissionRecord;
    if (!admissionRecord) {
      throw new Error("proposal did not return an admission record");
    }
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...applied,
        admissionRecord: redigestAdmission({
          ...admissionRecord,
          candidateDigest: `sha256:${"0".repeat(64)}`,
        }),
      }).success,
    ).toBe(false);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...applied,
        admissionRecord: redigestAdmission({
          ...admissionRecord,
          eventIds: ["event.wrong"],
        }),
      }).success,
    ).toBe(false);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...applied,
        admissionRecord: redigestAdmission({
          ...admissionRecord,
          baseRevision: admissionRecord.baseRevision + 1,
        }),
      }).success,
    ).toBe(false);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...applied,
        candidateDigest: `sha256:${"0".repeat(64)}`,
      }).success,
    ).toBe(false);
  });

  test("cross-binds direct append output to its admission record", async () => {
    const created = createRunOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_create_run",
          arguments: { contract: releaseContract() },
        })
      ).structuredContent,
    );
    const appended = appendEventOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_append_event",
          arguments: {
            runId: created.timeline.runId,
            expectedRunDigest: created.timeline.runDigest,
            event: correctionEvents[0],
            admission,
          },
        })
      ).structuredContent,
    );

    expect(
      appendEventOutputSchema.safeParse({
        ...appended,
        admissionRecord: redigestAdmission({
          ...appended.admissionRecord,
          baseRevision: appended.admissionRecord.baseRevision + 1,
        }),
      }).success,
    ).toBe(false);
    expect(
      appendEventOutputSchema.safeParse({
        ...appended,
        admissionRecord: redigestAdmission({
          ...appended.admissionRecord,
          kind: "model-proposal",
          candidateDigest: `sha256:${"0".repeat(64)}`,
          proposalDigest: `sha256:${"1".repeat(64)}`,
        }),
      }).success,
    ).toBe(false);
  });

  test("lowers prior knowledge cuts without mutating the run", async () => {
    const timeline = await createModelBase(connection);
    const requestId = "request.prior-consistency";
    const result = previewModelProposalOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_preview_model_proposal",
          arguments: {
            runId: "agent.release",
            expectedRevision: timeline.revision,
            expectedRunDigest: timeline.runDigest,
            expectedRequestId: requestId,
            proposal: {
              schema: "covenant.timeline.model-proposal.v1",
              requestId,
              changes: [],
              query: {
                type: "consistency",
                targetHandle: "actual-context",
                knowledgeCut: {
                  type: "prior",
                  cutHandle: "first-declaration",
                },
              },
            },
            evidenceCatalog: [],
            referenceCatalog: modelReferences(),
            knowledgeCutCatalog: [
              { handle: "first-declaration", recordedThrough: 0 },
            ],
          },
        })
      ).structuredContent,
    );

    expect(result).toMatchObject({
      events: [],
      timeline: { revision: 2 },
      query: {
        type: "context.consistency",
        contextId: "actual",
        recordedThrough: 0,
      },
    });
    const {
      conclusion: _,
      persistence: __,
      verified: ___,
      ...candidate
    } = result;
    const emptyAdmission = {
      ...candidate,
      admissionStatus: "empty-candidate",
      admissionRecord: null,
    };
    expect(
      admitModelProposalOutputSchema.safeParse(emptyAdmission).success,
    ).toBe(true);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...emptyAdmission,
        baseRevision: timeline.revision + 1,
      }).success,
    ).toBe(false);
    expect(
      admitModelProposalOutputSchema.safeParse({
        ...emptyAdmission,
        admissionStatus: "admitted",
      }).success,
    ).toBe(false);
    const reasoned = reasonOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_reason",
          arguments: {
            runId: "agent.release",
            query: result.query,
          },
        })
      ).structuredContent,
    );
    expect(reasoned.conclusion.result).toEqual({
      type: "context.consistency",
      status: "consistent",
    });
  });

  test("applies model corrections and retractions without restoring superseded state", async () => {
    let timeline = await createModelBase(connection);
    const firstText = "Review finished at 100.";
    const first = await applyCoordinateProposal(connection, {
      timeline,
      requestId: "request.review-v1",
      evidenceId: "record.review-v1",
      evidenceText: firstText,
      quote: firstText,
      value: 100,
    });
    const firstEvent = first.events[0];
    if (firstEvent?.type !== "coordinate.asserted") {
      throw new Error("coordinate proposal returned an unexpected event");
    }
    timeline = first.timeline;

    const correctedText = "Correction: review finished at 300.";
    const corrected = await applyCoordinateProposal(connection, {
      timeline,
      requestId: "request.review-v2",
      evidenceId: "record.review-v2",
      evidenceText: correctedText,
      quote: correctedText,
      value: 300,
      assertionCatalog: [
        {
          handle: "review-current",
          assertionId: firstEvent.assertion.id,
        },
      ],
      revision: {
        type: "supersede",
        assertionHandle: "review-current",
      },
    });
    const correctedEvent = corrected.events[0];
    if (correctedEvent?.type !== "coordinate.asserted") {
      throw new Error("correction proposal returned an unexpected event");
    }
    expect(correctedEvent.assertion.supersedes).toEqual([
      firstEvent.assertion.id,
    ]);

    const withdrawnText = "The corrected review record was withdrawn.";
    const retracted = await admitProposal(connection, {
      runId: "agent.release",
      expectedRevision: corrected.timeline.revision,
      expectedRunDigest: corrected.timeline.runDigest,
      expectedRequestId: "request.review-withdrawal",
      proposal: {
        schema: "covenant.timeline.model-proposal.v1",
        requestId: "request.review-withdrawal",
        changes: [
          {
            type: "retraction",
            assertionHandle: "review-corrected",
            supports: [
              {
                evidenceId: "record.review-withdrawal",
                quote: withdrawnText,
              },
            ],
          },
        ],
        query: {
          type: "consistency",
          targetHandle: "actual-context",
          knowledgeCut: { type: "current" },
        },
      },
      evidenceCatalog: [
        {
          id: "record.review-withdrawal",
          status: "current",
          text: withdrawnText,
        },
      ],
      referenceCatalog: modelReferences(),
      assertionCatalog: [
        {
          handle: "review-corrected",
          assertionId: correctedEvent.assertion.id,
        },
      ],
    });
    expect(retracted.events).toEqual([
      expect.objectContaining({
        type: "assertion.retracted",
        assertionId: correctedEvent.assertion.id,
      }),
    ]);

    const state = projectStateOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_project_state",
          arguments: {
            runId: "agent.release",
            contextId: "actual",
            recordedThrough: retracted.timeline.latestRecordedThrough,
          },
        })
      ).structuredContent,
    );
    expect(state.state.coordinates).toEqual([]);
  });

  test("rejects mismatched requests and unsupported evidence without mutation or leakage", async () => {
    const timeline = await createModelBase(connection);
    const quote = "Review finished at 300.";
    const baseArguments = {
      runId: "agent.release",
      expectedRevision: timeline.revision,
      expectedRunDigest: timeline.runDigest,
      expectedRequestId: "request.expected",
      proposal: {
        schema: "covenant.timeline.model-proposal.v1",
        requestId: "request.expected",
        changes: [
          {
            type: "coordinate",
            pointHandle: "review",
            bounds: { type: "exact", value: 300 },
            supports: [{ evidenceId: "record.review", quote }],
            revision: { type: "keep" },
          },
        ],
        query: {
          type: "consistency",
          targetHandle: "actual-context",
          knowledgeCut: { type: "current" },
        },
      },
      evidenceCatalog: [
        { id: "record.review", status: "current", text: quote },
      ],
      referenceCatalog: modelReferences(),
    } as const;

    const invalid = [
      {
        ...baseArguments,
        expectedRequestId: "request.different",
      },
      {
        ...baseArguments,
        evidenceCatalog: [
          { id: "record.review", status: "stale", text: quote },
        ],
      },
      {
        ...baseArguments,
        evidenceCatalog: [
          {
            id: "record.review",
            status: "current",
            text: `${quote} ${quote}`,
          },
        ],
      },
    ];
    for (const arguments_ of invalid) {
      const result = await connection.client.callTool({
        name: "timeline_preview_model_proposal",
        arguments: arguments_,
      });
      expect(result).toEqual({
        isError: true,
        content: [
          {
            type: "text",
            text: "timeline.mcp.input.invalid: model proposal is invalid",
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain(quote);
    }

    const listed = listRunsOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_list_runs",
          arguments: {},
        })
      ).structuredContent,
    );
    expect(listed.timelines[0]?.revision).toBe(timeline.revision);
  });

  test("enforces model proposal schema and aggregate evidence ceilings", async () => {
    const timeline = await createModelBase(connection);
    const requestId = "request.limit";
    const base = {
      runId: "agent.release",
      expectedRevision: timeline.revision,
      expectedRunDigest: timeline.runDigest,
      expectedRequestId: requestId,
      proposal: {
        schema: "covenant.timeline.model-proposal.v1",
        requestId,
        changes: [],
        query: {
          type: "consistency",
          targetHandle: "actual-context",
          knowledgeCut: { type: "current" },
        },
      },
      evidenceCatalog: [],
      referenceCatalog: modelReferences(),
    } as const;
    const excessiveChanges = {
      ...base,
      proposal: {
        ...base.proposal,
        changes: Array.from({ length: 9 }, () => ({
          type: "retraction",
          assertionHandle: "missing",
          supports: [{ evidenceId: "missing", quote: "missing" }],
        })),
      },
    };
    expect(
      previewModelProposalInputSchema.safeParse(excessiveChanges).success,
    ).toBe(false);

    const oversized = await connection.client.callTool({
      name: "timeline_preview_model_proposal",
      arguments: {
        ...base,
        evidenceCatalog: Array.from({ length: 5 }, (_, index) => ({
          id: `record.limit-${index}`,
          status: "current",
          text: "x".repeat(60_000),
        })),
      },
    });
    expect(oversized).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "timeline.mcp.input.invalid: model proposal is invalid",
        },
      ],
    });
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
              admission,
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

async function connect(store: McpRunStore, role?: "model" | "operator") {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createTimelineMcpServer(store, role ? { role } : {});
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

async function createModelBase(
  connection: Awaited<ReturnType<typeof connect>>,
): Promise<McpTimelineMetadata> {
  const created = createRunOutputSchema.parse(
    (
      await connection.client.callTool({
        name: "timeline_create_run",
        arguments: { contract: releaseContract() },
      })
    ).structuredContent,
  );
  let timeline = created.timeline;
  for (const event of correctionEvents.slice(0, 2)) {
    const appended = appendEventOutputSchema.parse(
      (
        await connection.client.callTool({
          name: "timeline_append_event",
          arguments: {
            runId: created.timeline.runId,
            expectedRunDigest: timeline.runDigest,
            event,
            admission,
          },
        })
      ).structuredContent,
    );
    timeline = appended.timeline;
  }
  return timeline;
}

function modelReferences() {
  return [
    {
      type: "context" as const,
      handle: "actual-context",
      contextId: "actual",
    },
    {
      type: "point" as const,
      handle: "review",
      pointId: "review-finished",
    },
    {
      type: "point" as const,
      handle: "deploy",
      pointId: "deployed",
    },
    {
      type: "difference" as const,
      handle: "review-minus-deploy",
      fromPointId: "deployed",
      toPointId: "review-finished",
    },
  ];
}

type McpTimelineMetadata = ReturnType<
  typeof createRunOutputSchema.parse
>["timeline"];

interface CoordinateProposalOptions {
  timeline: McpTimelineMetadata;
  requestId: string;
  evidenceId: string;
  evidenceText: string;
  quote: string;
  value: number;
  assertionCatalog?: readonly {
    handle: string;
    assertionId: string;
  }[];
  revision?: {
    type: "supersede";
    assertionHandle: string;
  };
}

async function applyCoordinateProposal(
  connection: Awaited<ReturnType<typeof connect>>,
  options: CoordinateProposalOptions,
) {
  return admitProposal(connection, {
    runId: options.timeline.runId,
    expectedRevision: options.timeline.revision,
    expectedRunDigest: options.timeline.runDigest,
    expectedRequestId: options.requestId,
    proposal: {
      schema: "covenant.timeline.model-proposal.v1",
      requestId: options.requestId,
      changes: [
        {
          type: "coordinate",
          pointHandle: "review",
          bounds: { type: "exact", value: options.value },
          supports: [
            {
              evidenceId: options.evidenceId,
              quote: options.quote,
            },
          ],
          revision: options.revision ?? { type: "keep" },
        },
      ],
      query: {
        type: "consistency",
        targetHandle: "actual-context",
        knowledgeCut: { type: "current" },
      },
    },
    evidenceCatalog: [
      {
        id: options.evidenceId,
        status: "current",
        text: options.evidenceText,
      },
    ],
    referenceCatalog: modelReferences(),
    ...(options.assertionCatalog
      ? { assertionCatalog: options.assertionCatalog }
      : {}),
  });
}

async function admitProposal(
  connection: Awaited<ReturnType<typeof connect>>,
  arguments_: Record<string, unknown>,
) {
  const preview = previewModelProposalOutputSchema.parse(
    (
      await connection.client.callTool({
        name: "timeline_preview_model_proposal",
        arguments: arguments_,
      })
    ).structuredContent,
  );
  return admitModelProposalOutputSchema.parse(
    (
      await connection.client.callTool({
        name: "timeline_admit_model_proposal",
        arguments: {
          ...arguments_,
          candidateDigest: preview.candidateDigest,
          admission,
        },
      })
    ).structuredContent,
  );
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
    admitVerifiedModelProposal: fail,
  };
}

function redigestAdmission<T extends Record<string, unknown>>(record: T) {
  const { recordDigest: _, ...unsigned } = record;
  return {
    ...unsigned,
    recordDigest: contentDigest(unsigned as JsonValue),
  };
}

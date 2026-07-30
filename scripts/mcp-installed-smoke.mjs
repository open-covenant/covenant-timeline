import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  byteDigest,
  parseRunDocumentV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "@covenant-org/timeline";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const fixture = JSON.parse(await readFile("./fixture.json", "utf8"));
const dataDirectory = process.argv[2];
const cli = fileURLToPath(
  new URL(
    "./node_modules/@covenant-org/timeline-mcp/dist/cli.js",
    import.meta.url,
  ),
);
let stderr = "";

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "--data-dir", dataDirectory],
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const client = new Client({
    name: "timeline-mcp-installed-smoke",
    version: "0.0.0",
  });
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError || !result.structuredContent) {
    throw new Error(JSON.stringify(result));
  }
  return result.structuredContent;
}

const first = await connect();
const created = await call(first, "timeline_create_run", {
  contract: fixture.contract,
});
let runDigest = created.timeline.runDigest;
for (const event of fixture.events) {
  const appended = await call(first, "timeline_append_event", {
    runId: fixture.contract.id,
    expectedRunDigest: runDigest,
    event,
  });
  runDigest = appended.timeline.runDigest;
}
await first.close();

const second = await connect();
const listed = await call(second, "timeline_list_runs", {});
const beforeState = await call(second, "timeline_project_state", {
  runId: fixture.contract.id,
  contextId: "actual",
  recordedThrough: fixture.before.recordedThrough,
});
const afterState = await call(second, "timeline_project_state", {
  runId: fixture.contract.id,
  contextId: "actual",
  recordedThrough: fixture.after.recordedThrough,
});
const before = await call(second, "timeline_reason", {
  runId: fixture.contract.id,
  query: fixture.before,
});
const after = await call(second, "timeline_reason", {
  runId: fixture.contract.id,
  query: fixture.after,
});
const resource = await second.readResource({
  uri: `timeline://run/${encodeURIComponent(fixture.contract.id)}`,
});

const proposalRunId = "release.proposal-smoke.v1";
const proposalCreated = await call(second, "timeline_create_run", {
  contract: {
    ...fixture.contract,
    id: proposalRunId,
  },
});
let proposalTimeline = proposalCreated.timeline;
for (const event of fixture.events.slice(0, 2)) {
  const appended = await call(second, "timeline_append_event", {
    runId: proposalRunId,
    expectedRunDigest: proposalTimeline.runDigest,
    event,
  });
  proposalTimeline = appended.timeline;
}

const requestId = "request.proposal-smoke.v1";
const deployQuote = "Deployment began at 200.";
const durationQuote = "Review finished 100 seconds after deployment began.";
const evidenceText = `${deployQuote} ${durationQuote}`;
const applied = await call(second, "timeline_apply_model_proposal", {
  runId: proposalRunId,
  expectedRevision: proposalTimeline.revision,
  expectedRunDigest: proposalTimeline.runDigest,
  expectedRequestId: requestId,
  proposal: {
    schema: "covenant.timeline.model-proposal.v1",
    requestId,
    changes: [
      {
        type: "coordinate",
        pointHandle: "deploy",
        bounds: { type: "exact", value: 200 },
        supports: [{ evidenceId: "record.proposal-smoke", quote: deployQuote }],
        revision: { type: "keep" },
      },
      {
        type: "constraint",
        differenceHandle: "review-minus-deploy",
        bounds: { type: "exact", value: 100 },
        supports: [
          { evidenceId: "record.proposal-smoke", quote: durationQuote },
        ],
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
    {
      id: "record.proposal-smoke",
      status: "current",
      text: evidenceText,
    },
  ],
  referenceCatalog: [
    { type: "context", handle: "actual-context", contextId: "actual" },
    { type: "point", handle: "deploy", pointId: "deployed" },
    { type: "point", handle: "review", pointId: "review-finished" },
    {
      type: "difference",
      handle: "review-minus-deploy",
      fromPointId: "deployed",
      toPointId: "review-finished",
    },
  ],
});
const proposalReasoned = await call(second, "timeline_reason", {
  runId: proposalRunId,
  query: applied.query,
});
const proposalResource = await second.readResource({
  uri: `timeline://run/${encodeURIComponent(proposalRunId)}`,
});
await second.close();

const content = resource.contents[0];
if (!content || !("text" in content)) {
  throw new Error("portable run resource did not contain JSON text");
}
const run = parseRunDocumentV0Alpha3(JSON.parse(content.text));
const proposalContent = proposalResource.contents[0];
if (!proposalContent || !("text" in proposalContent)) {
  throw new Error("proposal run resource did not contain JSON text");
}
const proposalRun = parseRunDocumentV0Alpha3(JSON.parse(proposalContent.text));
const beforeResult = before.conclusion.result;
const afterResult = after.conclusion.result;
const proposalResult = proposalReasoned.conclusion.result;
if (
  listed.timelines[0]?.runDigest !== runDigest ||
  beforeState.state.recordedThrough !== fixture.before.recordedThrough ||
  afterState.state.recordedThrough !== fixture.after.recordedThrough ||
  beforeResult.type !== "difference.bounds" ||
  afterResult.type !== "difference.bounds"
) {
  throw new Error("installed MCP state did not survive restart");
}

const serializedProposal = JSON.stringify(applied);
const serializedProposalRun = JSON.stringify(proposalRun);
const serializedProposalReasoning = JSON.stringify(proposalReasoned);
const candidateEventIds = applied.events.map(({ id }) => id);
const provenanceEventIds = applied.provenance.map(
  ({ candidateEventId }) => candidateEventId,
);
const evidenceRef = byteDigest(new TextEncoder().encode(evidenceText));
const supportBindings = [deployQuote, durationQuote].every((quote, index) => {
  const support = applied.provenance[index]?.supports?.[0];
  const start = Buffer.byteLength(
    evidenceText.slice(0, evidenceText.indexOf(quote)),
    "utf8",
  );
  return (
    applied.provenance[index]?.supports?.length === 1 &&
    support?.evidenceId === "record.proposal-smoke" &&
    support.evidenceRef === evidenceRef &&
    support.quoteDigest === byteDigest(new TextEncoder().encode(quote)) &&
    support.utf8StartByte === start &&
    support.utf8EndByte === start + Buffer.byteLength(quote, "utf8")
  );
});
const proposalAtomic =
  applied.applied === true &&
  applied.baseRevision === 2 &&
  applied.timeline.revision === 4 &&
  applied.events.length === 2 &&
  applied.events[0]?.sequence === 2 &&
  applied.events[0]?.type === "coordinate.asserted" &&
  applied.events[1]?.sequence === 3 &&
  applied.events[1]?.type === "constraint.asserted" &&
  applied.provenance.length === 2 &&
  JSON.stringify(candidateEventIds) === JSON.stringify(provenanceEventIds) &&
  supportBindings &&
  proposalRun.events.length === 4;
const proposalSourceTextAbsent =
  !serializedProposal.includes(evidenceText) &&
  !serializedProposal.includes(deployQuote) &&
  !serializedProposal.includes(durationQuote) &&
  !serializedProposalRun.includes(evidenceText) &&
  !serializedProposalRun.includes(deployQuote) &&
  !serializedProposalRun.includes(durationQuote) &&
  !serializedProposalReasoning.includes(evidenceText) &&
  !serializedProposalReasoning.includes(deployQuote) &&
  !serializedProposalReasoning.includes(durationQuote);
const proposalProof =
  proposalReasoned.verified === true &&
  verifyTemporalConclusionV0Alpha3(
    proposalRun,
    proposalReasoned.query,
    proposalReasoned.conclusion,
  );

process.stdout.write(
  JSON.stringify({
    before: beforeResult.minimum,
    after: afterResult.minimum,
    events: run.events.length,
    proofs:
      before.verified === true &&
      after.verified === true &&
      verifyTemporalConclusionV0Alpha3(run, before.query, before.conclusion) &&
      verifyTemporalConclusionV0Alpha3(run, after.query, after.conclusion),
    proposal: {
      atomic: proposalAtomic,
      events: applied.events.length,
      minimum:
        proposalResult.type === "difference.bounds"
          ? proposalResult.minimum
          : null,
      maximum:
        proposalResult.type === "difference.bounds"
          ? proposalResult.maximum
          : null,
      sourceTextAbsent: proposalSourceTextAbsent,
      proof: proposalProof,
    },
    stderr,
  }),
);

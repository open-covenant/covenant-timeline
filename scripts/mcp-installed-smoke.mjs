import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
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
await second.close();

const content = resource.contents[0];
if (!content || !("text" in content)) {
  throw new Error("portable run resource did not contain JSON text");
}
const run = parseRunDocumentV0Alpha3(JSON.parse(content.text));
const beforeResult = before.conclusion.result;
const afterResult = after.conclusion.result;
if (
  listed.timelines[0]?.runDigest !== runDigest ||
  beforeState.state.recordedThrough !== fixture.before.recordedThrough ||
  afterState.state.recordedThrough !== fixture.after.recordedThrough ||
  beforeResult.type !== "difference.bounds" ||
  afterResult.type !== "difference.bounds"
) {
  throw new Error("installed MCP state did not survive restart");
}

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
    stderr,
  }),
);

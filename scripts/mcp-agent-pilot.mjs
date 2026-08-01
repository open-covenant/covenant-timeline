import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  opendir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertInputDirectory,
  canonicalInputRoot,
  decodeUtf8,
  exactRecord,
  loadMcpClient,
  loadTimeline,
  MCP_AGENT_PILOT_LIMITS,
  readBoundedInputFile,
  readJson,
  repositoryRoot,
  resolveInside,
  safeEvidenceName,
  safeName,
  sha256,
  sourceIdentity,
  writeCanonicalJson,
} from "./mcp-agent-pilot-lib.mjs";

const REQUIRED_TOOLS = new Set([
  "timeline_create_run",
  "timeline_list_runs",
  "timeline_append_event",
  "timeline_project_state",
  "timeline_reason",
]);
const PILOT_ADMISSION = Object.freeze({
  authorityId: "operator.mcp-agent-pilot",
  policyRef: "policy:mcp-agent-pilot/v1",
  policyDigest: sha256(
    new TextEncoder().encode("covenant timeline mcp agent pilot admission v1"),
  ),
});

export async function connectMcpClient(client, transport) {
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw error;
  }
}

export function serializeTranscript(transcript, timeline) {
  if (
    transcript.length === 0 ||
    transcript.length > MCP_AGENT_PILOT_LIMITS.maxTranscriptLines
  ) {
    throw new Error("tool transcript exceeds its line limit");
  }
  const lines = [];
  let byteLength = 0;
  for (const entry of transcript) {
    const line = timeline.canonicalJson(entry);
    byteLength += Buffer.byteLength(line) + 1;
    if (byteLength > MCP_AGENT_PILOT_LIMITS.maxTranscriptBytes) {
      throw new Error("tool transcript exceeds its byte limit");
    }
    lines.push(line);
  }
  return `${lines.join("\n")}\n`;
}

export async function runMcpAgentPilot({ inputDirectory, outputDirectory }) {
  const inputPath = resolve(inputDirectory);
  const output = resolve(outputDirectory);
  await assertOutputOutsideCheckout(output);
  const input = await canonicalInputRoot(inputPath);
  const timeline = await loadTimeline();
  const { Client, StdioClientTransport } = await loadMcpClient();
  const pilot = parsePilot(
    await readInputJson(
      input,
      join(input, "pilot.json"),
      MCP_AGENT_PILOT_LIMITS.maxArtifactBytes,
      "pilot input",
      timeline,
    ),
  );
  const contract = await readInputJson(
    input,
    resolveInside(input, pilot.contract, "contract path"),
    MCP_AGENT_PILOT_LIMITS.maxRunBytes,
    "contract input",
    timeline,
  );
  const eventInputs = await readInputJson(
    input,
    resolveInside(input, pilot.events, "events path"),
    MCP_AGENT_PILOT_LIMITS.maxRunBytes,
    "events input",
    timeline,
  );
  const evidence = await loadEvidence(input, join(input, "evidence"));
  const events = materializeEvents(eventInputs, evidence);
  const restartIndex = events.findIndex(
    ({ id }) => id === pilot.restartAfterEventId,
  );
  if (restartIndex < 0 || restartIndex >= events.length - 1) {
    throw new Error("restart boundary must precede at least one event");
  }
  const queryBudget = inputBudget(
    MCP_AGENT_PILOT_LIMITS.maxQueryTotalBytes,
    "query inputs",
  );
  const queryDrafts = await Promise.all(
    pilot.queries.map(async ({ name, file }) => ({
      name,
      draft: await readInputJson(
        input,
        resolveInside(input, file, `query ${name} path`),
        MCP_AGENT_PILOT_LIMITS.maxQueryBytes,
        `query ${name} input`,
        timeline,
        queryBudget,
      ),
    })),
  );

  await mkdir(output, { recursive: false, mode: 0o700 });
  const working = await mkdtemp(join(tmpdir(), "timeline-mcp-agent-pilot-"));
  const storeDirectory = join(working, "store");
  const transcript = [];
  const stderr = [];
  let callSequence = 0;

  const connect = async (session) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        join(repositoryRoot, "packages/mcp-server/dist/cli.js"),
        "--data-dir",
        storeDirectory,
        "--role",
        "operator",
      ],
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk) => {
      stderr.push(chunk.toString("utf8"));
    });
    const client = new Client({
      name: "timeline-mcp-agent-pilot",
      version: "1.0.0",
    });
    await connectMcpClient(client, transport);
    return {
      client,
      async call(name, args) {
        const response = await client.callTool({
          name,
          arguments: args,
        });
        if (response.isError || response.structuredContent === undefined) {
          throw new Error(`MCP ${name} failed: ${JSON.stringify(response)}`);
        }
        transcript.push({
          sequence: callSequence++,
          session,
          tool: name,
          arguments: args,
          result: response.structuredContent,
        });
        return response.structuredContent;
      },
    };
  };

  let run;
  try {
    const first = await connect(1);
    let runDigest;
    try {
      const created = await first.call("timeline_create_run", { contract });
      runDigest = created.timeline.runDigest;
      for (const event of events.slice(0, restartIndex + 1)) {
        const appended = await first.call("timeline_append_event", {
          runId: contract.id,
          expectedRunDigest: runDigest,
          event,
          admission: PILOT_ADMISSION,
        });
        runDigest = appended.timeline.runDigest;
      }
    } finally {
      await first.client.close();
    }

    const second = await connect(2);
    const queryResults = new Map();
    const projectedStates = new Map();
    try {
      const listed = await second.call("timeline_list_runs", {});
      const recovered = listed.timelines.find(
        ({ runId }) => runId === contract.id,
      );
      if (!recovered || recovered.runDigest !== runDigest) {
        throw new Error("MCP run did not recover after restart");
      }

      for (const event of events.slice(restartIndex + 1)) {
        const appended = await second.call("timeline_append_event", {
          runId: contract.id,
          expectedRunDigest: runDigest,
          event,
          admission: PILOT_ADMISSION,
        });
        runDigest = appended.timeline.runDigest;
      }

      for (const { name, draft } of queryDrafts) {
        projectedStates.set(
          name,
          await second.call("timeline_project_state", {
            runId: contract.id,
            contextId: draft.contextId,
            recordedThrough: draft.recordedThrough,
          }),
        );
        queryResults.set(
          name,
          await second.call("timeline_reason", {
            runId: contract.id,
            query: draft,
          }),
        );
      }

      const resource = await second.client.readResource({
        uri: `timeline://run/${encodeURIComponent(contract.id)}`,
      });
      const content = resource.contents[0];
      if (!content || !("text" in content)) {
        throw new Error("portable run resource did not contain JSON text");
      }
      run = timeline.parseRunDocumentV0Alpha3(timeline.parseJson(content.text));
      if (timeline.contentDigest(run) !== runDigest) {
        throw new Error("portable run resource digest changed");
      }

      for (const { name } of queryDrafts) {
        const result = queryResults.get(name);
        if (result?.verified !== true) {
          throw new Error(`MCP did not verify ${name} conclusion`);
        }
        if (
          projectedStates.get(name)?.state?.stateDigest !==
          result.conclusion.receipt.stateDigest
        ) {
          throw new Error(`${name} projected state and receipt disagree`);
        }
      }
    } finally {
      await second.client.close();
    }

    if (stderr.join("") !== "") {
      throw new Error("MCP server wrote unexpected diagnostics");
    }
    const calledTools = new Set(transcript.map(({ tool }) => tool));
    if (
      calledTools.size !== REQUIRED_TOOLS.size ||
      [...REQUIRED_TOOLS].some((tool) => !calledTools.has(tool))
    ) {
      throw new Error("pilot did not exercise its required MCP tool surface");
    }

    const transcriptText = serializeTranscript(transcript, timeline);
    await exportArtifact({
      output,
      pilot,
      timeline,
      run,
      queryDrafts,
      queryResults,
      transcriptText,
      evidence,
    });

    const verification = verifyInSeparateProcess(output);
    await writeCanonicalJson(
      join(output, "verification.json"),
      verification,
      timeline.canonicalJson,
    );
    return verification;
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(working, { recursive: true, force: true });
  }
}

async function exportArtifact({
  output,
  pilot,
  timeline,
  run,
  queryDrafts,
  queryResults,
  transcriptText,
  evidence,
}) {
  await Promise.all([
    mkdir(join(output, "queries"), { mode: 0o700 }),
    mkdir(join(output, "conclusions"), { mode: 0o700 }),
    mkdir(join(output, "evidence"), { mode: 0o700 }),
  ]);

  const conclusionEntries = [];
  for (const { name } of queryDrafts) {
    const result = queryResults.get(name);
    const queryPath = `queries/${name}.json`;
    const conclusionPath = `conclusions/${name}.json`;
    await writeCanonicalJson(
      join(output, queryPath),
      result.query,
      timeline.canonicalJson,
    );
    await writeCanonicalJson(
      join(output, conclusionPath),
      result.conclusion,
      timeline.canonicalJson,
    );
    conclusionEntries.push({
      name,
      query: queryPath,
      conclusion: conclusionPath,
    });
  }

  for (const entry of evidence.values()) {
    await writeFile(join(output, "evidence", entry.name), entry.bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }

  const evidenceEntries = [...evidence.values()]
    .map(({ name, digest, bytes }) => ({
      path: `evidence/${name}`,
      digest,
      byteLength: bytes.byteLength,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const source = sourceIdentity();
  const mcpManifest = await readJson(
    join(repositoryRoot, "packages/mcp-server/package.json"),
    timeline.parseJson,
  );
  const coreManifest = await readJson(
    join(repositoryRoot, "packages/prototype/package.json"),
    timeline.parseJson,
  );
  const environment = {
    schema: "covenant.timeline.mcp-agent-pilot.environment.v1",
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    source,
    timelinePackage: {
      name: coreManifest.name,
      version: coreManifest.version,
    },
    mcpPackage: {
      name: mcpManifest.name,
      version: mcpManifest.version,
    },
    serverRestarted: true,
    serverSessions: 2,
    commandExitStatus: 0,
  };
  const artifact = {
    schema: "covenant.timeline.mcp-agent-pilot.artifact.v1",
    id: pilot.id,
    run: "run.json",
    runDigest: timeline.contentDigest(run),
    evidenceManifest: "evidence-manifest.json",
    environment: "environment.json",
    transcript: "tool-calls.jsonl",
    conclusions: conclusionEntries,
  };

  await Promise.all([
    writeCanonicalJson(
      join(output, "artifact.json"),
      artifact,
      timeline.canonicalJson,
    ),
    writeCanonicalJson(join(output, "run.json"), run, timeline.canonicalJson),
    writeCanonicalJson(
      join(output, "evidence-manifest.json"),
      {
        schema: "covenant.timeline.mcp-agent-pilot.evidence.v1",
        entries: evidenceEntries,
      },
      timeline.canonicalJson,
    ),
    writeCanonicalJson(
      join(output, "environment.json"),
      environment,
      timeline.canonicalJson,
    ),
    writeTranscript(join(output, "tool-calls.jsonl"), transcriptText),
    writeFile(join(output, "README.md"), artifactReadme(pilot), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }),
  ]);
}

async function readInputJson(root, path, maxBytes, label, timeline, aggregate) {
  const bytes = await readBoundedInputFile(
    root,
    path,
    maxBytes,
    label,
    aggregate
      ? (byteLength) => consumeInputBudget(aggregate, byteLength)
      : undefined,
  );
  return timeline.parseJson(decodeUtf8(bytes, label));
}

async function loadEvidence(root, directory) {
  await assertInputDirectory(root, directory, "evidence input directory");
  const names = [];
  const handle = await opendir(directory);
  for await (const entry of handle) {
    if (
      names.length >= MCP_AGENT_PILOT_LIMITS.maxEvidenceFiles ||
      !entry.isFile()
    ) {
      throw new Error(
        "evidence inputs exceed their file limit or are not regular files",
      );
    }
    safeEvidenceName(entry.name, "evidence filename");
    names.push(entry.name);
  }
  names.sort();
  if (names.length === 0) throw new Error("pilot has no evidence");
  const evidence = new Map();
  const evidenceBudget = inputBudget(
    MCP_AGENT_PILOT_LIMITS.maxEvidenceTotalBytes,
    "evidence inputs",
  );
  for (const name of names) {
    const path = join(directory, name);
    const bytes = await readBoundedInputFile(
      root,
      path,
      MCP_AGENT_PILOT_LIMITS.maxEvidenceFileBytes,
      `evidence input ${name}`,
      (byteLength) => consumeInputBudget(evidenceBudget, byteLength),
    );
    evidence.set(name, {
      name,
      bytes,
      digest: sha256(bytes),
    });
  }
  return evidence;
}

function inputBudget(maxBytes, label) {
  return { maxBytes, usedBytes: 0, label };
}

function consumeInputBudget(value, byteLength) {
  value.usedBytes += byteLength;
  if (value.usedBytes > value.maxBytes) {
    throw new Error(`${value.label} exceed their aggregate byte limit`);
  }
}

function materializeEvents(value, evidence) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("events must be a non-empty array");
  }
  const ids = new Set();
  return value.map((input) => {
    const event = structuredClone(input);
    if (
      event === null ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      typeof event.id !== "string" ||
      ids.has(event.id)
    ) {
      throw new Error("event IDs must be unique strings");
    }
    ids.add(event.id);
    if (event.type === "point.declared" || event.type === "interval.declared") {
      return event;
    }
    const holder =
      event.type === "assertion.retracted" ? event : event.assertion;
    if (
      holder === null ||
      typeof holder !== "object" ||
      Array.isArray(holder) ||
      !Array.isArray(holder.evidenceFiles) ||
      holder.evidenceFiles.length === 0
    ) {
      throw new Error(`event ${event.id} has no evidence files`);
    }
    const refs = holder.evidenceFiles.map((name) => {
      safeEvidenceName(name, `event ${event.id} evidence filename`);
      if (!evidence.has(name)) {
        throw new Error(`event ${event.id} references missing evidence`);
      }
      return evidence.get(name).digest;
    });
    delete holder.evidenceFiles;
    holder.evidenceRefs = refs;
    return event;
  });
}

function parsePilot(value) {
  const pilot = exactRecord(
    value,
    [
      "schema",
      "id",
      "title",
      "operator",
      "workflow",
      "contract",
      "events",
      "restartAfterEventId",
      "queries",
    ],
    "pilot input",
  );
  if (pilot.schema !== "covenant.timeline.mcp-agent-pilot.input.v1") {
    throw new Error("pilot input schema is invalid");
  }
  safeName(pilot.id, "pilot ID");
  for (const field of [
    "title",
    "operator",
    "workflow",
    "restartAfterEventId",
  ]) {
    if (typeof pilot[field] !== "string" || pilot[field].length === 0) {
      throw new Error(`pilot ${field} is invalid`);
    }
  }
  if (
    !Array.isArray(pilot.queries) ||
    pilot.queries.length < 2 ||
    pilot.queries.length > MCP_AGENT_PILOT_LIMITS.maxConclusions
  ) {
    throw new Error("pilot must define at least two queries");
  }
  const names = new Set();
  pilot.queries = pilot.queries.map((value, index) => {
    const query = exactRecord(value, ["name", "file"], `query ${index}`);
    safeName(query.name, `query ${index} name`);
    if (names.has(query.name)) throw new Error("query names must be unique");
    names.add(query.name);
    return query;
  });
  return pilot;
}

async function writeTranscript(path, transcript) {
  await writeFile(path, transcript, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

async function assertOutputOutsideCheckout(output) {
  const [checkout, parent] = await Promise.all([
    realpath(repositoryRoot),
    realpath(dirname(output)),
  ]);
  const target = join(parent, basename(output));
  const pathFromCheckout = relative(checkout, target);
  if (
    pathFromCheckout === "" ||
    (!pathFromCheckout.startsWith(`..${sep}`) && !isAbsolute(pathFromCheckout))
  ) {
    throw new Error("output must be outside the repository checkout");
  }
}

function verifyInSeparateProcess(output) {
  const verifier = join(repositoryRoot, "scripts/mcp-agent-pilot-verify.mjs");
  const result = spawnSync(process.execPath, [verifier, output], {
    cwd: output,
    encoding: "utf8",
    env: offlineEnvironment(),
  });
  if (result.status !== 0) {
    throw new Error(
      ["separate pilot verification failed", result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim(),
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("separate pilot verifier returned invalid JSON");
  }
}

function offlineEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_AUTH_TOKEN;
  delete environment.NPM_TOKEN;
  environment.HTTP_PROXY = "http://127.0.0.1:9";
  environment.HTTPS_PROXY = "http://127.0.0.1:9";
  environment.ALL_PROXY = "http://127.0.0.1:9";
  environment.NO_PROXY = "";
  return environment;
}

function artifactReadme(pilot) {
  return `# ${pilot.title}

Operator: ${pilot.operator}

Workflow: ${pilot.workflow}

This artifact was produced by the Covenant Timeline MCP restart-and-correction
pilot. It crossed two MCP server sessions, retained exact evidence bytes,
recorded a correction without rewriting the earlier knowledge cut, and was
verified by a separate process.

The bundled sample is not independent adoption. Replace the example operator,
workflow, and records before publishing a real pilot.

Verify from a built Covenant Timeline checkout:

\`\`\`sh
node scripts/mcp-agent-pilot-verify.mjs /path/to/this/artifact
\`\`\`
`;
}

function parseArguments(argv) {
  let inputDirectory;
  let outputDirectory;
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`missing value for ${option}`);
    if (option === "--input") inputDirectory = value;
    else if (option === "--out") outputDirectory = value;
    else throw new Error(`unknown option ${option}`);
  }
  if (!inputDirectory || !outputDirectory) {
    throw new Error(
      "usage: mcp-agent-pilot --input <directory> --out <directory>",
    );
  }
  return { inputDirectory, outputDirectory };
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  runMcpAgentPilot(parseArguments(process.argv.slice(2)))
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `mcp-agent-pilot: ${error instanceof Error ? error.message : "failed"}\n`,
      );
      process.exitCode = 1;
    });
}

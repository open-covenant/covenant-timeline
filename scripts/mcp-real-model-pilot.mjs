#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
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
import { connectMcpClient } from "./mcp-agent-pilot.mjs";
import {
  decodeUtf8,
  loadMcpClient,
  repositoryRoot,
  sha256,
  writeCanonicalJson,
} from "./mcp-agent-pilot-lib.mjs";
import {
  REAL_MODEL_PILOT_SCHEMA,
  assertRealModelPilotRuntime,
  captureRealModelPilotRuntime,
  createAdapterRequest,
  createProposalScope,
  invocationRecord,
  invokeAdapter,
  loadModelConfig,
  loadPilotInput,
  redactedModelCall,
  validateProposalSemantics,
  validateProviderProposal,
} from "./mcp-real-model-pilot-lib.mjs";

const DECLARATIONS = [
  {
    id: "event-artifacts-published-declared",
    type: "point.declared",
    point: {
      id: "artifacts-published",
      contextId: "actual",
      axisId: "unix-milliseconds",
    },
  },
  {
    id: "event-tagged-readiness-declared",
    type: "point.declared",
    point: {
      id: "tagged-readiness-recorded",
      contextId: "actual",
      axisId: "unix-milliseconds",
    },
  },
];

export async function runStart(options) {
  validateAdapterSelection(options.adapter, options.allowDirty);
  const input = await loadPilotInput(options.input);
  const modelConfig = await loadModelConfig(options.config, {
    allowDirty: options.allowDirty,
  });
  const runtime = await phaseRuntime(options, input.timeline);
  const state = resolve(options.state);
  await assertOutsideCheckout(state);
  await mkdir(state, { mode: 0o700 });
  await mkdir(join(state, "mcp"), { mode: 0o700 });

  const invocation = invocationRecord("initial");
  const session = await connectServer(join(state, "mcp"));
  try {
    const created = await session.call("timeline_create_run", {
      contract: input.contract,
    });
    let runDigest = created.timeline.runDigest;
    for (const event of DECLARATIONS) {
      const result = await session.call("timeline_append_event", {
        runId: input.contract.id,
        expectedRunDigest: runDigest,
        event,
      });
      runDigest = result.timeline.runDigest;
    }
    const run = await readRun(
      session.client,
      input.contract.id,
      input.timeline,
    );
    const scope = createProposalScope({ phase: "initial", input, run });
    const { request, outputSchema } = createAdapterRequest({
      input,
      scope,
      config: modelConfig.config,
    });
    const adapter = invokeAdapter(
      options.adapter.command,
      options.adapter.args,
      request,
      input.timeline,
    );
    const { proposal, usage } = validateProviderProposal(
      adapter.response,
      outputSchema,
    );
    validateProposalSemantics("initial", proposal, input.pilot.expected);
    const applied = await session.call("timeline_apply_model_proposal", {
      runId: input.contract.id,
      expectedRevision: run.events.length,
      expectedRunDigest: runDigest,
      expectedRequestId: scope.host.expectedRequestId,
      proposal,
      evidenceCatalog: scope.host.evidenceCatalog,
      referenceCatalog: scope.host.referenceCatalog,
      assertionCatalog: scope.host.assertionCatalog,
      knowledgeCutCatalog: scope.host.knowledgeCutCatalog,
    });
    if (!applied.applied || applied.events.length !== 2) {
      throw new Error("initial model proposal did not append two assertions");
    }
    const conclusion = await session.call("timeline_reason", {
      runId: input.contract.id,
      query: omitSchema(applied.query),
    });
    assertDifference(
      conclusion.conclusion,
      input.pilot.expected.initialDifference,
      "initial",
    );
    const call = redactedModelCall({
      phase: "initial",
      input,
      modelConfig,
      request,
      responseText: adapter.responseText,
      proposal,
      usage,
      scope,
      apply: applied,
    });
    await assertRealModelPilotRuntime(runtime, input.timeline);
    await Promise.all([
      writeCanonicalJson(
        join(state, "initial-call.json"),
        call,
        input.timeline.canonicalJson,
      ),
      writeCanonicalJson(
        join(state, "initial-conclusion.json"),
        conclusion,
        input.timeline.canonicalJson,
      ),
      writeCanonicalJson(
        join(state, "phase.json"),
        {
          schema: "covenant.timeline.real-model-pilot.phase.v1",
          phase: "initial-complete",
          inputDigest: input.inputDigest,
          runId: input.contract.id,
          runDigest: applied.timeline.runDigest,
          revision: applied.timeline.revision,
          invocation,
          source: modelConfig.source,
          runtime: runtime.identity,
          runtimeDigest: runtime.digest,
        },
        input.timeline.canonicalJson,
      ),
    ]);
    return {
      phase: "initial-complete",
      runDigest: applied.timeline.runDigest,
      recordedThrough: applied.query.recordedThrough,
    };
  } finally {
    await session.client.close();
  }
}

export async function runResume(options) {
  validateAdapterSelection(options.adapter, options.allowDirty);
  const input = await loadPilotInput(options.input);
  const modelConfig = await loadModelConfig(options.config, {
    allowDirty: options.allowDirty,
  });
  const state = await realpath(resolve(options.state));
  const output = resolve(options.out);
  await assertOutsideCheckout(output);
  const phase = await readCanonical(join(state, "phase.json"), input.timeline);
  const runtime = await assertRealModelPilotRuntime(
    { identity: phase.runtime, digest: phase.runtimeDigest },
    input.timeline,
  );
  await assertBootstrapRuntime(options, runtime, input.timeline);
  if (
    phase.phase !== "initial-complete" ||
    phase.inputDigest !== input.inputDigest ||
    phase.source.revision !== modelConfig.source.revision ||
    phase.source.dirty !== modelConfig.source.dirty ||
    phase.runtime.profile !== runtimeProfile(options.allowDirty) ||
    phase.invocation.processId === process.pid
  ) {
    throw new Error("resume does not match a separate completed initial phase");
  }
  const initialCall = await readCanonical(
    join(state, "initial-call.json"),
    input.timeline,
  );
  const initialConclusion = await readCanonical(
    join(state, "initial-conclusion.json"),
    input.timeline,
  );
  const invocation = invocationRecord("correction");
  const session = await connectServer(join(state, "mcp"));
  try {
    const listed = await session.call("timeline_list_runs", {});
    const recovered = listed.timelines.find(
      ({ runId }) => runId === input.contract.id,
    );
    if (
      !recovered ||
      recovered.runDigest !== phase.runDigest ||
      recovered.revision !== phase.revision
    ) {
      throw new Error("MCP state did not recover at the recorded prefix");
    }
    const run = await readRun(
      session.client,
      input.contract.id,
      input.timeline,
    );
    const initialAssertion = run.events.find(
      (event) =>
        event.type === "coordinate.asserted" &&
        event.assertion.pointId === "artifacts-published",
    );
    if (!initialAssertion) {
      throw new Error("initial publication assertion is missing");
    }
    const scope = createProposalScope({
      phase: "correction",
      input,
      run,
      initialAssertionId: initialAssertion.assertion.id,
    });
    const { request, outputSchema } = createAdapterRequest({
      input,
      scope,
      config: modelConfig.config,
    });
    const adapter = invokeAdapter(
      options.adapter.command,
      options.adapter.args,
      request,
      input.timeline,
    );
    const { proposal, usage } = validateProviderProposal(
      adapter.response,
      outputSchema,
    );
    validateProposalSemantics("correction", proposal, input.pilot.expected);
    const applied = await session.call("timeline_apply_model_proposal", {
      runId: input.contract.id,
      expectedRevision: run.events.length,
      expectedRunDigest: recovered.runDigest,
      expectedRequestId: scope.host.expectedRequestId,
      proposal,
      evidenceCatalog: scope.host.evidenceCatalog,
      referenceCatalog: scope.host.referenceCatalog,
      assertionCatalog: scope.host.assertionCatalog,
      knowledgeCutCatalog: scope.host.knowledgeCutCatalog,
    });
    if (!applied.applied || applied.events.length !== 1) {
      throw new Error("correction model proposal did not append one assertion");
    }
    const historicalQuery = {
      ...omitSchema(applied.query),
      id: "query-readiness-minus-publication-before-correction",
      recordedThrough: initialCall.apply.query.recordedThrough,
    };
    const historical = await session.call("timeline_reason", {
      runId: input.contract.id,
      query: historicalQuery,
    });
    const current = await session.call("timeline_reason", {
      runId: input.contract.id,
      query: omitSchema(applied.query),
    });
    assertDifference(
      historical.conclusion,
      input.pilot.expected.initialDifference,
      "historical",
    );
    assertDifference(
      current.conclusion,
      input.pilot.expected.correctedDifference,
      "corrected",
    );
    const finalRun = await readRun(
      session.client,
      input.contract.id,
      input.timeline,
    );
    const correctionCall = redactedModelCall({
      phase: "correction",
      input,
      modelConfig,
      request,
      responseText: adapter.responseText,
      proposal,
      usage,
      scope,
      apply: applied,
    });
    await assertRealModelPilotRuntime(runtime, input.timeline);
    await exportArtifact({
      output,
      input,
      modelConfig,
      phase,
      invocation,
      initialCall,
      correctionCall,
      initialConclusion,
      historical,
      current,
      finalRun,
      runtime,
    });
    const verification = verifyInSeparateProcess(output, {
      allowDirty: options.allowDirty,
    });
    await writeCanonicalJson(
      join(output, "verification.json"),
      verification,
      input.timeline.canonicalJson,
    );
    return verification;
  } finally {
    await session.client.close();
  }
}

async function exportArtifact({
  output,
  input,
  modelConfig,
  phase,
  invocation,
  initialCall,
  correctionCall,
  initialConclusion,
  historical,
  current,
  finalRun,
  runtime,
}) {
  await mkdir(output, { mode: 0o700 });
  await Promise.all([
    mkdir(join(output, "evidence"), { mode: 0o700 }),
    mkdir(join(output, "model-calls"), { mode: 0o700 }),
    mkdir(join(output, "queries"), { mode: 0o700 }),
    mkdir(join(output, "conclusions"), { mode: 0o700 }),
  ]);
  for (const entry of input.evidence.values()) {
    await writeFile(join(output, "evidence", entry.name), entry.bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
  const calls = [initialCall, correctionCall];
  const conclusions = [
    ["initial", initialConclusion],
    ["historical", historical],
    ["current", current],
  ];
  const artifactPaths = [
    ...calls.map((call) => `model-calls/${call.phase}.json`),
    ...conclusions.flatMap(([name]) => [
      `queries/${name}.json`,
      `conclusions/${name}.json`,
    ]),
    ...[...input.evidence.values()].map(({ name }) => `evidence/${name}`),
    "README.md",
    "artifact.json",
    "evidence-manifest.json",
    "model-config.json",
    "pilot-input.json",
    "prompt.md",
    "run.json",
  ].sort();
  await Promise.all([
    ...calls.map((call) =>
      writeCanonicalJson(
        join(output, "model-calls", `${call.phase}.json`),
        call,
        input.timeline.canonicalJson,
      ),
    ),
    ...conclusions.flatMap(([name, result]) => [
      writeCanonicalJson(
        join(output, "queries", `${name}.json`),
        result.query,
        input.timeline.canonicalJson,
      ),
      writeCanonicalJson(
        join(output, "conclusions", `${name}.json`),
        result.conclusion,
        input.timeline.canonicalJson,
      ),
    ]),
    writeCanonicalJson(
      join(output, "run.json"),
      finalRun,
      input.timeline.canonicalJson,
    ),
    writeCanonicalJson(
      join(output, "pilot-input.json"),
      input.pilot,
      input.timeline.canonicalJson,
    ),
    writeCanonicalJson(
      join(output, "model-config.json"),
      modelConfig.config,
      input.timeline.canonicalJson,
    ),
    writeCanonicalJson(
      join(output, "evidence-manifest.json"),
      {
        schema: "covenant.timeline.real-model-pilot.evidence.v1",
        redaction: "public-fields-allowlisted",
        entries: [...input.evidence.values()].map(
          ({ name, digest, bytes }) => ({
            path: `evidence/${name}`,
            digest,
            byteLength: bytes.byteLength,
          }),
        ),
      },
      input.timeline.canonicalJson,
    ),
    writeCanonicalJson(
      join(output, "artifact.json"),
      {
        schema: REAL_MODEL_PILOT_SCHEMA,
        id: input.pilot.id,
        operator: input.pilot.operator,
        operation: "maintainer-operated",
        provenance: {
          modelExecution: "maintainer-attested",
          processRestart: "maintainer-attested",
        },
        workflow: input.pilot.workflow,
        inputDigest: input.inputDigest,
        pilotInput: "pilot-input.json",
        run: "run.json",
        runDigest: input.timeline.contentDigest(finalRun),
        evidenceManifest: "evidence-manifest.json",
        modelConfig: "model-config.json",
        modelConfigDigest: modelConfig.digest,
        prompt: "prompt.md",
        promptDigest: input.timeline.contentDigest(input.prompt),
        contentManifest: "content-manifest.json",
        expected: input.pilot.expected,
        modelCalls: ["model-calls/initial.json", "model-calls/correction.json"],
        conclusions: conclusions.map(([name]) => ({
          name,
          query: `queries/${name}.json`,
          conclusion: `conclusions/${name}.json`,
        })),
        invocations: [phase.invocation, invocation],
        source: modelConfig.source,
        runtime: runtime.identity,
        runtimeDigest: runtime.digest,
        limitations: [
          "not-independent-adoption",
          "public-evidence-normalized-by-host",
          "structural-model-admission-with-scenario-specific-semantic-check",
        ],
      },
      input.timeline.canonicalJson,
    ),
    writeFile(join(output, "README.md"), artifactReadme(input.pilot.title), {
      flag: "wx",
      mode: 0o600,
    }),
    writeFile(join(output, "prompt.md"), input.prompt, {
      flag: "wx",
      mode: 0o600,
    }),
  ]);
  const entries = await Promise.all(
    artifactPaths.map(async (path) => {
      const bytes = await readFile(join(output, path));
      return {
        path,
        digest: sha256(bytes),
        byteLength: bytes.byteLength,
      };
    }),
  );
  await writeCanonicalJson(
    join(output, "content-manifest.json"),
    {
      schema: "covenant.timeline.real-model-pilot.content-manifest.v1",
      algorithm: "sha256",
      excluded: ["content-manifest.json", "verification.json"],
      entries,
    },
    input.timeline.canonicalJson,
  );
}

async function connectServer(dataDirectory) {
  const { Client, StdioClientTransport } = await loadMcpClient();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(repositoryRoot, "packages/mcp-server/dist/cli.js"),
      "--data-dir",
      dataDirectory,
    ],
    stderr: "pipe",
  });
  let diagnostics = "";
  transport.stderr?.on("data", (chunk) => {
    diagnostics += chunk.toString("utf8");
  });
  const client = new Client({
    name: "timeline-real-model-pilot",
    version: "1.0.0",
  });
  await connectMcpClient(client, transport);
  return {
    client,
    async call(name, args) {
      const response = await client.callTool({ name, arguments: args });
      if (
        response.isError ||
        response.structuredContent === undefined ||
        diagnostics !== ""
      ) {
        throw new Error(`MCP ${name} failed`);
      }
      return response.structuredContent;
    },
  };
}

async function readRun(client, runId, timeline) {
  const resource = await client.readResource({
    uri: `timeline://run/${encodeURIComponent(runId)}`,
  });
  const content = resource.contents[0];
  if (!content || !("text" in content)) {
    throw new Error("MCP run resource is missing");
  }
  return timeline.parseRunDocumentV0Alpha3(timeline.parseJson(content.text));
}

async function readCanonical(path, timeline) {
  const text = decodeUtf8(await readFile(path), "pilot state");
  const value = timeline.parseJson(text);
  if (text !== `${timeline.canonicalJson(value)}\n`) {
    throw new Error("pilot state is not canonical JSON");
  }
  return value;
}

function assertDifference(conclusion, value, label) {
  const result = conclusion?.result;
  if (
    result?.type !== "difference.bounds" ||
    result.status !== "bounded" ||
    result.minimum !== value ||
    result.maximum !== value
  ) {
    throw new Error(
      `${label} conclusion does not match the expected difference`,
    );
  }
}

function omitSchema({ schema: _schema, ...value }) {
  return value;
}

async function assertOutsideCheckout(path) {
  const checkout = await realpath(repositoryRoot);
  const parent = await realpath(dirname(path));
  const fromCheckout = relative(checkout, join(parent, basename(path)));
  if (
    fromCheckout === "" ||
    (!fromCheckout.startsWith(`..${sep}`) && !isAbsolute(fromCheckout))
  ) {
    throw new Error(
      "pilot state and output must be outside the source checkout",
    );
  }
}

function verifyInSeparateProcess(output, { allowDirty }) {
  const result = spawnSync(
    process.execPath,
    [
      join(repositoryRoot, "scripts/mcp-real-model-pilot-verify-bootstrap.mjs"),
      output,
      ...(allowDirty ? ["--allow-dirty"] : []),
      "--require-runtime-match",
    ],
    {
      cwd: output,
      encoding: "utf8",
      env: credentialFreeVerifierEnvironment(),
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `credential-free pilot verification failed: ${result.stderr.trim()}`,
    );
  }
  return JSON.parse(result.stdout);
}

function credentialFreeVerifierEnvironment() {
  const environment = {};
  for (const name of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

function artifactReadme(title) {
  return `# ${title}

This is a maintainer-operated historical staged evidence-disclosure replay. It is not independent adoption or a live delayed-evidence observation.

The artifact retains allowlisted public evidence, redacted model requests, exact model configuration, model proposals, a portable run, and verified conclusions before and after a process restart and publication-time correction. MCP state contains evidence digests, not source text. Model execution and process restart provenance are maintainer-attested, not cryptographically proven by the artifact.

The recorded runtime identity binds the Node executable, compiled core and MCP server, pilot and adapter scripts, resolved workspace targets, and transitive runtime package bytes used by the formal path. Stable logical package IDs keep local checkout and package-store paths out of the artifact. The content manifest covers every primary artifact file. It excludes itself and the derived verification report to avoid a checksum cycle; the verifier rejects every other unlisted file.

Verify from a clean checkout at the recorded source revision. The credential-free verifier performs no network requests and reports whether the local runtime matches the recorded operator runtime:

\`\`\`sh
node scripts/mcp-real-model-pilot-verify-bootstrap.mjs /path/to/artifact
\`\`\`

Require bit-for-bit runtime reproduction when the recorded runtime bytes are available:

\`\`\`sh
node scripts/mcp-real-model-pilot-verify-bootstrap.mjs /path/to/artifact --require-runtime-match
\`\`\`
`;
}

export function validateAdapterSelection(adapter, allowDirty) {
  if (allowDirty) return;
  const expectedAdapter = join(
    repositoryRoot,
    "scripts/openai-responses-model-eval-adapter.mjs",
  );
  if (
    !isAbsolute(adapter.command) ||
    resolve(adapter.command) !== resolve(process.execPath) ||
    adapter.args.length !== 1 ||
    !isAbsolute(adapter.args[0]) ||
    resolve(adapter.args[0]) !== resolve(expectedAdapter)
  ) {
    throw new Error(
      "formal model pilot requires the source-bound OpenAI Responses adapter",
    );
  }
}

function runtimeProfile(allowDirty) {
  return allowDirty ? "development-unbound-adapter" : "formal-openai";
}

async function phaseRuntime(options, timeline) {
  if (options.runtimeBinding) {
    await assertBootstrapRuntime(options, options.runtimeBinding, timeline);
    return options.runtimeBinding;
  }
  if (!options.allowDirty) {
    throw new Error(
      "formal model pilot must run through the runtime bootstrap",
    );
  }
  return captureRealModelPilotRuntime(timeline, {
    profile: runtimeProfile(options.allowDirty),
  });
}

async function assertBootstrapRuntime(options, expected, timeline) {
  if (!options.runtimeBinding) {
    if (options.allowDirty) return;
    throw new Error(
      "formal model pilot must run through the runtime bootstrap",
    );
  }
  if (
    options.runtimeBinding.digest !== expected.digest ||
    timeline.canonicalJson(options.runtimeBinding.identity) !==
      timeline.canonicalJson(expected.identity)
  ) {
    throw new Error("bootstrap runtime does not match the retained phase");
  }
  await assertRealModelPilotRuntime(options.runtimeBinding, timeline);
}

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("pilot requires an adapter command after --");
  }
  const [mode, ...raw] = argv.slice(0, separator);
  const adapter = argv.slice(separator + 1);
  const options = {
    mode,
    adapter: { command: adapter[0], args: adapter.slice(1) },
    allowDirty: false,
  };
  for (let index = 0; index < raw.length; ) {
    const option = raw[index];
    if (option === "--allow-dirty") {
      options.allowDirty = true;
      index += 1;
      continue;
    }
    const value = raw[index + 1];
    if (!value) throw new Error(`missing value for ${option}`);
    if (option === "--input") options.input = value;
    else if (option === "--state") options.state = value;
    else if (option === "--config") options.config = value;
    else if (option === "--out") options.out = value;
    else throw new Error(`unknown option ${option}`);
    index += 2;
  }
  if (
    !["start", "resume"].includes(mode) ||
    !options.input ||
    !options.state ||
    !options.config ||
    (mode === "resume" && !options.out)
  ) {
    throw new Error(
      "usage: mcp-real-model-pilot <start|resume> --input <dir> --state <dir> --config <file> [--out <dir>] [--allow-dirty] -- <adapter> [args...]",
    );
  }
  return options;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report =
      options.mode === "start"
        ? await runStart(options)
        : await runResume(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(
      `mcp-real-model-pilot: ${error instanceof Error ? error.message : "failed"}\n`,
    );
    process.exitCode = 1;
  }
}

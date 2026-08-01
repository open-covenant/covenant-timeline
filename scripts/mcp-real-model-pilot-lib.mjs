import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  canonicalInputRoot,
  decodeUtf8,
  exactRecord,
  loadTimeline,
  readBoundedExactFile,
  readBoundedInputFile,
  repositoryRoot,
  resolveInside,
  safeEvidenceName,
  sha256,
  sourceIdentity,
} from "./mcp-agent-pilot-lib.mjs";
import {
  capturePilotRuntime,
  pilotRuntimeMatches,
  validatePilotRuntime,
} from "./mcp-real-model-pilot-runtime.mjs";

export const REAL_MODEL_PILOT_SCHEMA =
  "covenant.timeline.real-model-pilot.artifact.v1";
export const REAL_MODEL_PILOT_ADMISSION_POLICY = Object.freeze({
  schema: "covenant.timeline.real-model-pilot.admission-policy.v1",
  id: "maintainer-operated-pilot-admission-v1",
  authorityId: "covenant-timeline-maintainers",
  policyRef: "covenant.timeline/maintainer-operated-pilot-admission/v1",
  operation: "maintainer-operated",
  evidenceBoundary: "host-normalized-public-fields",
  declarationRule: "host-defined-contract-consistent-declarations",
  proposalRule:
    "untrusted-model-proposal-previewed-and-host-admitted-only-after-scenario-semantic-validation",
});
export const REAL_MODEL_PILOT_LIMITS = Object.freeze({
  artifactBytes: 128 * 1024,
  artifactFiles: 64,
  artifactTotalBytes: 64 * 1024 * 1024,
  contentManifestBytes: 256 * 1024,
  evidenceBytes: 64 * 1024,
  configBytes: 64 * 1024,
  promptBytes: 64 * 1024,
  adapterBytes: 1024 * 1024,
  pilotInputBytes: 64 * 1024,
  runBytes: 4 * 1024 * 1024,
  modelCallBytes: 4 * 1024 * 1024,
  queryBytes: 1024 * 1024,
  conclusionBytes: 4 * 1024 * 1024,
  readmeBytes: 64 * 1024,
  runtimeExecutableBytes: 256 * 1024 * 1024,
  runtimeFileBytes: 16 * 1024 * 1024,
  runtimeFiles: 256,
});
export const REAL_MODEL_PILOT_PROPOSAL_LIMITS = Object.freeze({
  maxChanges: 4,
  maxSupportsPerChange: 1,
});

const MCP_SERVER_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/u;

export function validateMcpWriterIdentity(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "reasoner,serverPackage,serverVersion,timelinePackage,timelineVersion" ||
    value.timelinePackage !== "@covenant-org/timeline" ||
    value.timelineVersion !== "0.0.0-alpha.3" ||
    value.reasoner !== "covenant.timeline.stn.v0alpha1" ||
    value.serverPackage !== "@covenant-org/timeline-mcp" ||
    typeof value.serverVersion !== "string" ||
    value.serverVersion.length > 64 ||
    !MCP_SERVER_VERSION_PATTERN.test(value.serverVersion)
  ) {
    throw new Error("MCP writer identity is unsupported");
  }
  return value;
}

export function validateMcpWriterTrajectory(audit) {
  const lastWriter = validateMcpWriterIdentity(audit.lastWriter);
  if (!Array.isArray(audit.admissions) || audit.admissions.length === 0) {
    throw new Error("MCP writer trajectory is empty");
  }
  for (const admission of audit.admissions) {
    validateMcpWriterIdentity(admission.writer);
  }
  const finalWriter = audit.admissions.at(-1).writer;
  if (
    Object.keys(lastWriter).some((key) => lastWriter[key] !== finalWriter[key])
  ) {
    throw new Error("MCP last writer does not match the final admission");
  }
  return audit;
}

export async function captureRealModelPilotRuntime(timeline, options = {}) {
  const binding = await capturePilotRuntime(options);
  if (timeline.contentDigest(binding.identity) !== binding.digest) {
    throw new Error("runtime canonicalization does not match Timeline");
  }
  return binding;
}

export async function assertRealModelPilotRuntime(
  expected,
  timeline,
  options = {},
) {
  if (!(await realModelPilotRuntimeMatches(expected, timeline, options))) {
    throw new Error("real-model pilot runtime identity changed");
  }
  return expected;
}

export function validateRealModelPilotRuntime(expected, timeline) {
  exactRecord(expected, ["identity", "digest"], "pilot runtime binding");
  validatePilotRuntime(expected);
  if (timeline.contentDigest(expected.identity) !== expected.digest) {
    throw new Error("real-model pilot runtime digest did not reproduce");
  }
  return expected;
}

export async function realModelPilotRuntimeMatches(
  expected,
  timeline,
  options = {},
) {
  validateRealModelPilotRuntime(expected, timeline);
  return pilotRuntimeMatches(expected, options);
}

export function createRealModelPilotAdmissionPolicy(timeline) {
  const document = structuredClone(REAL_MODEL_PILOT_ADMISSION_POLICY);
  const bytes = Buffer.from(`${timeline.canonicalJson(document)}\n`);
  const digest = timeline.byteDigest(bytes);
  return {
    document,
    bytes,
    digest,
    decision: {
      authorityId: document.authorityId,
      policyRef: document.policyRef,
      policyDigest: digest,
    },
  };
}

export async function loadPilotInput(directory) {
  const root = await canonicalInputRoot(resolve(directory));
  const timeline = await loadTimeline();
  const pilot = exactRecord(
    timeline.parseJson(
      decodeUtf8(
        await readBoundedInputFile(
          root,
          join(root, "pilot.json"),
          REAL_MODEL_PILOT_LIMITS.configBytes,
          "pilot input",
        ),
        "pilot input",
      ),
    ),
    [
      "schema",
      "id",
      "title",
      "operator",
      "workflow",
      "contract",
      "prompt",
      "initialEvidence",
      "correctionEvidence",
      "expected",
    ],
    "real-model pilot input",
  );
  if (pilot.schema !== "covenant.timeline.real-model-pilot.input.v1") {
    throw new Error("real-model pilot input schema is invalid");
  }
  const contract = timeline.parseContractV0Alpha3(
    timeline.parseJson(
      decodeUtf8(
        await readBoundedInputFile(
          root,
          resolveInside(root, pilot.contract, "pilot contract path"),
          REAL_MODEL_PILOT_LIMITS.configBytes,
          "pilot contract",
        ),
        "pilot contract",
      ),
    ),
  );
  const prompt = decodeUtf8(
    await readBoundedInputFile(
      root,
      resolveInside(root, pilot.prompt, "pilot prompt path"),
      REAL_MODEL_PILOT_LIMITS.promptBytes,
      "pilot prompt",
    ),
    "pilot prompt",
  );
  const evidence = new Map();
  if (
    !Array.isArray(pilot.initialEvidence) ||
    pilot.initialEvidence.length !== 2 ||
    !Array.isArray(pilot.correctionEvidence) ||
    pilot.correctionEvidence.length !== 1
  ) {
    throw new Error("pilot evidence phases are invalid");
  }
  for (const name of [...pilot.initialEvidence, ...pilot.correctionEvidence]) {
    safeEvidenceName(name, "pilot evidence filename");
    if (evidence.has(name)) throw new Error("pilot evidence is duplicated");
    const bytes = await readBoundedInputFile(
      root,
      join(root, "evidence", name),
      REAL_MODEL_PILOT_LIMITS.evidenceBytes,
      `pilot evidence ${name}`,
    );
    const text = decodeUtf8(bytes, `pilot evidence ${name}`);
    evidence.set(name, {
      name,
      id: name.replace(/\.[^.]+$/u, ""),
      bytes,
      text,
      digest: sha256(bytes),
    });
  }
  validateExpected(pilot.expected, evidence);
  return {
    root,
    timeline,
    pilot,
    contract,
    prompt,
    evidence,
    inputDigest: timeline.contentDigest({
      pilot,
      contract,
      promptDigest: sha256(Buffer.from(prompt)),
      evidence: [...evidence.values()].map(({ name, digest }) => ({
        name,
        digest,
      })),
    }),
  };
}

function validateExpected(expected, evidence) {
  exactRecord(
    expected,
    [
      "tagCommit",
      "provisionalPublication",
      "authoritativePublication",
      "readinessRecorded",
      "initialDifference",
      "correctedDifference",
    ],
    "pilot expected values",
  );
  if (!/^[0-9a-f]{40}$/u.test(expected.tagCommit)) {
    throw new Error("pilot tagged commit is invalid");
  }
  for (const [name, value] of Object.entries(expected)) {
    if (name === "tagCommit") continue;
    if (!Number.isSafeInteger(value)) {
      throw new Error(`pilot expected ${name} is not a safe integer`);
    }
  }
  if (
    expected.readinessRecorded - expected.provisionalPublication !==
      expected.initialDifference ||
    expected.readinessRecorded - expected.authoritativePublication !==
      expected.correctedDifference
  ) {
    throw new Error("pilot expected differences do not match coordinates");
  }
  for (const entry of evidence.values()) {
    if (!entry.text.includes(expected.tagCommit)) {
      throw new Error(`${entry.name} does not bind the tagged commit`);
    }
  }
}

export async function loadModelConfig(path, { allowDirty = false } = {}) {
  const timeline = await loadTimeline();
  const bytes = await readBoundedExactFile(
    resolve(path),
    REAL_MODEL_PILOT_LIMITS.configBytes,
    "model config",
  );
  const config = timeline.parseJson(decodeUtf8(bytes, "model config"));
  exactRecord(
    config,
    ["schema", "id", "benchmarkRevision", "adapter", "model", "generation"],
    "model config",
  );
  if (config.schema !== "covenant.timeline.model-proposal-eval.config.v1") {
    throw new Error("model config schema is invalid");
  }
  const source = sourceIdentity();
  if (!allowDirty && source.dirty) {
    throw new Error("formal model pilot requires a clean source checkout");
  }
  if (!allowDirty && config.benchmarkRevision !== source.revision) {
    throw new Error("model config is not bound to the source revision");
  }
  if (
    !allowDirty &&
    (config.adapter?.id !== "openai-responses" ||
      config.adapter.version !== "1" ||
      config.model?.provider !== "openai")
  ) {
    throw new Error("formal model pilot requires an OpenAI Responses config");
  }
  return { config, source, digest: timeline.contentDigest(config) };
}

export function createProposalScope({ phase, input, run, initialAssertionId }) {
  const publication = {
    type: "point",
    handle: "point-publication",
    pointId: "artifacts-published",
  };
  const readiness = {
    type: "point",
    handle: "point-readiness",
    pointId: "tagged-readiness-recorded",
  };
  const difference = {
    type: "difference",
    handle: "difference-readiness-minus-publication",
    fromPointId: publication.pointId,
    toPointId: readiness.pointId,
  };
  const evidenceNames =
    phase === "initial"
      ? input.pilot.initialEvidence
      : input.pilot.correctionEvidence;
  const evidenceCatalog = evidenceNames.map((name) => {
    const entry = input.evidence.get(name);
    if (!entry) throw new Error(`pilot evidence ${name} is missing`);
    return { id: entry.id, status: "current", text: entry.text };
  });
  const referenceCatalog = [publication, readiness, difference];
  const assertionCatalog =
    phase === "correction"
      ? [
          {
            handle: "assertion-provisional-publication",
            assertionId: initialAssertionId,
          },
        ]
      : [];
  const knowledgeCutCatalog =
    phase === "correction"
      ? [{ handle: "cut-before-correction", recordedThrough: 3 }]
      : [];
  const expectedRequestId = `covenant-release-${phase}-v1`;
  const host = {
    run,
    expectedRequestId,
    evidenceCatalog,
    referenceCatalog,
    assertionCatalog,
    knowledgeCutCatalog,
  };
  const modelInput = {
    question:
      "What is tagged-commit readiness time minus artifact publication time in milliseconds?",
    evidence: evidenceCatalog.map(({ id, text }) => ({ id, text })),
    references: [
      {
        handle: publication.handle,
        type: "point",
        label: "artifact publication",
      },
      {
        handle: readiness.handle,
        type: "point",
        label: "tagged-commit readiness record",
      },
      {
        handle: difference.handle,
        type: "difference",
        from: "artifact publication",
        to: "tagged-commit readiness record",
        meaning: "tagged-commit readiness record minus artifact publication",
      },
    ],
    priorState: {
      assertions:
        phase === "correction"
          ? [
              {
                handle: "assertion-provisional-publication",
                type: "coordinate",
                target: publication.handle,
                bounds: {
                  type: "exact",
                  value: input.pilot.expected.provisionalPublication,
                },
              },
            ]
          : [],
      knowledgeCuts:
        phase === "correction" ? [{ handle: "cut-before-correction" }] : [],
    },
  };
  return { host, modelInput };
}

export function createAdapterRequest({ input, scope, config }) {
  const outputSchema = input.timeline.createTemporalModelProposalOutputSchemaV1(
    scope.host,
    REAL_MODEL_PILOT_PROPOSAL_LIMITS,
  );
  return {
    outputSchema,
    request: {
      schema: "covenant.timeline.model-eval.request.v1",
      benchmark: "model-proposal-boundary-v1",
      arm: "proposal",
      requestId: scope.host.expectedRequestId,
      prompt: input.prompt,
      input: scope.modelInput,
      outputSchema,
      outputSchemaDigest: input.timeline.contentDigest(outputSchema),
      config,
      configDigest: input.timeline.contentDigest(config),
    },
  };
}

export function invokeAdapter(command, args, request, timeline) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    input: Buffer.from(`${timeline.canonicalJson(request)}\n`),
    timeout: 120_000,
    maxBuffer: REAL_MODEL_PILOT_LIMITS.adapterBytes * 2,
    env: adapterEnvironment(process.env),
  });

  return {
    status: Number.isSafeInteger(result.status) ? result.status : null,
    signal: typeof result.signal === "string" ? result.signal : null,
    error:
      result.error instanceof Error
        ? {
            code: adapterErrorCode(result.error),
          }
        : null,
    stdout: rawAdapterStream(result.stdout),
    stderr: rawAdapterStream(result.stderr),
  };
}

export function parseAdapterExecution(execution, timeline) {
  validateAdapterExecution(execution);
  if (
    execution.error?.code === "enobufs" ||
    execution.stdout.truncated ||
    execution.stderr.truncated
  ) {
    throw adapterFailure("adapter-output", "adapter.output-limit");
  }
  if (execution.error || execution.status !== 0 || execution.signal) {
    throw adapterFailure("adapter-execution", "adapter.nonzero-exit");
  }

  let stdout;
  try {
    stdout = decodeUtf8(
      decodeAdapterStream(execution.stdout),
      "model adapter stdout",
    );
  } catch {
    throw adapterFailure("adapter-output", "adapter.invalid-utf8");
  }
  const lines = stdout.trimEnd().split("\n");
  if (lines.length !== 1 || lines[0].length === 0) {
    throw adapterFailure("adapter-output", "adapter.invalid-framing");
  }
  let response;
  try {
    response = timeline.parseJson(lines[0]);
  } catch {
    throw adapterFailure("adapter-output", "adapter.invalid-json");
  }
  if (response?.schema === "covenant.timeline.model-eval.adapter-error.v1") {
    throw adapterFailure("adapter-output", "adapter.error-envelope");
  }
  return { response, responseText: lines[0] };
}

export function validateAdapterExecution(execution) {
  if (
    execution === null ||
    typeof execution !== "object" ||
    Array.isArray(execution) ||
    Object.keys(execution).sort().join(",") !==
      "error,signal,status,stderr,stdout" ||
    (execution.status !== null &&
      (!Number.isSafeInteger(execution.status) || execution.status < 0)) ||
    (execution.signal !== null &&
      (typeof execution.signal !== "string" ||
        execution.signal.length === 0 ||
        execution.signal.length > 32)) ||
    (execution.error !== null &&
      (typeof execution.error !== "object" ||
        Array.isArray(execution.error) ||
        Object.keys(execution.error).join(",") !== "code" ||
        typeof execution.error.code !== "string" ||
        !["eacces", "enobufs", "enoent", "etimedout", "spawn-error"].includes(
          execution.error.code,
        )))
  ) {
    throw new Error("adapter execution record is invalid");
  }
  decodeAdapterStream(execution.stdout);
  decodeAdapterStream(execution.stderr);
  return execution;
}

export function isAdapterFailure(error) {
  return error instanceof Error && error.name === "TimelinePilotAdapterFailure";
}

function rawAdapterStream(value) {
  const source = Buffer.isBuffer(value) ? value : Buffer.alloc(0);
  const truncated = source.byteLength > REAL_MODEL_PILOT_LIMITS.adapterBytes;
  const bytes = truncated
    ? source.subarray(0, REAL_MODEL_PILOT_LIMITS.adapterBytes)
    : source;
  return {
    byteLength: bytes.byteLength,
    digest: sha256(bytes),
    base64: bytes.toString("base64"),
    truncated,
  };
}

function decodeAdapterStream(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "base64,byteLength,digest,truncated" ||
    typeof value.base64 !== "string" ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 0 ||
    value.byteLength > REAL_MODEL_PILOT_LIMITS.adapterBytes ||
    typeof value.digest !== "string" ||
    typeof value.truncated !== "boolean" ||
    (value.truncated &&
      value.byteLength !== REAL_MODEL_PILOT_LIMITS.adapterBytes) ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.digest)
  ) {
    throw new Error("adapter execution stream is invalid");
  }
  const bytes = Buffer.from(value.base64, "base64");
  if (
    bytes.byteLength !== value.byteLength ||
    bytes.toString("base64") !== value.base64 ||
    sha256(bytes) !== value.digest
  ) {
    throw new Error("adapter execution stream digest changed");
  }
  return bytes;
}

function adapterFailure(stage, code) {
  const error = new Error(`model phase failed at ${stage} (${code})`);
  error.name = "TimelinePilotAdapterFailure";
  error.stage = stage;
  error.code = code;
  return error;
}

function adapterErrorCode(error) {
  const code = String(error.code ?? "spawn-error").toLowerCase();
  return ["eacces", "enobufs", "enoent", "etimedout"].includes(code)
    ? code
    : "spawn-error";
}

function adapterEnvironment(source) {
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
    "OPENAI_API_KEY",
  ]) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  return environment;
}

export function validateProviderProposal(response, outputSchema) {
  const proposal = structuredClone(response);
  const usage = Object.hasOwn(proposal, "usage") ? proposal.usage : null;
  delete proposal.usage;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.compile(outputSchema)(proposal)) {
    throw new Error("model proposal does not match its request-bound schema");
  }
  return { proposal, usage };
}

export function validateProposalSemantics(phase, proposal, expected) {
  const expectedChanges =
    phase === "initial"
      ? new Map([
          [
            "point-publication",
            [expected.provisionalPublication, "release-created"],
          ],
          [
            "point-readiness",
            [expected.readinessRecorded, "readiness-recorded"],
          ],
        ])
      : new Map([
          [
            "point-publication",
            [expected.authoritativePublication, "release-published"],
          ],
        ]);
  if (proposal.changes.length !== expectedChanges.size) {
    throw new Error("model proposal contains an unexpected number of changes");
  }
  for (const change of proposal.changes) {
    if (change.type !== "coordinate" || change.bounds?.type !== "exact") {
      throw new Error("model proposal must contain exact coordinate changes");
    }
    const semantic = expectedChanges.get(change.pointHandle);
    if (!semantic || change.bounds.value !== semantic[0]) {
      throw new Error(
        "model proposal coordinate does not match normalized evidence",
      );
    }
    if (change.supports.length !== 1) {
      throw new Error("model proposal change must contain exactly one support");
    }
    if (change.supports[0].evidenceId !== semantic[1]) {
      throw new Error("model proposal support uses unexpected evidence");
    }
    if (!change.supports[0].quote.includes(String(semantic[0]))) {
      throw new Error(
        "model proposal support quote does not contain the expected coordinate",
      );
    }
    if (
      phase === "initial" &&
      (change.revision?.type !== "keep" ||
        Object.hasOwn(change.revision, "assertionHandle"))
    ) {
      throw new Error("initial model proposal must keep new assertions");
    }
    if (
      phase === "correction" &&
      (change.revision?.type !== "supersede" ||
        change.revision.assertionHandle !== "assertion-provisional-publication")
    ) {
      throw new Error("correction must supersede the provisional assertion");
    }
  }
  if (
    proposal.query?.type !== "difference" ||
    proposal.query.targetHandle !== "difference-readiness-minus-publication" ||
    proposal.query.knowledgeCut?.type !== "current"
  ) {
    throw new Error(
      "model proposal does not ask the required current-cut question",
    );
  }
}

export function redactedModelCall({
  phase,
  input,
  modelConfig,
  request,
  responseText,
  proposal,
  usage,
  scope,
  preview,
  admit,
}) {
  const { evidence, request: redactedRequest } = redactAdapterRequest(request);
  return {
    schema: "covenant.timeline.real-model-call.v1",
    phase,
    config: modelConfig.config,
    configDigest: modelConfig.digest,
    requestDigest: input.timeline.contentDigest(request),
    responseDigest: sha256(Buffer.from(responseText)),
    responseText,
    outputSchema: request.outputSchema,
    outputSchemaDigest: request.outputSchemaDigest,
    redactedRequest,
    proposal,
    usage,
    catalogs: {
      evidence,
      references: scope.host.referenceCatalog,
      assertions: scope.host.assertionCatalog,
      knowledgeCuts: scope.host.knowledgeCutCatalog,
    },
    preview,
    admit,
  };
}

export function redactAdapterRequest(request) {
  const evidence = request.input.evidence.map(({ id, text }) => ({
    id,
    digest: sha256(Buffer.from(text)),
    byteLength: Buffer.byteLength(text),
  }));
  const redactedRequest = structuredClone(request);
  redactedRequest.prompt = {
    digest: sha256(Buffer.from(request.prompt)),
    byteLength: Buffer.byteLength(request.prompt),
  };
  redactedRequest.input.evidence = evidence;
  return { evidence, request: redactedRequest };
}

export function invocationRecord(phase) {
  return {
    phase,
    invocationId: randomUUID(),
    processId: process.pid,
  };
}

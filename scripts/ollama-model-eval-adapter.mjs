#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";
import {
  canonicalJson,
  contentDigest,
} from "../packages/prototype/dist/index.js";
import { createModelEvalOutputSchema } from "./model-eval-output-schema.mjs";
import { parseStrictJson } from "./strict-json.mjs";

export const OLLAMA_TAGS_ENDPOINT = "http://127.0.0.1:11434/api/tags";
export const OLLAMA_CHAT_ENDPOINT = "http://127.0.0.1:11434/api/chat";
export const OLLAMA_VERSION_ENDPOINT = "http://127.0.0.1:11434/api/version";
export const OLLAMA_PS_ENDPOINT = "http://127.0.0.1:11434/api/ps";
export const OLLAMA_ADAPTER_ID = "ollama-chat";
export const OLLAMA_ADAPTER_VERSION = "1";

const REQUEST_SCHEMA = "covenant.timeline.model-eval.request.v1";
const ADAPTER_ERROR_SCHEMA = "covenant.timeline.model-eval.adapter-error.v1";
const CONFIG_SCHEMA = "covenant.timeline.model-eval.config.v1";
const BENCHMARK = "model-interface-v1";
const ARMS = new Set(["direct", "narrative-memory", "timeline"]);
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const MIN_OUTPUT_TOKENS = 16;
const MAX_OUTPUT_TOKENS = 1_000_000;
const MAX_CONTEXT_LENGTH = 1_000_000;
const MAX_USAGE_TOKENS = 1_000_000_000;
const MAX_SEED = 2_147_483_647;
const MODEL_KEEP_ALIVE = "5m";
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,199}$/iu;
const MODEL_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OLLAMA_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const OLLAMA_VERSION_PATTERN =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const CLOUD_MODEL_PATTERN = /(?:^|[:/-])cloud$/iu;
const THINKING_LEVELS = new Set(["low", "medium", "high"]);
const GENERATION_PARAMETERS = new Set([
  "contextLength",
  "runtimeVersion",
  "structuredOutput",
  "thinking",
  "topP",
]);
const RUN_SCOPED_ERROR_CODES = new Set([
  "provider.chat-http-401",
  "provider.chat-http-403",
  "provider.chat-http-404",
  "provider.model-not-installed",
  "provider.model-not-running",
  "provider.model-revision",
  "provider.runtime-version",
]);

class OllamaAdapterError extends Error {
  constructor(code, message, usage) {
    super(message);
    this.name = "OllamaAdapterError";
    this.code = code;
    this.usage = usage;
  }
}

function fail(code, message, usage) {
  throw new OllamaAdapterError(code, message, usage);
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail("adapter.request", `${label} must be an object`);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail("adapter.request", `${label} must be a non-empty string`);
  }
}

function requireExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("adapter.config", `${label} contains unsupported field ${key}`);
    }
  }
}

function validateRequest(request) {
  requireRecord(request, "adapter request");
  if (request.schema !== REQUEST_SCHEMA) {
    fail("adapter.request", "adapter request uses an unsupported schema");
  }
  if (request.benchmark !== BENCHMARK) {
    fail("adapter.request", "adapter request uses an unsupported benchmark");
  }
  requireNonEmptyString(request.requestId, "adapter request.requestId");
  requireNonEmptyString(request.prompt, "adapter request.prompt");
  requireRecord(request.input, "adapter request.input");
  if (!ARMS.has(request.arm)) {
    fail("adapter.request", "adapter request uses an unsupported arm");
  }

  const config = request.config;
  requireRecord(config, "adapter request.config");
  if (config.schema !== CONFIG_SCHEMA) {
    fail("adapter.config", "run configuration uses an unsupported schema");
  }
  requireNonEmptyString(
    config.benchmarkRevision,
    "run configuration.benchmarkRevision",
  );
  if (config.benchmarkRevision.startsWith("replace-with-")) {
    fail(
      "adapter.config",
      "run configuration benchmarkRevision still contains a placeholder",
    );
  }
  if (contentDigest(config) !== request.configDigest) {
    fail("adapter.config-digest", "run configuration digest does not match");
  }

  requireRecord(config.adapter, "run configuration.adapter");
  if (
    config.adapter.id !== OLLAMA_ADAPTER_ID ||
    config.adapter.version !== OLLAMA_ADAPTER_VERSION
  ) {
    fail(
      "adapter.config",
      `run configuration must select ${OLLAMA_ADAPTER_ID} version ${OLLAMA_ADAPTER_VERSION}`,
    );
  }

  requireRecord(config.model, "run configuration.model");
  if (config.model.provider !== "ollama") {
    fail("adapter.config", "run configuration must select the ollama provider");
  }
  if (
    typeof config.model.id !== "string" ||
    !MODEL_PATTERN.test(config.model.id) ||
    config.model.id.includes("://")
  ) {
    fail(
      "adapter.config",
      "run configuration model id must be an installed Ollama model name",
    );
  }
  if (CLOUD_MODEL_PATTERN.test(config.model.id)) {
    fail(
      "adapter.model-unsupported",
      "Ollama cloud models are not supported by the local adapter",
    );
  }
  if (
    typeof config.model.revision !== "string" ||
    !MODEL_DIGEST_PATTERN.test(config.model.revision)
  ) {
    fail(
      "adapter.model-revision",
      "run configuration model revision must be a lowercase sha256 digest",
    );
  }

  const generation = config.generation;
  requireRecord(generation, "run configuration.generation");
  if (generation.temperature !== 0) {
    fail("adapter.config", "Ollama benchmark runs require temperature 0");
  }
  if (
    !Number.isSafeInteger(generation.seed) ||
    generation.seed < 0 ||
    generation.seed > MAX_SEED
  ) {
    fail(
      "adapter.config",
      `run configuration seed must be between 0 and ${MAX_SEED}`,
    );
  }
  if (
    !Number.isSafeInteger(generation.maxOutputTokens) ||
    generation.maxOutputTokens < MIN_OUTPUT_TOKENS ||
    generation.maxOutputTokens > MAX_OUTPUT_TOKENS
  ) {
    fail(
      "adapter.config",
      `run configuration maxOutputTokens must be between ${MIN_OUTPUT_TOKENS} and ${MAX_OUTPUT_TOKENS}`,
    );
  }

  const parameters = generation.parameters;
  requireRecord(parameters, "run configuration.generation.parameters");
  requireExactKeys(
    parameters,
    GENERATION_PARAMETERS,
    "run configuration.generation.parameters",
  );
  if (parameters.structuredOutput !== true) {
    fail(
      "adapter.config",
      "run configuration must declare structuredOutput as true",
    );
  }
  if (
    parameters.thinking !== false &&
    !THINKING_LEVELS.has(parameters.thinking)
  ) {
    fail(
      "adapter.config",
      "generation parameter thinking must be false, low, medium, or high",
    );
  }
  if (
    typeof parameters.topP !== "number" ||
    !Number.isFinite(parameters.topP) ||
    parameters.topP < 0 ||
    parameters.topP > 1
  ) {
    fail("adapter.config", "generation parameter topP must be between 0 and 1");
  }
  if (
    !Number.isSafeInteger(parameters.contextLength) ||
    parameters.contextLength < 1 ||
    parameters.contextLength > MAX_CONTEXT_LENGTH
  ) {
    fail(
      "adapter.config",
      `generation parameter contextLength must be between 1 and ${MAX_CONTEXT_LENGTH}`,
    );
  }
  if (
    typeof parameters.runtimeVersion !== "string" ||
    !OLLAMA_VERSION_PATTERN.test(parameters.runtimeVersion)
  ) {
    fail(
      "adapter.config",
      "generation parameter runtimeVersion must be an exact Ollama semantic version",
    );
  }

  return { config, generation, parameters };
}

export function createOllamaChatBody(request) {
  const { config, generation, parameters } = validateRequest(request);
  return {
    model: config.model.id,
    messages: [
      {
        role: "system",
        content: request.prompt,
      },
      {
        role: "user",
        content: canonicalJson({
          requestId: request.requestId,
          input: request.input,
        }),
      },
    ],
    stream: false,
    keep_alive: MODEL_KEEP_ALIVE,
    think: parameters.thinking,
    format: createModelEvalOutputSchema(request.arm),
    options: {
      temperature: generation.temperature,
      seed: generation.seed,
      num_predict: generation.maxOutputTokens,
      top_p: parameters.topP,
      num_ctx: parameters.contextLength,
    },
  };
}

function validateUsageCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_USAGE_TOKENS) {
    fail("provider.invalid-usage", `provider ${label} is invalid`);
  }
  return value;
}

function mapUsage(response) {
  return {
    inputTokens: validateUsageCount(
      response.prompt_eval_count,
      "input token count",
    ),
    outputTokens: validateUsageCount(response.eval_count, "output token count"),
    costUsd: null,
  };
}

export function parseOllamaChatResponse(response, expectedModel) {
  if (!isRecord(response)) {
    fail("provider.invalid-response", "provider response must be an object");
  }
  const usage = mapUsage(response);
  if (response.model !== expectedModel) {
    fail(
      "provider.model-revision",
      "provider response model does not match the configured model",
      usage,
    );
  }
  if (response.done !== true) {
    fail(
      "provider.incomplete",
      "provider did not complete the benchmark response",
      usage,
    );
  }
  if (response.done_reason === "length") {
    fail(
      "provider.output-limit",
      "provider reached the configured output-token limit",
      usage,
    );
  }
  if (response.done_reason !== undefined && response.done_reason !== "stop") {
    fail(
      "provider.incomplete",
      "provider stopped before completing the benchmark response",
      usage,
    );
  }
  if (
    !isRecord(response.message) ||
    response.message.role !== "assistant" ||
    typeof response.message.content !== "string" ||
    response.message.content.length === 0
  ) {
    fail(
      "provider.invalid-output",
      "provider response must contain one assistant message",
      usage,
    );
  }
  if (
    Object.hasOwn(response.message, "tool_calls") &&
    (!Array.isArray(response.message.tool_calls) ||
      response.message.tool_calls.length !== 0)
  ) {
    fail(
      "provider.invalid-output",
      "provider response contains an unexpected tool call",
      usage,
    );
  }

  let modelResponse;
  try {
    modelResponse = parseStrictJson(
      response.message.content,
      "provider output",
    );
  } catch {
    fail("provider.invalid-json", "provider output is not strict JSON", usage);
  }
  if (!isRecord(modelResponse)) {
    fail(
      "provider.invalid-output",
      "provider output must be a JSON object",
      usage,
    );
  }
  if (
    Object.hasOwn(modelResponse, "usage") ||
    Object.hasOwn(modelResponse, "error")
  ) {
    fail(
      "provider.invalid-output",
      "provider output contains an adapter-controlled field",
      usage,
    );
  }
  return {
    ...modelResponse,
    usage,
  };
}

function installedModelDigest(response, model) {
  if (!isRecord(response) || !Array.isArray(response.models)) {
    fail("provider.tags-invalid", "Ollama model inventory is invalid");
  }
  const matches = response.models.filter(
    (entry) =>
      isRecord(entry) && (entry.name === model || entry.model === model),
  );
  if (matches.length === 0) {
    fail(
      "provider.model-not-installed",
      "configured Ollama model is not installed",
    );
  }
  const digests = new Set(matches.map((entry) => entry.digest));
  if (
    digests.size !== 1 ||
    typeof matches[0].digest !== "string" ||
    !OLLAMA_DIGEST_PATTERN.test(matches[0].digest)
  ) {
    fail(
      "provider.tags-invalid",
      "Ollama model inventory contains an invalid digest",
    );
  }
  return `sha256:${matches[0].digest}`;
}

function runningModelDigest(response, model) {
  if (!isRecord(response) || !Array.isArray(response.models)) {
    fail("provider.ps-invalid", "Ollama running model inventory is invalid");
  }
  const matches = response.models.filter(
    (entry) =>
      isRecord(entry) && (entry.name === model || entry.model === model),
  );
  if (matches.length === 0) {
    fail(
      "provider.model-not-running",
      "configured Ollama model is not running after inference",
    );
  }
  if (
    matches.length !== 1 ||
    typeof matches[0].digest !== "string" ||
    !OLLAMA_DIGEST_PATTERN.test(matches[0].digest)
  ) {
    fail(
      "provider.ps-invalid",
      "Ollama running model inventory must contain one valid model digest",
    );
  }
  return `sha256:${matches[0].digest}`;
}

function installedRuntimeVersion(response) {
  if (
    !isRecord(response) ||
    typeof response.version !== "string" ||
    !OLLAMA_VERSION_PATTERN.test(response.version)
  ) {
    fail(
      "provider.version-invalid",
      "Ollama runtime returned an invalid version",
    );
  }
  return response.version;
}

async function readBoundedBody(response, codePrefix) {
  if (response.body === null) {
    fail(
      `${codePrefix}-invalid-response`,
      "provider returned an empty response",
    );
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_PROVIDER_RESPONSE_BYTES) {
      fail(
        `${codePrefix}-response-too-large`,
        `provider response exceeds ${MAX_PROVIDER_RESPONSE_BYTES} bytes`,
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, total),
    );
  } catch {
    fail(`${codePrefix}-invalid-utf8`, "provider response is not valid UTF-8");
  }
}

async function fetchJson(fetchImpl, endpoint, init, codePrefix) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      ...init,
      redirect: "error",
    });
  } catch {
    fail(`${codePrefix}-transport`, "Ollama request failed");
  }
  if (
    response === null ||
    typeof response !== "object" ||
    typeof response.ok !== "boolean"
  ) {
    fail(`${codePrefix}-transport`, "Ollama request failed");
  }
  if (!response.ok) {
    const status = Number.isInteger(response.status)
      ? response.status
      : "unknown";
    await response.body?.cancel().catch(() => undefined);
    fail(`${codePrefix}-http-${status}`, `Ollama API returned HTTP ${status}`);
  }
  try {
    return parseStrictJson(
      await readBoundedBody(response, codePrefix),
      "provider response",
    );
  } catch (error) {
    if (error instanceof OllamaAdapterError) throw error;
    fail(`${codePrefix}-invalid-json`, "provider response is not strict JSON");
  }
}

async function readInstalledModelDigest(fetchImpl, model) {
  const inventory = await fetchJson(
    fetchImpl,
    OLLAMA_TAGS_ENDPOINT,
    {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    },
    "provider.tags",
  );
  return installedModelDigest(inventory, model);
}

async function readRunningModelDigest(fetchImpl, model) {
  const inventory = await fetchJson(
    fetchImpl,
    OLLAMA_PS_ENDPOINT,
    {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    },
    "provider.ps",
  );
  return runningModelDigest(inventory, model);
}

export async function invokeOllama(
  request,
  { fetchImpl = globalThis.fetch } = {},
) {
  if (typeof fetchImpl !== "function") {
    fail("adapter.runtime", "global fetch is unavailable");
  }
  const body = createOllamaChatBody(request);
  const runtime = await fetchJson(
    fetchImpl,
    OLLAMA_VERSION_ENDPOINT,
    {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    },
    "provider.version",
  );
  const runtimeVersion = installedRuntimeVersion(runtime);
  if (runtimeVersion !== request.config.generation.parameters.runtimeVersion) {
    fail(
      "provider.runtime-version",
      "Ollama runtime version does not match the configured version",
    );
  }
  const digest = await readInstalledModelDigest(
    fetchImpl,
    request.config.model.id,
  );
  if (digest !== request.config.model.revision) {
    fail(
      "provider.model-revision",
      "installed Ollama model digest does not match the configured revision",
    );
  }

  const response = await fetchJson(
    fetchImpl,
    OLLAMA_CHAT_ENDPOINT,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: canonicalJson(body),
    },
    "provider.chat",
  );
  const runningDigest = await readRunningModelDigest(
    fetchImpl,
    request.config.model.id,
  );
  if (runningDigest !== request.config.model.revision) {
    fail(
      "provider.model-revision",
      "running Ollama model digest does not match the configured revision",
    );
  }
  return parseOllamaChatResponse(response, request.config.model.id);
}

async function readRequest(stream) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_REQUEST_BYTES) {
      fail(
        "adapter.request-too-large",
        `adapter request exceeds ${MAX_REQUEST_BYTES} bytes`,
      );
    }
    chunks.push(bytes);
  }

  let text;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(Buffer.concat(chunks, total));
  } catch {
    fail("adapter.invalid-utf8", "adapter request is not valid UTF-8");
  }
  const lines = text.split(/\r\n|[\n\r]/u);
  if (/(?:\r\n|[\n\r])$/u.test(text)) lines.pop();
  if (lines.length !== 1 || lines[0].length === 0) {
    fail("adapter.request-lines", "adapter requires exactly one request line");
  }
  try {
    return parseStrictJson(lines[0], "adapter request");
  } catch {
    fail("adapter.invalid-json", "adapter request is not strict JSON");
  }
}

function errorEnvelope(requestId, error) {
  return {
    schema: ADAPTER_ERROR_SCHEMA,
    requestId,
    error: {
      code: error.code,
      message: boundedErrorMessage(error.message),
      scope: errorScope(error.code),
    },
    ...(error.usage === undefined ? {} : { usage: error.usage }),
  };
}

function boundedErrorMessage(value) {
  const source = String(value);
  const wellFormed =
    typeof source.toWellFormed === "function"
      ? source.toWellFormed()
      : source.replaceAll(
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
          "\uFFFD",
        );
  return Array.from(wellFormed).slice(0, 480).join("") || "adapter failed";
}

function errorScope(code) {
  if (
    code.startsWith("adapter.") ||
    code.startsWith("provider.ps-") ||
    code.startsWith("provider.tags-") ||
    code.startsWith("provider.version-") ||
    RUN_SCOPED_ERROR_CODES.has(code)
  ) {
    return "run";
  }
  return "observation";
}

export async function runAdapter({
  fetchImpl = globalThis.fetch,
  input = process.stdin,
  output = process.stdout,
  diagnostics = process.stderr,
} = {}) {
  let request;
  try {
    request = await readRequest(input);
  } catch (error) {
    const message =
      error instanceof OllamaAdapterError
        ? error.message
        : "adapter request failed";
    diagnostics.write(`ollama adapter: ${message}\n`);
    return 1;
  }

  try {
    const response = await invokeOllama(request, { fetchImpl });
    output.write(`${canonicalJson(response)}\n`);
  } catch (error) {
    const failure =
      error instanceof OllamaAdapterError
        ? error
        : new OllamaAdapterError("adapter.failure", "Ollama adapter failed");
    if (
      !isRecord(request) ||
      typeof request.requestId !== "string" ||
      request.requestId.length === 0
    ) {
      diagnostics.write(`ollama adapter: ${failure.message}\n`);
      return 1;
    }
    output.write(
      `${canonicalJson(errorEnvelope(request.requestId, failure))}\n`,
    );
  }
  return 0;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  process.exitCode = await runAdapter();
}

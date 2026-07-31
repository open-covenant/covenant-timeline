#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";
import {
  canonicalJson,
  contentDigest,
} from "../packages/prototype/dist/index.js";
import { createOpenAIResponseFormat } from "./openai-responses-model-eval-schema.mjs";
import { parseStrictJson } from "./strict-json.mjs";

export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const OPENAI_ADAPTER_ID = "openai-responses";
export const OPENAI_ADAPTER_VERSION = "1";

const REQUEST_SCHEMA = "covenant.timeline.model-eval.request.v1";
const RESPONSE_SCHEMA = "covenant.timeline.model-eval.response.v1";
const ADAPTER_ERROR_SCHEMA = "covenant.timeline.model-eval.adapter-error.v1";
const CONFIG_SCHEMA = "covenant.timeline.model-eval.config.v1";
const MODEL_PROPOSAL_CONFIG_SCHEMA =
  "covenant.timeline.model-proposal-eval.config.v1";
const MODEL_INTERFACE_BENCHMARK = "model-interface-v1";
const MODEL_PROPOSAL_BENCHMARK = "model-proposal-boundary-v1";
const MODEL_INTERFACE_ARMS = new Set([
  "direct",
  "narrative-memory",
  "structured-extraction",
  "timeline",
]);
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const MIN_OUTPUT_TOKENS = 16;
const MAX_OUTPUT_TOKENS = 1_000_000;
const MAX_USAGE_TOKENS = 1_000_000_000;
const GENERATION_PARAMETERS = new Set([
  "reasoningEffort",
  "structuredOutput",
  "topP",
  "verbosity",
]);
const REASONING_EFFORTS = new Set([
  "minimal",
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const VERBOSITIES = new Set(["low", "medium", "high"]);
const RUN_SCOPED_ERROR_CODES = new Set([
  "provider.http-401",
  "provider.http-403",
  "provider.http-404",
  "provider.model-revision",
]);

class OpenAIAdapterError extends Error {
  constructor(code, message, usage) {
    super(message);
    this.name = "OpenAIAdapterError";
    this.code = code;
    this.usage = usage;
  }
}

function fail(code, message, usage) {
  throw new OpenAIAdapterError(code, message, usage);
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

function validateBenchmark(request) {
  if (request.benchmark === MODEL_INTERFACE_BENCHMARK) {
    if (!MODEL_INTERFACE_ARMS.has(request.arm)) {
      fail("adapter.request", "adapter request uses an unsupported arm");
    }
    if (
      Object.hasOwn(request, "outputSchema") ||
      Object.hasOwn(request, "outputSchemaDigest")
    ) {
      fail(
        "adapter.request",
        "model-interface requests must not contain an output schema",
      );
    }
    return undefined;
  }

  if (request.benchmark !== MODEL_PROPOSAL_BENCHMARK) {
    fail("adapter.request", "adapter request uses an unsupported benchmark");
  }
  if (request.arm !== "proposal") {
    fail("adapter.request", "adapter request uses an unsupported arm");
  }
  requireRecord(request.outputSchema, "adapter request.outputSchema");
  requireNonEmptyString(
    request.outputSchemaDigest,
    "adapter request.outputSchemaDigest",
  );
  if (contentDigest(request.outputSchema) !== request.outputSchemaDigest) {
    fail("adapter.output-schema-digest", "output schema digest does not match");
  }
  return request.outputSchema;
}

function validateRequest(request) {
  requireRecord(request, "adapter request");
  if (request.schema !== REQUEST_SCHEMA) {
    fail("adapter.request", "adapter request uses an unsupported schema");
  }
  requireNonEmptyString(request.requestId, "adapter request.requestId");
  requireNonEmptyString(request.prompt, "adapter request.prompt");
  requireRecord(request.input, "adapter request.input");
  const outputSchema = validateBenchmark(request);

  const config = request.config;
  requireRecord(config, "adapter request.config");
  const expectedConfigSchema =
    request.benchmark === MODEL_PROPOSAL_BENCHMARK
      ? MODEL_PROPOSAL_CONFIG_SCHEMA
      : CONFIG_SCHEMA;
  if (config.schema !== expectedConfigSchema) {
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
    config.adapter.id !== OPENAI_ADAPTER_ID ||
    config.adapter.version !== OPENAI_ADAPTER_VERSION
  ) {
    fail(
      "adapter.config",
      `run configuration must select ${OPENAI_ADAPTER_ID} version ${OPENAI_ADAPTER_VERSION}`,
    );
  }

  requireRecord(config.model, "run configuration.model");
  if (config.model.provider !== "openai") {
    fail("adapter.config", "run configuration must select the openai provider");
  }
  requireNonEmptyString(config.model.id, "run configuration.model.id");
  requireNonEmptyString(
    config.model.revision,
    "run configuration.model.revision",
  );
  if (config.model.id !== config.model.revision) {
    fail(
      "adapter.model-revision",
      "OpenAI model id and expected revision must match",
    );
  }
  if (config.model.id.startsWith("ft:")) {
    fail(
      "adapter.model-unsupported",
      "fine-tuned models are not supported by the benchmark response schemas",
    );
  }

  const generation = config.generation;
  requireRecord(generation, "run configuration.generation");
  if (
    generation.temperature !== null &&
    (typeof generation.temperature !== "number" ||
      !Number.isFinite(generation.temperature) ||
      generation.temperature < 0 ||
      generation.temperature > 2)
  ) {
    fail(
      "adapter.config",
      "run configuration temperature must be null or between 0 and 2",
    );
  }
  if (generation.seed !== null) {
    fail(
      "adapter.seed-unsupported",
      "OpenAI Responses runs must declare seed as null",
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
    parameters.topP !== undefined &&
    (typeof parameters.topP !== "number" ||
      !Number.isFinite(parameters.topP) ||
      parameters.topP < 0 ||
      parameters.topP > 1)
  ) {
    fail("adapter.config", "generation parameter topP must be between 0 and 1");
  }
  if (
    parameters.reasoningEffort !== undefined &&
    !REASONING_EFFORTS.has(parameters.reasoningEffort)
  ) {
    fail(
      "adapter.config",
      "generation parameter reasoningEffort is unsupported",
    );
  }
  if (
    parameters.verbosity !== undefined &&
    !VERBOSITIES.has(parameters.verbosity)
  ) {
    fail("adapter.config", "generation parameter verbosity is unsupported");
  }

  return {
    config,
    generation,
    outputSchema,
    parameters,
  };
}

export function createOpenAIRequestBody(request) {
  const { config, generation, outputSchema, parameters } =
    validateRequest(request);
  const text = {
    format:
      outputSchema === undefined
        ? createOpenAIResponseFormat(request.arm)
        : {
            type: "json_schema",
            name: "covenant_timeline_model_proposal_v1",
            strict: true,
            schema: outputSchema,
          },
    ...(parameters.verbosity === undefined
      ? {}
      : { verbosity: parameters.verbosity }),
  };

  return {
    model: config.model.id,
    instructions: request.prompt,
    input: [
      {
        role: "user",
        content: canonicalJson({
          requestId: request.requestId,
          input: request.input,
        }),
      },
    ],
    max_output_tokens: generation.maxOutputTokens,
    ...(generation.temperature === null
      ? {}
      : { temperature: generation.temperature }),
    ...(parameters.topP === undefined ? {} : { top_p: parameters.topP }),
    ...(parameters.reasoningEffort === undefined
      ? {}
      : { reasoning: { effort: parameters.reasoningEffort } }),
    text,
    tools: [],
    store: false,
    stream: false,
    background: false,
  };
}

function validateUsageCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_USAGE_TOKENS) {
    fail("provider.invalid-usage", `provider ${label} is invalid`);
  }
  return value;
}

function mapUsage(value) {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) {
    fail("provider.invalid-usage", "provider usage is invalid");
  }
  return {
    inputTokens: validateUsageCount(value.input_tokens, "input token count"),
    outputTokens: validateUsageCount(value.output_tokens, "output token count"),
    costUsd: null,
  };
}

function outputText(response, usage) {
  if (!Array.isArray(response.output)) {
    fail("provider.invalid-output", "provider response has no output", usage);
  }

  const messages = [];
  for (const item of response.output) {
    if (!isRecord(item)) {
      fail(
        "provider.invalid-output",
        "provider response contains an invalid output item",
        usage,
      );
    }
    if (item.type === "reasoning") continue;
    if (item.type !== "message") {
      fail(
        "provider.invalid-output",
        "provider response contains an unexpected output item",
        usage,
      );
    }
    messages.push(item);
  }
  if (messages.length !== 1 || messages[0].role !== "assistant") {
    fail(
      "provider.invalid-output",
      "provider response must contain one assistant message",
      usage,
    );
  }

  if (messages[0].status !== "completed") {
    fail(
      "provider.incomplete",
      "provider assistant message is not complete",
      usage,
    );
  }
  const content = messages[0].content;
  if (!Array.isArray(content) || content.length === 0) {
    fail(
      "provider.invalid-output",
      "provider response must contain output text",
      usage,
    );
  }
  const parts = [];
  for (const item of content) {
    if (!isRecord(item)) {
      fail(
        "provider.invalid-output",
        "provider response contains an invalid message item",
        usage,
      );
    }
    if (item.type === "refusal") {
      fail("provider.refusal", "model refused the benchmark request", usage);
    }
    if (item.type !== "output_text" || typeof item.text !== "string") {
      fail(
        "provider.invalid-output",
        "provider response contains an unexpected message item",
        usage,
      );
    }
    parts.push(item.text);
  }
  return parts.join("");
}

export function parseOpenAIResponse(response, expectedModelRevision) {
  if (!isRecord(response)) {
    fail("provider.invalid-response", "provider response must be an object");
  }
  const usage = mapUsage(response.usage);
  if (response.error !== null && response.error !== undefined) {
    fail(
      "provider.failed",
      "provider returned a failed benchmark response",
      usage,
    );
  }
  if (response.model !== expectedModelRevision) {
    fail(
      "provider.model-revision",
      "provider response model does not match the expected revision",
      usage,
    );
  }
  if (response.status !== "completed") {
    fail(
      "provider.incomplete",
      "provider did not complete the benchmark response",
      usage,
    );
  }

  let modelResponse;
  try {
    modelResponse = parseStrictJson(
      outputText(response, usage),
      "provider output",
    );
  } catch (error) {
    if (error instanceof OpenAIAdapterError) throw error;
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

  return usage === undefined
    ? modelResponse
    : {
        ...modelResponse,
        usage,
      };
}

async function readBoundedBody(response) {
  if (response.body === null) {
    fail("provider.invalid-response", "provider returned an empty response");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_PROVIDER_RESPONSE_BYTES) {
      fail(
        "provider.response-too-large",
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
    fail("provider.invalid-utf8", "provider response is not valid UTF-8");
  }
}

export async function invokeOpenAI(
  request,
  { apiKey, fetchImpl = globalThis.fetch } = {},
) {
  if (
    typeof apiKey !== "string" ||
    apiKey.length === 0 ||
    apiKey.length > 4096 ||
    /[\u0000-\u0020\u007f]/u.test(apiKey)
  ) {
    fail("adapter.credentials", "OPENAI_API_KEY is missing or invalid");
  }
  if (typeof fetchImpl !== "function") {
    fail("adapter.runtime", "global fetch is unavailable");
  }

  const requestBody = createOpenAIRequestBody(request);
  let response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: canonicalJson(requestBody),
    });
  } catch {
    fail("provider.transport", "OpenAI Responses request failed");
  }
  if (
    response === null ||
    typeof response !== "object" ||
    typeof response.ok !== "boolean"
  ) {
    fail("provider.transport", "OpenAI Responses request failed");
  }
  if (!response.ok) {
    const status = Number.isInteger(response.status)
      ? response.status
      : "unknown";
    await response.body?.cancel().catch(() => undefined);
    fail(
      `provider.http-${status}`,
      `OpenAI Responses API returned HTTP ${status}`,
    );
  }

  let providerResponse;
  try {
    providerResponse = parseStrictJson(
      await readBoundedBody(response),
      "provider response",
    );
  } catch (error) {
    if (error instanceof OpenAIAdapterError) throw error;
    fail("provider.invalid-json", "provider response is not strict JSON");
  }
  return parseOpenAIResponse(providerResponse, request.config.model.revision);
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
  if (code.startsWith("adapter.") || RUN_SCOPED_ERROR_CODES.has(code)) {
    return "run";
  }
  const status = Number(code.match(/[.-]http-(\d{3})$/u)?.[1]);
  if (status === 400) return "run";
  return "observation";
}

export async function runAdapter({
  apiKey = process.env.OPENAI_API_KEY,
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
      error instanceof OpenAIAdapterError
        ? error.message
        : "adapter request failed";
    diagnostics.write(`openai-responses adapter: ${message}\n`);
    return 1;
  }

  try {
    const response = await invokeOpenAI(request, {
      apiKey,
      fetchImpl,
    });
    output.write(`${canonicalJson(response)}\n`);
  } catch (error) {
    const failure =
      error instanceof OpenAIAdapterError
        ? error
        : new OpenAIAdapterError(
            "adapter.failure",
            "OpenAI Responses adapter failed",
          );
    if (
      typeof request.requestId !== "string" ||
      request.requestId.length === 0
    ) {
      diagnostics.write(`openai-responses adapter: ${failure.message}\n`);
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

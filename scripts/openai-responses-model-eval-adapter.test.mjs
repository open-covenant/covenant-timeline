import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  canonicalJson,
  contentDigest,
} from "../packages/prototype/dist/index.js";
import {
  createModelEvalValidators,
  validateAdapterResponse,
} from "./model-interface-eval.mjs";
import {
  MAX_MODEL_REQUEST_ID_LENGTH,
  MAX_NARRATIVE_MEMORY_CHARACTERS,
  MAX_TIMELINE_EVENTS_PER_RESPONSE,
  MAX_TIMELINE_REFERENCES_PER_EVENT,
} from "./model-eval-output-schema.mjs";
import {
  OPENAI_ADAPTER_ID,
  OPENAI_ADAPTER_VERSION,
  OPENAI_RESPONSES_ENDPOINT,
  createOpenAIRequestBody,
  invokeOpenAI,
  parseOpenAIResponse,
  runAdapter,
} from "./openai-responses-model-eval-adapter.mjs";
import { createOpenAIResponseFormat } from "./openai-responses-model-eval-schema.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const casesPath = join(root, "benchmarks/model-interface/v1/cases.jsonl");
const adapterPath = join(
  root,
  "scripts/openai-responses-model-eval-adapter.mjs",
);
const responseSchema = "covenant.timeline.model-eval.response.v1";
const adapterErrorSchema = "covenant.timeline.model-eval.adapter-error.v1";

function createConfig(overrides = {}) {
  const model = overrides.model ?? "gpt-4o-mini-2024-07-18";
  return {
    schema: overrides.schema ?? "covenant.timeline.model-eval.config.v1",
    id: "openai-reference-test",
    benchmarkRevision: overrides.benchmarkRevision ?? "test-revision",
    adapter: {
      id: OPENAI_ADAPTER_ID,
      version: OPENAI_ADAPTER_VERSION,
    },
    model: {
      provider: "openai",
      id: model,
      revision: overrides.revision ?? model,
    },
    generation: {
      temperature: overrides.temperature ?? 0,
      seed: overrides.seed ?? null,
      maxOutputTokens: overrides.maxOutputTokens ?? 4096,
      parameters: overrides.parameters ?? {
        structuredOutput: true,
      },
    },
  };
}

function createRequest(arm = "direct", overrides = {}) {
  const config = overrides.config ?? createConfig();
  return {
    schema: "covenant.timeline.model-eval.request.v1",
    requestId: overrides.requestId ?? "request-17",
    benchmark: overrides.benchmark ?? "model-interface-v1",
    config,
    configDigest: overrides.configDigest ?? contentDigest(config),
    caseId: "case-01",
    arm,
    repeat: 0,
    cut: 0,
    prompt: overrides.prompt ?? "Use the benchmark protocol exactly.",
    input: overrides.input ?? {
      entities: { deploy: "deployment" },
      question: "When did deployment happen?",
      evidence: [],
    },
  };
}

function createProposalSchema() {
  return {
    type: "object",
    properties: {
      schema: {
        type: "string",
        enum: ["covenant.timeline.model-proposal.v1"],
      },
      requestId: { type: "string", enum: ["request-17"] },
      changes: {
        type: "array",
        items: { type: "object" },
        maxItems: 2,
      },
    },
    required: ["schema", "requestId", "changes"],
    additionalProperties: false,
  };
}

function createProposalRequest(overrides = {}) {
  const outputSchema = overrides.outputSchema ?? createProposalSchema();
  return {
    ...createRequest("proposal", {
      ...overrides,
      benchmark: "model-proposal-boundary-v1",
      config:
        overrides.config ??
        createConfig({
          schema: "covenant.timeline.model-proposal-eval.config.v1",
        }),
    }),
    outputSchema,
    outputSchemaDigest:
      overrides.outputSchemaDigest ?? contentDigest(outputSchema),
  };
}

function createProviderResponse(modelOutput, overrides = {}) {
  return {
    id: "resp_test",
    object: "response",
    status: overrides.status ?? "completed",
    error: overrides.error ?? null,
    incomplete_details: overrides.incompleteDetails ?? null,
    model: overrides.model ?? "gpt-4o-mini-2024-07-18",
    output: overrides.output ?? [
      {
        id: "reasoning_test",
        type: "reasoning",
        summary: [],
      },
      {
        id: "message_test",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: canonicalJson(modelOutput),
            annotations: [],
          },
        ],
      },
    ],
    usage:
      overrides.usage === undefined
        ? {
            input_tokens: 120,
            output_tokens: 24,
            total_tokens: 144,
          }
        : overrides.usage,
  };
}

function capture() {
  let value = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      value += chunk.toString();
      callback();
    },
  });
  return {
    stream,
    value: () => value,
  };
}

async function startServer(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  return {
    server,
    endpoint: `http://127.0.0.1:${address.port}/v1/responses`,
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

test("OpenAI request mapping is exact and stateless for every arm", () => {
  for (const arm of ["direct", "narrative-memory", "timeline"]) {
    const config = createConfig({
      parameters: {
        structuredOutput: true,
        topP: 0.9,
        reasoningEffort: "low",
        verbosity: "low",
      },
    });
    const request = createRequest(arm, { config });
    const body = createOpenAIRequestBody(request);

    assert.equal(body.model, config.model.id);
    assert.equal(body.instructions, request.prompt);
    assert.deepEqual(body.input, [
      {
        role: "user",
        content: canonicalJson({
          requestId: request.requestId,
          input: request.input,
        }),
      },
    ]);
    assert.equal(body.max_output_tokens, 4096);
    assert.equal(body.temperature, 0);
    assert.equal(body.top_p, 0.9);
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(body.text.verbosity, "low");
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(
      body.text.format.schema.properties.requestId.maxLength,
      MAX_MODEL_REQUEST_ID_LENGTH,
    );
    if (arm === "narrative-memory") {
      assert.equal(
        body.text.format.schema.properties.memory.maxLength,
        MAX_NARRATIVE_MEMORY_CHARACTERS,
      );
    }
    if (arm === "timeline") {
      assert.equal(
        body.text.format.schema.properties.events.maxItems,
        MAX_TIMELINE_EVENTS_PER_RESPONSE,
      );
      assert.equal(
        body.text.format.schema.$defs.evidenceRefs.maxItems,
        MAX_TIMELINE_REFERENCES_PER_EVENT,
      );
      assert.equal(
        body.text.format.schema.$defs.nonEmptyIdentifiers.maxItems,
        MAX_TIMELINE_REFERENCES_PER_EVENT,
      );
      assert.equal(body.text.format.schema.$defs.identifier.maxLength, 128);
    }
    assert.equal(
      canonicalJson(body.text.format).includes(request.requestId),
      false,
    );
    assert.deepEqual(body.tools, []);
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    assert.equal(body.background, false);
    for (const forbidden of [
      "conversation",
      "metadata",
      "previous_response_id",
      "prompt",
      "prompt_cache_key",
      "safety_identifier",
      "seed",
      "truncation",
    ]) {
      assert.equal(Object.hasOwn(body, forbidden), false);
    }
    assert.equal(body.input[0].content.includes(config.id), false);
    assert.equal(body.input[0].content.includes(request.caseId), false);
  }
});

test("proposal requests use a strict wrapper around the request-bound schema", () => {
  const request = createProposalRequest();
  const body = createOpenAIRequestBody(request);

  assert.deepEqual(body.text.format, {
    type: "json_schema",
    name: "covenant_timeline_model_proposal_v1",
    strict: true,
    schema: request.outputSchema,
  });
  assert.equal(body.text.format.schema, request.outputSchema);
  assert.deepEqual(body.input, [
    {
      role: "user",
      content: canonicalJson({
        requestId: request.requestId,
        input: request.input,
      }),
    },
  ]);
});

test("benchmark-specific schema fields fail closed", () => {
  const schema = createProposalSchema();
  const invalid = [
    createProposalRequest({
      outputSchemaDigest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
    {
      ...createRequest("proposal", {
        benchmark: "model-proposal-boundary-v1",
      }),
      outputSchema: schema,
    },
    {
      ...createRequest(),
      outputSchema: schema,
      outputSchemaDigest: contentDigest(schema),
    },
    createRequest("direct", {
      benchmark: "model-proposal-boundary-v1",
    }),
  ];

  for (const request of invalid) {
    assert.throws(() => createOpenAIRequestBody(request));
  }
});

test("provider schemas cover every public v1 gold response", async () => {
  const cases = (await readFile(casesPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const ajv = new Ajv2020({ allErrors: true, strict: false });

  for (const arm of ["direct", "narrative-memory", "timeline"]) {
    const requestId = `schema-${arm}`;
    const format = createOpenAIResponseFormat(arm);
    assert.equal(format.schema.type, "object");
    assert.equal(Object.hasOwn(format.schema, "anyOf"), false);
    assertOpenAISchemaSubset(format.schema);
    const validate = ajv.compile(format.schema);

    for (const testCase of cases) {
      for (const cut of testCase.cuts) {
        const response =
          arm === "timeline"
            ? {
                schema: responseSchema,
                requestId,
                events: cut.goldEvents,
                query: cut.goldQuery,
              }
            : {
                schema: responseSchema,
                requestId,
                answer: cut.expectedResult,
                ...(arm === "narrative-memory" ? { memory: "" } : {}),
              };
        assert.equal(
          validate(response),
          true,
          `${arm} ${testCase.id} cut ${cut.index}: ${JSON.stringify(validate.errors)}`,
        );
      }
    }
  }
});

test("provider schemas reject model-controlled values above their limits", async () => {
  const [testCase] = (await readFile(casesPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const [cut] = testCase.cuts;
  const timelineSchema = createOpenAIResponseFormat("timeline").schema;
  const narrativeSchema = createOpenAIResponseFormat("narrative-memory").schema;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validateTimeline = ajv.compile(timelineSchema);
  const validateNarrative = ajv.compile(narrativeSchema);
  const timeline = {
    schema: responseSchema,
    requestId: "request-bounds",
    events: cut.goldEvents,
    query: cut.goldQuery,
  };

  const atEventLimit = structuredClone(timeline);
  atEventLimit.events = Array.from(
    { length: MAX_TIMELINE_EVENTS_PER_RESPONSE },
    () => structuredClone(cut.goldEvents[0]),
  );
  assert.equal(validateTimeline(atEventLimit), true);

  const aboveEventLimit = structuredClone(atEventLimit);
  aboveEventLimit.events.push(structuredClone(cut.goldEvents[0]));
  assert.equal(validateTimeline(aboveEventLimit), false);

  const aboveEvidenceLimit = structuredClone(timeline);
  aboveEvidenceLimit.events[0].assertion.evidenceRefs = Array.from(
    { length: MAX_TIMELINE_REFERENCES_PER_EVENT + 1 },
    () => cut.goldEvents[0].assertion.evidenceRefs[0],
  );
  assert.equal(validateTimeline(aboveEvidenceLimit), false);

  const aboveSupersessionLimit = structuredClone(timeline);
  aboveSupersessionLimit.events[0].assertion.supersedes = Array.from(
    { length: MAX_TIMELINE_REFERENCES_PER_EVENT + 1 },
    (_, index) => `coordinate.previous.${index}`,
  );
  assert.equal(validateTimeline(aboveSupersessionLimit), false);

  const longIdentifier = structuredClone(timeline);
  longIdentifier.events[0].id = "a".repeat(129);
  assert.equal(validateTimeline(longIdentifier), false);

  const longRequestId = structuredClone(timeline);
  longRequestId.requestId = "r".repeat(MAX_MODEL_REQUEST_ID_LENGTH + 1);
  assert.equal(validateTimeline(longRequestId), false);

  assert.equal(
    validateNarrative({
      schema: responseSchema,
      requestId: "request-bounds",
      answer: cut.expectedResult,
      memory: "m".repeat(MAX_NARRATIVE_MEMORY_CHARACTERS + 1),
    }),
    false,
  );
});

test("configuration mismatches fail before an inference request", async () => {
  const cases = [
    createRequest("direct", {
      config: createConfig({
        benchmarkRevision: "replace-with-source-commit",
      }),
    }),
    createRequest("direct", {
      config: createConfig({ seed: 42 }),
    }),
    createRequest("direct", {
      config: createConfig({
        revision: "different-model-revision",
      }),
    }),
    createRequest("direct", {
      config: createConfig({
        maxOutputTokens: 15,
      }),
    }),
    createRequest("direct", {
      config: createConfig({
        model: "ft:gpt-4o-mini:example",
      }),
    }),
    createRequest("direct", {
      config: createConfig({
        parameters: {
          structuredOutput: true,
          hiddenRetryCount: 2,
        },
      }),
    }),
    createRequest("direct", {
      configDigest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
  ];

  for (const request of cases) {
    let calls = 0;
    await assert.rejects(
      invokeOpenAI(request, {
        apiKey: "inert-test-key",
        fetchImpl: async () => {
          calls += 1;
          throw new Error("must not be called");
        },
      }),
    );
    assert.equal(calls, 0);
  }
});

test("the Responses minimum output-token budget is accepted", () => {
  const config = createConfig({ maxOutputTokens: 16 });
  assert.equal(
    createOpenAIRequestBody(createRequest("direct", { config }))
      .max_output_tokens,
    16,
  );
});

test("native Responses output is traversed once and usage is mechanical", () => {
  const modelOutput = {
    schema: responseSchema,
    requestId: "request-17",
    answer: {
      type: "context.consistency",
      status: "consistent",
    },
  };
  const response = createProviderResponse(modelOutput);
  const encoded = canonicalJson(modelOutput);
  response.output[1].content = [
    {
      type: "output_text",
      text: encoded.slice(0, 23),
      annotations: [],
    },
    {
      type: "output_text",
      text: encoded.slice(23),
      annotations: [],
    },
  ];
  const parsed = parseOpenAIResponse(response, "gpt-4o-mini-2024-07-18");

  assert.deepEqual(parsed, {
    ...modelOutput,
    usage: {
      inputTokens: 120,
      outputTokens: 24,
      costUsd: null,
    },
  });
});

test("native Responses output preserves proposal fields with adapter usage", () => {
  const proposal = {
    schema: "covenant.timeline.model-proposal.v1",
    requestId: "request-17",
    changes: [],
    query: {
      type: "consistency",
      targetHandle: "delivery",
      knowledgeCut: { type: "current" },
    },
  };

  assert.deepEqual(
    parseOpenAIResponse(
      createProviderResponse(proposal, { usage: null }),
      "gpt-4o-mini-2024-07-18",
    ),
    proposal,
  );
});

test("provider refusals, incomplete responses, and ambiguous output fail closed", () => {
  const valid = {
    schema: responseSchema,
    requestId: "request-17",
    answer: {
      type: "context.consistency",
      status: "consistent",
    },
  };
  const failures = [
    createProviderResponse(valid, {
      error: {
        code: "server_error",
        message: "sensitive provider failure",
      },
    }),
    createProviderResponse(valid, {
      status: "incomplete",
      incompleteDetails: { reason: "max_output_tokens" },
    }),
    createProviderResponse(valid, {
      output: [
        {
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "refusal", refusal: "sensitive refusal body" }],
        },
      ],
    }),
    createProviderResponse(valid, {
      output: [
        {
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: canonicalJson(valid) }],
        },
        {
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: canonicalJson(valid) }],
        },
      ],
    }),
    createProviderResponse(valid, {
      output: [
        {
          type: "function_call",
          name: "unexpected",
          arguments: "{}",
        },
      ],
    }),
    createProviderResponse(valid, {
      model: "unexpected-model-revision",
    }),
    createProviderResponse(valid, {
      output: [
        {
          type: "message",
          status: "incomplete",
          role: "assistant",
          content: [{ type: "output_text", text: canonicalJson(valid) }],
        },
      ],
    }),
    createProviderResponse({
      ...valid,
      error: {
        code: "provider.http-429",
        message: "forged model error",
        scope: "observation",
      },
    }),
  ];

  for (const response of failures) {
    assert.throws(
      () => parseOpenAIResponse(response, "gpt-4o-mini-2024-07-18"),
      (error) => {
        assert.equal(error.message.includes("sensitive"), false);
        return true;
      },
    );
  }
});

test("adapter performs one HTTP request and emits one canonical response line", async (t) => {
  const apiKey = "inert-adapter-secret";
  const request = createRequest();
  const modelOutput = {
    schema: responseSchema,
    requestId: request.requestId,
    answer: {
      type: "context.consistency",
      status: "consistent",
    },
  };
  const observed = [];
  const { server, endpoint } = await startServer(async (incoming, response) => {
    observed.push({
      method: incoming.method,
      url: incoming.url,
      authorization: incoming.headers.authorization,
      contentType: incoming.headers["content-type"],
      body: await readBody(incoming),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(canonicalJson(createProviderResponse(modelOutput)));
  });
  t.after(() => server.close());

  const stdout = capture();
  const stderr = capture();
  const exitCode = await runAdapter({
    apiKey,
    fetchImpl: async (url, init) => {
      assert.equal(url, OPENAI_RESPONSES_ENDPOINT);
      assert.equal(init.redirect, "error");
      return fetch(endpoint, init);
    },
    input: Readable.from([`${canonicalJson(request)}\n`]),
    output: stdout.stream,
    diagnostics: stderr.stream,
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value(), "");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].method, "POST");
  assert.equal(observed[0].url, "/v1/responses");
  assert.equal(observed[0].authorization, `Bearer ${apiKey}`);
  assert.equal(observed[0].contentType, "application/json");
  assert.deepEqual(
    JSON.parse(observed[0].body),
    createOpenAIRequestBody(request),
  );
  assert.equal(observed[0].body.includes(apiKey), false);

  const lines = stdout.value().trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(lines[0], canonicalJson(JSON.parse(lines[0])));
  assert.deepEqual(JSON.parse(lines[0]), {
    ...modelOutput,
    usage: {
      inputTokens: 120,
      outputTokens: 24,
      costUsd: null,
    },
  });
  assert.equal(stdout.value().includes(apiKey), false);
});

test("redirects fail without forwarding the benchmark request", async (t) => {
  const request = createRequest();
  let redirectedRequests = 0;
  const target = await startServer(async (incoming, response) => {
    redirectedRequests += 1;
    await readBody(incoming);
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const redirect = await startServer(async (incoming, response) => {
    await readBody(incoming);
    response.writeHead(307, { location: target.endpoint });
    response.end();
  });
  t.after(() => target.server.close());
  t.after(() => redirect.server.close());

  await assert.rejects(
    invokeOpenAI(request, {
      apiKey: "inert-redirect-secret",
      fetchImpl: async (url, init) => {
        assert.equal(url, OPENAI_RESPONSES_ENDPOINT);
        return fetch(redirect.endpoint, init);
      },
    }),
    (error) => {
      assert.equal(error.code, "provider.transport");
      return true;
    },
  );
  assert.equal(redirectedRequests, 0);
});

test("provider HTTP failures become safe protocol error envelopes", async (t) => {
  const apiKey = "inert-error-secret";
  const providerBody = "sensitive-provider-error-body";
  const request = createRequest();
  let calls = 0;
  const { server, endpoint } = await startServer(async (incoming, response) => {
    calls += 1;
    await readBody(incoming);
    response.writeHead(429, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: {
          message: providerBody,
          reflectedCredential: apiKey,
        },
      }),
    );
  });
  t.after(() => server.close());

  const stdout = capture();
  const stderr = capture();
  const exitCode = await runAdapter({
    apiKey,
    fetchImpl: async (url, init) => {
      assert.equal(url, OPENAI_RESPONSES_ENDPOINT);
      return fetch(endpoint, init);
    },
    input: Readable.from([`${canonicalJson(request)}\n`]),
    output: stdout.stream,
    diagnostics: stderr.stream,
  });

  assert.equal(exitCode, 0);
  assert.equal(calls, 1);
  assert.equal(stderr.value(), "");
  const response = JSON.parse(stdout.value());
  assert.deepEqual(response, {
    schema: adapterErrorSchema,
    requestId: request.requestId,
    error: {
      code: "provider.http-429",
      message: "OpenAI Responses API returned HTTP 429",
      scope: "observation",
    },
  });
  for (const secret of [apiKey, providerBody]) {
    assert.equal(stdout.value().includes(secret), false);
    assert.equal(stderr.value().includes(secret), false);
  }
});

test("provider HTTP 400 is a run-scoped request failure", async () => {
  const request = createRequest();
  const stdout = capture();
  const stderr = capture();
  const exitCode = await runAdapter({
    apiKey: "inert-adapter-secret",
    fetchImpl: async () => new Response("", { status: 400 }),
    input: Readable.from([`${canonicalJson(request)}\n`]),
    output: stdout.stream,
    diagnostics: stderr.stream,
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value(), "");
  assert.deepEqual(JSON.parse(stdout.value()), {
    schema: adapterErrorSchema,
    requestId: request.requestId,
    error: {
      code: "provider.http-400",
      message: "OpenAI Responses API returned HTTP 400",
      scope: "run",
    },
  });
});

test("adapter error envelopes remain valid for adversarial config keys", async () => {
  const config = createConfig({
    parameters: {
      structuredOutput: true,
      ["x".repeat(600)]: true,
    },
  });
  const request = createRequest("direct", { config });
  const stdout = capture();
  const stderr = capture();

  const exitCode = await runAdapter({
    apiKey: "inert-config-secret",
    fetchImpl: async () => {
      throw new Error("must not be called");
    },
    input: Readable.from([`${canonicalJson(request)}\n`]),
    output: stdout.stream,
    diagnostics: stderr.stream,
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value(), "");
  const response = JSON.parse(stdout.value());
  assert.equal(response.schema, adapterErrorSchema);
  assert.equal(response.error.scope, "run");
  assert.ok(Array.from(response.error.message).length <= 480);
  const validators = await createModelEvalValidators();
  assert.doesNotThrow(() =>
    validateAdapterResponse(response, request, validators),
  );
});

test("transport and malformed provider bodies do not leak error content", async () => {
  const request = createRequest();
  let calls = 0;
  await assert.rejects(
    invokeOpenAI(request, {
      apiKey: "inert-transport-secret",
      fetchImpl: async () => {
        calls += 1;
        throw new Error("sensitive network endpoint");
      },
    }),
    (error) => {
      assert.equal(error.code, "provider.transport");
      assert.equal(error.message.includes("sensitive network endpoint"), false);
      return true;
    },
  );
  assert.equal(calls, 1);

  await assert.rejects(
    invokeOpenAI(request, {
      apiKey: "inert-json-secret",
      fetchImpl: async () =>
        new Response('{"secret":"sensitive","secret":"duplicate"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    }),
    (error) => {
      assert.equal(error.code, "provider.invalid-json");
      assert.equal(error.message.includes("sensitive"), false);
      return true;
    },
  );
});

test("HTTP status failures are classified without reading provider bodies", async () => {
  const request = createRequest();
  for (const status of [400, 401, 429, 500]) {
    await assert.rejects(
      invokeOpenAI(request, {
        apiKey: "inert-http-secret",
        fetchImpl: async () =>
          new Response("sensitive provider body", { status }),
      }),
      (error) => {
        assert.equal(error.code, `provider.http-${status}`);
        assert.equal(error.message.includes("sensitive provider body"), false);
        return true;
      },
    );
  }
});

test("HTTP request and authentication failures are run-scoped", async () => {
  for (const [status, scope] of [
    [400, "run"],
    [401, "run"],
    [403, "run"],
    [404, "run"],
    [422, "observation"],
  ]) {
    const request = createRequest();
    const stdout = capture();
    const exitCode = await runAdapter({
      apiKey: "inert-http-scope-secret",
      fetchImpl: async () => new Response("not recorded", { status }),
      input: Readable.from([`${canonicalJson(request)}\n`]),
      output: stdout.stream,
      diagnostics: capture().stream,
    });
    assert.equal(exitCode, 0);
    const response = JSON.parse(stdout.value());
    assert.equal(response.schema, adapterErrorSchema);
    assert.equal(response.error.scope, scope);
  }
});

test("oversized provider responses and malformed model JSON fail safely", async () => {
  const request = createRequest();
  await assert.rejects(
    invokeOpenAI(request, {
      apiKey: "inert-size-secret",
      fetchImpl: async () =>
        new Response(Buffer.alloc(1024 * 1024 + 1, 0x20), { status: 200 }),
    }),
    (error) => {
      assert.equal(error.code, "provider.response-too-large");
      return true;
    },
  );

  const malformed = createProviderResponse({});
  malformed.output[1].content[0].text =
    '{"schema":"covenant.timeline.model-eval.response.v1","secret":"sensitive","secret":"duplicate"}';
  assert.throws(
    () => parseOpenAIResponse(malformed, "gpt-4o-mini-2024-07-18"),
    (error) => {
      assert.equal(error.code, "provider.invalid-json");
      assert.equal(error.message.includes("sensitive"), false);
      return true;
    },
  );
});

test("the executable main guard returns a protocol error without credentials", async () => {
  const request = createRequest();
  const child = spawn(process.execPath, [adapterPath], {
    env: {
      ...process.env,
      OPENAI_API_KEY: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(`${canonicalJson(request)}\n`);
  const [exitCode] = await once(child, "close");

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  assert.equal(stdout.trimEnd().split("\n").length, 1);
  assert.deepEqual(JSON.parse(stdout), {
    schema: adapterErrorSchema,
    requestId: request.requestId,
    error: {
      code: "adapter.credentials",
      message: "OPENAI_API_KEY is missing or invalid",
      scope: "run",
    },
  });
});

test("the executable uses the official endpoint and has no endpoint override", async () => {
  assert.equal(
    OPENAI_RESPONSES_ENDPOINT,
    "https://api.openai.com/v1/responses",
  );
  const source = await readFile(adapterPath, "utf8");
  assert.equal(source.includes("OPENAI_BASE_URL"), false);
  assert.equal(source.includes("COVENANT_OPENAI_ENDPOINT"), false);
  assert.deepEqual(source.match(/process\.env\.[A-Z0-9_]+/gu), [
    "process.env.OPENAI_API_KEY",
  ]);
});

function assertOpenAISchemaSubset(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertOpenAISchemaSubset(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const forbidden of ["oneOf", "allOf", "not", "if", "then", "else"]) {
    assert.equal(
      Object.hasOwn(value, forbidden),
      false,
      `${path} contains unsupported ${forbidden}`,
    );
  }
  if (value.type === "object") {
    assert.equal(
      value.additionalProperties,
      false,
      `${path} must close object properties`,
    );
    assert.deepEqual(
      [...value.required].sort(),
      Object.keys(value.properties).sort(),
      `${path} must require every property`,
    );
  }
  for (const [key, entry] of Object.entries(value)) {
    assertOpenAISchemaSubset(entry, `${path}.${key}`);
  }
}

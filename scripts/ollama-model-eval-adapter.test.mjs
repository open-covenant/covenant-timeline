import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
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
  OLLAMA_ADAPTER_ID,
  OLLAMA_ADAPTER_VERSION,
  OLLAMA_CHAT_ENDPOINT,
  OLLAMA_PS_ENDPOINT,
  OLLAMA_TAGS_ENDPOINT,
  OLLAMA_VERSION_ENDPOINT,
  createOllamaChatBody,
  invokeOllama,
  parseOllamaChatResponse,
  runAdapter,
} from "./ollama-model-eval-adapter.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const adapterPath = join(root, "scripts/ollama-model-eval-adapter.mjs");
const responseSchema = "covenant.timeline.model-eval.response.v1";
const adapterErrorSchema = "covenant.timeline.model-eval.adapter-error.v1";
const model = "example/model:latest";
const modelDigest = `sha256:${"a".repeat(64)}`;
const runtimeVersion = "0.31.2";

function createConfig(overrides = {}) {
  return {
    schema: "covenant.timeline.model-eval.config.v1",
    id: "ollama-reference-test",
    benchmarkRevision: overrides.benchmarkRevision ?? "test-revision",
    adapter: {
      id: overrides.adapterId ?? OLLAMA_ADAPTER_ID,
      version: overrides.adapterVersion ?? OLLAMA_ADAPTER_VERSION,
    },
    model: {
      provider: overrides.provider ?? "ollama",
      id: overrides.model ?? model,
      revision: overrides.revision ?? modelDigest,
    },
    generation: {
      temperature: overrides.temperature ?? 0,
      seed: overrides.seed === undefined ? 42 : overrides.seed,
      maxOutputTokens: overrides.maxOutputTokens ?? 4096,
      parameters: overrides.parameters ?? {
        contextLength: 32768,
        runtimeVersion,
        structuredOutput: true,
        thinking: false,
        topP: 1,
      },
    },
  };
}

function createRequest(arm = "direct", overrides = {}) {
  const config = overrides.config ?? createConfig();
  return {
    schema: "covenant.timeline.model-eval.request.v1",
    requestId: overrides.requestId ?? "request-23",
    benchmark: "model-interface-v1",
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

function createModelOutput(requestId = "request-23") {
  return {
    schema: responseSchema,
    requestId,
    answer: {
      type: "context.consistency",
      status: "consistent",
    },
  };
}

function createChatResponse(output = createModelOutput(), overrides = {}) {
  return {
    model: overrides.model ?? model,
    created_at: "2026-07-30T12:00:00Z",
    message: overrides.message ?? {
      role: "assistant",
      content: canonicalJson(output),
    },
    done: overrides.done ?? true,
    done_reason: overrides.doneReason ?? "stop",
    prompt_eval_count: overrides.inputTokens ?? 180,
    eval_count: overrides.outputTokens ?? 30,
  };
}

function createTagsResponse(overrides = {}) {
  return {
    models: overrides.models ?? [
      {
        name: model,
        model,
        digest: modelDigest.slice("sha256:".length),
        size: 1024,
      },
    ],
  };
}

function createPsResponse(overrides = {}) {
  return {
    models: overrides.models ?? [
      {
        name: model,
        model,
        digest: modelDigest.slice("sha256:".length),
        size: 1024,
        size_vram: 1024,
      },
    ],
  };
}

function createVersionResponse(version = runtimeVersion) {
  return { version };
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

function jsonResponse(value, status = 200) {
  return new Response(canonicalJson(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Ollama request mapping is deterministic and stateless for every arm", () => {
  for (const arm of ["direct", "narrative-memory", "timeline"]) {
    const request = createRequest(arm);
    const body = createOllamaChatBody(request);

    assert.equal(body.model, model);
    assert.deepEqual(body.messages, [
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
    ]);
    assert.equal(body.stream, false);
    assert.equal(body.keep_alive, "5m");
    assert.equal(body.think, false);
    assert.equal(body.format.type, "object");
    assert.equal(Object.hasOwn(body.format, "anyOf"), false);
    assert.equal(
      body.format.properties.requestId.maxLength,
      MAX_MODEL_REQUEST_ID_LENGTH,
    );
    if (arm === "narrative-memory") {
      assert.equal(
        body.format.properties.memory.maxLength,
        MAX_NARRATIVE_MEMORY_CHARACTERS,
      );
    }
    if (arm === "timeline") {
      assert.equal(
        body.format.properties.events.maxItems,
        MAX_TIMELINE_EVENTS_PER_RESPONSE,
      );
      assert.equal(
        body.format.$defs.evidenceRefs.maxItems,
        MAX_TIMELINE_REFERENCES_PER_EVENT,
      );
      assert.equal(
        body.format.$defs.nonEmptyIdentifiers.maxItems,
        MAX_TIMELINE_REFERENCES_PER_EVENT,
      );
      assert.equal(body.format.$defs.identifier.maxLength, 128);
    }
    assert.deepEqual(body.options, {
      temperature: 0,
      seed: 42,
      num_predict: 4096,
      top_p: 1,
      num_ctx: 32768,
    });
    for (const forbidden of ["conversation", "raw", "session", "tools"]) {
      assert.equal(Object.hasOwn(body, forbidden), false);
    }
    assert.equal(body.messages[1].content.includes(request.config.id), false);
    assert.equal(body.messages[1].content.includes(request.caseId), false);
  }
});

test("records supported thinking levels in the provider request", () => {
  const config = createConfig({
    parameters: {
      contextLength: 32768,
      runtimeVersion,
      structuredOutput: true,
      thinking: "low",
      topP: 1,
    },
  });
  const body = createOllamaChatBody(createRequest("direct", { config }));
  assert.equal(body.think, "low");
});

test("configuration errors fail before model discovery", async () => {
  const requests = [
    createRequest("direct", {
      config: createConfig({
        benchmarkRevision: "replace-with-source-commit",
      }),
    }),
    createRequest("direct", {
      config: createConfig({ temperature: 0.1 }),
    }),
    createRequest("direct", {
      config: createConfig({ seed: null }),
    }),
    createRequest("direct", {
      config: createConfig({ revision: "a".repeat(64) }),
    }),
    createRequest("direct", {
      config: createConfig({ model: "https://remote.example/model" }),
    }),
    createRequest("direct", {
      config: createConfig({
        parameters: {
          contextLength: 32768,
          runtimeVersion,
          structuredOutput: true,
          thinking: true,
          topP: 1,
        },
      }),
    }),
    createRequest("direct", {
      config: createConfig({
        parameters: {
          contextLength: 32768,
          hiddenRetryCount: 2,
          runtimeVersion,
          structuredOutput: true,
          thinking: false,
          topP: 1,
        },
      }),
    }),
    createRequest("direct", {
      configDigest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
    createRequest("direct", {
      config: createConfig({ model: "gpt-oss:120b-cloud" }),
    }),
    createRequest("direct", {
      config: createConfig({
        parameters: {
          contextLength: 32768,
          runtimeVersion: "latest",
          structuredOutput: true,
          thinking: false,
          topP: 1,
        },
      }),
    }),
  ];

  for (const request of requests) {
    let calls = 0;
    await assert.rejects(
      invokeOllama(request, {
        fetchImpl: async () => {
          calls += 1;
          throw new Error("must not be called");
        },
      }),
    );
    assert.equal(calls, 0);
  }
});

test("native chat output maps token counts mechanically", () => {
  assert.deepEqual(parseOllamaChatResponse(createChatResponse(), model), {
    ...createModelOutput(),
    usage: {
      inputTokens: 180,
      outputTokens: 30,
      costUsd: null,
    },
  });
});

test("incomplete, ambiguous, and malformed chat output fails closed", () => {
  const failures = [
    createChatResponse(createModelOutput(), { done: false }),
    createChatResponse(createModelOutput(), {
      model: "different:latest",
    }),
    createChatResponse(createModelOutput(), {
      message: {
        role: "assistant",
        content: canonicalJson(createModelOutput()),
        tool_calls: [{ function: { name: "unexpected" } }],
      },
    }),
    createChatResponse(createModelOutput(), { inputTokens: -1 }),
    createChatResponse({
      ...createModelOutput(),
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
      },
    }),
  ];
  const duplicate = createChatResponse();
  duplicate.message.content = '{"secret":"first","secret":"second"}';
  failures.push(duplicate);

  for (const response of failures) {
    assert.throws(
      () => parseOllamaChatResponse(response, model),
      (error) => {
        assert.equal(error.message.includes("secret"), false);
        return true;
      },
    );
  }
});

test("output-token exhaustion is reported without retaining partial output", () => {
  const response = createChatResponse(
    { secret: "partial provider output" },
    { doneReason: "length", outputTokens: 4096 },
  );

  assert.throws(
    () => parseOllamaChatResponse(response, model),
    (error) => {
      assert.equal(error.code, "provider.output-limit");
      assert.equal(
        error.message,
        "provider reached the configured output-token limit",
      );
      assert.deepEqual(error.usage, {
        inputTokens: 180,
        outputTokens: 4096,
        costUsd: null,
      });
      assert.equal(error.message.includes("secret"), false);
      return true;
    },
  );
});

test("adapter binds installed and running model digests to one chat request", async () => {
  const request = createRequest();
  const calls = [];
  const response = await invokeOllama(request, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url === OLLAMA_VERSION_ENDPOINT) {
        return jsonResponse(createVersionResponse());
      }
      if (url === OLLAMA_TAGS_ENDPOINT) {
        return jsonResponse(createTagsResponse());
      }
      if (url === OLLAMA_CHAT_ENDPOINT) {
        return jsonResponse(createChatResponse());
      }
      if (url === OLLAMA_PS_ENDPOINT) {
        return jsonResponse(createPsResponse());
      }
      throw new Error("unexpected endpoint");
    },
  });

  assert.deepEqual(response, {
    ...createModelOutput(),
    usage: {
      inputTokens: 180,
      outputTokens: 30,
      costUsd: null,
    },
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      OLLAMA_VERSION_ENDPOINT,
      OLLAMA_TAGS_ENDPOINT,
      OLLAMA_CHAT_ENDPOINT,
      OLLAMA_PS_ENDPOINT,
    ],
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[1].init.redirect, "error");
  assert.equal(calls[2].init.method, "POST");
  assert.equal(calls[2].init.redirect, "error");
  assert.equal(calls[3].init.method, "GET");
  assert.equal(calls[3].init.redirect, "error");
  assert.equal(calls[2].init.headers.authorization, undefined);
  assert.deepEqual(
    JSON.parse(calls[2].init.body),
    createOllamaChatBody(request),
  );
});

test("running model mismatch, absence, or ambiguity returns no result", async () => {
  const cases = [
    {
      models: [{ name: model, model, digest: "b".repeat(64) }],
      code: "provider.model-revision",
    },
    {
      models: [],
      code: "provider.model-not-running",
    },
    {
      models: [
        {
          name: model,
          model,
          digest: modelDigest.slice("sha256:".length),
        },
        {
          name: model,
          model,
          digest: modelDigest.slice("sha256:".length),
        },
      ],
      code: "provider.ps-invalid",
    },
  ];

  for (const { models, code } of cases) {
    const request = createRequest();
    const stdout = capture();
    const exitCode = await runAdapter({
      fetchImpl: async (url) => {
        if (url === OLLAMA_VERSION_ENDPOINT) {
          return jsonResponse(createVersionResponse());
        }
        if (url === OLLAMA_TAGS_ENDPOINT) {
          return jsonResponse(createTagsResponse());
        }
        if (url === OLLAMA_CHAT_ENDPOINT) {
          return jsonResponse(createChatResponse());
        }
        assert.equal(url, OLLAMA_PS_ENDPOINT);
        return jsonResponse(createPsResponse({ models }));
      },
      input: Readable.from([`${canonicalJson(request)}\n`]),
      output: stdout.stream,
      diagnostics: capture().stream,
    });

    assert.equal(exitCode, 0);
    const envelope = JSON.parse(stdout.value());
    assert.equal(envelope.error.code, code);
    assert.equal(envelope.error.scope, "run");
    assert.equal(Object.hasOwn(envelope, "answer"), false);
  }
});

test("runtime mismatch or malformed version prevents model discovery", async () => {
  for (const [version, code] of [
    ["0.31.3", "provider.runtime-version"],
    ["latest", "provider.version-invalid"],
  ]) {
    let calls = 0;
    await assert.rejects(
      invokeOllama(createRequest(), {
        fetchImpl: async (url) => {
          calls += 1;
          assert.equal(url, OLLAMA_VERSION_ENDPOINT);
          return jsonResponse(createVersionResponse(version));
        },
      }),
      (error) => {
        assert.equal(error.code, code);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test("missing or mismatched model inventory prevents inference", async () => {
  for (const inventory of [
    createTagsResponse({ models: [] }),
    createTagsResponse({
      models: [
        {
          name: model,
          model,
          digest: "b".repeat(64),
        },
      ],
    }),
    createTagsResponse({
      models: [{ name: model, model, digest: "invalid" }],
    }),
  ]) {
    let calls = 0;
    await assert.rejects(
      invokeOllama(createRequest(), {
        fetchImpl: async (url) => {
          calls += 1;
          if (url === OLLAMA_VERSION_ENDPOINT) {
            return jsonResponse(createVersionResponse());
          }
          assert.equal(url, OLLAMA_TAGS_ENDPOINT);
          return jsonResponse(inventory);
        },
      }),
    );
    assert.equal(calls, 2);
  }
});

test("run adapter emits one canonical benchmark response line", async () => {
  const request = createRequest();
  const stdout = capture();
  const stderr = capture();
  const exitCode = await runAdapter({
    fetchImpl: async (url) => {
      if (url === OLLAMA_VERSION_ENDPOINT) {
        return jsonResponse(createVersionResponse());
      }
      if (url === OLLAMA_TAGS_ENDPOINT) {
        return jsonResponse(createTagsResponse());
      }
      if (url === OLLAMA_CHAT_ENDPOINT) {
        return jsonResponse(createChatResponse());
      }
      assert.equal(url, OLLAMA_PS_ENDPOINT);
      return jsonResponse(createPsResponse());
    },
    input: Readable.from([`${canonicalJson(request)}\n`]),
    output: stdout.stream,
    diagnostics: stderr.stream,
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value(), "");
  const lines = stdout.value().trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(lines[0], canonicalJson(JSON.parse(lines[0])));
  const response = JSON.parse(lines[0]);
  const validators = await createModelEvalValidators();
  assert.doesNotThrow(() =>
    validateAdapterResponse(response, request, validators),
  );
});

test("discovery failures are run-scoped and do not leak response bodies", async () => {
  const request = createRequest();
  const stdout = capture();
  const stderr = capture();
  let calls = 0;
  const exitCode = await runAdapter({
    fetchImpl: async (url, init) => {
      calls += 1;
      if (url === OLLAMA_VERSION_ENDPOINT) {
        return jsonResponse(createVersionResponse());
      }
      assert.equal(url, OLLAMA_TAGS_ENDPOINT);
      assert.equal(init.redirect, "error");
      return new Response("sensitive local provider body", { status: 500 });
    },
    input: Readable.from([`${canonicalJson(request)}\n`]),
    output: stdout.stream,
    diagnostics: stderr.stream,
  });

  assert.equal(exitCode, 0);
  assert.equal(calls, 2);
  assert.equal(stderr.value(), "");
  assert.deepEqual(JSON.parse(stdout.value()), {
    schema: adapterErrorSchema,
    requestId: request.requestId,
    error: {
      code: "provider.tags-http-500",
      message: "Ollama API returned HTTP 500",
      scope: "run",
    },
  });
  assert.equal(stdout.value().includes("sensitive"), false);
});

test("chat failures are not retried", async () => {
  let versionCalls = 0;
  let tagsCalls = 0;
  let chatCalls = 0;
  await assert.rejects(
    invokeOllama(createRequest(), {
      fetchImpl: async (url) => {
        if (url === OLLAMA_VERSION_ENDPOINT) {
          versionCalls += 1;
          return jsonResponse(createVersionResponse());
        }
        if (url === OLLAMA_TAGS_ENDPOINT) {
          tagsCalls += 1;
          return jsonResponse(createTagsResponse());
        }
        chatCalls += 1;
        return new Response("not recorded", { status: 500 });
      },
    }),
    (error) => {
      assert.equal(error.code, "provider.chat-http-500");
      return true;
    },
  );
  assert.equal(versionCalls, 1);
  assert.equal(tagsCalls, 1);
  assert.equal(chatCalls, 1);
});

test("chat HTTP 400 remains an observation-scoped result", async () => {
  const request = createRequest();
  const stdout = capture();
  const exitCode = await runAdapter({
    fetchImpl: async (url) => {
      if (url === OLLAMA_VERSION_ENDPOINT) {
        return jsonResponse(createVersionResponse());
      }
      if (url === OLLAMA_TAGS_ENDPOINT) {
        return jsonResponse(createTagsResponse());
      }
      return new Response("not recorded", { status: 400 });
    },
    input: Readable.from([`${canonicalJson(request)}\n`]),
    output: stdout.stream,
    diagnostics: capture().stream,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(stdout.value()), {
    schema: adapterErrorSchema,
    requestId: request.requestId,
    error: {
      code: "provider.chat-http-400",
      message: "Ollama API returned HTTP 400",
      scope: "observation",
    },
  });
});

test("malformed adapter requests fail before provider access", async () => {
  const request = canonicalJson(createRequest());
  const cases = [
    Buffer.from([0xff]),
    Buffer.alloc(256 * 1024 + 1, 0x61),
    `${request}\n${request}\n`,
    '{"requestId":"sensitive-first","requestId":"sensitive-second"}\n',
    "null\n",
  ];

  for (const input of cases) {
    const stdout = capture();
    const stderr = capture();
    let calls = 0;
    const exitCode = await runAdapter({
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not be called");
      },
      input: Readable.from([input]),
      output: stdout.stream,
      diagnostics: stderr.stream,
    });

    assert.equal(exitCode, 1);
    assert.equal(calls, 0);
    assert.equal(stdout.value(), "");
    assert.match(stderr.value(), /^ollama adapter: .+\n$/u);
    assert.equal(stderr.value().includes("sensitive"), false);
  }
});

test("provider transport and body boundaries fail closed", async () => {
  const failures = [
    {
      response: new Response(Uint8Array.from([0xff])),
      code: "provider.version-invalid-utf8",
    },
    {
      response: new Response(Buffer.alloc(4 * 1024 * 1024 + 1, 0x61)),
      code: "provider.version-response-too-large",
    },
    {
      response: new Response(
        '{"version":"0.31.2","version":"sensitive-duplicate"}',
      ),
      code: "provider.version-invalid-json",
    },
  ];

  for (const { response, code } of failures) {
    await assert.rejects(
      invokeOllama(createRequest(), {
        fetchImpl: async () => response,
      }),
      (error) => {
        assert.equal(error.code, code);
        assert.equal(error.message.includes("sensitive"), false);
        return true;
      },
    );
  }

  await assert.rejects(
    invokeOllama(createRequest(), {
      fetchImpl: async () => {
        throw new Error("sensitive transport detail");
      },
    }),
    (error) => {
      assert.equal(error.code, "provider.version-transport");
      assert.equal(error.message.includes("sensitive"), false);
      return true;
    },
  );
});

test("unexpected provider exceptions become sanitized run failures", async () => {
  const request = createRequest();
  const stdout = capture();
  const stderr = capture();
  const response = {};
  Object.defineProperty(response, "ok", {
    get() {
      throw new Error("sensitive provider exception");
    },
  });
  const exitCode = await runAdapter({
    fetchImpl: async () => response,
    input: Readable.from([`${canonicalJson(request)}\n`]),
    output: stdout.stream,
    diagnostics: stderr.stream,
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value(), "");
  assert.equal(stdout.value().includes("sensitive"), false);
  assert.deepEqual(JSON.parse(stdout.value()), {
    schema: adapterErrorSchema,
    requestId: request.requestId,
    error: {
      code: "adapter.failure",
      message: "Ollama adapter failed",
      scope: "run",
    },
  });
});

test("adapter exposes fixed loopback endpoints and no environment override", async () => {
  assert.equal(OLLAMA_TAGS_ENDPOINT, "http://127.0.0.1:11434/api/tags");
  assert.equal(OLLAMA_CHAT_ENDPOINT, "http://127.0.0.1:11434/api/chat");
  assert.equal(OLLAMA_VERSION_ENDPOINT, "http://127.0.0.1:11434/api/version");
  assert.equal(OLLAMA_PS_ENDPOINT, "http://127.0.0.1:11434/api/ps");
  const source = await readFile(adapterPath, "utf8");
  assert.equal(source.includes("OLLAMA_HOST"), false);
  assert.equal(source.includes("localhost"), false);
  assert.equal(source.includes("process.env"), false);
  assert.deepEqual(source.match(/https?:\/\/[^"]+/gu), [
    "http://127.0.0.1:11434/api/tags",
    "http://127.0.0.1:11434/api/chat",
    "http://127.0.0.1:11434/api/version",
    "http://127.0.0.1:11434/api/ps",
  ]);
});

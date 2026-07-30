import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  canonicalJson,
  contentDigest,
} from "../packages/prototype/dist/index.js";
import { digestText } from "./model-interface-eval.mjs";
import {
  createModelProposalEvalValidators,
  runModelProposalEval,
} from "./run-model-proposal-eval.mjs";

const revision = "a".repeat(40);
const sourceState = {
  revision,
  dirty: false,
  status: "",
  stateDigest: contentDigest({ revision }),
};

test("runner preserves rolling state across a compiler failure", async (t) => {
  const fixture = await createFixture(t, "rolling");
  const result = await runFixture(fixture);
  assert.equal(result.completed, 3);
  if (process.platform !== "win32") {
    assert.equal((await stat(fixture.output)).mode & 0o777, 0o600);
  }

  const records = await readJsonLines(fixture.output);
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map(({ status }) => status),
    ["ok", "error", "ok"],
  );
  assert.equal(records[0].applied, true);
  assert.equal(records[1].responseSchemaValid, true);
  assert.equal(records[1].compiled, false);
  assert.equal(records[1].applied, null);
  assert.equal(records[1].error.stage, "compilation");
  assert.equal(records[2].applied, true);
  assert.deepEqual(records[2].conclusion.result, {
    type: "difference.bounds",
    status: "partially-bounded",
    minimum: null,
    maximum: 9,
  });

  const requests = await readJsonLines(fixture.log);
  assert.equal(requests.length, 3);
  assert.deepEqual(
    requests.map(({ input }) => ({
      assertions: input.priorState.assertions.length,
      cuts: input.priorState.knowledgeCuts.length,
    })),
    [
      { assertions: 0, cuts: 0 },
      { assertions: 1, cuts: 1 },
      { assertions: 1, cuts: 2 },
    ],
  );

  await assertArtifactIntegrity(records, requests);
});

test("provider, response-schema, and protocol failures remain complete observations", async (t) => {
  const fixture = await createFixture(t, "mixed");
  await runFixture(fixture);

  const records = await readJsonLines(fixture.output);
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map(({ status }) => status),
    ["error", "error", "error"],
  );
  assert.deepEqual(
    records.map(({ error }) => error.stage),
    ["response-schema", "adapter", "protocol"],
  );
  assert.equal(records[0].responseSchemaValid, false);
  assert.equal(records[0].proposal, null);
  assert.equal(records[1].responseSchemaValid, null);
  assert.equal(records[1].responseText.includes("fixture unavailable"), true);
  assert.equal(records[2].responseText, "not-json");
  for (const record of records) {
    assert.equal(record.applied, null);
    assert.equal(record.error.message.length <= 480, true);
  }

  const requests = await readJsonLines(fixture.log);
  assert.deepEqual(
    requests.map(({ input }) => input.priorState.knowledgeCuts.length),
    [0, 1, 2],
  );
  await assertArtifactIntegrity(records, requests);
});

test("run-scoped adapter failure publishes no partial artifact", async (t) => {
  const fixture = await createFixture(t, "run-error");

  await assert.rejects(runFixture(fixture), /fixture unavailable/u);
  await assert.rejects(readFile(fixture.output, "utf8"), {
    code: "ENOENT",
  });
  assert.deepEqual(
    (await readdir(fixture.directory)).filter((name) =>
      name.endsWith(".partial"),
    ),
    [],
  );
});

test("existing output is not replaced without explicit overwrite", async (t) => {
  const fixture = await createFixture(t, "rolling");
  await writeFile(fixture.output, "existing\n");

  await assert.rejects(runFixture(fixture), /output already exists/u);
  assert.equal(await readFile(fixture.output, "utf8"), "existing\n");
  assert.equal((await readFile(fixture.log, "utf8")).length, 0);
});

async function assertArtifactIntegrity(records, requests) {
  const validators = await createModelProposalEvalValidators();
  for (const [index, record] of records.entries()) {
    assert.equal(
      validators.result(record),
      true,
      JSON.stringify(validators.result.errors),
    );
    assert.equal(record.requestText, canonicalJson(requests[index]));
    assert.equal(record.requestDigest, digestText(record.requestText));
    assert.equal(
      record.outputSchemaJson,
      canonicalJson(requests[index].outputSchema),
    );
    assert.equal(
      record.outputSchemaDigest,
      digestText(record.outputSchemaJson),
    );
    assert.equal(
      record.outputSchemaDigest,
      contentDigest(requests[index].outputSchema),
    );
    assert.equal(requests[index].outputSchemaDigest, record.outputSchemaDigest);
    assert.equal(requests[index].configDigest, record.run.configDigest);
    assert.deepEqual(requests[index].config, record.run.config);
    assertNoGoldLeak(requests[index]);
  }
}

function assertNoGoldLeak(value) {
  const forbidden = new Set([
    "family",
    "traits",
    "goldEvents",
    "goldQuery",
    "expectedResult",
    "contract",
    "run",
    "setupEvents",
  ]);
  visit(value);

  function visit(entry) {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (entry === null || typeof entry !== "object") return;
    for (const [key, child] of Object.entries(entry)) {
      assert.equal(forbidden.has(key), false, `request leaks ${key}`);
      visit(child);
    }
  }
}

async function createFixture(t, mode) {
  const directory = await mkdtemp(join(tmpdir(), "timeline-proposal-eval-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "config.json");
  const adapter = join(directory, "adapter.mjs");
  const output = join(directory, "results.jsonl");
  const log = join(directory, "requests.jsonl");

  await Promise.all([
    writeFile(
      config,
      `${JSON.stringify(
        {
          schema: "covenant.timeline.model-proposal-eval.config.v1",
          id: "fixture-run",
          benchmarkRevision: revision,
          adapter: { id: "fixture-adapter", version: "1" },
          model: {
            provider: "fixture",
            id: "fixture-model",
            revision: "fixture-model-v1",
          },
          generation: {
            temperature: 0,
            seed: 0,
            maxOutputTokens: 1024,
            parameters: {},
          },
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(adapter, fakeAdapterSource),
    writeFile(log, ""),
  ]);

  return { adapter, config, directory, log, mode, output };
}

function runFixture(fixture) {
  return runModelProposalEval(
    {
      adapter: [process.execPath, fixture.adapter, fixture.mode, fixture.log],
      caseIds: ["bounds.deploy-window"],
      config: fixture.config,
      output: fixture.output,
      overwrite: false,
      repeats: 1,
      timeoutMs: 10_000,
    },
    {
      readSourceState: async () => sourceState,
    },
  );
}

async function readJsonLines(path) {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").filter(Boolean).map(JSON.parse);
}

const fakeAdapterSource = String.raw`
import { appendFileSync } from "node:fs";

const [mode, logPath] = process.argv.slice(2);
let text = "";
for await (const chunk of process.stdin) text += chunk;
const request = JSON.parse(text);
appendFileSync(logPath, JSON.stringify(request) + "\n");

const ordinal = Number(request.requestId.slice("request-".length));
const usage = { inputTokens: 10, outputTokens: 20, costUsd: 0 };

if (mode === "run-error" || (mode === "mixed" && ordinal === 2)) {
  process.stdout.write(JSON.stringify({
    schema: "covenant.timeline.model-eval.adapter-error.v1",
    requestId: request.requestId,
    error: {
      code: "provider.fixture",
      message: "fixture unavailable",
      scope: mode === "run-error" ? "run" : "observation"
    },
    usage
  }) + "\n");
  process.exit(0);
}

if (mode === "mixed" && ordinal === 3) {
  process.stdout.write("not-json\n");
  process.exit(0);
}

const evidence = request.input.evidence[0];
const references = request.input.references;
const open = references.find(
  (entry) => entry.type === "point" && entry.label === "release window opening"
);
const approval = references.find(
  (entry) => entry.type === "point" && entry.label === "approval"
);
const difference = references.find(
  (entry) =>
    entry.type === "difference" &&
    entry.from === "release window opening" &&
    entry.to === "approval"
);

let change;
if (evidence.text.includes("opened at offset 10")) {
  change = {
    type: "coordinate",
    pointHandle: open.handle,
    bounds: { type: "exact", value: 10 },
    supports: [{
      evidenceId: evidence.id,
      quote: "The release window opened at offset 10."
    }],
    revision: { type: "keep" }
  };
} else if (evidence.text.includes("no earlier than offset 16")) {
  change = {
    type: "coordinate",
    pointHandle: approval.handle,
    bounds: { type: "lower-bound", minimum: 16 },
    supports: [{
      evidenceId: evidence.id,
      quote: mode === "rolling"
        ? "not present in current evidence"
        : "Approval occurred no earlier than offset 16."
    }],
    revision: { type: "keep" }
  };
} else {
  change = {
    type: "coordinate",
    pointHandle: approval.handle,
    bounds: { type: "upper-bound", maximum: 19 },
    supports: [{
      evidenceId: evidence.id,
      quote: "Approval occurred no later than offset 19."
    }],
    revision: { type: "keep" }
  };
}

const proposal = {
  schema: "covenant.timeline.model-proposal.v1",
  requestId: request.requestId,
  changes: [change],
  query: {
    type: "difference",
    targetHandle: difference.handle,
    knowledgeCut: { type: "current" }
  },
  usage
};

if (mode === "mixed" && ordinal === 1) delete proposal.query;
process.stdout.write(JSON.stringify(proposal) + "\n");
`;

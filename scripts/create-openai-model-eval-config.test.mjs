import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createOpenAIModelEvalConfig,
  main,
} from "./create-openai-model-eval-config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const revision = "a".repeat(40);

test("config creation injects the source revision and exact model snapshot", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-openai-config-"),
  );
  const output = join(directory, "run.json");

  try {
    assert.equal(
      await createOpenAIModelEvalConfig({
        maxOutputTokens: 16_384,
        model: "gpt-4o-mini-2024-07-18",
        output,
        reasoningEffort: "high",
        sourceRevision: revision,
        verbosity: "low",
      }),
      output,
    );
    const config = JSON.parse(await readFile(output, "utf8"));
    assert.equal(config.benchmarkRevision, revision);
    assert.equal(config.model.id, "gpt-4o-mini-2024-07-18");
    assert.equal(config.model.revision, config.model.id);
    assert.equal(config.adapter.id, "openai-responses");
    assert.equal(config.adapter.version, "1");
    assert.equal(config.generation.temperature, null);
    assert.equal(config.generation.seed, null);
    assert.equal(config.generation.maxOutputTokens, 16_384);
    assert.equal(config.generation.parameters.structuredOutput, true);
    assert.equal(config.generation.parameters.reasoningEffort, "high");
    assert.equal(config.generation.parameters.verbosity, "low");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("config creation selects the proposal benchmark contract", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-openai-proposal-config-"),
  );
  const output = join(directory, "run.json");
  try {
    await createOpenAIModelEvalConfig({
      benchmark: "model-proposal-boundary-v1",
      model: "gpt-4o-mini-2024-07-18",
      output,
      sourceRevision: revision,
    });
    const config = JSON.parse(await readFile(output, "utf8"));
    assert.equal(
      config.schema,
      "covenant.timeline.model-proposal-eval.config.v1",
    );
    assert.equal(config.id, "openai-proposal-smoke");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("config creation refuses checkout paths and accidental overwrites", async () => {
  await assert.rejects(
    createOpenAIModelEvalConfig({
      output: join(tmpdir(), "run.json"),
      sourceRevision: "a".repeat(41),
    }),
    /full Git object id/u,
  );
  await assert.rejects(
    createOpenAIModelEvalConfig({
      benchmark: "unknown",
      output: join(root, "run.json"),
      sourceRevision: revision,
    }),
    /benchmark must be/u,
  );
  await assert.rejects(
    createOpenAIModelEvalConfig({
      output: join(root, "run.json"),
      sourceRevision: revision,
    }),
    /outside the repository checkout/u,
  );

  const directory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-openai-config-"),
  );
  const output = join(directory, "run.json");
  try {
    await writeFile(output, "existing", "utf8");
    await assert.rejects(
      createOpenAIModelEvalConfig({
        output,
        sourceRevision: revision,
      }),
      /EEXIST/u,
    );
    assert.equal(await readFile(output, "utf8"), "existing");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("config CLI fails closed on invalid arguments", async () => {
  let stdout = "";
  let stderr = "";
  const exitCode = await main(["--model"], {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /--model requires a value/u);
});

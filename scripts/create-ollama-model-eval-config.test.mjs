import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createOllamaModelEvalConfig,
  main,
} from "./create-ollama-model-eval-config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const revision = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const runtimeVersion = "0.31.2";

test("config creation pins source, model, digest, and thinking level", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-ollama-config-"),
  );
  const output = join(directory, "run.json");

  try {
    assert.equal(
      await createOllamaModelEvalConfig({
        digest,
        model: "example/model:latest",
        output,
        runtimeVersion,
        sourceRevision: revision,
        thinking: "low",
      }),
      output,
    );
    const config = JSON.parse(await readFile(output, "utf8"));
    assert.equal(config.benchmarkRevision, revision);
    assert.equal(config.model.provider, "ollama");
    assert.equal(config.model.id, "example/model:latest");
    assert.equal(config.model.revision, digest);
    assert.equal(config.adapter.id, "ollama-chat");
    assert.equal(config.adapter.version, "1");
    assert.equal(config.generation.temperature, 0);
    assert.equal(config.generation.seed, 42);
    assert.equal(config.generation.parameters.contextLength, 32768);
    assert.equal(config.generation.parameters.runtimeVersion, runtimeVersion);
    assert.equal(config.generation.parameters.structuredOutput, true);
    assert.equal(config.generation.parameters.thinking, "low");
    assert.equal(config.generation.parameters.topP, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("config creation rejects invalid identities and checkout outputs", async () => {
  for (const sourceRevision of ["a".repeat(41), "a".repeat(63)]) {
    await assert.rejects(
      createOllamaModelEvalConfig({
        digest,
        model: "example:latest",
        output: join(root, "run.json"),
        runtimeVersion,
        sourceRevision,
      }),
      /full Git object id/u,
    );
  }
  await assert.rejects(
    createOllamaModelEvalConfig({
      digest,
      model: undefined,
      output: join(root, "run.json"),
      runtimeVersion,
      sourceRevision: revision,
    }),
    /valid installed Ollama model name/u,
  );
  await assert.rejects(
    createOllamaModelEvalConfig({
      digest,
      model: "https://remote.example/model",
      output: join(root, "run.json"),
      runtimeVersion,
      sourceRevision: revision,
    }),
    /valid installed Ollama model name/u,
  );
  await assert.rejects(
    createOllamaModelEvalConfig({
      digest: "b".repeat(64),
      model: "example:latest",
      output: join(root, "run.json"),
      runtimeVersion,
      sourceRevision: revision,
    }),
    /lowercase sha256 model digest/u,
  );
  await assert.rejects(
    createOllamaModelEvalConfig({
      digest,
      model: "example:latest",
      output: join(root, "run.json"),
      runtimeVersion,
      sourceRevision: revision,
    }),
    /outside the repository checkout/u,
  );
  await assert.rejects(
    createOllamaModelEvalConfig({
      digest,
      model: "example:latest",
      output: join(root, "run.json"),
      runtimeVersion,
      sourceRevision: revision,
      thinking: true,
    }),
    /thinking must be false, low, medium, or high/u,
  );
  await assert.rejects(
    createOllamaModelEvalConfig({
      digest,
      model: "example:latest",
      output: join(root, "run.json"),
      runtimeVersion,
      sourceRevision: revision,
      thinking: "false",
    }),
    /thinking must be false, low, medium, or high/u,
  );
  await assert.rejects(
    createOllamaModelEvalConfig({
      digest,
      model: "gpt-oss:120b-cloud",
      output: join(root, "run.json"),
      runtimeVersion,
      sourceRevision: revision,
    }),
    /local Ollama model/u,
  );
  await assert.rejects(
    createOllamaModelEvalConfig({
      digest,
      model: "example:latest",
      output: join(root, "run.json"),
      runtimeVersion: "latest",
      sourceRevision: revision,
    }),
    /exact Ollama semantic version/u,
  );
  await assert.rejects(
    createOllamaModelEvalConfig({
      digest,
      model: "example:latest",
      output: undefined,
      runtimeVersion,
      sourceRevision: revision,
    }),
    /output must be a non-empty path/u,
  );
});

test("config creation refuses accidental overwrites", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-ollama-config-"),
  );
  const output = join(directory, "run.json");
  try {
    await writeFile(output, "existing", "utf8");
    await assert.rejects(
      createOllamaModelEvalConfig({
        digest,
        model: "example:latest",
        output,
        runtimeVersion,
        sourceRevision: revision,
      }),
      /EEXIST/u,
    );
    assert.equal(await readFile(output, "utf8"), "existing");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("config CLI records an explicit thinking level", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "covenant-timeline-ollama-config-"),
  );
  const output = join(directory, "run.json");
  let stdout = "";
  let stderr = "";

  try {
    const exitCode = await main(
      [
        "--model",
        "example:latest",
        "--digest",
        digest,
        "--thinking",
        "low",
        "--runtime-version",
        runtimeVersion,
        "--output",
        output,
      ],
      {
        stdout: { write: (value) => (stdout += value) },
        stderr: { write: (value) => (stderr += value) },
      },
    );
    assert.equal(exitCode, 0, stderr);
    assert.equal(stdout, `${output}\n`);
    const config = JSON.parse(await readFile(output, "utf8"));
    assert.equal(config.generation.parameters.thinking, "low");
    assert.equal(config.generation.parameters.runtimeVersion, runtimeVersion);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("config CLI fails closed on incomplete arguments", async () => {
  let stdout = "";
  let stderr = "";
  const exitCode = await main(["--model", "example:latest", "--digest"], {
    stdout: { write: (value) => (stdout += value) },
    stderr: { write: (value) => (stderr += value) },
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /--digest requires a value/u);

  stdout = "";
  stderr = "";
  const missingRuntimeExitCode = await main(
    [
      "--model",
      "example:latest",
      "--digest",
      digest,
      "--output",
      "/tmp/unused-ollama-config.json",
    ],
    {
      stdout: { write: (value) => (stdout += value) },
      stderr: { write: (value) => (stderr += value) },
    },
  );
  assert.equal(missingRuntimeExitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /--runtime-version is required/u);
});

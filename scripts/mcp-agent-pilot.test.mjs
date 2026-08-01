import { spawnSync } from "node:child_process";
import {
  access,
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { MCP_AGENT_PILOT_LIMITS } from "./mcp-agent-pilot-lib.mjs";
import { connectMcpClient, serializeTranscript } from "./mcp-agent-pilot.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const driver = join(root, "scripts/mcp-agent-pilot.mjs");
const verifier = join(root, "scripts/mcp-agent-pilot-verify.mjs");
const fixture = join(root, "examples/mcp-agent-pilot");

test("exports and independently verifies a local MCP pilot from paths with spaces", async () => {
  const { temporary, working, input, output, report } = await generateArtifact(
    "timeline pilot test ",
  );

  try {
    assert.equal(report.verified, true);
    assert.equal(report.eventCount, 6);
    assert.equal(report.evidenceCount, 3);
    assert.equal(report.historicalCutVerified, true);
    assert.match(report.generationSourceRevision, /^[0-9a-f]{40}$/);
    assert.equal(typeof report.generationSourceDirty, "boolean");
    assert.equal(
      report.verifierSourceRevision,
      report.generationSourceRevision,
    );
    assert.equal(report.verifierSourceDirty, report.generationSourceDirty);
    assert.equal(report.generationSourceMatchesVerifier, true);
    assert.equal(report.conclusions.length, 2);
    assert.deepEqual(
      report.conclusions.map(({ recordedThrough }) => recordedThrough),
      [3, 5],
    );
    assert.notEqual(
      report.conclusions[0].stateDigest,
      report.conclusions[1].stateDigest,
    );

    const environment = JSON.parse(
      await readFile(join(output, "environment.json"), "utf8"),
    );
    assert.equal(environment.serverRestarted, true);
    assert.equal(environment.serverSessions, 2);

    await rm(input, { recursive: true, force: true });
    const second = spawnSync(process.execPath, [verifier, output], {
      cwd: working,
      encoding: "utf8",
      env: offlineEnvironment(),
    });
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(JSON.parse(second.stdout), report);

    const differentSource = join(working, "different claimed source");
    await cp(output, differentSource, { recursive: true, force: false });
    await rewriteCanonicalJson(
      join(differentSource, "environment.json"),
      (value) => {
        value.source.revision = "b".repeat(40);
      },
    );
    const crossVersion = spawnVerifier(differentSource, working);
    assert.equal(crossVersion.status, 0, crossVersion.stderr);
    const crossVersionReport = JSON.parse(crossVersion.stdout);
    assert.equal(crossVersionReport.generationSourceRevision, "b".repeat(40));
    assert.equal(
      crossVersionReport.verifierSourceRevision,
      report.verifierSourceRevision,
    );
    assert.equal(crossVersionReport.generationSourceMatchesVerifier, false);

    await writeFile(
      join(output, "evidence", "review-correction.json"),
      '{"tampered":true}\n',
    );
    const tampered = spawnSync(process.execPath, [verifier, output], {
      cwd: working,
      encoding: "utf8",
      env: offlineEnvironment(),
    });
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /evidence entry does not match its bytes/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("refuses to generate pilot artifacts inside the source checkout", async () => {
  const owned = await mkdtemp(join(root, ".mcp-agent-pilot-refusal-"));
  const output = join(owned, "forbidden output");

  try {
    const run = spawnSync(
      process.execPath,
      [driver, "--input", fixture, "--out", output],
      {
        cwd: owned,
        encoding: "utf8",
        env: offlineEnvironment(),
      },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /output must be outside the repository checkout/);
    await assert.rejects(access(output), { code: "ENOENT" });
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
});

test("rejects an oversized artifact file before parsing", async () => {
  const { temporary, working, output } = await generateArtifact(
    "timeline pilot oversized ",
  );

  try {
    await writeFile(
      join(output, "environment.json"),
      Buffer.alloc(MCP_AGENT_PILOT_LIMITS.maxEnvironmentBytes + 1, 0x20),
    );
    const checked = spawnVerifier(output, working);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /environment exceeds its byte limit/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("rejects invalid UTF-8 in artifact and operator JSON", async () => {
  const artifact = await generateArtifact("timeline pilot artifact utf8 ");
  try {
    const malformed = join(artifact.working, "malformed environment");
    await cp(artifact.output, malformed, { recursive: true, force: false });
    await rewriteCanonicalJson(join(malformed, "environment.json"), (value) => {
      value.mcpPackage.name = "other-package";
    });
    const malformedCheck = spawnVerifier(malformed, artifact.working);
    assert.notEqual(malformedCheck.status, 0);
    assert.match(malformedCheck.stderr, /MCP package identity is invalid/);

    await writeFile(
      join(artifact.output, "environment.json"),
      Buffer.from([0x7b, 0xff, 0x7d, 0x0a]),
    );
    const checked = spawnVerifier(artifact.output, artifact.working);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /environment is not valid UTF-8/);
  } finally {
    await rm(artifact.temporary, { recursive: true, force: true });
  }

  const input = await runPilotFixture(
    "timeline pilot input utf8 ",
    async ({ input: directory }) => {
      await writeFile(
        join(directory, "queries", "after.json"),
        Buffer.from([0x7b, 0xff, 0x7d]),
      );
    },
  );
  try {
    assert.notEqual(input.run.status, 0);
    assert.match(input.run.stderr, /query after input is not valid UTF-8/);
  } finally {
    await rm(input.temporary, { recursive: true, force: true });
  }
});

test(
  "rejects an artifact file symlink that escapes the artifact root",
  { skip: process.platform === "win32" },
  async () => {
    const { temporary, working, output } = await generateArtifact(
      "timeline pilot symlink ",
    );
    const outside = join(temporary, "outside-environment.json");

    try {
      await copyFile(join(output, "environment.json"), outside);
      await rm(join(output, "environment.json"));
      await symlink(outside, join(output, "environment.json"));
      const checked = spawnVerifier(output, working);
      assert.notEqual(checked.status, 0);
      assert.match(
        checked.stderr,
        /environment must be a real file inside the artifact/,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

test("cleans up the owned MCP transport when connection fails", async () => {
  const connectError = new Error("connect failed");
  let clientCloseCount = 0;
  let transportCloseCount = 0;
  await assert.rejects(
    connectMcpClient(
      {
        async connect() {
          throw connectError;
        },
        async close() {
          clientCloseCount += 1;
        },
      },
      {
        async close() {
          transportCloseCount += 1;
        },
      },
    ),
    (error) => error === connectError,
  );
  assert.equal(clientCloseCount, 1);
  assert.equal(transportCloseCount, 1);

  const closeError = new Error("client close failed");
  await assert.rejects(
    connectMcpClient(
      {
        async connect() {
          throw connectError;
        },
        async close() {
          throw closeError;
        },
      },
      {
        async close() {
          transportCloseCount += 1;
        },
      },
    ),
    (error) => error === connectError,
  );
  assert.equal(transportCloseCount, 2);
});

test("bounds the transcript before artifact export", () => {
  const timeline = { canonicalJson: () => "{}" };
  assert.throws(
    () =>
      serializeTranscript(
        Array(MCP_AGENT_PILOT_LIMITS.maxTranscriptLines + 1).fill({}),
        timeline,
      ),
    /tool transcript exceeds its line limit/,
  );
  assert.throws(
    () =>
      serializeTranscript([{}], {
        canonicalJson: () =>
          "x".repeat(MCP_AGENT_PILOT_LIMITS.maxTranscriptBytes),
      }),
    /tool transcript exceeds its byte limit/,
  );
});

test("accepts safe flat evidence filenames without a JSON extension", async () => {
  const artifact = await generateArtifact(
    "timeline pilot non-json evidence ",
    async ({ input }) => {
      await rename(
        join(input, "evidence", "deploy.json"),
        join(input, "evidence", "deploy.receipt"),
      );
      await rewriteJson(join(input, "events.json"), (events) => {
        for (const event of events) {
          const holder =
            event.type === "assertion.retracted" ? event : event.assertion;
          if (!holder?.evidenceFiles) continue;
          holder.evidenceFiles = holder.evidenceFiles.map((name) =>
            name === "deploy.json" ? "deploy.receipt" : name,
          );
        }
      });
    },
  );

  try {
    await access(join(artifact.output, "evidence", "deploy.receipt"));
    assert.equal(artifact.report.verified, true);
  } finally {
    await rm(artifact.temporary, { recursive: true, force: true });
  }
});

test("rejects hidden and traversing evidence inputs", async () => {
  const hidden = await runPilotFixture(
    "timeline pilot hidden evidence ",
    async ({ input }) => {
      await writeFile(join(input, "evidence", ".hidden"), "not admitted\n");
    },
  );
  try {
    assert.notEqual(hidden.run.status, 0);
    assert.match(hidden.run.stderr, /evidence filename is invalid/);
  } finally {
    await rm(hidden.temporary, { recursive: true, force: true });
  }

  const traversal = await runPilotFixture(
    "timeline pilot evidence traversal ",
    async ({ input }) => {
      await rewriteJson(join(input, "events.json"), (events) => {
        events[3].assertion.evidenceFiles = ["../deploy.json"];
      });
    },
  );
  try {
    assert.notEqual(traversal.run.status, 0);
    assert.match(traversal.run.stderr, /evidence filename is invalid/);
  } finally {
    await rm(traversal.temporary, { recursive: true, force: true });
  }
});

test("rejects oversized evidence input before allocation", async () => {
  const scenario = await runPilotFixture(
    "timeline pilot oversized input ",
    async ({ input }) => {
      await writeFile(
        join(input, "evidence", "deploy.json"),
        Buffer.alloc(MCP_AGENT_PILOT_LIMITS.maxEvidenceFileBytes + 1, 0x20),
      );
    },
  );
  try {
    assert.notEqual(scenario.run.status, 0);
    assert.match(
      scenario.run.stderr,
      /evidence input deploy\.json exceeds its byte limit/,
    );
  } finally {
    await rm(scenario.temporary, { recursive: true, force: true });
  }
});

test(
  "rejects a symlinked operator input",
  { skip: process.platform === "win32" },
  async () => {
    const scenario = await runPilotFixture(
      "timeline pilot symlink input ",
      async ({ temporary, input }) => {
        const outside = join(temporary, "outside-query.json");
        await copyFile(join(input, "queries", "after.json"), outside);
        await rm(join(input, "queries", "after.json"));
        await symlink(outside, join(input, "queries", "after.json"));
      },
    );
    try {
      assert.notEqual(scenario.run.status, 0);
      assert.match(
        scenario.run.stderr,
        /query after input must be a real file inside the input/,
      );
    } finally {
      await rm(scenario.temporary, { recursive: true, force: true });
    }
  },
);

test("requires historical and current queries to ask the same question", async () => {
  const scenario = await runPilotFixture(
    "timeline pilot query counterexample ",
    async ({ input }) => {
      await rewriteJson(join(input, "queries", "after.json"), (query) => {
        [query.fromPointId, query.toPointId] = [
          query.toPointId,
          query.fromPointId,
        ];
      });
    },
  );
  try {
    assert.notEqual(scenario.run.status, 0);
    assert.match(scenario.run.stderr, /same semantic question/);
  } finally {
    await rm(scenario.temporary, { recursive: true, force: true });
  }
});

test("requires a correction to target state known at the historical cut", async () => {
  const scenario = await runPilotFixture(
    "timeline pilot no correction ",
    async ({ input }) => {
      await rewriteJson(join(input, "events.json"), (events) => {
        events[5] = {
          id: "event.unrelated-declared",
          type: "point.declared",
          point: {
            id: "unrelated",
            contextId: "actual",
            axisId: "elapsed-seconds",
          },
        };
      });
    },
  );
  try {
    assert.notEqual(scenario.run.status, 0);
    assert.match(
      scenario.run.stderr,
      /post-historical-cut retraction or supersession/,
    );
  } finally {
    await rm(scenario.temporary, { recursive: true, force: true });
  }
});

test("accepts supersession as the recorded correction", async () => {
  const artifact = await generateArtifact(
    "timeline pilot supersession ",
    async ({ input }) => {
      await rewriteJson(join(input, "events.json"), (events) => {
        events[4].assertion.supersedes = ["review.v1"];
        events[5] = {
          id: "event.unrelated-declared",
          type: "point.declared",
          point: {
            id: "unrelated",
            contextId: "actual",
            axisId: "elapsed-seconds",
          },
        };
      });
    },
  );
  try {
    assert.equal(artifact.report.verified, true);
  } finally {
    await rm(artifact.temporary, { recursive: true, force: true });
  }
});

test("finds an earlier qualifying historical cut", async () => {
  const artifact = await generateArtifact(
    "timeline pilot earlier history ",
    async ({ input }) => {
      await rewriteJson(join(input, "events.json"), (events) => {
        events.push({
          id: "event.post-correction-declared",
          type: "point.declared",
          point: {
            id: "post-correction",
            contextId: "actual",
            axisId: "elapsed-seconds",
          },
        });
      });
      const current = JSON.parse(
        await readFile(join(input, "queries", "after.json"), "utf8"),
      );
      current.id = "query.review-minus-deploy.current";
      current.recordedThrough = 6;
      await writeFile(
        join(input, "queries", "current.json"),
        `${JSON.stringify(current, null, 2)}\n`,
      );
      await rewriteJson(join(input, "pilot.json"), (pilot) => {
        pilot.queries.push({
          name: "current",
          file: "queries/current.json",
        });
      });
    },
  );
  try {
    assert.deepEqual(
      artifact.report.conclusions.map(({ recordedThrough }) => recordedThrough),
      [3, 5, 6],
    );
  } finally {
    await rm(artifact.temporary, { recursive: true, force: true });
  }
});

test("binds the transcript to the exported run and conclusions", async () => {
  const artifact = await generateArtifact("timeline pilot transcript binding ");
  const cases = [
    {
      name: "contract",
      mutate(entries) {
        entries[0].arguments.contract.subject.id = "other/service";
      },
      error: /create call does not match the exported contract/,
    },
    {
      name: "append-cas",
      mutate(entries) {
        const appended = entries.find(
          ({ tool }) => tool === "timeline_append_event",
        );
        appended.arguments.expectedRunDigest = `sha256:${"0".repeat(64)}`;
      },
      error: /does not match the exported event or digest chain/,
    },
    {
      name: "query",
      mutate(entries) {
        const reasoned = entries.find(({ tool }) => tool === "timeline_reason");
        reasoned.arguments.query.id = "query.changed";
      },
      error: /reason call does not match its exported query/,
    },
    {
      name: "conclusion",
      mutate(entries) {
        const reasoned = entries.filter(
          ({ tool }) => tool === "timeline_reason",
        );
        reasoned[0].result.conclusion = structuredClone(
          reasoned[1].result.conclusion,
        );
      },
      error: /reason result does not match its exported conclusion/,
    },
  ];

  try {
    for (const entry of cases) {
      const output = join(artifact.working, `tampered ${entry.name}`);
      await cp(artifact.output, output, { recursive: true, force: false });
      await rewriteTranscript(join(output, "tool-calls.jsonl"), entry.mutate);
      const checked = spawnVerifier(output, artifact.working);
      assert.notEqual(checked.status, 0);
      assert.match(checked.stderr, entry.error);
    }
  } finally {
    await rm(artifact.temporary, { recursive: true, force: true });
  }
});

async function generateArtifact(prefix, prepare) {
  const scenario = await runPilotFixture(prefix, prepare);
  const { temporary, working, input, output, run } = scenario;
  if (run.status !== 0) {
    await rm(temporary, { recursive: true, force: true });
  }
  assert.equal(run.status, 0, run.stderr);
  return {
    temporary,
    working,
    input,
    output,
    report: JSON.parse(run.stdout),
  };
}

async function runPilotFixture(prefix, prepare = async () => undefined) {
  const temporary = await mkdtemp(join(tmpdir(), prefix));
  const working = join(temporary, "working directory with spaces");
  const input = join(working, "pilot input");
  const output = join(working, "pilot artifact");

  try {
    await mkdir(working);
    await cp(fixture, input, { recursive: true, force: false });
    await prepare({ temporary, working, input, output });
    const run = spawnSync(
      process.execPath,
      [driver, "--input", input, "--out", output],
      {
        cwd: working,
        encoding: "utf8",
        env: offlineEnvironment(),
      },
    );
    return {
      temporary,
      working,
      input,
      output,
      run,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function rewriteJson(path, mutate) {
  const value = JSON.parse(await readFile(path, "utf8"));
  mutate(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function rewriteCanonicalJson(path, mutate) {
  const value = JSON.parse(await readFile(path, "utf8"));
  mutate(value);
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

async function rewriteTranscript(path, mutate) {
  const entries = (await readFile(path, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  mutate(entries);
  await writeFile(
    path,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
}

function spawnVerifier(output, cwd) {
  return spawnSync(process.execPath, [verifier, output], {
    cwd,
    encoding: "utf8",
    env: offlineEnvironment(),
  });
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

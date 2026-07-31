import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { TemporalEventV0Alpha3 } from "@covenant-org/timeline";
import {
  FileMcpRunStore,
  parseMcpRunEnvelopeV0Alpha1,
  TimelineMcpError,
} from "./index.js";
import {
  DEFAULT_MAX_RUN_BYTES,
  DEFAULT_MAX_RUNS,
  MAX_LIST_PAGE_SIZE,
  MAX_MODEL_PROPOSAL_EVENTS,
} from "./constants.js";
import { correctionEvents, releaseContract } from "./__tests__/fixtures.js";

describe("FileMcpRunStore", () => {
  let directory: string;
  let store: FileMcpRunStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "timeline-mcp-store-"));
    store = new FileMcpRunStore(directory);
  });

  afterEach(async () => {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });

  test("creates, lists, reloads, and idempotently reopens a run", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);

    expect(created.created).toBe(true);
    expect(created.envelope.revision).toBe(0);
    expect(created.envelope.runDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(created.envelope.admission).toEqual({
      mode: "structural-only",
      assertionAuthority: "unverified",
      evidencePayloads: "external",
    });

    const loaded = await new FileMcpRunStore(directory).require(contract.id);
    expect(loaded).toEqual(created.envelope);
    expect(await store.list()).toEqual([
      {
        runId: contract.id,
        revision: 0,
        subject: contract.subject,
        contexts: contract.contexts,
        eventCount: 0,
        latestRecordedThrough: null,
        runDigest: created.envelope.runDigest,
      },
    ]);

    const reopened = await store.create(contract);
    expect(reopened.created).toBe(false);
    expect(reopened.envelope).toEqual(created.envelope);
  });

  test("lists deterministic first, middle, and final pages", async () => {
    const expectedIds = await createRuns(store, 5);

    const first = await store.listPage({ limit: 2 });
    expect(first.timelines).toHaveLength(2);
    expect(first.nextCursor).toMatch(/^v1\.[0-9a-f]{64}\.[0-9a-f]{64}$/);
    expect(await store.listPage({ limit: 2 })).toEqual(first);

    const middle = await store.listPage({
      cursor: first.nextCursor!,
      limit: 2,
    });
    expect(middle.timelines).toHaveLength(2);
    expect(middle.nextCursor).toMatch(/^v1\.[0-9a-f]{64}\.[0-9a-f]{64}$/);

    const final = await store.listPage({
      cursor: middle.nextCursor!,
      limit: 2,
    });
    expect(final.timelines).toHaveLength(1);
    expect(final.nextCursor).toBeNull();

    const actualIds = [
      ...first.timelines,
      ...middle.timelines,
      ...final.timelines,
    ]
      .map(({ runId }) => runId)
      .sort();
    expect(actualIds).toEqual(expectedIds.sort());
  });

  test("rejects invalid and stale page cursors", async () => {
    await createRuns(store, 2);
    await expect(
      store.listPage({ cursor: "not-a-cursor" }),
    ).rejects.toMatchObject({
      code: "timeline.mcp.input.invalid",
      message: "timeline page cursor is invalid or stale",
    });

    const first = await store.listPage({ limit: 1 });
    const firstFile = (await storedFiles(directory))[0]!;
    await rm(join(directory, firstFile));
    await expect(
      store.listPage({ cursor: first.nextCursor! }),
    ).rejects.toMatchObject({
      code: "timeline.mcp.input.invalid",
      message: "timeline page cursor is invalid or stale",
    });
  });

  test("invalidates a page cursor when the run catalog changes", async () => {
    await createRuns(store, 2);
    const first = await store.listPage({ limit: 1 });

    await store.create(releaseContract("agent.page-new"));

    await expect(
      store.listPage({ cursor: first.nextCursor! }),
    ).rejects.toMatchObject({
      code: "timeline.mcp.input.invalid",
      message: "timeline page cursor is invalid or stale",
    });
  });

  test.each([0, MAX_LIST_PAGE_SIZE + 1, 1.5, "1", null])(
    "rejects invalid page limit %j",
    async (limit) => {
      await expect(store.listPage({ limit } as never)).rejects.toMatchObject({
        code: "timeline.mcp.input.invalid",
        message: `timeline page limit must be an integer from 1 through ${MAX_LIST_PAGE_SIZE}`,
      });
    },
  );

  test("reads no more than the default page size", async () => {
    await createRuns(store, MAX_LIST_PAGE_SIZE + 1);
    const files = await storedFiles(directory);
    await writeFile(join(directory, files[MAX_LIST_PAGE_SIZE]!), "corrupt\n");

    const first = await store.listPage();
    expect(first.timelines).toHaveLength(MAX_LIST_PAGE_SIZE);
    expect(first.nextCursor).toMatch(/^v1\.[0-9a-f]{64}\.[0-9a-f]{64}$/);

    await expect(
      store.listPage({ cursor: first.nextCursor! }),
    ).rejects.toMatchObject({
      code: "timeline.mcp.store.corrupt",
    });
  });

  test("rejects invalid configuration, identifiers, drafts, and conflicts", async () => {
    expect(() => new FileMcpRunStore("")).toThrow(TypeError);
    expect(() => new FileMcpRunStore(directory, { maxBytes: 0 })).toThrow(
      RangeError,
    );
    expect(() => new FileMcpRunStore(directory, { maxRuns: 1.5 })).toThrow(
      RangeError,
    );
    expect(
      () =>
        new FileMcpRunStore(directory, {
          maxBytes: DEFAULT_MAX_RUN_BYTES + 1,
        }),
    ).toThrow(RangeError);
    expect(
      () => new FileMcpRunStore(directory, { maxRuns: DEFAULT_MAX_RUNS + 1 }),
    ).toThrow(RangeError);
    expect(
      () =>
        new FileMcpRunStore(directory, {
          maxBytes: DEFAULT_MAX_RUN_BYTES,
          maxRuns: DEFAULT_MAX_RUNS,
        }),
    ).not.toThrow();

    await expect(store.load("../outside")).rejects.toMatchObject({
      code: "timeline.mcp.input.invalid",
    });
    await expect(
      store.append(
        "missing.run",
        correctionEvents[0],
        `sha256:${"0".repeat(64)}`,
      ),
    ).rejects.toMatchObject({
      code: "timeline.mcp.store.not-found",
    });
    await expect(
      store.append("missing.run", correctionEvents[0], "not-a-digest"),
    ).rejects.toMatchObject({
      code: "timeline.mcp.input.invalid",
    });

    const contract = releaseContract();
    const created = await store.create(contract);
    await expect(
      store.create({
        ...contract,
        subject: { ...contract.subject, id: "different/service" },
      }),
    ).rejects.toMatchObject({
      code: "timeline.mcp.store.conflict",
    });
    await expect(
      store.append(contract.id, null, created.envelope.runDigest),
    ).rejects.toMatchObject({
      code: "timeline.mcp.input.invalid",
    });
    await expect(
      store.append(
        contract.id,
        { ...correctionEvents[0], schema: "caller-supplied" },
        created.envelope.runDigest,
      ),
    ).rejects.toMatchObject({
      code: "timeline.mcp.input.invalid",
    });
    await expect(
      store.append(
        contract.id,
        { id: "INVALID", type: "unsupported" },
        created.envelope.runDigest,
      ),
    ).rejects.toMatchObject({
      code: "timeline.mcp.input.invalid",
    });
  });

  test("assigns sequence, enforces CAS, and makes event retries idempotent", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const first = await store.append(
      contract.id,
      correctionEvents[0],
      created.envelope.runDigest,
    );
    const second = await store.append(
      contract.id,
      correctionEvents[1],
      first.envelope.runDigest,
    );

    expect(first.event).toMatchObject({
      schema: "covenant.timeline.event.v0alpha3",
      sequence: 0,
    });
    expect(second.event.sequence).toBe(1);
    expect(second.envelope.revision).toBe(2);

    const retried = await store.append(
      contract.id,
      correctionEvents[0],
      created.envelope.runDigest,
    );
    expect(retried.appended).toBe(false);
    expect(retried.event).toEqual(first.event);
    expect(retried.envelope.revision).toBe(2);

    const firstDraft = correctionEvents[0];
    if (firstDraft?.type !== "point.declared") {
      throw new Error("correction fixture must begin with a point declaration");
    }

    await expect(
      store.append(
        contract.id,
        {
          ...firstDraft,
          point: { ...firstDraft.point, id: "changed" },
        },
        second.envelope.runDigest,
      ),
    ).rejects.toMatchObject({
      code: "timeline.mcp.store.conflict",
    });

    await expect(
      store.append(
        contract.id,
        correctionEvents[2],
        created.envelope.runDigest,
      ),
    ).rejects.toMatchObject({
      code: "timeline.mcp.store.conflict",
    });
  });

  test("appends a compiled batch atomically and retries it from its bound prefix", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const batch = materializeEvents(correctionEvents.slice(0, 2), 0);

    const applied = await store.appendCompiled(contract.id, batch, {
      revision: 0,
      runDigest: created.envelope.runDigest,
    });
    expect(applied).toMatchObject({
      appended: true,
      events: [{ sequence: 0 }, { sequence: 1 }],
      envelope: { revision: 2 },
    });

    const later = await store.append(
      contract.id,
      correctionEvents[2],
      applied.envelope.runDigest,
    );
    const retried = await store.appendCompiled(contract.id, batch, {
      revision: 0,
      runDigest: created.envelope.runDigest,
    });
    expect(retried.appended).toBe(false);
    expect(retried.events).toEqual(batch);
    expect(retried.envelope).toEqual(later.envelope);
  });

  test("rejects incomplete, changed, reordered, colliding, and stale occupied prefixes", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const batch = materializeEvents(correctionEvents.slice(0, 2), 0);

    await store.append(
      contract.id,
      correctionEvents[0],
      created.envelope.runDigest,
    );
    await expect(
      store.appendCompiled(contract.id, batch, {
        revision: 0,
        runDigest: created.envelope.runDigest,
      }),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });

    const current = await store.require(contract.id);
    const changed = structuredClone(batch);
    if (changed[0]?.type !== "point.declared") {
      throw new Error("compiled fixture must begin with a point declaration");
    }
    changed[0].point.id = "changed";
    await expect(
      store.appendCompiled(contract.id, changed, {
        revision: 0,
        runDigest: created.envelope.runDigest,
      }),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });

    const reordered = [
      { ...batch[1]!, sequence: 0 },
      { ...batch[0]!, sequence: 1 },
    ];
    await expect(
      store.appendCompiled(contract.id, reordered, {
        revision: 0,
        runDigest: created.envelope.runDigest,
      }),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });

    const colliding = [
      {
        ...batch[0]!,
        sequence: 1,
      },
    ];
    await expect(
      store.appendCompiled(contract.id, colliding, {
        revision: 1,
        runDigest: current.runDigest,
      }),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });

    await expect(
      store.appendCompiled(contract.id, [], {
        revision: 0,
        runDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });
    await expect(
      store.appendCompiled(contract.id, [], {
        revision: current.revision + 1,
        runDigest: current.runDigest,
      }),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });
  });

  test("validates a complete compiled batch before replacing stored bytes", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const path = await storedPath(directory);
    const before = await readFile(path);
    const events: TemporalEventV0Alpha3[] = [
      ...materializeEvents(correctionEvents.slice(0, 1), 0),
      {
        schema: "covenant.timeline.event.v0alpha3",
        id: "event.invalid-interval",
        sequence: 1,
        type: "interval.declared",
        interval: {
          id: "missing",
          contextId: "actual",
          startPointId: "not-declared",
          endPointId: "also-missing",
        },
      },
    ];

    await expect(
      store.appendCompiled(contract.id, events, {
        revision: 0,
        runDigest: created.envelope.runDigest,
      }),
    ).rejects.toMatchObject({ code: "timeline.mcp.input.invalid" });
    expect(await readFile(path)).toEqual(before);
    expect((await store.require(contract.id)).revision).toBe(0);
  });

  test("allows only one compiled batch to consume a run prefix", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const first = materializeEvents(correctionEvents.slice(0, 1), 0);
    const second = materializeEvents(correctionEvents.slice(1, 2), 0);
    const expected = {
      revision: 0,
      runDigest: created.envelope.runDigest,
    };

    const writes = await Promise.allSettled([
      store.appendCompiled(contract.id, first, expected),
      store.appendCompiled(contract.id, second, expected),
    ]);
    expect(writes.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect((await store.require(contract.id)).revision).toBe(1);
    expect(writes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.objectContaining({
        code: expect.stringMatching(/^timeline\.mcp\.store\.(busy|conflict)$/),
      }),
    });
  });

  test("bounds compiled batches and accepts a bound empty no-op", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const empty = await store.appendCompiled(contract.id, [], {
      revision: 0,
      runDigest: created.envelope.runDigest,
    });
    expect(empty).toMatchObject({
      appended: false,
      events: [],
      envelope: { revision: 0 },
    });

    await expect(
      store.appendCompiled(
        contract.id,
        Array.from(
          { length: MAX_MODEL_PROPOSAL_EVENTS + 1 },
          (_, sequence) => ({
            schema: "covenant.timeline.event.v0alpha3",
            id: `event.limit-${sequence}`,
            sequence,
            type: "point.declared",
            point: {
              id: `point.limit-${sequence}`,
              contextId: "actual",
              axisId: "utc-seconds",
            },
          }),
        ),
        {
          revision: 0,
          runDigest: created.envelope.runDigest,
        },
      ),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.limit" });
  });

  test("validates complete candidate runs before replacing stored bytes", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const path = await storedPath(directory);
    const before = await readFile(path);

    await expect(
      store.append(
        contract.id,
        {
          id: "event.invalid-interval",
          type: "interval.declared",
          interval: {
            id: "missing",
            contextId: "actual",
            startPointId: "not-declared",
            endPointId: "also-missing",
          },
        },
        created.envelope.runDigest,
      ),
    ).rejects.toMatchObject({
      code: "timeline.mcp.input.invalid",
    });

    expect(await readFile(path)).toEqual(before);
    expect((await store.require(contract.id)).revision).toBe(0);
  });

  test("allows only one writer to consume a run digest", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const writes = await Promise.allSettled([
      store.append(
        contract.id,
        correctionEvents[0],
        created.envelope.runDigest,
      ),
      store.append(
        contract.id,
        correctionEvents[1],
        created.envelope.runDigest,
      ),
    ]);

    expect(writes.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect((await store.require(contract.id)).revision).toBe(1);
    const rejected = writes.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({
        code: expect.stringMatching(/^timeline\.mcp\.store\.(busy|conflict)$/),
      }),
    });
  });

  test("serializes the global run limit and never steals fixed locks", async () => {
    const limited = new FileMcpRunStore(directory, { maxRuns: 1 });
    const creates = await Promise.allSettled([
      limited.create(releaseContract("agent.one")),
      limited.create(releaseContract("agent.two")),
    ]);

    expect(creates.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(await limited.list()).toHaveLength(1);

    const path = await storedPath(directory);
    const lockPath = path.replace(/\.json$/, ".lock");
    await writeFile(lockPath, "operator lock", { flag: "wx", mode: 0o600 });
    const timeline = (await limited.list())[0];
    expect(timeline).toBeDefined();

    await expect(
      limited.append(timeline!.runId, correctionEvents[0], timeline!.runDigest),
    ).rejects.toMatchObject({
      code: "timeline.mcp.store.busy",
    });
    expect(await readFile(lockPath, "utf8")).toBe("operator lock");
  });

  test("rejects corrupt, non-UTF-8, and oversized stored data", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const path = await storedPath(directory);
    const envelope = JSON.parse(await readFile(path, "utf8"));
    envelope.runDigest = `sha256:${"0".repeat(64)}`;
    await writeFile(path, JSON.stringify(envelope));

    await expect(store.require(contract.id)).rejects.toMatchObject({
      code: "timeline.mcp.store.corrupt",
    });

    await writeFile(path, Buffer.from([0xff, 0xfe]));
    await expect(store.require(contract.id)).rejects.toMatchObject({
      code: "timeline.mcp.store.corrupt",
    });

    await expect(
      new FileMcpRunStore(directory, { maxBytes: 1 }).require(contract.id),
    ).rejects.toMatchObject({
      code: "timeline.mcp.store.limit",
    });
    expect(created.envelope.revision).toBe(0);
  });

  test("rejects non-canonical and duplicate-key envelopes", async () => {
    const contract = releaseContract();
    await store.create(contract);
    const path = await storedPath(directory);
    const canonical = await readFile(path, "utf8");

    await writeFile(path, ` ${canonical}`);
    await expect(store.require(contract.id)).rejects.toMatchObject({
      code: "timeline.mcp.store.corrupt",
    });

    const duplicate = canonical.replace(
      '{"admission":',
      '{"schema":"covenant.timeline.mcp-run.v0alpha1","admission":',
    );
    await writeFile(path, duplicate);
    await expect(store.require(contract.id)).rejects.toMatchObject({
      code: "timeline.mcp.store.corrupt",
    });
  });

  test("rejects every stored envelope identity invariant", async () => {
    const created = await store.create(releaseContract());
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        value.extra = true;
      },
      (value) => {
        value.schema = "unsupported";
      },
      (value) => {
        value.runId = "../invalid";
      },
      (value) => {
        value.revision = -1;
      },
      (value) => {
        value.runDigest = "not-a-digest";
      },
      (value) => {
        record(value.admission).mode = "trusted";
      },
      (value) => {
        record(value.implementation).serverVersion = "unrecognized";
      },
      (value) => {
        record(record(value.run).contract).id = "different.run";
      },
      (value) => {
        value.revision = 1;
      },
      (value) => {
        value.runDigest = `sha256:${"0".repeat(64)}`;
      },
    ];

    for (const mutate of mutations) {
      const value = structuredClone(created.envelope) as unknown as Record<
        string,
        unknown
      >;
      mutate(value);
      expect(() => parseMcpRunEnvelopeV0Alpha1(value)).toThrowError(
        expect.objectContaining({ code: "timeline.mcp.store.corrupt" }),
      );
    }
    expect(() => parseMcpRunEnvelopeV0Alpha1(null)).toThrowError(
      expect.objectContaining({ code: "timeline.mcp.store.corrupt" }),
    );
  });

  test("preserves compatible server versions across process upgrades", async () => {
    const created = await store.create(releaseContract());
    const value = structuredClone(created.envelope);
    value.implementation.serverVersion = "0.0.0-alpha.2";

    expect(parseMcpRunEnvelopeV0Alpha1(value).implementation).toEqual({
      ...created.envelope.implementation,
      serverVersion: "0.0.0-alpha.2",
    });
  });

  test("rejects stored files whose names do not bind their run IDs", async () => {
    const contract = releaseContract();
    await store.create(contract);
    const path = await storedPath(directory);
    await rename(path, join(directory, `${"0".repeat(64)}.json`));

    await expect(store.list()).rejects.toMatchObject({
      code: "timeline.mcp.store.corrupt",
    });
  });

  test.runIf(process.platform !== "win32")(
    "rejects symlinked stored runs",
    async () => {
      const contract = releaseContract();
      await store.create(contract);
      const path = await storedPath(directory);
      const target = join(directory, "outside-run.json");
      await rename(path, target);
      await symlink(target, path);

      await expect(store.require(contract.id)).rejects.toMatchObject({
        code: "timeline.mcp.store.corrupt",
      });
    },
  );

  test.runIf(process.platform !== "win32")(
    "rejects FIFO stored runs without blocking",
    async () => {
      const contract = releaseContract();
      await store.create(contract);
      const path = await storedPath(directory);
      await rm(path);
      const created = spawnSync("mkfifo", [path], { encoding: "utf8" });
      expect(created.status, created.stderr).toBe(0);

      const result = await requireStoredRunInChild(directory, contract.id);
      expect(result).toEqual({
        code: 0,
        signal: null,
        stderr: "",
        timedOut: false,
      });
    },
  );

  test.runIf(process.platform !== "win32")(
    "creates private destination and lock files",
    async () => {
      const contract = releaseContract();
      const created = await store.create(contract);
      const path = await storedPath(directory);
      expect((await stat(path)).mode & 0o777).toBe(0o600);

      const lockPath = path.replace(/\.json$/, ".lock");
      await writeFile(lockPath, "", { flag: "wx", mode: 0o600 });
      expect((await stat(lockPath)).mode & 0o777).toBe(0o600);
      await expect(
        store.append(
          contract.id,
          correctionEvents[0],
          created.envelope.runDigest,
        ),
      ).rejects.toBeInstanceOf(TimelineMcpError);
    },
  );

  test("cleans handled temporary files and locks after a byte-limit failure", async () => {
    const limited = new FileMcpRunStore(directory, { maxBytes: 128 });
    await expect(limited.create(releaseContract())).rejects.toMatchObject({
      code: "timeline.mcp.store.limit",
    });
    expect(await readdir(directory)).toEqual([]);
  });
});

async function storedPath(directory: string): Promise<string> {
  const files = await storedFiles(directory);
  expect(files).toHaveLength(1);
  return join(directory, files[0]!);
}

async function storedFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((file) => /^[0-9a-f]{64}\.json$/.test(file))
    .sort();
}

async function createRuns(
  store: FileMcpRunStore,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `agent.page-${String(index).padStart(2, "0")}`;
    await store.create(releaseContract(id));
    ids.push(id);
  }
  return ids;
}

function materializeEvents(
  drafts: readonly (typeof correctionEvents)[number][],
  start: number,
): TemporalEventV0Alpha3[] {
  return drafts.map(
    (draft, index) =>
      ({
        ...structuredClone(draft),
        schema: "covenant.timeline.event.v0alpha3",
        sequence: start + index,
      }) as TemporalEventV0Alpha3,
  );
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("expected record");
  }
  return value as Record<string, unknown>;
}

async function requireStoredRunInChild(
  directory: string,
  runId: string,
): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  timedOut: boolean;
}> {
  const storeModule = new URL("../dist/store.js", import.meta.url).href;
  const source = `
    import { FileMcpRunStore } from ${JSON.stringify(storeModule)};
    try {
      await new FileMcpRunStore(${JSON.stringify(directory)}).require(${JSON.stringify(runId)});
      process.exitCode = 2;
    } catch (error) {
      if (error?.code === "timeline.mcp.store.corrupt") {
        process.exitCode = 0;
      } else {
        process.stderr.write(error instanceof Error ? error.message : "failed");
        process.exitCode = 3;
      }
    }
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 2_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
      });
    });
  });
}

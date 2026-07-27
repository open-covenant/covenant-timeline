import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  FileMcpRunStore,
  parseMcpRunEnvelopeV0Alpha1,
  TimelineMcpError,
} from "./index.js";
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

  test("rejects invalid configuration, identifiers, drafts, and conflicts", async () => {
    expect(() => new FileMcpRunStore("")).toThrow(TypeError);
    expect(() => new FileMcpRunStore(directory, { maxBytes: 0 })).toThrow(
      RangeError,
    );
    expect(() => new FileMcpRunStore(directory, { maxRuns: 1.5 })).toThrow(
      RangeError,
    );

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
  const files = (await readdir(directory)).filter((file) =>
    /^[0-9a-f]{64}\.json$/.test(file),
  );
  expect(files).toHaveLength(1);
  return join(directory, files[0]!);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("expected record");
  }
  return value as Record<string, unknown>;
}

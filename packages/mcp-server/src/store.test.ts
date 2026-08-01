import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import {
  canonicalJson,
  contentDigest,
  type JsonValue,
  type TemporalEventV0Alpha3,
  type TemporalModelProposalCandidateV1,
} from "@covenant-org/timeline";
import {
  FileMcpRunStore,
  parseMcpRunEnvelopeV0Alpha2,
  TimelineMcpError,
  type McpRunEnvelopeV0Alpha2,
} from "./index.js";
import {
  DEFAULT_MAX_RUN_BYTES,
  DEFAULT_MAX_RUNS,
  MAX_LIST_PAGE_SIZE,
  MAX_MODEL_PROPOSAL_EVENTS,
  MCP_KERNEL_LIMITS,
  MCP_SERVER_VERSION,
  MCP_WRITER_IDENTITY,
} from "./constants.js";
import { correctionEvents, releaseContract } from "./__tests__/fixtures.js";
import { sealVerifiedModelProposalAdmission } from "./model-admission.js";

const directAdmission = {
  authorityId: "operator.test",
  policyRef: "policy:test/v1",
  policyDigest: `sha256:${"a".repeat(64)}`,
} as const;
const modelAdmission = directAdmission;

class TestStore extends FileMcpRunStore {
  override append(
    runId: string,
    draft: unknown,
    expectedRunDigest: string,
    admission: unknown = directAdmission,
  ) {
    return super.append(runId, draft, expectedRunDigest, admission);
  }

  admitCompiled(
    runId: string,
    events: unknown,
    expected: { revision: number; runDigest: string },
    admission: unknown = modelAdmission,
  ) {
    const proposal = {
      schema: "covenant.timeline.model-proposal.v1",
      requestId: "request.store-test",
      changes: [],
      query: {
        type: "consistency",
        targetHandle: "actual",
        knowledgeCut: { type: "current" },
      },
    } as const;
    const candidateEvents = events as readonly TemporalEventV0Alpha3[];
    const candidate = {
      schema: "covenant.timeline.model-proposal-candidate.v1",
      requestId: proposal.requestId,
      baseRunDigest: expected.runDigest,
      proposalDigest: contentDigest(proposal as unknown as JsonValue),
      candidateEvents,
      candidateQuery: {
        schema: "covenant.timeline.query.v0alpha3",
        id: "query.store-test",
        contextId: "actual",
        recordedThrough: null,
        type: "context.consistency",
      },
      provenance: candidateEvents.map(({ id }) => ({
        candidateEventId: id,
        evidenceRefs: [],
        supports: [],
      })),
    } as TemporalModelProposalCandidateV1;
    const permit = sealVerifiedModelProposalAdmission(
      runId,
      candidate,
      proposal,
      expected,
    );
    return super.admitVerifiedModelProposal(permit, admission);
  }
}

describe("FileMcpRunStore", () => {
  let directory: string;
  let store: TestStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "timeline-mcp-store-"));
    store = new TestStore(directory);
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
    expect(created.envelope.admissions).toEqual([]);

    const loaded = await new FileMcpRunStore(directory).require(contract.id);
    expect(loaded).toEqual(created.envelope);
    expect(await store.list()).toEqual([
      {
        runId: contract.id,
        revision: 0,
        auditDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        subject: contract.subject,
        contexts: contract.contexts,
        eventCount: 0,
        admissionCount: 0,
        latestRecordedThrough: null,
        runDigest: created.envelope.runDigest,
      },
    ]);

    const reopened = await store.create(contract);
    expect(reopened.created).toBe(false);
    expect(reopened.envelope).toEqual(created.envelope);
  });

  test("snapshots a contract before the first filesystem await", async () => {
    const contract = structuredClone(releaseContract());
    const runId = contract.id;

    const pending = store.create(contract);
    contract.id = "agent.mutated";

    const created = await pending;
    expect(created.envelope.runId).toBe(runId);
    expect(created.envelope.run.contract.id).toBe(runId);
    expect(await store.require(runId)).toEqual(created.envelope);
    expect(await store.load(contract.id)).toBeUndefined();
  });

  test("snapshots an event and admission before the first filesystem await", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const fixture = correctionEvents[0];
    if (!fixture || fixture.type !== "point.declared") {
      throw new Error("correction fixture must begin with a point declaration");
    }
    const draft = structuredClone(fixture);
    const admission: {
      authorityId: string;
      policyRef: string;
      policyDigest: string;
    } = { ...directAdmission };
    const pointId = draft.point.id;

    const pending = store.append(
      contract.id,
      draft,
      created.envelope.runDigest,
      admission,
    );
    draft.point.id = "point.mutated";
    admission.authorityId = "INVALID";

    const appended = await pending;
    expect(appended.event).toMatchObject({ point: { id: pointId } });
    expect(appended.admissionRecord.authorityId).toBe(
      directAdmission.authorityId,
    );
    expect(await store.require(contract.id)).toEqual(appended.envelope);
  });

  test("rejects missing or forged model admission capabilities before filesystem access", async () => {
    const untouched = join(directory, "untouched");
    const rawStore = new FileMcpRunStore(untouched);

    expect("admitCompiled" in rawStore).toBe(false);
    await expect(
      rawStore.admitVerifiedModelProposal(undefined, directAdmission),
    ).rejects.toMatchObject({ code: "timeline.mcp.input.invalid" });
    await expect(
      rawStore.admitVerifiedModelProposal(
        {
          artifact: {
            runId: "../../forged",
            events: [],
            exactPrefix: { revision: 0, runDigest: "not-a-digest" },
          },
        },
        directAdmission,
      ),
    ).rejects.toMatchObject({ code: "timeline.mcp.input.invalid" });
    await expect(stat(untouched)).rejects.toMatchObject({ code: "ENOENT" });
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

    await expect(
      store.append(
        contract.id,
        correctionEvents[0],
        created.envelope.runDigest,
        { ...directAdmission, policyRef: "policy:test/v2" },
      ),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });

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

    const applied = await store.admitCompiled(contract.id, batch, {
      revision: 0,
      runDigest: created.envelope.runDigest,
    });
    expect(applied).toMatchObject({
      admissionStatus: "admitted",
      events: [{ sequence: 0 }, { sequence: 1 }],
      envelope: { revision: 2 },
    });

    const later = await store.append(
      contract.id,
      correctionEvents[2],
      applied.envelope.runDigest,
    );
    const retried = await store.admitCompiled(contract.id, batch, {
      revision: 0,
      runDigest: created.envelope.runDigest,
    });
    expect(retried.admissionStatus).toBe("already-admitted");
    expect(retried.events).toEqual(batch);
    expect(retried.envelope).toEqual(later.envelope);
    await expect(
      store.admitCompiled(
        contract.id,
        batch,
        { revision: 0, runDigest: created.envelope.runDigest },
        { ...modelAdmission, authorityId: "operator.different" },
      ),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });
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
      store.admitCompiled(contract.id, batch, {
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
      store.admitCompiled(contract.id, changed, {
        revision: 0,
        runDigest: created.envelope.runDigest,
      }),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });

    const reordered = [
      { ...batch[1]!, sequence: 0 },
      { ...batch[0]!, sequence: 1 },
    ];
    await expect(
      store.admitCompiled(contract.id, reordered, {
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
      store.admitCompiled(contract.id, colliding, {
        revision: 1,
        runDigest: current.runDigest,
      }),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });

    await expect(
      store.admitCompiled(contract.id, [], {
        revision: 0,
        runDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "timeline.mcp.store.conflict" });
    await expect(
      store.admitCompiled(contract.id, [], {
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
      store.admitCompiled(contract.id, events, {
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
      store.admitCompiled(contract.id, first, expected),
      store.admitCompiled(contract.id, second, expected),
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
    const empty = await store.admitCompiled(contract.id, [], {
      revision: 0,
      runDigest: created.envelope.runDigest,
    });
    expect(empty).toMatchObject({
      admissionStatus: "empty-candidate",
      events: [],
      envelope: { revision: 0 },
    });

    await expect(
      store.admitCompiled(
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
    const limited = new TestStore(directory, { maxRuns: 1 });
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
      '{"admissions":',
      '{"schema":"covenant.timeline.mcp-run.v0alpha2","admissions":',
    );
    await writeFile(path, duplicate);
    await expect(store.require(contract.id)).rejects.toMatchObject({
      code: "timeline.mcp.store.corrupt",
    });
  });

  test("rejects every stored envelope identity invariant", async () => {
    const created = await store.create(releaseContract());
    const appended = await store.append(
      created.envelope.runId,
      correctionEvents[0],
      created.envelope.runDigest,
    );
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
        record((value.admissions as unknown[])[0]).policyDigest =
          `sha256:${"0".repeat(64)}`;
      },
      (value) => {
        value.admissions = [];
      },
      (value) => {
        record((value.admissions as unknown[])[0]).eventIds = [
          "event.different",
        ];
      },
      (value) => {
        record(value.lastWriter).serverVersion = "unrecognized";
      },
      (value) => {
        record(value.lastWriter).serverVersion = "0.0.0-alpha.2";
      },
      (value) => {
        record(
          record((value.admissions as unknown[])[0]).writer,
        ).serverVersion = "0.0.0-alpha.2";
      },
      (value) => {
        record(
          record((value.admissions as unknown[])[0]).writer,
        ).serverVersion = "unrecognized";
      },
      (value) => {
        record(record(value.run).contract).id = "different.run";
      },
      (value) => {
        value.revision = 2;
      },
      (value) => {
        value.runDigest = `sha256:${"0".repeat(64)}`;
      },
    ];

    for (const mutate of mutations) {
      const value = structuredClone(appended.envelope) as unknown as Record<
        string,
        unknown
      >;
      mutate(value);
      expect(() => parseMcpRunEnvelopeV0Alpha2(value)).toThrowError(
        expect.objectContaining({ code: "timeline.mcp.store.corrupt" }),
      );
    }
    expect(() => parseMcpRunEnvelopeV0Alpha2(null)).toThrowError(
      expect.objectContaining({ code: "timeline.mcp.store.corrupt" }),
    );
  });

  test("preserves compatible last-writer versions across process upgrades", async () => {
    const created = await store.create(releaseContract());
    const value = structuredClone(created.envelope);
    value.lastWriter.serverVersion = "0.0.0-alpha.2";

    expect(parseMcpRunEnvelopeV0Alpha2(value).lastWriter).toEqual({
      ...created.envelope.lastWriter,
      serverVersion: "0.0.0-alpha.2",
    });
  });

  test("validates incremental prefix digests against canonical run prefixes", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    let current = created.envelope;
    for (const event of correctionEvents.slice(0, 4)) {
      current = (await store.append(contract.id, event, current.runDigest))
        .envelope;
    }

    const loaded = await store.require(contract.id);
    expect(loaded.admissions.map(({ baseRunDigest }) => baseRunDigest)).toEqual(
      loaded.run.events.map((_, revision) =>
        contentDigest({
          schema: loaded.run.schema,
          contract: loaded.run.contract,
          events: loaded.run.events.slice(0, revision),
        } as unknown as JsonValue),
      ),
    );
  });

  test("validates the supported direct-admission ceiling", () => {
    const envelope = directAdmissionEnvelope(MCP_KERNEL_LIMITS.maxEvents);
    expect(
      Buffer.byteLength(canonicalJson(envelope as unknown as JsonValue)),
    ).toBeLessThanOrEqual(DEFAULT_MAX_RUN_BYTES);
    const parsed = parseMcpRunEnvelopeV0Alpha2(envelope);

    expect(parsed.revision).toBe(MCP_KERNEL_LIMITS.maxEvents);
    expect(parsed.admissions).toHaveLength(MCP_KERNEL_LIMITS.maxEvents);
  });

  test("retries a direct admission without replacing its original writer", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const appended = await store.append(
      contract.id,
      correctionEvents[0],
      created.envelope.runDigest,
    );
    const historical = withWriterVersion(appended.envelope, "0.0.0-alpha.2");
    await writeFile(
      await storedPath(directory),
      `${canonicalJson(historical as unknown as JsonValue)}\n`,
    );

    const retried = await store.append(
      contract.id,
      correctionEvents[0],
      created.envelope.runDigest,
    );
    expect(retried.appended).toBe(false);
    expect(retried.admissionRecord.writer.serverVersion).toBe("0.0.0-alpha.2");
    expect(retried.envelope.lastWriter.serverVersion).toBe("0.0.0-alpha.2");

    const later = await store.append(
      contract.id,
      correctionEvents[1],
      retried.envelope.runDigest,
    );
    expect(
      later.envelope.admissions.map(({ writer }) => writer.serverVersion),
    ).toEqual(["0.0.0-alpha.2", MCP_SERVER_VERSION]);
    expect(later.envelope.lastWriter.serverVersion).toBe(MCP_SERVER_VERSION);
  });

  test("retries a model admission without replacing its original writer", async () => {
    const contract = releaseContract();
    const created = await store.create(contract);
    const batch = materializeEvents(correctionEvents.slice(0, 2), 0);
    const admitted = await store.admitCompiled(
      contract.id,
      batch,
      { revision: 0, runDigest: created.envelope.runDigest },
      modelAdmission,
    );
    const historical = withWriterVersion(admitted.envelope, "0.0.0-alpha.2");
    await writeFile(
      await storedPath(directory),
      `${canonicalJson(historical as unknown as JsonValue)}\n`,
    );

    const empty = await store.admitCompiled(
      contract.id,
      [],
      { revision: historical.revision, runDigest: historical.runDigest },
      modelAdmission,
    );
    expect(empty.envelope.lastWriter.serverVersion).toBe("0.0.0-alpha.2");

    const retried = await store.admitCompiled(
      contract.id,
      batch,
      { revision: 0, runDigest: created.envelope.runDigest },
      modelAdmission,
    );
    expect(retried.admissionStatus).toBe("already-admitted");
    expect(retried.admissionRecord?.writer.serverVersion).toBe("0.0.0-alpha.2");
    expect(retried.envelope.lastWriter.serverVersion).toBe("0.0.0-alpha.2");
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

function withWriterVersion(
  envelope: McpRunEnvelopeV0Alpha2,
  serverVersion: string,
): McpRunEnvelopeV0Alpha2 {
  const value = structuredClone(envelope);
  value.lastWriter.serverVersion = serverVersion;
  value.admissions = value.admissions.map((admission) => {
    const writer = { ...admission.writer, serverVersion };
    const { recordDigest: _, ...unsigned } = { ...admission, writer };
    return {
      ...unsigned,
      recordDigest: contentDigest(unsigned as unknown as JsonValue),
    };
  });
  return value;
}

function directAdmissionEnvelope(eventCount: number): McpRunEnvelopeV0Alpha2 {
  const contract = releaseContract("agent.admission-ceiling");
  const events: TemporalEventV0Alpha3[] = [
    {
      schema: "covenant.timeline.event.v0alpha3",
      sequence: 0,
      id: "event.point",
      type: "point.declared",
      point: {
        id: "point",
        contextId: "actual",
        axisId: "utc-seconds",
      },
    },
  ];
  const assertionCount = Math.min(
    eventCount - events.length,
    MCP_KERNEL_LIMITS.maxAssertions,
  );
  for (let index = 0; index < assertionCount; index += 1) {
    events.push({
      schema: "covenant.timeline.event.v0alpha3",
      sequence: events.length,
      id: `event.assertion-${index}`,
      type: "coordinate.asserted",
      assertion: {
        id: `assertion-${index}`,
        contextId: "actual",
        pointId: "point",
        coordinate: { minimum: index, maximum: index },
        evidenceRefs: [directAdmission.policyDigest],
      },
    });
  }
  while (events.length < eventCount) {
    const assertionIndex = events.length - assertionCount - 1;
    events.push({
      schema: "covenant.timeline.event.v0alpha3",
      sequence: events.length,
      id: `event.retraction-${assertionIndex}`,
      type: "assertion.retracted",
      assertionId: `assertion-${assertionIndex}`,
      evidenceRefs: [directAdmission.policyDigest],
    });
  }

  const run = {
    schema: "covenant.timeline.run.v0alpha3" as const,
    contract,
    events,
  };
  const prefixHash = createHash("sha256")
    .update('{"contract":')
    .update(canonicalJson(contract as unknown as JsonValue))
    .update(',"events":[');
  const admissions = events.map((event, revision) => {
    const unsigned = {
      schema: "covenant.timeline.mcp-admission.v0alpha1" as const,
      kind: "direct-event" as const,
      decision: "admitted" as const,
      ...directAdmission,
      writer: MCP_WRITER_IDENTITY,
      baseRevision: revision,
      baseRunDigest:
        `sha256:${prefixHash.copy().update('],"schema":"covenant.timeline.run.v0alpha3"}').digest("hex")}` as const,
      eventIds: [event.id],
    };
    if (revision > 0) prefixHash.update(",");
    prefixHash.update(canonicalJson(event as unknown as JsonValue));
    return {
      ...unsigned,
      recordDigest: contentDigest(unsigned as unknown as JsonValue),
    };
  });

  return {
    schema: "covenant.timeline.mcp-run.v0alpha2",
    runId: contract.id,
    revision: events.length,
    runDigest: contentDigest(run as unknown as JsonValue),
    admissions,
    lastWriter: MCP_WRITER_IDENTITY,
    run,
  };
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

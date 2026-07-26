import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileRunArchiveStore,
  TimelineArchiveError,
  createPortableRunArchive,
  evaluateRunDocumentV0Alpha2,
  type TimelineRunDocumentV0Alpha2,
} from "../index.js";

const directories: string[] = [];
const run: TimelineRunDocumentV0Alpha2 = {
  schema: "covenant.timeline.run.v0alpha2",
  runId: "archive.restart",
  contract: {
    schema: "covenant.timeline.contract.v0alpha2",
    id: "archive.contract",
    subject: { kind: "repository", id: "example/service" },
    checkpoints: [
      {
        id: "complete",
        requirements: ["archive.complete"],
        policy: {
          profile: "archive.profile.v1",
          policyRef: "archive.policy.v1",
          policyDigest:
            "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        },
      },
    ],
  },
  events: [],
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("portable run archive", () => {
  it("continues from contract and events after replacing the store instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-archive-"));
    directories.push(directory);
    await new FileRunArchiveStore(directory).save(
      createPortableRunArchive(run),
    );

    const loaded = await new FileRunArchiveStore(directory).load(run.runId);
    expect(loaded?.stateDigest).toBe(
      evaluateRunDocumentV0Alpha2(run).stateDigest,
    );

    const continued = {
      ...loaded!.run,
      events: [
        {
          schema: "covenant.timeline.event.v0alpha2" as const,
          id: "event-0",
          sequence: 0,
          type: "evidence.recorded" as const,
          evidence: {
            id: "archive",
            kind: "archive",
            claims: ["archive.complete"],
            payloadDigest:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
            producer: "archive-store",
            authority: {
              ...run.contract.checkpoints[0]!.policy,
              proofDigest:
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
            },
          },
        },
      ],
    };
    await new FileRunArchiveStore(directory).save(
      createPortableRunArchive(continued),
    );
    expect(
      (await new FileRunArchiveStore(directory).load(run.runId))?.run.events,
    ).toHaveLength(1);
  });

  it("rejects a substituted state digest", async () => {
    await expect(
      new FileRunArchiveStore("archive").save({
        ...createPortableRunArchive(run),
        stateDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).rejects.toThrow(TimelineArchiveError);
  });

  it("rejects stale optimistic writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-archive-"));
    directories.push(directory);
    const store = new FileRunArchiveStore(directory);
    const initialArchive = createPortableRunArchive(run);
    await store.save(initialArchive);
    const changedArchive = createPortableRunArchive({
      ...run,
      events: [
        {
          schema: "covenant.timeline.event.v0alpha2",
          id: "event-0",
          sequence: 0,
          type: "evidence.recorded",
          evidence: {
            id: "archive",
            kind: "archive",
            claims: ["archive.complete"],
            payloadDigest:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            producer: "archive-store",
            authority: {
              ...run.contract.checkpoints[0]!.policy,
              proofDigest:
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
          },
        },
      ],
    });
    await store.save(changedArchive, {
      expectedStateDigest: initialArchive.stateDigest,
    });

    await expect(
      store.save(initialArchive, {
        expectedStateDigest: initialArchive.stateDigest,
      }),
    ).rejects.toThrow(/state changed/);
  });

  it("bounds archive reads and writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timeline-archive-"));
    directories.push(directory);
    const archive = createPortableRunArchive(run);
    await new FileRunArchiveStore(directory).save(archive);

    await expect(
      new FileRunArchiveStore(directory, { maxBytes: 1 }).load(run.runId),
    ).rejects.toThrow(/exceeds 1 bytes/);
    await expect(
      new FileRunArchiveStore(directory, { maxBytes: 1 }).save(archive),
    ).rejects.toThrow(/exceeds 1 bytes/);
    expect(() => new FileRunArchiveStore(directory, { maxBytes: 0 })).toThrow(
      RangeError,
    );
  });
});

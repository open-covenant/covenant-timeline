import { describe, expect, it } from "vitest";
import {
  TimelineInputError,
  createRun,
  reduceRun,
  replay,
  validateCommand,
  verifyRun,
  type EvidenceRecorded,
  type ReceiptRecorded,
  type RunEvent,
} from "../index.js";
import { contract } from "./contract.test.js";

const events: readonly RunEvent[] = [
  {
    schema: "covenant.timeline.event.v0alpha1",
    id: "event-0",
    sequence: 0,
    type: "evidence.recorded",
    evidence: {
      id: "ci-42",
      kind: "ci",
      claims: ["ci.tests.pass"],
      payloadDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      producer: "github-actions",
    },
  },
  {
    schema: "covenant.timeline.event.v0alpha1",
    id: "event-1",
    sequence: 1,
    type: "evidence.recorded",
    evidence: {
      id: "review-42",
      kind: "review",
      claims: ["review.approved"],
      payloadDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      producer: "maintainer",
    },
  },
  {
    schema: "covenant.timeline.event.v0alpha1",
    id: "event-2",
    sequence: 2,
    type: "checkpoint.evaluated",
    checkpointId: "release-ready",
    evidenceRefs: ["ci-42", "review-42"],
    policyRef: "software.release.v0",
  },
  {
    schema: "covenant.timeline.event.v0alpha1",
    id: "event-3",
    sequence: 3,
    type: "receipt.recorded",
    receipt: {
      id: "receipt-42",
      commandId: "run-42:release-ready:2",
      status: "succeeded",
      effectDigest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  },
];
const receiptEvent = events[3] as ReceiptRecorded;
const evidenceEvent = events[0] as EvidenceRecorded;

describe("run reducer", () => {
  it("accepts an evidenced checkpoint and joins its effect receipt", () => {
    const state = replay(contract, "run-42", events);

    expect(state.checkpoints["release-ready"]?.decision).toEqual({
      schema: "covenant.timeline.decision.v0alpha1",
      checkpointId: "release-ready",
      outcome: "accepted",
      policyRef: "software.release.v0",
      evidenceRefs: ["ci-42", "review-42"],
      missingRequirements: [],
    });
    expect(verifyRun(state)).toEqual({
      scope: "structural",
      evidenceAuthority: "external",
      effectAuthority: "external",
      ok: true,
      pendingCheckpoints: [],
      rejectedCheckpoints: [],
      unresolvedCommands: [],
      failedCommands: [],
      findings: [],
    });
  });

  it("rejects a checkpoint when evidence does not cover every requirement", () => {
    const state = replay(contract, "run-42", [
      events[0]!,
      { ...events[2]!, sequence: 1, evidenceRefs: ["ci-42"] },
    ]);

    expect(state.checkpoints["release-ready"]?.decision).toMatchObject({
      outcome: "rejected",
      missingRequirements: ["review.approved"],
    });
    expect(verifyRun(state).ok).toBe(false);
  });

  it("reports unknown evidence without inventing a decision", () => {
    const state = replay(contract, "run-42", [
      {
        ...events[2]!,
        sequence: 0,
        evidenceRefs: ["missing"],
      },
    ]);

    expect(state.checkpoints["release-ready"]?.status).toBe("pending");
    expect(state.findings).toEqual([
      {
        code: "timeline.evidence.unknown",
        eventId: "event-2",
        detail: "missing",
      },
    ]);
  });

  it("does not verify a run with a failed effect", () => {
    const state = replay(contract, "run-42", [
      ...events.slice(0, 3),
      {
        schema: "covenant.timeline.event.v0alpha1",
        id: "event-3",
        sequence: 3,
        type: "receipt.recorded",
        receipt: {
          id: "receipt-42",
          commandId: "run-42:release-ready:2",
          status: "failed",
          effectDigest:
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
      },
    ]);

    expect(verifyRun(state)).toMatchObject({
      ok: false,
      failedCommands: ["run-42:release-ready:2"],
    });
  });

  it("does not mutate prior state and enforces stream order", () => {
    const initial = createRun(contract, "run-42");
    const reduced = reduceRun(contract, initial, events[0]!);

    expect(initial.nextSequence).toBe(0);
    expect(initial.evidence).toEqual({});
    expect(reduced.state.nextSequence).toBe(1);
    expect(() => reduceRun(contract, reduced.state, events[0]!)).toThrow(
      RangeError,
    );
  });

  it("replay produces the same state without executing commands", () => {
    expect(replay(contract, "run-42", events)).toEqual(
      replay(contract, "run-42", events),
    );
  });

  it("corrects a rejected checkpoint by appending evidence", () => {
    const state = replay(contract, "run-42", [
      events[0]!,
      { ...events[2]!, sequence: 1, evidenceRefs: ["ci-42"] },
      { ...events[1]!, sequence: 2 },
      {
        ...events[2]!,
        id: "event-3",
        sequence: 3,
        evidenceRefs: ["ci-42", "review-42"],
      },
      {
        ...receiptEvent,
        id: "event-4",
        sequence: 4,
        receipt: {
          ...receiptEvent.receipt,
          commandId: "run-42:release-ready:3",
        },
      },
    ]);

    expect(state.checkpoints["release-ready"]?.status).toBe("accepted");
    expect(verifyRun(state).ok).toBe(true);
  });

  it("records duplicate event and receipt findings", () => {
    const state = replay(contract, "run-42", [
      ...events,
      {
        ...receiptEvent,
        id: "event-3",
        sequence: 4,
      },
      {
        ...receiptEvent,
        id: "event-5",
        sequence: 5,
      },
    ]);

    expect(state.findings.map(({ code }) => code)).toEqual([
      "timeline.event.duplicate",
      "timeline.receipt.duplicate",
    ]);
  });

  it("exposes stable codes for fatal input errors", () => {
    try {
      reduceRun(contract, createRun(contract, "run-42"), {
        ...events[0]!,
        sequence: 1,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TimelineInputError);
      expect((error as TimelineInputError).code).toBe(
        "timeline.event.sequence",
      );
    }
  });

  it("binds incremental state to the exact contract bytes", () => {
    const state = createRun(contract, "run-42");
    const substituted = {
      ...contract,
      checkpoints: [
        {
          ...contract.checkpoints[0]!,
          requirements: ["attacker.asserted"],
        },
      ],
    };

    expect(() => reduceRun(substituted, state, events[0]!)).toThrowError(
      expect.objectContaining({
        code: "timeline.run.contract_mismatch",
      }),
    );
    expect(() => reduceRun(contract, { ...state }, events[0]!)).toThrowError(
      expect.objectContaining({
        code: "timeline.run.contract_mismatch",
      }),
    );
  });

  it("does not emit another command after checkpoint acceptance", () => {
    const repeated = {
      ...events[2]!,
      id: "event-3",
      sequence: 3,
    };
    const state = replay(contract, "run-42", [...events.slice(0, 3), repeated]);

    expect(Object.keys(state.commands)).toEqual(["run-42:release-ready:2"]);
    expect(state.findings).toContainEqual({
      code: "timeline.checkpoint.finalized",
      eventId: "event-3",
      detail: "release-ready",
    });
  });

  it("accepts identifiers that match inherited object property names", () => {
    const event = {
      ...evidenceEvent,
      id: "constructor",
      evidence: { ...evidenceEvent.evidence, id: "constructor" },
    };
    const state = replay(contract, "constructor", [event]);

    expect(state.findings).toEqual([]);
    expect(state.evidence.constructor).toMatchObject({ id: "constructor" });
  });

  it("rejects one receipt identifier reused for another command", () => {
    const twoCheckpoints = {
      ...contract,
      checkpoints: [
        contract.checkpoints[0]!,
        { ...contract.checkpoints[0]!, id: "deploy-ready" },
      ],
    };
    const state = replay(twoCheckpoints, "run-42", [
      events[0]!,
      events[1]!,
      events[2]!,
      {
        ...events[2]!,
        id: "event-3",
        sequence: 3,
        checkpointId: "deploy-ready",
      },
      {
        ...receiptEvent,
        id: "event-4",
        sequence: 4,
      },
      {
        ...receiptEvent,
        id: "event-5",
        sequence: 5,
        receipt: {
          ...receiptEvent.receipt,
          commandId: "run-42:deploy-ready:3",
        },
      },
    ]);

    expect(state.findings).toContainEqual({
      code: "timeline.receipt.id_duplicate",
      eventId: "event-5",
      detail: "receipt-42",
    });
  });

  it("rejects malformed runtime events before reduction", () => {
    expect(() =>
      reduceRun(contract, createRun(contract, "run-42"), {
        ...events[0]!,
        type: "unsupported",
      } as unknown as RunEvent),
    ).toThrowError(expect.objectContaining({ code: "schema.invalid" }));
  });

  it("replays a large evidence stream without quadratic copying", () => {
    const digest =
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    const largeRun = Array.from({ length: 5_000 }, (_, index) => ({
      schema: "covenant.timeline.event.v0alpha1" as const,
      id: `event-${index}`,
      sequence: index,
      type: "evidence.recorded" as const,
      evidence: {
        id: `evidence-${index}`,
        kind: "test",
        claims: ["test.observed"],
        payloadDigest: digest,
        producer: "test",
      },
    }));

    expect(replay(contract, "load-test", largeRun).nextSequence).toBe(5_000);
  });

  it("emits schema-valid commands at maximum run and checkpoint ID lengths", () => {
    const checkpointId = `c${"x".repeat(127)}`;
    const longContract = {
      ...contract,
      checkpoints: [
        {
          id: checkpointId,
          requirements: ["ready"],
          onAccept: contract.checkpoints[0]!.onAccept,
        },
      ],
    };
    const runId = `r${"x".repeat(127)}`;
    const state = replay(longContract, runId, [
      {
        ...evidenceEvent,
        evidence: {
          ...evidenceEvent.evidence,
          claims: ["ready"],
        },
      },
      {
        ...events[2]!,
        sequence: 1,
        checkpointId,
        evidenceRefs: [evidenceEvent.evidence.id],
      },
    ]);
    const command = Object.values(state.commands)[0];

    expect(command?.id.length).toBeGreaterThan(128);
    expect(validateCommand(command)).toEqual([]);
  });
});

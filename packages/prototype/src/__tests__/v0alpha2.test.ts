import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TimelineMigrationError,
  createRunV0Alpha2,
  evaluateRunDocument,
  evaluateRunDocumentV0Alpha2,
  migrateRunV0Alpha1ToV0Alpha2,
  reduceRunV0Alpha2,
  replayV0Alpha2,
  validateContractV0Alpha2,
  validateRunDocumentV0Alpha2,
  verifyRunV0Alpha2,
  type PolicyBindingV0Alpha2,
  type RunEventV0Alpha2,
  type TimelineContractV0Alpha2,
} from "../index.js";

const policy: PolicyBindingV0Alpha2 = {
  profile: "github.software-delivery.v1",
  policyRef: "software.release.v1",
  policyDigest:
    "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
};
const migrationPolicy: PolicyBindingV0Alpha2 = {
  ...policy,
  policyRef: "software.release.v0",
};

const contract: TimelineContractV0Alpha2 = {
  schema: "covenant.timeline.contract.v0alpha2",
  id: "release.v1",
  subject: { kind: "repository", id: "example/service" },
  checkpoints: [
    {
      id: "release-ready",
      requirements: ["ci.tests.pass", "review.approved"],
      policy,
      onAccept: {
        kind: "covenant.capability.request",
        payloadRef: "release.deploy",
      },
    },
  ],
};

const evidence = (
  id: string,
  sequence: number,
  claim: string,
): RunEventV0Alpha2 => ({
  schema: "covenant.timeline.event.v0alpha2",
  id: `event-${sequence}`,
  sequence,
  type: "evidence.recorded",
  evidence: {
    id,
    kind: "github",
    claims: [claim],
    payloadDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    producer: "github-collector",
    authority: {
      ...policy,
      proofDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  },
});

describe("v0alpha2 policy binding", () => {
  it("pins the decision policy to contract bytes", () => {
    const state = replayV0Alpha2(contract, "run-1", [
      evidence("ci", 0, "ci.tests.pass"),
      evidence("review", 1, "review.approved"),
      {
        schema: "covenant.timeline.event.v0alpha2",
        id: "event-2",
        sequence: 2,
        type: "checkpoint.evaluated",
        checkpointId: "release-ready",
        evidenceRefs: ["ci", "review"],
      },
      {
        schema: "covenant.timeline.event.v0alpha2",
        id: "event-3",
        sequence: 3,
        type: "receipt.recorded",
        receipt: {
          id: "receipt-1",
          commandId: "run-1:release-ready:2",
          status: "succeeded",
          effectDigest:
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
      },
    ]);

    expect(state.checkpoints["release-ready"]?.decision?.policy).toEqual(
      policy,
    );
    expect(verifyRunV0Alpha2(state)).toMatchObject({
      ok: true,
      policyAuthority: "contract",
      policyBinding: "contract-digest",
    });
  });

  it("fails closed when evidence carries another policy digest", () => {
    const first = evidence("ci", 0, "ci.tests.pass");
    if (first.type !== "evidence.recorded") throw new Error("invalid fixture");
    const state = replayV0Alpha2(contract, "run-1", [
      {
        ...first,
        evidence: {
          ...first.evidence,
          authority: {
            ...first.evidence.authority,
            policyDigest:
              "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          },
        },
      },
      {
        schema: "covenant.timeline.event.v0alpha2",
        id: "event-1",
        sequence: 1,
        type: "checkpoint.evaluated",
        checkpointId: "release-ready",
        evidenceRefs: ["ci"],
      },
    ]);

    expect(state.checkpoints["release-ready"]?.status).toBe("pending");
    expect(state.findings).toEqual([
      {
        code: "timeline.evidence.policy_mismatch",
        eventId: "event-1",
        detail: "ci",
      },
    ]);
  });

  it("requires every checkpoint to pin a policy digest", () => {
    const issues = validateContractV0Alpha2({
      ...contract,
      checkpoints: [{ id: "release-ready", requirements: ["ready"] }],
    });

    expect(issues).toContainEqual({
      path: "checkpoints[0].policy",
      message: "must be an object",
    });
  });

  it("validates bounded extensions and nested contract values", () => {
    expect(
      validateContractV0Alpha2({
        ...contract,
        subject: null,
        checkpoints: [null],
        extensions: null,
      }),
    ).toEqual(
      expect.arrayContaining([
        { path: "subject", message: "must be an object" },
        { path: "checkpoints[0]", message: "must be an object" },
        { path: "extensions", message: "must be an object" },
      ]),
    );

    const issues = validateContractV0Alpha2({
      ...contract,
      checkpoints: [
        ...contract.checkpoints,
        { ...contract.checkpoints[0], id: "second", onAccept: null },
      ],
      extensions: {
        required: [
          "https://example.com/extension",
          "https://example.com/extension",
          "not-an-uri",
        ],
        optional: { "not-an-uri": true },
      },
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        {
          path: "checkpoints[1].onAccept",
          message: "must be an object",
        },
        {
          path: "extensions.required[0]",
          message: "required extension is not supported",
        },
        {
          path: "extensions.required[1]",
          message: "must be unique",
        },
        {
          path: "extensions.required[2]",
          message: "must be an absolute URI",
        },
        {
          path: "extensions.optional.not-an-uri",
          message: "property name must be an absolute URI",
        },
      ]),
    );
    expect(
      validateContractV0Alpha2(
        {
          ...contract,
          checkpoints: contract.checkpoints.concat(contract.checkpoints),
        },
        { maxCheckpoints: 1 },
      ),
    ).toContainEqual({
      path: "checkpoints",
      message: "must contain at most 1 checkpoints",
    });
  });

  it("fails closed across incremental and adverse replay paths", () => {
    expect(() => createRunV0Alpha2(contract, "INVALID")).toThrow(/runId/);
    expect(() =>
      replayV0Alpha2(
        contract,
        "run-1",
        [
          evidence("ci", 0, "ci.tests.pass"),
          evidence("review", 1, "review.approved"),
        ],
        { maxEvents: 1 },
      ),
    ).toThrow(/exceeds/);

    const prior = createRunV0Alpha2(contract, "run-1");
    const reduced = reduceRunV0Alpha2(
      contract,
      prior,
      evidence("ci", 0, "ci.tests.pass"),
    );
    expect(prior.nextSequence).toBe(0);
    expect(reduced.state.evidence).toHaveProperty("ci");
    expect(() =>
      reduceRunV0Alpha2(
        contract,
        { ...prior },
        evidence("ci", 0, "ci.tests.pass"),
      ),
    ).toThrow(/exact contract bytes/);
    expect(() =>
      reduceRunV0Alpha2(
        { ...contract, subject: { ...contract.subject, id: "example/other" } },
        prior,
        evidence("ci", 0, "ci.tests.pass"),
      ),
    ).toThrow(/exact contract bytes/);
    expect(() =>
      reduceRunV0Alpha2(contract, prior, evidence("ci", 1, "ci.tests.pass")),
    ).toThrow(/does not match/);

    const duplicateEvent = replayV0Alpha2(contract, "run-1", [
      evidence("ci", 0, "ci.tests.pass"),
      { ...evidence("review", 1, "review.approved"), id: "event-0" },
    ]);
    expect(duplicateEvent.findings[0]?.code).toBe("timeline.event.duplicate");

    const duplicateEvidence = replayV0Alpha2(contract, "run-1", [
      evidence("ci", 0, "ci.tests.pass"),
      evidence("ci", 1, "review.approved"),
    ]);
    expect(duplicateEvidence.findings[0]?.code).toBe(
      "timeline.evidence.duplicate",
    );

    const unknownCheckpoint = replayV0Alpha2(contract, "run-1", [
      evaluation(0, "unknown", []),
    ]);
    expect(unknownCheckpoint.findings[0]?.code).toBe(
      "timeline.checkpoint.unknown",
    );

    const unknownEvidence = replayV0Alpha2(contract, "run-1", [
      evaluation(0, "release-ready", ["missing"]),
    ]);
    expect(unknownEvidence.findings[0]?.code).toBe("timeline.evidence.unknown");

    const rejected = replayV0Alpha2(contract, "run-1", [
      evaluation(0, "release-ready", []),
    ]);
    expect(rejected.checkpoints["release-ready"]?.status).toBe("rejected");
    expect(verifyRunV0Alpha2(rejected).rejectedCheckpoints).toEqual([
      "release-ready",
    ]);

    const accepted = [
      evidence("ci", 0, "ci.tests.pass"),
      evidence("review", 1, "review.approved"),
      evaluation(2, "release-ready", ["ci", "review"]),
    ] satisfies RunEventV0Alpha2[];
    const unresolved = replayV0Alpha2(contract, "run-1", accepted);
    expect(verifyRunV0Alpha2(unresolved).unresolvedCommands).toEqual([
      "run-1:release-ready:2",
    ]);

    const failed = replayV0Alpha2(contract, "run-1", [
      ...accepted,
      receipt(3, "receipt-1", "run-1:release-ready:2", "failed"),
    ]);
    expect(verifyRunV0Alpha2(failed).failedCommands).toEqual([
      "run-1:release-ready:2",
    ]);

    const finalized = replayV0Alpha2(contract, "run-1", [
      ...accepted,
      evaluation(3, "release-ready", ["ci", "review"]),
    ]);
    expect(finalized.findings[0]?.code).toBe("timeline.checkpoint.finalized");

    const unknownCommand = replayV0Alpha2(contract, "run-1", [
      receipt(0, "receipt-1", "missing-command", "succeeded"),
    ]);
    expect(unknownCommand.findings[0]?.code).toBe("timeline.command.unknown");

    const duplicateReceipt = replayV0Alpha2(contract, "run-1", [
      ...accepted,
      receipt(3, "receipt-1", "run-1:release-ready:2", "succeeded"),
      receipt(4, "receipt-2", "run-1:release-ready:2", "succeeded"),
    ]);
    expect(duplicateReceipt.findings[0]?.code).toBe(
      "timeline.receipt.duplicate",
    );
  });

  it("migrates v0alpha1 without changing historical replay", () => {
    const source = JSON.parse(
      readFileSync("../../conformance/v0alpha1/runs/successful.json", "utf8"),
    ) as unknown;
    const before = evaluateRunDocument(source);
    const migrated = migrateRunV0Alpha1ToV0Alpha2(source, {
      policies: { "release-ready": migrationPolicy },
    });
    const after = evaluateRunDocumentV0Alpha2(migrated);

    expect(before.schema).toBe("covenant.timeline.report.v0alpha1");
    expect(before.stateDigest).toBe(
      "sha256:8b65911cc4907e5939ae955728e9b5b38d6df8f6fc08966fe03ff588d3f2fe06",
    );
    expect(validateRunDocumentV0Alpha2(migrated)).toEqual([]);
    expect(after.verification.ok).toBe(true);
  });

  it("refuses migration when an event label conflicts with the binding", () => {
    const source = JSON.parse(
      readFileSync("../../conformance/v0alpha1/runs/successful.json", "utf8"),
    ) as unknown;

    expect(() =>
      migrateRunV0Alpha1ToV0Alpha2(source, {
        policies: {
          "release-ready": { ...policy, policyRef: "another.policy" },
        },
      }),
    ).toThrow(TimelineMigrationError);
  });

  it("validates migration options without inherited-property ambiguity", () => {
    const source = JSON.parse(
      readFileSync("../../conformance/v0alpha1/runs/successful.json", "utf8"),
    ) as {
      contract: { checkpoints: { id: string }[] };
      events: { type: string; checkpointId?: string }[];
    };

    expect(() =>
      migrateRunV0Alpha1ToV0Alpha2(
        source,
        null as unknown as { policies: Record<string, PolicyBindingV0Alpha2> },
      ),
    ).toThrow(TimelineMigrationError);
    expect(() =>
      migrateRunV0Alpha1ToV0Alpha2(source, {
        policies: {
          "release-ready": migrationPolicy,
          unknown: migrationPolicy,
        },
      }),
    ).toThrow(/unknown checkpoint/);

    source.contract.checkpoints[0]!.id = "constructor";
    for (const event of source.events) {
      if (event.type === "checkpoint.evaluated") {
        event.checkpointId = "constructor";
      }
    }
    const policies = Object.assign(
      Object.create(null) as Record<string, PolicyBindingV0Alpha2>,
      { constructor: migrationPolicy },
    );
    expect(
      migrateRunV0Alpha1ToV0Alpha2(source, { policies }).contract.checkpoints[0]
        ?.id,
    ).toBe("constructor");
  });
});

function evaluation(
  sequence: number,
  checkpointId: string,
  evidenceRefs: string[],
): RunEventV0Alpha2 {
  return {
    schema: "covenant.timeline.event.v0alpha2",
    id: `event-${sequence}`,
    sequence,
    type: "checkpoint.evaluated",
    checkpointId,
    evidenceRefs,
  };
}

function receipt(
  sequence: number,
  id: string,
  commandId: string,
  status: "succeeded" | "failed" | "indeterminate",
): RunEventV0Alpha2 {
  return {
    schema: "covenant.timeline.event.v0alpha2",
    id: `event-${sequence}`,
    sequence,
    type: "receipt.recorded",
    receipt: {
      id,
      commandId,
      status,
      effectDigest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  };
}

import { describe, expect, it } from "vitest";
import {
  TimelineContractError,
  createRun,
  validateContract,
  type TimelineContract,
} from "../index.js";

export const contract: TimelineContract = {
  schema: "covenant.timeline.contract.v0alpha1",
  id: "release.v0",
  subject: {
    kind: "repository",
    id: "example/service",
  },
  checkpoints: [
    {
      id: "release-ready",
      requirements: ["ci.tests.pass", "review.approved"],
      onAccept: {
        kind: "covenant.capability.request",
        payloadRef: "release.deploy",
      },
    },
  ],
};

describe("validateContract", () => {
  it("accepts a portable software-work contract", () => {
    expect(validateContract(contract)).toEqual([]);
  });

  it("rejects duplicate checkpoints and empty requirements", () => {
    const issues = validateContract({
      ...contract,
      checkpoints: [
        { id: "release-ready", requirements: [] },
        { id: "release-ready", requirements: ["Review Approved"] },
      ],
    });

    expect(issues.map(({ path }) => path)).toEqual([
      "checkpoints[0].requirements",
      "checkpoints[1].id",
      "checkpoints[1].requirements[0]",
    ]);
  });

  it("refuses to create a run from an invalid contract", () => {
    expect(() => createRun({ ...contract, checkpoints: [] }, "run-1")).toThrow(
      TimelineContractError,
    );
  });
});

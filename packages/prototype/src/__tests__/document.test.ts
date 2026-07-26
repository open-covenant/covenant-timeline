import { describe, expect, it } from "vitest";
import {
  TimelineDocumentError,
  evaluateRunDocument,
  parseRunDocument,
  validateRunDocument,
  type TimelineRunDocument,
} from "../index.js";
import { contract } from "./contract.test.js";

const run: TimelineRunDocument = {
  schema: "covenant.timeline.run.v0alpha1",
  runId: "run-42",
  contract,
  events: [
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
  ],
};

describe("portable run document", () => {
  it("validates and parses an incomplete run", () => {
    expect(validateRunDocument(run)).toEqual([]);
    expect(parseRunDocument(run)).toBe(run);
    expect(evaluateRunDocument(run).verification).toMatchObject({
      evaluation: "requirement-coverage",
      policyAuthority: "external",
      policyBinding: "unverified-event-label",
      ok: false,
      pendingCheckpoints: ["release-ready"],
    });
  });

  it("rejects gaps and duplicate event identifiers", () => {
    const invalid = {
      ...run,
      events: [
        run.events[0]!,
        {
          ...run.events[0]!,
          sequence: 2,
        },
      ],
    };

    expect(validateRunDocument(invalid)).toEqual(
      expect.arrayContaining([
        {
          path: "events[1].sequence",
          message: "must equal 1",
        },
        {
          path: "events[1].id",
          message: "must be unique within the run",
        },
      ]),
    );
    expect(() => parseRunDocument(invalid)).toThrow(TimelineDocumentError);
  });

  it("produces byte-stable replay reports", () => {
    expect(evaluateRunDocument(run)).toEqual(evaluateRunDocument(run));
  });

  it("enforces configurable implementation limits", () => {
    const issues = validateRunDocument(
      { ...run, events: [run.events[0]!, { ...run.events[0]!, sequence: 1 }] },
      { maxEvents: 1 },
    );

    expect(issues).toContainEqual({
      path: "events",
      message: "event count must not exceed 1",
    });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateRunDocumentV0Alpha2,
  parseContractV0Alpha2,
  parseRunDocumentV0Alpha2,
  validateCommandV0Alpha2,
  validateContractV0Alpha2,
  validateDecisionV0Alpha2,
  validateEvidenceV0Alpha2,
  validateEventV0Alpha2,
  validatePortableDocumentV0Alpha2,
  validateReceiptV0Alpha2,
  validateRunDocumentV0Alpha2,
} from "../index.js";

const root = "../../conformance/v0alpha2";
const cases = JSON.parse(
  readFileSync(join(root, "cases.json"), "utf8"),
) as DocumentCase[];
const runCases = JSON.parse(
  readFileSync(join(root, "run-cases.json"), "utf8"),
) as RunCase[];
const validators: Record<
  string,
  (value: unknown) => readonly { path: string; message: string }[]
> = {
  "command.schema.json": validateCommandV0Alpha2,
  "contract.schema.json": validateContractV0Alpha2,
  "decision.schema.json": validateDecisionV0Alpha2,
  "evidence.schema.json": validateEvidenceV0Alpha2,
  "event.schema.json": validateEventV0Alpha2,
  "receipt.schema.json": validateReceiptV0Alpha2,
  "run.schema.json": validateRunDocumentV0Alpha2,
};

describe("v0alpha2 conformance corpus", () => {
  for (const testCase of cases) {
    it(testCase.id, () => {
      const schemaName = testCase.targetSchema.split("/").at(-1);
      if (!schemaName) throw new Error("case has no schema name");
      const validate = validators[schemaName];
      if (!validate) throw new Error(`missing validator for ${schemaName}`);

      expect(validate(testCase.document).length === 0).toBe(
        testCase.expect.valid,
      );
    });
  }

  for (const testCase of runCases) {
    it(testCase.id, () => {
      const run = JSON.parse(
        readFileSync(join(root, testCase.file), "utf8"),
      ) as unknown;
      const report = evaluateRunDocumentV0Alpha2(run);

      expect(report.verification.ok).toBe(testCase.expect.ok);
      expect(report.stateDigest).toBe(testCase.expect.stateDigest);
      expect(report.state.checkpoints["release-ready"]?.status).toBe(
        testCase.expect.checkpoint,
      );
      if (testCase.expect.finding) {
        expect(report.state.findings).toContainEqual(
          expect.objectContaining({ code: testCase.expect.finding }),
        );
      }
    });
  }

  it("dispatches and parses every portable document kind", () => {
    const valid = new Map<string, unknown>();
    for (const testCase of cases) {
      if (
        testCase.expect.valid &&
        !valid.has(testCase.targetSchema) &&
        testCase.targetSchema.split("/").at(-1) !== "evidence.schema.json" &&
        testCase.targetSchema.split("/").at(-1) !== "receipt.schema.json"
      ) {
        valid.set(testCase.targetSchema, testCase.document);
      }
    }

    for (const document of valid.values()) {
      expect(validatePortableDocumentV0Alpha2(document)).toEqual([]);
    }
    expect(validatePortableDocumentV0Alpha2({ schema: "unknown" })).toEqual([
      { path: "schema", message: "must identify a v0alpha2 document" },
    ]);
    expect(validatePortableDocumentV0Alpha2(null)).toEqual([
      { path: "$", message: "must be an object" },
    ]);

    const contract = valid.get(
      "https://covenant-timeline.org/schemas/v0alpha2/contract.schema.json",
    );
    const run = valid.get(
      "https://covenant-timeline.org/schemas/v0alpha2/run.schema.json",
    );
    expect(parseContractV0Alpha2(contract).schema).toBe(
      "covenant.timeline.contract.v0alpha2",
    );
    expect(parseRunDocumentV0Alpha2(run).schema).toBe(
      "covenant.timeline.run.v0alpha2",
    );
    expect(() => parseContractV0Alpha2(null)).toThrow();
    expect(() => parseRunDocumentV0Alpha2(null)).toThrow();
  });
});

interface DocumentCase {
  id: string;
  targetSchema: string;
  document: unknown;
  expect: { valid: boolean };
}

interface RunCase {
  id: string;
  file: string;
  expect: {
    ok: boolean;
    checkpoint: string;
    finding?: string;
    stateDigest: string;
  };
}

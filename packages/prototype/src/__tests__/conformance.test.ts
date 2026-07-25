import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateCommand,
  validateContract,
  validateDecision,
  validateEvidence,
  validateEvent,
  validateReceipt,
  validateRunDocument,
} from "../index.js";

interface ConformanceCase {
  id: string;
  targetSchema: string;
  document: unknown;
  expect: { valid: boolean };
}

const validators = new Map<string, (value: unknown) => readonly unknown[]>([
  ["contract.schema.json", validateContract],
  ["event.schema.json", validateEvent],
  ["evidence.schema.json", validateEvidence],
  ["receipt.schema.json", validateReceipt],
  ["command.schema.json", validateCommand],
  ["decision.schema.json", validateDecision],
  ["run.schema.json", validateRunDocument],
]);
const cases = JSON.parse(
  readFileSync("../../conformance/v0alpha1/cases.json", "utf8"),
) as ConformanceCase[];

describe("runtime conformance corpus", () => {
  for (const testCase of cases) {
    const schema = testCase.targetSchema.split("/").at(-1)!;
    const validate = validators.get(schema);
    if (!validate) continue;

    it(testCase.id, () => {
      expect(validate(testCase.document).length === 0).toBe(
        testCase.expect.valid,
      );
    });
  }
});

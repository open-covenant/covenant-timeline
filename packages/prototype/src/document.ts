import {
  validateContract,
  type TimelineContract,
  type ValidationIssue,
} from "./contract.js";
import type { Evidence, Receipt, RunEvent } from "./run.js";

export interface TimelineRunDocument {
  schema: "covenant.timeline.run.v0alpha1";
  runId: string;
  contract: TimelineContract;
  events: readonly RunEvent[];
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export class TimelineDocumentError extends Error {
  readonly code = "schema.invalid";

  constructor(readonly issues: readonly ValidationIssue[]) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join("; "));
    this.name = "TimelineDocumentError";
  }
}

export function validateRunDocument(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const document = asRecord(value);
  if (!document) return [{ path: "$", message: "must be an object" }];

  validateKeys(
    document,
    ["schema", "runId", "contract", "events"],
    "$",
    issues,
  );
  if (document.schema !== "covenant.timeline.run.v0alpha1") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha1 run schema",
    });
  }
  validateIdentifier(document.runId, "runId", issues);

  issues.push(
    ...validateContract(document.contract).map((issue) =>
      prefixIssue(issue, "contract"),
    ),
  );

  if (!Array.isArray(document.events)) {
    issues.push({ path: "events", message: "must be an array" });
    return issues;
  }

  const eventIds = new Set<string>();
  document.events.forEach((event, index) => {
    issues.push(
      ...validateEvent(event).map((issue) =>
        prefixIssue(issue, `events[${index}]`),
      ),
    );

    const record = asRecord(event);
    if (!record) return;
    if (
      typeof record.sequence === "number" &&
      Number.isInteger(record.sequence) &&
      record.sequence !== index
    ) {
      issues.push({
        path: `events[${index}].sequence`,
        message: `must equal ${index}`,
      });
    }
    if (typeof record.id === "string") {
      if (eventIds.has(record.id)) {
        issues.push({
          path: `events[${index}].id`,
          message: "must be unique within the run",
        });
      }
      eventIds.add(record.id);
    }
  });

  return issues;
}

export function parseRunDocument(value: unknown): TimelineRunDocument {
  const issues = validateRunDocument(value);
  if (issues.length > 0) throw new TimelineDocumentError(issues);
  return value as TimelineRunDocument;
}

export function validateEvent(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const event = asRecord(value);
  if (!event) return [{ path: "$", message: "must be an object" }];

  if (event.schema !== "covenant.timeline.event.v0alpha1") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha1 event schema",
    });
  }
  validateIdentifier(event.id, "id", issues);
  if (
    typeof event.sequence !== "number" ||
    !Number.isInteger(event.sequence) ||
    event.sequence < 0
  ) {
    issues.push({
      path: "sequence",
      message: "must be a non-negative integer",
    });
  }

  if (event.type === "evidence.recorded") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "evidence"],
      "$",
      issues,
    );
    validateEvidence(event.evidence, "evidence", issues);
  } else if (event.type === "checkpoint.evaluated") {
    validateKeys(
      event,
      [
        "schema",
        "id",
        "sequence",
        "type",
        "checkpointId",
        "evidenceRefs",
        "policyRef",
      ],
      "$",
      issues,
    );
    validateIdentifier(event.checkpointId, "checkpointId", issues);
    validateIdentifier(event.policyRef, "policyRef", issues);
    validateIdentifierArray(event.evidenceRefs, "evidenceRefs", true, issues);
  } else if (event.type === "receipt.recorded") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "receipt"],
      "$",
      issues,
    );
    validateReceipt(event.receipt, "receipt", issues);
  } else {
    issues.push({
      path: "type",
      message: "must identify a supported event type",
    });
  }

  return issues;
}

export function validatePortableDocument(value: unknown): ValidationIssue[] {
  const document = asRecord(value);
  if (!document) return [{ path: "$", message: "must be an object" }];
  if (document.schema === "covenant.timeline.contract.v0alpha1") {
    return validateContract(document);
  }
  if (document.schema === "covenant.timeline.event.v0alpha1") {
    return validateEvent(document);
  }
  if (document.schema === "covenant.timeline.run.v0alpha1") {
    return validateRunDocument(document);
  }
  return [{ path: "schema", message: "must identify a portable document" }];
}

function validateEvidence(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is Evidence {
  const evidence = asRecord(value);
  if (!evidence) {
    issues.push({ path, message: "must be an object" });
    return false;
  }

  validateKeys(
    evidence,
    ["id", "kind", "claims", "payloadDigest", "producer"],
    path,
    issues,
  );
  validateIdentifier(evidence.id, `${path}.id`, issues);
  validateIdentifier(evidence.kind, `${path}.kind`, issues);
  validateIdentifierArray(evidence.claims, `${path}.claims`, false, issues);
  validateDigest(evidence.payloadDigest, `${path}.payloadDigest`, issues);
  validateIdentifier(evidence.producer, `${path}.producer`, issues);
  return true;
}

function validateReceipt(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is Receipt {
  const receipt = asRecord(value);
  if (!receipt) {
    issues.push({ path, message: "must be an object" });
    return false;
  }

  validateKeys(
    receipt,
    ["id", "commandId", "status", "effectDigest"],
    path,
    issues,
  );
  validateIdentifier(receipt.id, `${path}.id`, issues);
  if (
    typeof receipt.commandId !== "string" ||
    receipt.commandId.length === 0 ||
    receipt.commandId.length > 512
  ) {
    issues.push({
      path: `${path}.commandId`,
      message: "must identify a command",
    });
  }
  if (
    receipt.status !== "succeeded" &&
    receipt.status !== "failed" &&
    receipt.status !== "indeterminate"
  ) {
    issues.push({
      path: `${path}.status`,
      message: "must be succeeded, failed, or indeterminate",
    });
  }
  validateDigest(receipt.effectDigest, `${path}.effectDigest`, issues);
  return true;
}

function validateIdentifierArray(
  value: unknown,
  path: string,
  allowEmpty: boolean,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return;
  }
  if (!allowEmpty && value.length === 0) {
    issues.push({ path, message: "must not be empty" });
  }

  const seen = new Set<string>();
  value.forEach((entry, index) => {
    validateIdentifier(entry, `${path}[${index}]`, issues);
    if (typeof entry === "string") {
      if (seen.has(entry)) {
        issues.push({
          path: `${path}[${index}]`,
          message: "must be unique",
        });
      }
      seen.add(entry);
    }
  });
}

function validateIdentifier(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    issues.push({
      path,
      message: "must be a lowercase portable identifier",
    });
  }
}

function validateDigest(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    issues.push({
      path,
      message: "must be a lowercase SHA-256 digest",
    });
  }
}

function validateKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      issues.push({
        path: path === "$" ? key : `${path}.${key}`,
        message: "unknown field",
      });
    }
  }
}

function prefixIssue(issue: ValidationIssue, prefix: string): ValidationIssue {
  return {
    ...issue,
    path: issue.path === "$" ? prefix : `${prefix}.${issue.path}`,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

import {
  validateContract,
  type TimelineContract,
  type ValidationIssue,
} from "./contract.js";
import {
  canonicalJson,
  TimelineCanonicalizationError,
  type JsonValue,
} from "./identity.js";
import {
  resolveTimelineLimits,
  type TimelineLimitOptions,
  type TimelineLimits,
} from "./limits.js";
import type {
  CheckpointDecision,
  Command,
  Evidence,
  Receipt,
  RunEvent,
} from "./run.js";

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

export function validateRunDocument(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
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
    ...validateContract(document.contract, limits).map((issue) =>
      prefixIssue(issue, "contract"),
    ),
  );

  if (!Array.isArray(document.events)) {
    issues.push({ path: "events", message: "must be an array" });
    return issues;
  }
  if (document.events.length > limits.maxEvents) {
    issues.push({
      path: "events",
      message: `event count must not exceed ${limits.maxEvents}`,
    });
  }

  const eventIds = new Set<string>();
  document.events.slice(0, limits.maxEvents).forEach((event, index) => {
    appendEventIssues(event, `events[${index}]`, issues, limits);

    const record = asRecord(event);
    if (!record) return;
    if (
      typeof record.sequence === "number" &&
      Number.isSafeInteger(record.sequence) &&
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

  appendCanonicalIssue(document, issues, limits);
  return issues;
}

export function parseRunDocument(
  value: unknown,
  options: TimelineLimitOptions = {},
): TimelineRunDocument {
  const issues = validateRunDocument(value, options);
  if (issues.length > 0) throw new TimelineDocumentError(issues);
  return value as TimelineRunDocument;
}

export function validateEvent(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  appendEventIssues(value, "$", issues, limits);
  appendCanonicalIssue(value, issues, limits);
  return issues;
}

export function validateEvidence(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  appendEvidenceIssues(value, "$", issues, limits);
  appendCanonicalIssue(value, issues, limits);
  return issues;
}

export function validateReceipt(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  appendReceiptIssues(value, "$", issues);
  appendCanonicalIssue(value, issues, limits);
  return issues;
}

export function validateCommand(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  const command = asRecord(value);
  if (!command) return [{ path: "$", message: "must be an object" }];

  validateKeys(
    command,
    ["schema", "id", "kind", "payloadRef", "idempotencyKey", "replayPolicy"],
    "$",
    issues,
  );
  if (command.schema !== "covenant.timeline.command.v0alpha1") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha1 command schema",
    });
  }
  validateCommandIdentifier(command.id, "id", issues);
  validateIdentifier(command.kind, "kind", issues);
  validateIdentifier(command.payloadRef, "payloadRef", issues);
  validateBoundedString(
    command.idempotencyKey,
    "idempotencyKey",
    8,
    512,
    issues,
  );
  if (command.replayPolicy !== "forbid") {
    issues.push({ path: "replayPolicy", message: "must be forbid" });
  }
  appendCanonicalIssue(command, issues, limits);
  return issues;
}

export function validateDecision(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  const decision = asRecord(value);
  if (!decision) return [{ path: "$", message: "must be an object" }];

  validateKeys(
    decision,
    [
      "schema",
      "checkpointId",
      "outcome",
      "policyRef",
      "evidenceRefs",
      "missingRequirements",
    ],
    "$",
    issues,
  );
  if (decision.schema !== "covenant.timeline.decision.v0alpha1") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha1 decision schema",
    });
  }
  validateIdentifier(decision.checkpointId, "checkpointId", issues);
  if (decision.outcome !== "accepted" && decision.outcome !== "rejected") {
    issues.push({ path: "outcome", message: "must be accepted or rejected" });
  }
  validateIdentifier(decision.policyRef, "policyRef", issues);
  validateIdentifierArray(
    decision.evidenceRefs,
    "evidenceRefs",
    true,
    limits.maxEvidenceRefs,
    issues,
  );
  validateIdentifierArray(
    decision.missingRequirements,
    "missingRequirements",
    true,
    limits.maxRequirementsPerCheckpoint,
    issues,
  );
  appendCanonicalIssue(decision, issues, limits);
  return issues;
}

export function validatePortableDocument(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const document = asRecord(value);
  if (!document) return [{ path: "$", message: "must be an object" }];
  if (document.schema === "covenant.timeline.contract.v0alpha1") {
    return validateContract(document, options);
  }
  if (document.schema === "covenant.timeline.event.v0alpha1") {
    return validateEvent(document, options);
  }
  if (document.schema === "covenant.timeline.run.v0alpha1") {
    return validateRunDocument(document, options);
  }
  if (document.schema === "covenant.timeline.command.v0alpha1") {
    return validateCommand(document, options);
  }
  if (document.schema === "covenant.timeline.decision.v0alpha1") {
    return validateDecision(document, options);
  }
  return [{ path: "schema", message: "must identify a portable document" }];
}

function appendEventIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  const event = asRecord(value);
  if (!event) {
    issues.push({ path, message: "must be an object" });
    return;
  }

  const field = (name: string) => (path === "$" ? name : `${path}.${name}`);
  if (event.schema !== "covenant.timeline.event.v0alpha1") {
    issues.push({
      path: field("schema"),
      message: "must identify the v0alpha1 event schema",
    });
  }
  validateIdentifier(event.id, field("id"), issues);
  if (
    typeof event.sequence !== "number" ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 0
  ) {
    issues.push({
      path: field("sequence"),
      message: "must be a non-negative safe integer",
    });
  }

  if (event.type === "evidence.recorded") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "evidence"],
      path,
      issues,
    );
    appendEvidenceIssues(event.evidence, field("evidence"), issues, limits);
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
      path,
      issues,
    );
    validateIdentifier(event.checkpointId, field("checkpointId"), issues);
    validateIdentifier(event.policyRef, field("policyRef"), issues);
    validateIdentifierArray(
      event.evidenceRefs,
      field("evidenceRefs"),
      true,
      limits.maxEvidenceRefs,
      issues,
    );
  } else if (event.type === "receipt.recorded") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "receipt"],
      path,
      issues,
    );
    appendReceiptIssues(event.receipt, field("receipt"), issues);
  } else {
    issues.push({
      path: field("type"),
      message: "must identify a supported event type",
    });
  }
}

function appendEvidenceIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
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
  validateIdentifier(evidence.id, joinPath(path, "id"), issues);
  validateIdentifier(evidence.kind, joinPath(path, "kind"), issues);
  validateIdentifierArray(
    evidence.claims,
    joinPath(path, "claims"),
    false,
    limits.maxEvidenceClaims,
    issues,
  );
  validateDigest(
    evidence.payloadDigest,
    joinPath(path, "payloadDigest"),
    issues,
  );
  validateIdentifier(evidence.producer, joinPath(path, "producer"), issues);
  return true;
}

function appendReceiptIssues(
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
  validateIdentifier(receipt.id, joinPath(path, "id"), issues);
  validateBoundedString(
    receipt.commandId,
    joinPath(path, "commandId"),
    1,
    512,
    issues,
  );
  if (
    receipt.status !== "succeeded" &&
    receipt.status !== "failed" &&
    receipt.status !== "indeterminate"
  ) {
    issues.push({
      path: joinPath(path, "status"),
      message: "must be succeeded, failed, or indeterminate",
    });
  }
  validateDigest(receipt.effectDigest, joinPath(path, "effectDigest"), issues);
  return true;
}

function validateIdentifierArray(
  value: unknown,
  path: string,
  allowEmpty: boolean,
  maximum: number,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return;
  }
  if (!allowEmpty && value.length === 0) {
    issues.push({ path, message: "must not be empty" });
  }
  if (value.length > maximum) {
    issues.push({ path, message: `must contain at most ${maximum} entries` });
  }

  const seen = new Set<string>();
  value.slice(0, maximum).forEach((entry, index) => {
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

function validateCommandIdentifier(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !/^[a-z0-9][a-z0-9._:/-]*$/.test(value)
  ) {
    issues.push({
      path,
      message: "must be a lowercase portable command identifier",
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

function validateBoundedString(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  issues: ValidationIssue[],
): void {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  ) {
    issues.push({
      path,
      message: `must be a string between ${minimum} and ${maximum} characters`,
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

function appendCanonicalIssue(
  value: unknown,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  try {
    canonicalJson(value as JsonValue, limits);
  } catch (error) {
    if (error instanceof TimelineCanonicalizationError) {
      issues.push({ path: error.path, message: error.reason });
      return;
    }
    throw error;
  }
}

function joinPath(path: string, field: string): string {
  return path === "$" ? field : `${path}.${field}`;
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

import { TimelineContractError, type ValidationIssue } from "../contract.js";
import {
  resolveTimelineLimits,
  type TimelineLimitOptions,
  type TimelineLimits,
} from "../limits.js";
import { TimelineDocumentError } from "../document.js";
import {
  validateContractV0Alpha2,
  validatePolicyBinding,
  type TimelineContractV0Alpha2,
} from "./contract.js";
import type {
  CheckpointDecisionV0Alpha2,
  CommandV0Alpha2,
  EvidenceV0Alpha2,
  ReceiptV0Alpha2,
  RunEventV0Alpha2,
} from "./run.js";
import {
  appendCanonicalIssue,
  asRecord,
  joinPath,
  prefixIssue,
  validateBoundedString,
  validateCommandIdentifier,
  validateDigest,
  validateIdentifier,
  validateIdentifierArray,
  validateKeys,
} from "./validation.js";

export interface TimelineRunDocumentV0Alpha2 {
  schema: "covenant.timeline.run.v0alpha2";
  runId: string;
  contract: TimelineContractV0Alpha2;
  events: readonly RunEventV0Alpha2[];
}

export function validateRunDocumentV0Alpha2(
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
  if (document.schema !== "covenant.timeline.run.v0alpha2") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha2 run schema",
    });
  }
  validateIdentifier(document.runId, "runId", issues);
  issues.push(
    ...validateContractV0Alpha2(document.contract, limits).map((issue) =>
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
    appendEventIssuesV0Alpha2(event, `events[${index}]`, issues, limits);
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

export function parseRunDocumentV0Alpha2(
  value: unknown,
  options: TimelineLimitOptions = {},
): TimelineRunDocumentV0Alpha2 {
  const issues = validateRunDocumentV0Alpha2(value, options);
  if (issues.length > 0) throw new TimelineDocumentError(issues);
  return value as TimelineRunDocumentV0Alpha2;
}

export function validateEventV0Alpha2(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  appendEventIssuesV0Alpha2(value, "$", issues, limits);
  appendCanonicalIssue(value, issues, limits);
  return issues;
}

export function validateEvidenceV0Alpha2(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  appendEvidenceIssuesV0Alpha2(value, "$", issues, limits);
  appendCanonicalIssue(value, issues, limits);
  return issues;
}

export function validateReceiptV0Alpha2(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  appendReceiptIssuesV0Alpha2(value, "$", issues);
  appendCanonicalIssue(value, issues, limits);
  return issues;
}

export function validateCommandV0Alpha2(
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
  if (command.schema !== "covenant.timeline.command.v0alpha2") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha2 command schema",
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

export function validateDecisionV0Alpha2(
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
      "policy",
      "evidenceRefs",
      "missingRequirements",
    ],
    "$",
    issues,
  );
  if (decision.schema !== "covenant.timeline.decision.v0alpha2") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha2 decision schema",
    });
  }
  validateIdentifier(decision.checkpointId, "checkpointId", issues);
  if (decision.outcome !== "accepted" && decision.outcome !== "rejected") {
    issues.push({ path: "outcome", message: "must be accepted or rejected" });
  }
  validatePolicyBinding(decision.policy, "policy", issues);
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

export function validatePortableDocumentV0Alpha2(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const document = asRecord(value);
  if (!document) return [{ path: "$", message: "must be an object" }];
  if (document.schema === "covenant.timeline.contract.v0alpha2") {
    return validateContractV0Alpha2(document, options);
  }
  if (document.schema === "covenant.timeline.event.v0alpha2") {
    return validateEventV0Alpha2(document, options);
  }
  if (document.schema === "covenant.timeline.run.v0alpha2") {
    return validateRunDocumentV0Alpha2(document, options);
  }
  if (document.schema === "covenant.timeline.command.v0alpha2") {
    return validateCommandV0Alpha2(document, options);
  }
  if (document.schema === "covenant.timeline.decision.v0alpha2") {
    return validateDecisionV0Alpha2(document, options);
  }
  return [{ path: "schema", message: "must identify a v0alpha2 document" }];
}

function appendEventIssuesV0Alpha2(
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
  const field = (name: string) => joinPath(path, name);
  if (event.schema !== "covenant.timeline.event.v0alpha2") {
    issues.push({
      path: field("schema"),
      message: "must identify the v0alpha2 event schema",
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
    appendEvidenceIssuesV0Alpha2(
      event.evidence,
      field("evidence"),
      issues,
      limits,
    );
    return;
  }
  if (event.type === "checkpoint.evaluated") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "checkpointId", "evidenceRefs"],
      path,
      issues,
    );
    validateIdentifier(event.checkpointId, field("checkpointId"), issues);
    validateIdentifierArray(
      event.evidenceRefs,
      field("evidenceRefs"),
      true,
      limits.maxEvidenceRefs,
      issues,
    );
    return;
  }
  if (event.type === "receipt.recorded") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "receipt"],
      path,
      issues,
    );
    appendReceiptIssuesV0Alpha2(event.receipt, field("receipt"), issues);
    return;
  }
  issues.push({
    path: field("type"),
    message: "must identify a supported event type",
  });
}

function appendEvidenceIssuesV0Alpha2(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): value is EvidenceV0Alpha2 {
  const evidence = asRecord(value);
  if (!evidence) {
    issues.push({ path, message: "must be an object" });
    return false;
  }
  validateKeys(
    evidence,
    ["id", "kind", "claims", "payloadDigest", "producer", "authority"],
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
  appendAuthorityIssues(
    evidence.authority,
    joinPath(path, "authority"),
    issues,
  );
  return true;
}

function appendAuthorityIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  const authority = asRecord(value);
  if (!authority) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  validateKeys(
    authority,
    ["profile", "policyRef", "policyDigest", "proofDigest"],
    path,
    issues,
  );
  validateIdentifier(authority.profile, `${path}.profile`, issues);
  validateIdentifier(authority.policyRef, `${path}.policyRef`, issues);
  validateDigest(authority.policyDigest, `${path}.policyDigest`, issues);
  validateDigest(authority.proofDigest, `${path}.proofDigest`, issues);
}

function appendReceiptIssuesV0Alpha2(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is ReceiptV0Alpha2 {
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

export function assertContractV0Alpha2(
  value: unknown,
): TimelineContractV0Alpha2 {
  const issues = validateContractV0Alpha2(value);
  if (issues.length > 0) throw new TimelineContractError(issues);
  return value as TimelineContractV0Alpha2;
}

export type {
  CheckpointDecisionV0Alpha2,
  CommandV0Alpha2,
  EvidenceV0Alpha2,
  ReceiptV0Alpha2,
};

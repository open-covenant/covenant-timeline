import {
  TimelineContractError,
  type CommandTemplate,
  type Extensions,
  type Subject,
  type ValidationIssue,
} from "../contract.js";
import {
  resolveTimelineLimits,
  type TimelineLimitOptions,
  type TimelineLimits,
} from "../limits.js";
import {
  appendCanonicalIssue,
  asRecord,
  validateDigest,
  validateIdentifier,
  validateIdentifierArray,
  validateKeys,
} from "./validation.js";

export interface PolicyBindingV0Alpha2 {
  profile: string;
  policyRef: string;
  policyDigest: `sha256:${string}`;
}

export interface CheckpointV0Alpha2 {
  id: string;
  requirements: readonly string[];
  policy: PolicyBindingV0Alpha2;
  onAccept?: CommandTemplate;
}

export interface TimelineContractV0Alpha2 {
  schema: "covenant.timeline.contract.v0alpha2";
  id: string;
  subject: Subject;
  checkpoints: readonly CheckpointV0Alpha2[];
  extensions?: Extensions;
}

export function validateContractV0Alpha2(
  contract: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  const value = asRecord(contract);
  if (!value) return [{ path: "$", message: "must be an object" }];

  validateKeys(
    value,
    ["schema", "id", "subject", "checkpoints", "extensions"],
    "$",
    issues,
  );
  if (value.schema !== "covenant.timeline.contract.v0alpha2") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha2 contract schema",
    });
  }
  validateIdentifier(value.id, "id", issues);
  validateSubject(value.subject, issues);

  if (!Array.isArray(value.checkpoints)) {
    issues.push({ path: "checkpoints", message: "must be an array" });
  } else {
    validateCheckpoints(value.checkpoints, issues, limits);
  }

  if (value.extensions !== undefined) {
    validateExtensions(value.extensions, issues, limits);
  }
  appendCanonicalIssue(value, issues, limits);
  return issues;
}

export function parseContractV0Alpha2(
  contract: unknown,
  options: TimelineLimitOptions = {},
): TimelineContractV0Alpha2 {
  const issues = validateContractV0Alpha2(contract, options);
  if (issues.length > 0) throw new TimelineContractError(issues);
  return contract as TimelineContractV0Alpha2;
}

export function samePolicyBinding(
  left: PolicyBindingV0Alpha2,
  right: PolicyBindingV0Alpha2,
): boolean {
  return (
    left.profile === right.profile &&
    left.policyRef === right.policyRef &&
    left.policyDigest === right.policyDigest
  );
}

function validateSubject(value: unknown, issues: ValidationIssue[]): void {
  const subject = asRecord(value);
  if (!subject) {
    issues.push({ path: "subject", message: "must be an object" });
    return;
  }
  validateKeys(subject, ["kind", "id"], "subject", issues);
  validateIdentifier(subject.kind, "subject.kind", issues);
  validateIdentifier(subject.id, "subject.id", issues);
}

function validateCheckpoints(
  checkpoints: readonly unknown[],
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  if (checkpoints.length === 0) {
    issues.push({
      path: "checkpoints",
      message: "must contain at least one checkpoint",
    });
  }
  if (checkpoints.length > limits.maxCheckpoints) {
    issues.push({
      path: "checkpoints",
      message: `must contain at most ${limits.maxCheckpoints} checkpoints`,
    });
  }

  const ids = new Set<string>();
  checkpoints.slice(0, limits.maxCheckpoints).forEach((entry, index) => {
    const path = `checkpoints[${index}]`;
    const checkpoint = asRecord(entry);
    if (!checkpoint) {
      issues.push({ path, message: "must be an object" });
      return;
    }
    validateKeys(
      checkpoint,
      ["id", "requirements", "policy", "onAccept"],
      path,
      issues,
    );
    if (validateIdentifier(checkpoint.id, `${path}.id`, issues)) {
      if (ids.has(checkpoint.id)) {
        issues.push({ path: `${path}.id`, message: "must be unique" });
      }
      ids.add(checkpoint.id);
    }
    validateIdentifierArray(
      checkpoint.requirements,
      `${path}.requirements`,
      false,
      limits.maxRequirementsPerCheckpoint,
      issues,
    );
    validatePolicyBinding(checkpoint.policy, `${path}.policy`, issues);
    if (checkpoint.onAccept !== undefined) {
      validateCommandTemplate(checkpoint.onAccept, `${path}.onAccept`, issues);
    }
  });
}

export function validatePolicyBinding(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is PolicyBindingV0Alpha2 {
  const policy = asRecord(value);
  if (!policy) {
    issues.push({ path, message: "must be an object" });
    return false;
  }
  validateKeys(policy, ["profile", "policyRef", "policyDigest"], path, issues);
  const profile = validateIdentifier(policy.profile, `${path}.profile`, issues);
  const policyRef = validateIdentifier(
    policy.policyRef,
    `${path}.policyRef`,
    issues,
  );
  const policyDigest = validateDigest(
    policy.policyDigest,
    `${path}.policyDigest`,
    issues,
  );
  return profile && policyRef && policyDigest;
}

function validateCommandTemplate(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  const command = asRecord(value);
  if (!command) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  validateKeys(command, ["kind", "payloadRef"], path, issues);
  validateIdentifier(command.kind, `${path}.kind`, issues);
  validateIdentifier(command.payloadRef, `${path}.payloadRef`, issues);
}

function validateExtensions(
  value: unknown,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  const extensions = asRecord(value);
  if (!extensions) {
    issues.push({ path: "extensions", message: "must be an object" });
    return;
  }
  validateKeys(extensions, ["required", "optional"], "extensions", issues);
  if (extensions.required !== undefined) {
    if (!Array.isArray(extensions.required)) {
      issues.push({ path: "extensions.required", message: "must be an array" });
    } else {
      if (extensions.required.length > limits.maxRequirementsPerCheckpoint) {
        issues.push({
          path: "extensions.required",
          message: `must contain at most ${limits.maxRequirementsPerCheckpoint} entries`,
        });
      }
      const seen = new Set<string>();
      extensions.required
        .slice(0, limits.maxRequirementsPerCheckpoint)
        .forEach((entry, index) => {
          const path = `extensions.required[${index}]`;
          if (typeof entry !== "string" || !isAbsoluteUrl(entry)) {
            issues.push({ path, message: "must be an absolute URI" });
          } else {
            issues.push({
              path,
              message: "required extension is not supported",
            });
          }
          if (typeof entry === "string") {
            if (seen.has(entry)) {
              issues.push({ path, message: "must be unique" });
            }
            seen.add(entry);
          }
        });
    }
  }
  if (extensions.optional !== undefined) {
    const optional = asRecord(extensions.optional);
    if (!optional) {
      issues.push({
        path: "extensions.optional",
        message: "must be an object",
      });
    } else {
      for (const key of Object.keys(optional)) {
        if (!isAbsoluteUrl(key)) {
          issues.push({
            path: `extensions.optional.${key}`,
            message: "property name must be an absolute URI",
          });
        }
      }
    }
  }
}

function isAbsoluteUrl(value: string): boolean {
  try {
    return new URL(value).href === value;
  } catch {
    return false;
  }
}

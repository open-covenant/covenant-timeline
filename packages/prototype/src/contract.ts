export interface Subject {
  kind: string;
  id: string;
}

export interface CommandTemplate {
  kind: string;
  payloadRef: string;
}

export interface Checkpoint {
  id: string;
  requirements: readonly string[];
  onAccept?: CommandTemplate;
}

export interface Extensions {
  required?: readonly string[];
  optional?: Readonly<Record<string, unknown>>;
}

export interface TimelineContract {
  schema: "covenant.timeline.contract.v0alpha1";
  id: string;
  subject: Subject;
  checkpoints: readonly Checkpoint[];
  extensions?: Extensions;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;

export class TimelineContractError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join("; "));
    this.name = "TimelineContractError";
    this.issues = issues;
  }
}

export function validateContract(contract: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const value = asRecord(contract);
  if (!value) {
    return [{ path: "$", message: "must be an object" }];
  }

  validateKeys(
    value,
    ["schema", "id", "subject", "checkpoints", "extensions"],
    "$",
    issues,
  );
  if (value.schema !== "covenant.timeline.contract.v0alpha1") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha1 contract schema",
    });
  }
  validateIdentifier(value.id, "id", issues);

  const subject = asRecord(value.subject);
  if (!subject) {
    issues.push({ path: "subject", message: "must be an object" });
  } else {
    validateKeys(subject, ["kind", "id"], "subject", issues);
    validateIdentifier(subject.kind, "subject.kind", issues);
    validateIdentifier(subject.id, "subject.id", issues);
  }

  if (!Array.isArray(value.checkpoints)) {
    issues.push({ path: "checkpoints", message: "must be an array" });
  } else {
    validateCheckpoints(value.checkpoints, issues);
  }

  if (value.extensions !== undefined) {
    validateExtensions(value.extensions, issues);
  }

  return issues;
}

function validateCheckpoints(
  checkpoints: readonly unknown[],
  issues: ValidationIssue[],
): void {
  if (checkpoints.length === 0) {
    issues.push({
      path: "checkpoints",
      message: "must contain at least one checkpoint",
    });
  }

  const checkpointIds = new Set<string>();
  checkpoints.forEach((entry, index) => {
    const path = `checkpoints[${index}]`;
    const checkpoint = asRecord(entry);
    if (!checkpoint) {
      issues.push({ path, message: "must be an object" });
      return;
    }

    validateKeys(checkpoint, ["id", "requirements", "onAccept"], path, issues);
    validateIdentifier(checkpoint.id, `${path}.id`, issues);
    if (typeof checkpoint.id === "string") {
      if (checkpointIds.has(checkpoint.id)) {
        issues.push({ path: `${path}.id`, message: "must be unique" });
      }
      checkpointIds.add(checkpoint.id);
    }

    if (!Array.isArray(checkpoint.requirements)) {
      issues.push({
        path: `${path}.requirements`,
        message: "must be an array",
      });
    } else {
      validateRequirements(checkpoint.requirements, path, issues);
    }

    if (checkpoint.onAccept !== undefined) {
      const command = asRecord(checkpoint.onAccept);
      if (!command) {
        issues.push({
          path: `${path}.onAccept`,
          message: "must be an object",
        });
      } else {
        validateKeys(
          command,
          ["kind", "payloadRef"],
          `${path}.onAccept`,
          issues,
        );
        validateIdentifier(command.kind, `${path}.onAccept.kind`, issues);
        validateIdentifier(
          command.payloadRef,
          `${path}.onAccept.payloadRef`,
          issues,
        );
      }
    }
  });
}

function validateRequirements(
  requirements: readonly unknown[],
  checkpointPath: string,
  issues: ValidationIssue[],
): void {
  if (requirements.length === 0) {
    issues.push({
      path: `${checkpointPath}.requirements`,
      message: "must contain at least one evidence claim",
    });
  }

  const seen = new Set<string>();
  requirements.forEach((requirement, index) => {
    const path = `${checkpointPath}.requirements[${index}]`;
    validateIdentifier(requirement, path, issues);
    if (typeof requirement === "string") {
      if (seen.has(requirement)) {
        issues.push({ path, message: "must be unique within the checkpoint" });
      }
      seen.add(requirement);
    }
  });
}

function validateExtensions(value: unknown, issues: ValidationIssue[]): void {
  const extensions = asRecord(value);
  if (!extensions) {
    issues.push({ path: "extensions", message: "must be an object" });
    return;
  }

  validateKeys(extensions, ["required", "optional"], "extensions", issues);
  if (extensions.required !== undefined) {
    if (!Array.isArray(extensions.required)) {
      issues.push({
        path: "extensions.required",
        message: "must be an array",
      });
    } else {
      extensions.required.forEach((entry, index) => {
        if (typeof entry !== "string" || !isAbsoluteUrl(entry)) {
          issues.push({
            path: `extensions.required[${index}]`,
            message: "must be an absolute URI",
          });
        } else {
          issues.push({
            path: `extensions.required[${index}]`,
            message: "required extension is not supported",
          });
        }
      });
    }
  }

  if (extensions.optional !== undefined && !asRecord(extensions.optional)) {
    issues.push({
      path: "extensions.optional",
      message: "must be an object",
    });
  }
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isAbsoluteUrl(value: string): boolean {
  try {
    return new URL(value).href === value;
  } catch {
    return false;
  }
}

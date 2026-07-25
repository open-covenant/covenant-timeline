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

export interface TimelineContract {
  schema: "covenant.timeline.contract.v0alpha1";
  id: string;
  subject: Subject;
  checkpoints: readonly Checkpoint[];
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

export function validateContract(
  contract: TimelineContract,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (contract.schema !== "covenant.timeline.contract.v0alpha1") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha1 contract schema",
    });
  }

  validateIdentifier(contract.id, "id", issues);
  validateIdentifier(contract.subject.kind, "subject.kind", issues);
  validateIdentifier(contract.subject.id, "subject.id", issues);

  if (contract.checkpoints.length === 0) {
    issues.push({
      path: "checkpoints",
      message: "must contain at least one checkpoint",
    });
  }

  const checkpointIds = new Set<string>();
  contract.checkpoints.forEach((checkpoint, index) => {
    const path = `checkpoints[${index}]`;
    validateIdentifier(checkpoint.id, `${path}.id`, issues);

    if (checkpointIds.has(checkpoint.id)) {
      issues.push({
        path: `${path}.id`,
        message: "must be unique",
      });
    }
    checkpointIds.add(checkpoint.id);

    if (checkpoint.requirements.length === 0) {
      issues.push({
        path: `${path}.requirements`,
        message: "must contain at least one evidence claim",
      });
    }

    const requirements = new Set<string>();
    checkpoint.requirements.forEach((requirement, requirementIndex) => {
      validateIdentifier(
        requirement,
        `${path}.requirements[${requirementIndex}]`,
        issues,
      );
      if (requirements.has(requirement)) {
        issues.push({
          path: `${path}.requirements[${requirementIndex}]`,
          message: "must be unique within the checkpoint",
        });
      }
      requirements.add(requirement);
    });

    if (checkpoint.onAccept) {
      validateIdentifier(
        checkpoint.onAccept.kind,
        `${path}.onAccept.kind`,
        issues,
      );
      validateIdentifier(
        checkpoint.onAccept.payloadRef,
        `${path}.onAccept.payloadRef`,
        issues,
      );
    }
  });

  return issues;
}

function validateIdentifier(
  value: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!IDENTIFIER.test(value)) {
    issues.push({
      path,
      message: "must be a lowercase portable identifier",
    });
  }
}

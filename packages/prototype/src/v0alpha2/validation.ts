import {
  canonicalJson,
  TimelineCanonicalizationError,
  type JsonValue,
} from "../identity.js";
import type { ValidationIssue } from "../contract.js";
import type { TimelineLimits } from "../limits.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function validateKeys(
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

export function validateIdentifier(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    issues.push({
      path,
      message: "must be a lowercase portable identifier",
    });
    return false;
  }
  return true;
}

export function validateCommandIdentifier(
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

export function validateDigest(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is `sha256:${string}` {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    issues.push({
      path,
      message: "must be a lowercase SHA-256 digest",
    });
    return false;
  }
  return true;
}

export function validateIdentifierArray(
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
        issues.push({ path: `${path}[${index}]`, message: "must be unique" });
      }
      seen.add(entry);
    }
  });
}

export function validateBoundedString(
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

export function appendCanonicalIssue(
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

export function joinPath(path: string, field: string): string {
  return path === "$" ? field : `${path}.${field}`;
}

export function prefixIssue(
  issue: ValidationIssue,
  prefix: string,
): ValidationIssue {
  return {
    ...issue,
    path: issue.path === "$" ? prefix : `${prefix}.${issue.path}`,
  };
}

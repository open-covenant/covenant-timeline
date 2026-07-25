import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export class TimelineCanonicalizationError extends TypeError {
  constructor(
    message: string,
    readonly path = "$",
  ) {
    super(`${path}: ${message}`);
    this.name = "TimelineCanonicalizationError";
  }
}

export function canonicalJson(value: JsonValue): string {
  assertJsonValue(value);
  const result = canonicalize(value);
  if (result === undefined) {
    throw new TimelineCanonicalizationError("value is not JSON");
  }
  return result;
}

export function canonicalBytes(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

export function contentDigest(value: JsonValue): `sha256:${string}` {
  const digest = createHash("sha256")
    .update(canonicalBytes(value))
    .digest("hex");
  return `sha256:${digest}`;
}

function assertJsonValue(
  value: unknown,
  path = "$",
  ancestors = new Set<object>(),
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TimelineCanonicalizationError("number must be finite", path);
    }
    return;
  }

  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) {
      throw new TimelineCanonicalizationError(
        "string contains a lone surrogate",
        path,
      );
    }
    return;
  }

  if (typeof value !== "object") {
    throw new TimelineCanonicalizationError("value is not JSON", path);
  }
  if (ancestors.has(value)) {
    throw new TimelineCanonicalizationError("value contains a cycle", path);
  }

  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new TimelineCanonicalizationError(
      "object must have a plain prototype",
      path,
    );
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertJsonValue(entry, `${path}[${index}]`, ancestors),
    );
  } else {
    for (const [key, entry] of Object.entries(value)) {
      if (hasLoneSurrogate(key)) {
        throw new TimelineCanonicalizationError(
          "property name contains a lone surrogate",
          path,
        );
      }
      assertJsonValue(entry, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

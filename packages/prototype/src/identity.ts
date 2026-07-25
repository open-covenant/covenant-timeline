import { createHash, timingSafeEqual } from "node:crypto";
import canonicalize from "canonicalize";
import { resolveTimelineLimits, type TimelineLimitOptions } from "./limits.js";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export class TimelineCanonicalizationError extends TypeError {
  constructor(
    readonly reason: string,
    readonly path = "$",
  ) {
    super(`${path}: ${reason}`);
    this.name = "TimelineCanonicalizationError";
  }
}

export function canonicalJson(
  value: JsonValue,
  options: TimelineLimitOptions = {},
): string {
  const limits = resolveTimelineLimits(options);
  assertJsonValue(value, "$", new Set(), 0, { nodes: 0 }, limits);
  const result = canonicalize(value);
  if (result === undefined) {
    throw new TimelineCanonicalizationError("value is not JSON");
  }
  return result;
}

export function canonicalBytes(
  value: JsonValue,
  options: TimelineLimitOptions = {},
): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value, options));
}

export function contentDigest(
  value: JsonValue,
  options: TimelineLimitOptions = {},
): `sha256:${string}` {
  return byteDigest(canonicalBytes(value, options));
}

export function byteDigest(value: Uint8Array): `sha256:${string}` {
  const digest = createHash("sha256").update(value).digest("hex");
  return `sha256:${digest}`;
}

export function verifyByteDigest(value: Uint8Array, expected: string): boolean {
  if (!/^sha256:[0-9a-f]{64}$/.test(expected)) return false;
  const actual = Buffer.from(byteDigest(value));
  return timingSafeEqual(actual, Buffer.from(expected));
}

function assertJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  depth: number,
  budget: { nodes: number },
  limits: ReturnType<typeof resolveTimelineLimits>,
): asserts value is JsonValue {
  budget.nodes += 1;
  if (budget.nodes > limits.maxCanonicalNodes) {
    throw new TimelineCanonicalizationError(
      `value exceeds ${limits.maxCanonicalNodes} nodes`,
      path,
    );
  }
  if (depth > limits.maxCanonicalDepth) {
    throw new TimelineCanonicalizationError(
      `value exceeds depth ${limits.maxCanonicalDepth}`,
      path,
    );
  }

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
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TimelineCanonicalizationError(
      "object must not contain symbol properties",
      path,
    );
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertJsonValue(
        entry,
        `${path}[${index}]`,
        ancestors,
        depth + 1,
        budget,
        limits,
      ),
    );
  } else {
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (hasLoneSurrogate(key)) {
        throw new TimelineCanonicalizationError(
          "property name contains a lone surrogate",
          path,
        );
      }
      if (!("value" in descriptor)) {
        throw new TimelineCanonicalizationError(
          "object must not contain accessors",
          `${path}.${key}`,
        );
      }
      assertJsonValue(
        descriptor.value,
        `${path}.${key}`,
        ancestors,
        depth + 1,
        budget,
        limits,
      );
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

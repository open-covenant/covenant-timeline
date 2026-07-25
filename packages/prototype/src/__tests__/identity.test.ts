import { describe, expect, it } from "vitest";
import {
  TimelineCanonicalizationError,
  byteDigest,
  canonicalJson,
  contentDigest,
  verifyByteDigest,
} from "../index.js";

describe("canonical identity", () => {
  it("matches the RFC 8785 value serialization fixture", () => {
    const value = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
      string: '€$^O\nA\'B"\\\\"/',
      literals: [null, true, false],
    };

    expect(canonicalJson(value)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$^O\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("derives a lowercase SHA-256 content identity", () => {
    expect(contentDigest({})).toBe(
      "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });

  it("rejects non-I-JSON values", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(
      TimelineCanonicalizationError,
    );
    expect(() => canonicalJson({ value: "\ud800" })).toThrow(
      TimelineCanonicalizationError,
    );
  });

  it("hashes payload bytes without treating them as JSON", () => {
    const payload = new TextEncoder().encode("payload");
    const digest = byteDigest(payload);

    expect(digest).toBe(
      "sha256:239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
    );
    expect(verifyByteDigest(payload, digest)).toBe(true);
    expect(verifyByteDigest(new Uint8Array(), digest)).toBe(false);
  });

  it("rejects values outside the canonicalization resource policy", () => {
    expect(() =>
      canonicalJson({ nested: { value: true } }, { maxCanonicalDepth: 1 }),
    ).toThrow(TimelineCanonicalizationError);

    const symbol = Symbol("hidden");
    const withSymbol = { value: true, [symbol]: false };
    expect(() => canonicalJson(withSymbol)).toThrow(
      TimelineCanonicalizationError,
    );

    const withAccessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => true,
    });
    expect(() => canonicalJson(withAccessor)).toThrow(
      TimelineCanonicalizationError,
    );
  });
});

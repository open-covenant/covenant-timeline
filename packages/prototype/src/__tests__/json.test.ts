import { describe, expect, it } from "vitest";
import { parseJson, TimelineJsonError } from "../index.js";

describe("strict JSON parsing", () => {
  it("accepts unambiguous JSON", () => {
    expect(parseJson('{"nested":{"value":1},"items":[true,null]}')).toEqual({
      nested: { value: 1 },
      items: [true, null],
    });
  });

  it("rejects duplicate keys at every object depth", () => {
    expect(() => parseJson('{"nested":{"value":1,"value":2}}')).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "duplicate_key",
            path: "$.nested.value",
          }),
        ],
      }),
    );
  });

  it("stops after the first duplicate key", () => {
    let input = "0";
    for (let depth = 0; depth < 2_000; depth += 1) {
      input = `{"value":0,"value":${input}}`;
    }

    expect(() => parseJson(input)).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "duplicate_key",
            path: "$.value",
          }),
        ],
      }),
    );
  });

  it("stops after the first syntax error", () => {
    expect(() => parseJson("}".repeat(10_000))).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "syntax",
          }),
        ],
      }),
    );
  });

  it.each(['{"value":1,}', '{"value":/* comment */1}', ""])(
    "rejects non-strict input",
    (input) => {
      expect(() => parseJson(input)).toThrow(TimelineJsonError);
    },
  );
});

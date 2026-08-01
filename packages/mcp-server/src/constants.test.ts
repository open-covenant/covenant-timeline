import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { MCP_SERVER_VERSION, TIMELINE_PACKAGE_VERSION } from "./constants.js";

const load = createRequire(import.meta.url);

describe("package versions", () => {
  test("uses the installed manifests as runtime identities", () => {
    expect(MCP_SERVER_VERSION).toBe(load("../package.json").version);
    expect(TIMELINE_PACKAGE_VERSION).toBe(
      load("@covenant-org/timeline/package.json").version,
    );
  });
});

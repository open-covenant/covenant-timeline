import { describe, expect, test } from "vitest";
import { main } from "./cli.js";

describe("timeline-mcp CLI", () => {
  test.each([
    { args: [], message: "--data-dir is required" },
    {
      args: ["--data-dir", "relative/path"],
      message: "--data-dir must be absolute",
    },
    { args: ["--unknown"], message: "invalid command-line arguments" },
  ])("rejects invalid startup arguments", async ({ args, message }) => {
    await expect(main(args)).rejects.toThrow(message);
  });
});

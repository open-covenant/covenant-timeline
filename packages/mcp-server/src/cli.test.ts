import { describe, expect, test } from "vitest";
import { main } from "./cli.js";

describe("timeline-mcp CLI", () => {
  test.each([
    { args: [], message: "--data-dir is required" },
    {
      args: ["--data-dir", "relative/path"],
      message: "--data-dir must be absolute",
    },
    {
      args: ["--demo", "--data-dir", "/tmp/timeline"],
      message: "--demo cannot be combined with --data-dir or --role",
    },
    {
      args: ["--demo", "--role", "model"],
      message: "--demo cannot be combined with --data-dir or --role",
    },
    {
      args: ["--data-dir", "/tmp/timeline", "--role", "combined"],
      message: "--role must be model or operator",
    },
    { args: ["--unknown"], message: "invalid command-line arguments" },
  ])("rejects invalid startup arguments", async ({ args, message }) => {
    await expect(main(args)).rejects.toThrow(message);
  });
});

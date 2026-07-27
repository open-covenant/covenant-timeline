#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { canonicalJson, type JsonValue } from "@covenant-org/timeline";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { DEFAULT_MAX_MESSAGE_BYTES, MCP_SERVER_VERSION } from "./constants.js";
import { runCorrectionDemo } from "./demo.js";
import { createTimelineMcpServer } from "./server.js";
import { FileMcpRunStore } from "./store.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let values: ReturnType<typeof parseArgs>["values"];
  try {
    ({ values } = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        "data-dir": { type: "string" },
        demo: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    }));
  } catch {
    throw new Error("invalid command-line arguments");
  }

  if (values.version) {
    process.stdout.write(`${MCP_SERVER_VERSION}\n`);
    return;
  }
  if (values.help) {
    process.stdout.write(
      [
        "Usage:",
        "  timeline-mcp --data-dir <directory>",
        "  timeline-mcp --demo",
        "",
        "Local stdio MCP server for Covenant Timeline.",
        "",
      ].join("\n"),
    );
    return;
  }
  if (values.demo) {
    if (values["data-dir"] !== undefined) {
      throw new Error("--demo cannot be combined with --data-dir");
    }
    const directory = await mkdtemp(join(tmpdir(), "timeline-mcp-demo-"));
    try {
      process.stdout.write(
        `${canonicalJson(
          (await runCorrectionDemo(directory)) as unknown as JsonValue,
        )}\n`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    return;
  }
  const directory = values["data-dir"];
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("--data-dir is required");
  }
  if (!isAbsolute(directory)) {
    throw new Error("--data-dir must be absolute");
  }

  const store = new FileMcpRunStore(directory);
  const server = createTimelineMcpServer(store);
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: DEFAULT_MAX_MESSAGE_BYTES,
  });
  let reportedInputError = false;
  transport.onerror = () => {
    if (reportedInputError) return;
    reportedInputError = true;
    process.stderr.write("timeline-mcp: invalid protocol input\n");
  };
  await server.connect(transport);
}

if (isEntrypoint()) {
  main().catch(() => {
    process.stderr.write("timeline-mcp: startup failed\n");
    process.exitCode = 1;
  });
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

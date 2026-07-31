#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseArgs, TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import { parseJson } from "@covenant-org/timeline";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { DEFAULT_MAX_MESSAGE_BYTES, MCP_SERVER_VERSION } from "./constants.js";
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
      "Usage: timeline-mcp --data-dir <directory>\n\nLocal stdio MCP server for Covenant Timeline.\n",
    );
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
  let rawInputObserver: ReturnType<typeof createRawInputObserver> | undefined;
  let rawInputEndObserver: (() => void) | undefined;
  const failProtocolInput = () => {
    process.exitCode = 1;
    if (reportedInputError) return;
    reportedInputError = true;
    if (rawInputObserver) {
      process.stdin.off("data", rawInputObserver.onData);
    }
    if (rawInputEndObserver) {
      process.stdin.off("end", rawInputEndObserver);
    }
    process.stdin.pause();
    const stderrFlushed = new Promise<void>((resolve) => {
      process.stderr.write("timeline-mcp: invalid protocol input\n", () =>
        resolve(),
      );
    });
    void Promise.allSettled([transport.close(), stderrFlushed]).then(() => {
      process.exit(1);
    });
  };
  rawInputObserver = createRawInputObserver(failProtocolInput);
  rawInputEndObserver = () => {
    if (rawInputObserver?.hasPendingFrame()) failProtocolInput();
  };
  process.stdin.on("data", rawInputObserver.onData);
  process.stdin.once("end", rawInputEndObserver);
  transport.onerror = failProtocolInput;
  try {
    await server.connect(transport);
  } catch (error) {
    process.stdin.off("data", rawInputObserver.onData);
    process.stdin.off("end", rawInputEndObserver);
    process.stdin.pause();
    throw error;
  }
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

function createRawInputObserver(onInvalidInput: () => void): {
  onData: (chunk: Buffer) => void;
  hasPendingFrame: () => boolean;
} {
  const decoder = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  });
  let chunks: Buffer<ArrayBufferLike>[] = [];
  let bufferedBytes = 0;

  return {
    hasPendingFrame: () => bufferedBytes > 0,
    onData: (chunk) => {
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(0x0a, offset);
        const end = newline === -1 ? chunk.length : newline;
        const part = chunk.subarray(offset, end);
        bufferedBytes += part.length;
        if (bufferedBytes > DEFAULT_MAX_MESSAGE_BYTES) {
          chunks = [];
          bufferedBytes = 0;
          onInvalidInput();
          return;
        }
        if (part.length > 0) chunks.push(part);
        if (newline === -1) return;

        try {
          const frame =
            chunks.length === 1
              ? chunks[0]!
              : Buffer.concat(chunks, bufferedBytes);
          parseJson(decoder.decode(frame));
        } catch {
          onInvalidInput();
          return;
        }
        chunks = [];
        bufferedBytes = 0;
        offset = newline + 1;
      }
    },
  };
}

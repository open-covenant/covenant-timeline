#!/usr/bin/env node

import { createReadStream, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { TimelineDocumentError, validatePortableDocument } from "./document.js";
import { canonicalJson, type JsonValue } from "./identity.js";
import { parseJson, TimelineJsonError } from "./json.js";
import { evaluateRunDocument, type TimelineRunReport } from "./report.js";

interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export const DEFAULT_MAX_INPUT_BYTES = 16 * 1024 * 1024;

const USAGE = `Usage: timeline <command> <file|-> [--json]

Commands:
  validate  Validate a contract, event, command, decision, or portable run
  replay    Replay a portable run without executing effects
  inspect   Show checkpoints, evidence, commands, and receipts
  verify    Replay and structurally verify a portable run

Options:
  --json     Emit canonical JSON
  --version  Print the package version
`;

export async function runCli(
  argv = process.argv.slice(2),
  io: CliIo = defaultIo,
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout(USAGE);
    return 0;
  }
  if (argv.includes("--version")) {
    io.stdout(`${await packageVersion()}\n`);
    return 0;
  }

  const json = argv.includes("--json");
  const unknownFlags = argv.filter(
    (argument) =>
      argument.startsWith("-") && argument !== "--json" && argument !== "-",
  );
  const positional = argv.filter(
    (argument) => !argument.startsWith("-") || argument === "-",
  );
  if (unknownFlags.length > 0 || positional.length !== 2) {
    io.stderr(USAGE);
    return 2;
  }

  const [command, file] = positional;
  if (
    command !== "validate" &&
    command !== "replay" &&
    command !== "inspect" &&
    command !== "verify"
  ) {
    io.stderr(`Unknown command: ${command}\n\n${USAGE}`);
    return 2;
  }

  let input: unknown;
  try {
    input = parseJson(await readInput(file!));
  } catch (error) {
    const result = inputError(error);
    writeResult(
      io,
      json,
      {
        ok: false,
        code: result.code,
        file,
        message: result.message,
        ...(result.issues ? { issues: result.issues } : {}),
      },
      `INVALID ${file}\n${result.message}`,
      true,
    );
    return 1;
  }

  if (command === "validate") {
    const issues = validatePortableDocument(input);
    const ok = issues.length === 0;
    writeResult(
      io,
      json,
      { ok, file, issues },
      ok
        ? `VALID ${file}`
        : `INVALID ${file}\n${issues
            .map(({ path, message }) => `  ${path}: ${message}`)
            .join("\n")}`,
      !ok,
    );
    return ok ? 0 : 1;
  }

  let report: TimelineRunReport;
  try {
    report = evaluateRunDocument(input);
  } catch (error) {
    if (error instanceof TimelineDocumentError) {
      writeResult(
        io,
        json,
        { ok: false, code: error.code, file, issues: error.issues },
        `INVALID ${file}\n${error.issues
          .map(({ path, message }) => `  ${path}: ${message}`)
          .join("\n")}`,
        true,
      );
      return 1;
    }
    throw error;
  }

  if (command === "replay") {
    writeResult(io, json, report, renderReplay(report));
    return 0;
  }
  if (command === "inspect") {
    writeResult(io, json, report, renderInspect(report));
    return 0;
  }

  writeResult(io, json, report, renderVerify(report), !report.verification.ok);
  return report.verification.ok ? 0 : 1;
}

function renderReplay(report: TimelineRunReport): string {
  return [
    `REPLAYED ${report.runId}`,
    `  contract ${report.contractDigest}`,
    `  events   ${report.eventsDigest}`,
    `  state    ${report.stateDigest}`,
    `  next sequence ${report.state.nextSequence}`,
    "  evidence authority external",
    "  no effects executed",
  ].join("\n");
}

function renderInspect(report: TimelineRunReport): string {
  const lines = [
    `RUN ${report.runId}`,
    `  contract ${report.contractDigest}`,
    `  events   ${report.eventsDigest}`,
    `  state    ${report.stateDigest}`,
    "",
    "CHECKPOINTS",
  ];

  for (const [id, checkpoint] of Object.entries(report.state.checkpoints)) {
    lines.push(`  ${id}: ${checkpoint.status}`);
    if (checkpoint.decision?.missingRequirements.length) {
      lines.push(
        `    missing: ${checkpoint.decision.missingRequirements.join(", ")}`,
      );
    }
  }

  lines.push(
    "",
    `EVIDENCE ${Object.keys(report.state.evidence).length}`,
    `COMMANDS ${Object.keys(report.state.commands).length}`,
    `RECEIPTS ${Object.keys(report.state.receipts).length}`,
    `FINDINGS ${report.state.findings.length}`,
  );
  for (const finding of report.state.findings) {
    lines.push(`  ${finding.code} ${finding.eventId}: ${finding.detail}`);
  }
  return lines.join("\n");
}

function renderVerify(report: TimelineRunReport): string {
  const { verification } = report;
  const lines = [
    `${verification.ok ? "STRUCTURALLY VERIFIED" : "STRUCTURAL VERIFICATION FAILED"} ${report.runId}`,
    `  state ${report.stateDigest}`,
    "  evaluation requirement coverage",
    "  evidence authority external",
    "  policy authority external",
    "  policy binding unverified event label",
    "  effect authority external",
  ];

  appendList(lines, "pending checkpoints", verification.pendingCheckpoints);
  appendList(lines, "rejected checkpoints", verification.rejectedCheckpoints);
  appendList(lines, "unresolved commands", verification.unresolvedCommands);
  appendList(lines, "failed commands", verification.failedCommands);
  for (const finding of verification.findings) {
    lines.push(
      `  finding: ${finding.code} ${finding.eventId} ${finding.detail}`,
    );
  }
  return lines.join("\n");
}

class CliInputError extends Error {
  constructor(
    readonly code: "timeline.input.read_failed" | "timeline.input.too_large",
    message: string,
  ) {
    super(message);
    this.name = "CliInputError";
  }
}

async function readInput(file: string): Promise<string> {
  const stream = file === "-" ? stdin : createReadStream(file);
  return readBounded(stream);
}

async function readBounded(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += chunk.length;
      if (total > DEFAULT_MAX_INPUT_BYTES) {
        stream.destroy();
        throw new CliInputError(
          "timeline.input.too_large",
          `input exceeds ${DEFAULT_MAX_INPUT_BYTES} bytes`,
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CliInputError("timeline.input.read_failed", message);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, total),
    );
  } catch {
    throw new TimelineJsonError([
      {
        code: "syntax",
        offset: 0,
        line: 0,
        column: 0,
        detail: "input is not valid UTF-8",
      },
    ]);
  }
}

function inputError(error: unknown): {
  code:
    | "timeline.input.invalid_json"
    | "timeline.input.read_failed"
    | "timeline.input.too_large";
  message: string;
  issues?: TimelineJsonError["issues"];
} {
  if (error instanceof TimelineJsonError) {
    return { code: error.code, message: error.message, issues: error.issues };
  }
  if (error instanceof CliInputError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "timeline.input.read_failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

async function packageVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("package version is missing");
  }
  return packageJson.version;
}

function appendList(
  lines: string[],
  label: string,
  values: readonly string[],
): void {
  if (values.length > 0) lines.push(`  ${label}: ${values.join(", ")}`);
}

function writeResult(
  io: CliIo,
  json: boolean,
  value: unknown,
  human: string,
  error = false,
): void {
  const output = `${json ? canonicalJson(value as JsonValue) : human}\n`;
  if (error) io.stderr(output);
  else io.stdout(output);
}

export function isCliEntry(
  entry = process.argv[1],
  resolve: (path: string) => string = realpathSync,
): boolean {
  if (!entry) return false;
  try {
    return resolve(entry) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    process.exitCode = await runCli();
  } catch {
    const json = process.argv.includes("--json");
    writeResult(
      defaultIo,
      json,
      { ok: false, code: "timeline.internal" },
      "INTERNAL ERROR",
      true,
    );
    process.exitCode = 70;
  }
}

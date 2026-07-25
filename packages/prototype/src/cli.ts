#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { TimelineDocumentError, validatePortableDocument } from "./document.js";
import { canonicalJson, type JsonValue } from "./identity.js";
import { evaluateRunDocument, type TimelineRunReport } from "./report.js";

interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

const USAGE = `Usage: timeline <command> <file> [--json]

Commands:
  validate  Validate a contract, event, or portable run
  replay    Replay a portable run without executing effects
  inspect   Show checkpoints, evidence, commands, and receipts
  verify    Replay and verify a portable run
`;

export async function runCli(
  argv = process.argv.slice(2),
  io: CliIo = defaultIo,
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout(USAGE);
    return 0;
  }

  const json = argv.includes("--json");
  const unknownFlags = argv.filter(
    (argument) => argument.startsWith("-") && argument !== "--json",
  );
  const positional = argv.filter((argument) => !argument.startsWith("-"));
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
    input = JSON.parse(await readFile(file!, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeResult(
      io,
      json,
      {
        ok: false,
        code: "timeline.input.invalid_json",
        file,
        message,
      },
      `INVALID ${file}\n${message}`,
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
    `${verification.ok ? "VERIFIED" : "FAILED"} ${report.runId}`,
    `  state ${report.stateDigest}`,
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
  process.exitCode = await runCli();
}

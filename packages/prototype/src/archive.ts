import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, contentDigest, type JsonValue } from "./identity.js";
import { parseJson } from "./json.js";
import {
  evaluateRunDocumentV0Alpha2,
  parseRunDocumentV0Alpha2,
  type TimelineRunDocumentV0Alpha2,
} from "./v0alpha2/index.js";

export interface PortableRunArchive {
  schema: "covenant.timeline.archive.v1";
  run: TimelineRunDocumentV0Alpha2;
  stateDigest: `sha256:${string}`;
}

export interface RunArchiveStore {
  load(runId: string): Promise<PortableRunArchive | undefined>;
  save(
    archive: PortableRunArchive,
    options?: SaveArchiveOptions,
  ): Promise<void>;
}

export interface SaveArchiveOptions {
  expectedStateDigest?: `sha256:${string}`;
}

export interface FileRunArchiveStoreOptions {
  maxBytes?: number;
}

export const DEFAULT_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

export class TimelineArchiveError extends Error {
  readonly code = "timeline.archive.invalid";

  constructor(message: string) {
    super(message);
    this.name = "TimelineArchiveError";
  }
}

export function createPortableRunArchive(
  run: TimelineRunDocumentV0Alpha2,
): PortableRunArchive {
  const parsed = parseRunDocumentV0Alpha2(run);
  return {
    schema: "covenant.timeline.archive.v1",
    run: parsed,
    stateDigest: evaluateRunDocumentV0Alpha2(parsed).stateDigest,
  };
}

export function parsePortableRunArchive(value: unknown): PortableRunArchive {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TimelineArchiveError("archive must be an object");
  }
  const archive = value as Record<string, unknown>;
  if (
    Object.keys(archive).some(
      (key) => !["schema", "run", "stateDigest"].includes(key),
    ) ||
    archive.schema !== "covenant.timeline.archive.v1"
  ) {
    throw new TimelineArchiveError("archive schema or fields are invalid");
  }
  const run = parseRunDocumentV0Alpha2(archive.run);
  const report = evaluateRunDocumentV0Alpha2(run);
  if (archive.stateDigest !== report.stateDigest) {
    throw new TimelineArchiveError(
      "archive state digest does not match replay",
    );
  }
  return {
    schema: "covenant.timeline.archive.v1",
    run,
    stateDigest: report.stateDigest,
  };
}

export class FileRunArchiveStore implements RunArchiveStore {
  readonly directory: string;
  readonly maxBytes: number;

  constructor(directory: string, options: FileRunArchiveStoreOptions = {}) {
    this.directory = resolve(directory);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1) {
      throw new RangeError("maxBytes must be a positive safe integer");
    }
  }

  async load(runId: string): Promise<PortableRunArchive | undefined> {
    let contents: string;
    try {
      contents = await readBoundedUtf8(this.pathFor(runId), this.maxBytes);
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
    const archive = parsePortableRunArchive(parseJson(contents));
    if (archive.run.runId !== runId) {
      throw new TimelineArchiveError("archive run ID does not match lookup");
    }
    return archive;
  }

  async save(
    archive: PortableRunArchive,
    options: SaveArchiveOptions = {},
  ): Promise<void> {
    const parsed = parsePortableRunArchive(archive);
    const contents = `${canonicalJson(parsed as unknown as JsonValue)}\n`;
    if (Buffer.byteLength(contents) > this.maxBytes) {
      throw new TimelineArchiveError(`archive exceeds ${this.maxBytes} bytes`);
    }
    await mkdir(this.directory, { recursive: true });
    const destination = this.pathFor(parsed.run.runId);
    const lockPath = `${destination}.lock`;
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (isFileError(error, "EEXIST")) {
        throw new TimelineArchiveError("archive has another active writer");
      }
      throw error;
    }
    const temporary = join(
      this.directory,
      `.${this.fileName(parsed.run.runId)}.${randomUUID()}.tmp`,
    );
    try {
      await lock.writeFile(
        `${canonicalJson({
          schema: "covenant.timeline.archive-lock.v1",
          pid: process.pid,
          createdAt: new Date().toISOString(),
        })}\n`,
      );
      if (options.expectedStateDigest) {
        const current = await this.load(parsed.run.runId);
        if (current?.stateDigest !== options.expectedStateDigest) {
          throw new TimelineArchiveError(
            "archive state changed before this write",
          );
        }
      }
      await writeFile(temporary, contents, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isFileError(error, "ENOENT")) throw error;
      });
      await lock.close();
      await unlink(lockPath);
    }
  }

  private pathFor(runId: string): string {
    return join(this.directory, this.fileName(runId));
  }

  private fileName(runId: string): string {
    if (!/^[a-z0-9][a-z0-9._:/-]{0,127}$/.test(runId)) {
      throw new TimelineArchiveError("run ID is not portable");
    }
    return `${contentDigest(runId as unknown as JsonValue).slice(7)}.json`;
  }
}

async function readBoundedUtf8(
  path: string,
  maxBytes: number,
): Promise<string> {
  const stream = createReadStream(path);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new TimelineArchiveError(`archive exceeds ${maxBytes} bytes`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function isFileError(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

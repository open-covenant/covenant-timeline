import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  canonicalJson,
  contentDigest,
  parseContractV0Alpha3,
  parseEventV0Alpha3,
  parseJson,
  parseRunDocumentV0Alpha3,
  type JsonValue,
  type TemporalEventV0Alpha3,
  type TimelineContractV0Alpha3,
  type TimelineRunDocumentV0Alpha3,
} from "@covenant-org/timeline";
import {
  DEFAULT_MAX_RUN_BYTES,
  DEFAULT_MAX_RUNS,
  MCP_ADMISSION,
  MCP_DOCUMENT_LIMITS,
  MCP_IMPLEMENTATION,
  MCP_KERNEL_LIMITS,
  MAX_LIST_PAGE_SIZE,
} from "./constants.js";
import { TimelineMcpError } from "./errors.js";
import type {
  AppendEventResultV0Alpha1,
  CreateRunResultV0Alpha1,
  McpRunEnvelopeV0Alpha1,
  McpRunImplementationV0Alpha1,
  McpRunListPageOptionsV0Alpha1,
  McpRunListPageV0Alpha1,
  McpRunMetadataV0Alpha1,
  TemporalEventDraftV0Alpha3,
} from "./types.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SERVER_VERSION = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/;
const STORED_FILE = /^[0-9a-f]{64}\.json$/;
const PAGE_CURSOR = /^v1\.[0-9a-f]{64}\.[0-9a-f]{64}$/;

export interface FileMcpRunStoreOptions {
  maxBytes?: number;
  maxRuns?: number;
}

export interface McpRunStore {
  list(): Promise<readonly McpRunMetadataV0Alpha1[]>;
  listPage(
    options?: McpRunListPageOptionsV0Alpha1,
  ): Promise<McpRunListPageV0Alpha1>;
  load(runId: string): Promise<McpRunEnvelopeV0Alpha1 | undefined>;
  require(runId: string): Promise<McpRunEnvelopeV0Alpha1>;
  create(contract: unknown): Promise<CreateRunResultV0Alpha1>;
  append(
    runId: string,
    draft: unknown,
    expectedRunDigest: string,
  ): Promise<AppendEventResultV0Alpha1>;
}

export class FileMcpRunStore implements McpRunStore {
  readonly directory: string;
  readonly maxBytes: number;
  readonly maxRuns: number;

  constructor(directory: string, options: FileMcpRunStoreOptions = {}) {
    if (typeof directory !== "string" || directory.length === 0) {
      throw new TypeError("directory must be a non-empty string");
    }
    this.directory = resolve(directory);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_RUN_BYTES;
    this.maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;
    assertPositiveSafeInteger(this.maxBytes, "maxBytes");
    assertPositiveSafeInteger(this.maxRuns, "maxRuns");
    assertAtMost(this.maxBytes, DEFAULT_MAX_RUN_BYTES, "maxBytes");
    assertAtMost(this.maxRuns, DEFAULT_MAX_RUNS, "maxRuns");
  }

  async list(): Promise<readonly McpRunMetadataV0Alpha1[]> {
    await this.ensureDirectory();
    const files = await this.storedFiles();
    if (files.length > this.maxRuns) {
      throw new TimelineMcpError(
        "timeline.mcp.store.limit",
        "timeline store exceeds its run limit",
      );
    }

    const timelines: McpRunMetadataV0Alpha1[] = [];
    for (const file of files) {
      const envelope = await this.loadPath(join(this.directory, file));
      if (file !== this.fileName(envelope.runId)) {
        throw new TimelineMcpError(
          "timeline.mcp.store.corrupt",
          "stored timeline filename does not match its run ID",
        );
      }
      timelines.push(metadataForEnvelope(envelope));
    }
    return timelines.sort((left, right) =>
      left.runId.localeCompare(right.runId),
    );
  }

  async listPage(
    options: McpRunListPageOptionsV0Alpha1 = {},
  ): Promise<McpRunListPageV0Alpha1> {
    const { cursor, limit } = parseListPageOptions(options);
    await this.ensureDirectory();
    const files = await this.storedFiles();
    if (files.length > this.maxRuns) {
      throw new TimelineMcpError(
        "timeline.mcp.store.limit",
        "timeline store exceeds its run limit",
      );
    }
    const catalogDigest = pageCatalogDigest(files);

    let start = 0;
    if (cursor !== undefined) {
      const [, cursorCatalogDigest, cursorFileDigest] = cursor.split(".");
      if (cursorCatalogDigest !== catalogDigest) {
        throw new TimelineMcpError(
          "timeline.mcp.input.invalid",
          "timeline page cursor is invalid or stale",
        );
      }
      const cursorIndex = files.findIndex(
        (file) => pageFileDigest(file) === cursorFileDigest,
      );
      if (cursorIndex === -1) {
        throw new TimelineMcpError(
          "timeline.mcp.input.invalid",
          "timeline page cursor is invalid or stale",
        );
      }
      start = cursorIndex + 1;
    }

    const pageFiles = files.slice(start, start + limit);
    const timelines: McpRunMetadataV0Alpha1[] = [];
    for (const file of pageFiles) {
      const envelope = await this.loadPath(join(this.directory, file));
      if (file !== this.fileName(envelope.runId)) {
        throw new TimelineMcpError(
          "timeline.mcp.store.corrupt",
          "stored timeline filename does not match its run ID",
        );
      }
      timelines.push(metadataForEnvelope(envelope));
    }

    const hasMore = start + pageFiles.length < files.length;
    return {
      timelines,
      nextCursor:
        hasMore && pageFiles.length > 0
          ? pageCursorFor(catalogDigest, pageFiles.at(-1)!)
          : null,
    };
  }

  async load(runId: string): Promise<McpRunEnvelopeV0Alpha1 | undefined> {
    assertRunId(runId);
    return this.loadUnlocked(runId);
  }

  async require(runId: string): Promise<McpRunEnvelopeV0Alpha1> {
    const envelope = await this.load(runId);
    if (!envelope) {
      throw new TimelineMcpError(
        "timeline.mcp.store.not-found",
        "timeline does not exist",
      );
    }
    return envelope;
  }

  async create(contractValue: unknown): Promise<CreateRunResultV0Alpha1> {
    const contract = parseContractInput(contractValue);
    const runId = contract.id;
    await this.ensureDirectory();

    return this.withLock(this.catalogLockPath(), async () =>
      this.withLock(this.lockPath(runId), async () => {
        const current = await this.loadUnlocked(runId);
        if (current) {
          if (!sameJson(current.run.contract, contract)) {
            throw new TimelineMcpError(
              "timeline.mcp.store.conflict",
              "timeline ID already belongs to a different contract",
            );
          }
          return { envelope: current, created: false };
        }

        const files = await this.storedFiles();
        if (files.length >= this.maxRuns) {
          throw new TimelineMcpError(
            "timeline.mcp.store.limit",
            "timeline store reached its run limit",
          );
        }

        const run = parseInputRun({
          schema: "covenant.timeline.run.v0alpha3",
          contract,
          events: [],
        });
        const envelope = createEnvelope(run);
        await this.persist(runId, envelope);
        return { envelope, created: true };
      }),
    );
  }

  async append(
    runId: string,
    draftValue: unknown,
    expectedRunDigest: string,
  ): Promise<AppendEventResultV0Alpha1> {
    assertRunId(runId);
    if (!DIGEST.test(expectedRunDigest)) {
      throw new TimelineMcpError(
        "timeline.mcp.input.invalid",
        "expectedRunDigest must be a SHA-256 digest",
      );
    }
    const draft = parseDraft(draftValue);
    await this.ensureDirectory();

    return this.withLock(this.lockPath(runId), async () => {
      const current = await this.loadUnlocked(runId);
      if (!current) {
        throw new TimelineMcpError(
          "timeline.mcp.store.not-found",
          "timeline does not exist",
        );
      }

      const existing = current.run.events.find(
        (event) => event.id === draft.id,
      );
      if (existing) {
        const retried = materializeEvent(draft, existing.sequence);
        if (!sameJson(existing, retried)) {
          throw new TimelineMcpError(
            "timeline.mcp.store.conflict",
            "event ID already exists with different content",
          );
        }
        return {
          envelope: current,
          event: existing,
          appended: false,
        };
      }

      if (current.runDigest !== expectedRunDigest) {
        throw new TimelineMcpError(
          "timeline.mcp.store.conflict",
          "timeline changed before this append",
        );
      }

      const event = materializeEvent(draft, current.revision);
      const run = parseInputRun({
        ...current.run,
        events: [...current.run.events, event],
      });
      const envelope = createEnvelope(run);
      await this.persist(runId, envelope);
      return { envelope, event, appended: true };
    });
  }

  private async loadUnlocked(
    runId: string,
  ): Promise<McpRunEnvelopeV0Alpha1 | undefined> {
    try {
      const envelope = await this.loadPath(this.path(runId));
      if (envelope.runId !== runId) {
        throw new TimelineMcpError(
          "timeline.mcp.store.corrupt",
          "stored timeline run ID does not match the lookup",
        );
      }
      return envelope;
    } catch (error) {
      if (isFileError(error, "ENOENT")) return undefined;
      throw sanitizeFileError(error);
    }
  }

  private async loadPath(path: string): Promise<McpRunEnvelopeV0Alpha1> {
    let text: string;
    try {
      text = await readBoundedUtf8(path, this.maxBytes);
    } catch (error) {
      if (error instanceof TimelineMcpError || isFileError(error, "ENOENT")) {
        throw error;
      }
      throw new TimelineMcpError(
        "timeline.mcp.store.corrupt",
        "stored timeline bytes are invalid",
      );
    }

    try {
      const envelope = parseMcpRunEnvelopeV0Alpha1(parseJson(text));
      const canonical = `${canonicalJson(envelope as unknown as JsonValue)}\n`;
      if (text !== canonical) {
        throw new TimelineMcpError(
          "timeline.mcp.store.corrupt",
          "stored timeline bytes are not canonical",
        );
      }
      return envelope;
    } catch (error) {
      if (
        error instanceof TimelineMcpError &&
        error.code === "timeline.mcp.store.limit"
      ) {
        throw error;
      }
      throw new TimelineMcpError(
        "timeline.mcp.store.corrupt",
        "stored timeline envelope is invalid",
      );
    }
  }

  private async persist(
    runId: string,
    envelope: McpRunEnvelopeV0Alpha1,
  ): Promise<void> {
    const contents = `${canonicalJson(envelope as unknown as JsonValue)}\n`;
    const bytes = new TextEncoder().encode(contents);
    if (bytes.byteLength > this.maxBytes) {
      throw new TimelineMcpError(
        "timeline.mcp.store.limit",
        "timeline exceeds its byte limit",
      );
    }

    const temporary = join(
      this.directory,
      `.${this.fileName(runId)}.${randomUUID()}.tmp`,
    );
    let handle: FileHandle | undefined;
    let committed = false;
    let primaryError: unknown;

    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.path(runId));
      committed = true;
      await syncDirectory(this.directory);
    } catch (error) {
      primaryError = error;
    }

    const cleanupError = await cleanupTemporary(handle, temporary);
    if (primaryError) throw persistenceError(primaryError, committed);
    if (cleanupError) throw persistenceError(cleanupError, committed);
  }

  private async withLock<T>(
    path: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    let lock: FileHandle;
    try {
      lock = await open(path, "wx", 0o600);
    } catch (error) {
      if (isFileError(error, "EEXIST")) {
        throw new TimelineMcpError(
          "timeline.mcp.store.busy",
          "timeline store has another active writer",
        );
      }
      throw sanitizeFileError(error);
    }

    let result: T | undefined;
    let operationError: unknown;
    try {
      await lock.writeFile(
        `${canonicalJson({
          schema: "covenant.timeline.mcp-lock.v1",
          pid: process.pid,
          createdAt: new Date().toISOString(),
        })}\n`,
      );
      await lock.sync();
      result = await operation();
    } catch (error) {
      operationError = error;
    }

    const cleanupError = await releaseLock(lock, path);
    if (operationError) throw operationError;
    if (cleanupError) {
      throw new TimelineMcpError(
        "timeline.mcp.store.indeterminate",
        "timeline write may have committed; reload before retrying",
      );
    }
    return result as T;
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw sanitizeFileError(error);
    }
  }

  private async storedFiles(): Promise<string[]> {
    try {
      return (await readdir(this.directory))
        .filter((name) => STORED_FILE.test(name))
        .sort();
    } catch (error) {
      throw sanitizeFileError(error);
    }
  }

  private path(runId: string): string {
    return join(this.directory, this.fileName(runId));
  }

  private lockPath(runId: string): string {
    return join(this.directory, `${this.fileName(runId).slice(0, -5)}.lock`);
  }

  private catalogLockPath(): string {
    return join(this.directory, ".catalog.lock");
  }

  private fileName(runId: string): string {
    assertRunId(runId);
    return `${contentDigest(runId as unknown as JsonValue).slice(7)}.json`;
  }
}

export function parseMcpRunEnvelopeV0Alpha1(
  value: unknown,
): McpRunEnvelopeV0Alpha1 {
  const envelope = exactRecord(
    value,
    [
      "schema",
      "runId",
      "revision",
      "runDigest",
      "admission",
      "implementation",
      "run",
    ],
    "stored timeline",
  );
  if (envelope.schema !== "covenant.timeline.mcp-run.v0alpha1") {
    corrupt("stored timeline schema is invalid");
  }
  if (typeof envelope.runId !== "string" || !IDENTIFIER.test(envelope.runId)) {
    corrupt("stored timeline run ID is invalid");
  }
  if (
    typeof envelope.revision !== "number" ||
    !Number.isSafeInteger(envelope.revision) ||
    envelope.revision < 0
  ) {
    corrupt("stored timeline revision is invalid");
  }
  if (
    typeof envelope.runDigest !== "string" ||
    !DIGEST.test(envelope.runDigest)
  ) {
    corrupt("stored timeline digest is invalid");
  }
  assertConstantObject(envelope.admission, MCP_ADMISSION, "admission");
  const implementation = parseImplementation(envelope.implementation);

  const run = parseStoredRun(envelope.run);
  if (envelope.runId !== run.contract.id) {
    corrupt("stored timeline contract ID is invalid");
  }
  if (envelope.revision !== run.events.length) {
    corrupt("stored timeline revision does not match its event count");
  }
  const runDigest = contentDigest(run as unknown as JsonValue);
  if (envelope.runDigest !== runDigest) {
    corrupt("stored timeline digest does not match its run");
  }

  return {
    schema: "covenant.timeline.mcp-run.v0alpha1",
    runId: envelope.runId,
    revision: envelope.revision,
    runDigest,
    admission: MCP_ADMISSION,
    implementation,
    run,
  };
}

function createEnvelope(
  run: TimelineRunDocumentV0Alpha3,
): McpRunEnvelopeV0Alpha1 {
  enforceRunLimits(run);
  return {
    schema: "covenant.timeline.mcp-run.v0alpha1",
    runId: run.contract.id,
    revision: run.events.length,
    runDigest: contentDigest(run as unknown as JsonValue),
    admission: MCP_ADMISSION,
    implementation: MCP_IMPLEMENTATION,
    run,
  };
}

export function metadataForEnvelope(
  envelope: McpRunEnvelopeV0Alpha1,
): McpRunMetadataV0Alpha1 {
  return {
    runId: envelope.runId,
    revision: envelope.revision,
    subject: envelope.run.contract.subject,
    contexts: envelope.run.contract.contexts,
    eventCount: envelope.run.events.length,
    latestRecordedThrough:
      envelope.run.events.length === 0 ? null : envelope.run.events.length - 1,
    runDigest: envelope.runDigest,
  };
}

function parseContractInput(value: unknown): TimelineContractV0Alpha3 {
  try {
    const contract = parseContractV0Alpha3(value, MCP_DOCUMENT_LIMITS);
    if (
      contract.axes.length > MCP_KERNEL_LIMITS.maxAxes ||
      contract.contexts.length > MCP_KERNEL_LIMITS.maxContexts
    ) {
      throw new TimelineMcpError(
        "timeline.mcp.store.limit",
        "contract exceeds the MCP server limits",
      );
    }
    return contract;
  } catch (error) {
    if (error instanceof TimelineMcpError) throw error;
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "contract is invalid",
    );
  }
}

function parseDraft(value: unknown): TemporalEventDraftV0Alpha3 {
  const draft = exactRecord(value, undefined, "event draft");
  if ("schema" in draft || "sequence" in draft) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "event draft must omit schema and sequence",
    );
  }
  if (typeof draft.id !== "string" || !IDENTIFIER.test(draft.id)) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "event draft ID is invalid",
    );
  }
  materializeEvent(draft as TemporalEventDraftV0Alpha3, 0);
  return draft as TemporalEventDraftV0Alpha3;
}

function materializeEvent(
  draft: TemporalEventDraftV0Alpha3,
  sequence: number,
): TemporalEventV0Alpha3 {
  try {
    return parseEventV0Alpha3(
      {
        ...draft,
        schema: "covenant.timeline.event.v0alpha3",
        sequence,
      },
      MCP_DOCUMENT_LIMITS,
    );
  } catch {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "event draft is invalid",
    );
  }
}

function parseInputRun(value: unknown): TimelineRunDocumentV0Alpha3 {
  try {
    const run = parseRunDocumentV0Alpha3(value, MCP_DOCUMENT_LIMITS);
    enforceRunLimits(run);
    return run;
  } catch (error) {
    if (error instanceof TimelineMcpError) throw error;
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "event is not valid for this timeline",
    );
  }
}

function parseStoredRun(value: unknown): TimelineRunDocumentV0Alpha3 {
  try {
    const run = parseRunDocumentV0Alpha3(value, MCP_DOCUMENT_LIMITS);
    enforceRunLimits(run);
    return run;
  } catch (error) {
    if (
      error instanceof TimelineMcpError &&
      error.code === "timeline.mcp.store.limit"
    ) {
      throw error;
    }
    corrupt("stored timeline run is invalid");
  }
}

function enforceRunLimits(run: TimelineRunDocumentV0Alpha3): void {
  let points = 0;
  let intervals = 0;
  let assertions = 0;

  for (const event of run.events) {
    if (event.type === "point.declared") points += 1;
    else if (event.type === "interval.declared") intervals += 1;
    else if (
      event.type === "constraint.asserted" ||
      event.type === "coordinate.asserted" ||
      event.type === "fact.asserted"
    ) {
      assertions += 1;
    }
  }

  if (
    run.events.length > MCP_KERNEL_LIMITS.maxEvents ||
    run.contract.axes.length > MCP_KERNEL_LIMITS.maxAxes ||
    run.contract.contexts.length > MCP_KERNEL_LIMITS.maxContexts ||
    points > MCP_KERNEL_LIMITS.maxPoints ||
    intervals > MCP_KERNEL_LIMITS.maxIntervals ||
    assertions > MCP_KERNEL_LIMITS.maxAssertions
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.store.limit",
      "timeline exceeds the MCP server limits",
    );
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[] | undefined,
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    if (label === "event draft") {
      throw new TimelineMcpError(
        "timeline.mcp.input.invalid",
        "event draft must be an object",
      );
    }
    corrupt(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.getOwnPropertySymbols(record).length > 0 ||
    Object.values(Object.getOwnPropertyDescriptors(record)).some(
      (descriptor) => !("value" in descriptor),
    )
  ) {
    if (label === "event draft") {
      throw new TimelineMcpError(
        "timeline.mcp.input.invalid",
        "event draft fields are invalid",
      );
    }
    corrupt(`${label} fields are invalid`);
  }
  if (
    keys &&
    (Object.keys(record).length !== keys.length ||
      keys.some((key) => !(key in record)))
  ) {
    corrupt(`${label} fields are invalid`);
  }
  return record;
}

function assertConstantObject(
  value: unknown,
  expected: Readonly<Record<string, string>>,
  label: string,
): void {
  const record = exactRecord(value, Object.keys(expected), label);
  if (
    Object.entries(expected).some(([key, expectedValue]) => {
      return record[key] !== expectedValue;
    })
  ) {
    corrupt(`stored timeline ${label} is unsupported`);
  }
}

function parseImplementation(value: unknown): McpRunImplementationV0Alpha1 {
  const record = exactRecord(
    value,
    Object.keys(MCP_IMPLEMENTATION),
    "implementation",
  );
  if (
    record.timelinePackage !== MCP_IMPLEMENTATION.timelinePackage ||
    record.timelineVersion !== MCP_IMPLEMENTATION.timelineVersion ||
    record.reasoner !== MCP_IMPLEMENTATION.reasoner ||
    record.serverPackage !== MCP_IMPLEMENTATION.serverPackage ||
    typeof record.serverVersion !== "string" ||
    record.serverVersion.length > 64 ||
    !SERVER_VERSION.test(record.serverVersion)
  ) {
    corrupt("stored timeline implementation is unsupported");
  }
  return {
    timelinePackage: MCP_IMPLEMENTATION.timelinePackage,
    timelineVersion: MCP_IMPLEMENTATION.timelineVersion,
    reasoner: MCP_IMPLEMENTATION.reasoner,
    serverPackage: MCP_IMPLEMENTATION.serverPackage,
    serverVersion: record.serverVersion,
  };
}

function assertRunId(runId: string): void {
  if (typeof runId !== "string" || !IDENTIFIER.test(runId)) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "timeline ID is invalid",
    );
  }
}

function parseListPageOptions(value: unknown): {
  cursor: string | undefined;
  limit: number;
} {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalidPageOptions();
  }
  const options = value as Record<string, unknown>;
  const descriptors = Object.getOwnPropertyDescriptors(options);
  if (
    Object.getOwnPropertySymbols(options).length > 0 ||
    Object.values(descriptors).some((descriptor) => !("value" in descriptor)) ||
    Object.keys(options).some((key) => key !== "cursor" && key !== "limit")
  ) {
    invalidPageOptions();
  }

  const cursor = options.cursor;
  if (
    cursor !== undefined &&
    (typeof cursor !== "string" || !PAGE_CURSOR.test(cursor))
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "timeline page cursor is invalid or stale",
    );
  }
  const limit =
    options.limit === undefined ? MAX_LIST_PAGE_SIZE : options.limit;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIST_PAGE_SIZE
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      `timeline page limit must be an integer from 1 through ${MAX_LIST_PAGE_SIZE}`,
    );
  }
  return { cursor, limit };
}

function pageCatalogDigest(files: readonly string[]): string {
  return contentDigest(files as unknown as JsonValue).slice(7);
}

function pageFileDigest(file: string): string {
  return contentDigest(file as unknown as JsonValue).slice(7);
}

function pageCursorFor(catalogDigest: string, file: string): string {
  return `v1.${catalogDigest}.${pageFileDigest(file)}`;
}

function invalidPageOptions(): never {
  throw new TimelineMcpError(
    "timeline.mcp.input.invalid",
    "timeline page options are invalid",
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

function corrupt(message: string): never {
  throw new TimelineMcpError("timeline.mcp.store.corrupt", message);
}

async function readBoundedUtf8(
  path: string,
  maxBytes: number,
): Promise<string> {
  const link = await lstat(path);
  if (!link.isFile()) {
    throw new TimelineMcpError(
      "timeline.mcp.store.corrupt",
      "stored timeline is not a regular file",
    );
  }

  const flags =
    process.platform === "win32"
      ? "r"
      : fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW ?? 0) |
        fsConstants.O_NONBLOCK;
  const handle = await open(path, flags);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.dev !== link.dev ||
      stat.ino !== link.ino ||
      !Number.isSafeInteger(stat.size) ||
      stat.size < 0
    ) {
      throw new TimelineMcpError(
        "timeline.mcp.store.corrupt",
        "stored timeline changed while opening",
      );
    }
    if (stat.size > maxBytes) {
      throw new TimelineMcpError(
        "timeline.mcp.store.limit",
        "stored timeline exceeds its byte limit",
      );
    }

    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        null,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) {
      throw new TimelineMcpError(
        "timeline.mcp.store.corrupt",
        "stored timeline changed while reading",
      );
    }

    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, offset),
      );
    } catch {
      throw new TimelineMcpError(
        "timeline.mcp.store.corrupt",
        "stored timeline is not valid UTF-8",
      );
    }
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function cleanupTemporary(
  handle: FileHandle | undefined,
  path: string,
): Promise<unknown> {
  let failure: unknown;
  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      failure = error;
    }
  }
  try {
    await unlink(path);
  } catch (error) {
    if (!isFileError(error, "ENOENT") && !failure) failure = error;
  }
  return failure;
}

async function releaseLock(lock: FileHandle, path: string): Promise<unknown> {
  let failure: unknown;
  try {
    await lock.close();
  } catch (error) {
    failure = error;
  }
  try {
    await unlink(path);
  } catch (error) {
    if (!failure) failure = error;
  }
  return failure;
}

function persistenceError(
  error: unknown,
  committed: boolean,
): TimelineMcpError {
  if (error instanceof TimelineMcpError) return error;
  return new TimelineMcpError(
    committed ? "timeline.mcp.store.indeterminate" : "timeline.mcp.internal",
    committed
      ? "timeline write may have committed; reload before retrying"
      : "timeline write failed",
  );
}

function sanitizeFileError(error: unknown): TimelineMcpError {
  if (error instanceof TimelineMcpError) return error;
  return new TimelineMcpError(
    "timeline.mcp.internal",
    "timeline store operation failed",
  );
}

function isFileError(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertAtMost(value: number, maximum: number, name: string): void {
  if (value > maximum) {
    throw new RangeError(`${name} must not exceed ${maximum}`);
  }
}

import { createHash, randomUUID, type Hash } from "node:crypto";
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
  MCP_DOCUMENT_LIMITS,
  MCP_WRITER_IDENTITY,
  MCP_KERNEL_LIMITS,
  MAX_LIST_PAGE_SIZE,
  MAX_MODEL_PROPOSAL_EVENTS,
} from "./constants.js";
import { TimelineMcpError } from "./errors.js";
import { requireVerifiedModelProposalAdmission } from "./model-admission.js";
import type {
  AdmitCompiledEventsResultV0Alpha2,
  AppendEventResultV0Alpha2,
  CreateRunResultV0Alpha2,
  ExpectedRunPrefixV0Alpha2,
  McpAdmissionDecisionV0Alpha1,
  McpAdmissionRecordV0Alpha1,
  McpDirectAdmissionRecordV0Alpha1,
  McpModelProposalAdmissionRecordV0Alpha1,
  McpRunEnvelopeV0Alpha2,
  McpWriterIdentityV0Alpha1,
  McpRunListPageOptionsV0Alpha2,
  McpRunListPageV0Alpha2,
  McpRunMetadataV0Alpha2,
  TemporalEventDraftV0Alpha3,
} from "./types.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const POLICY_REFERENCE = /^[\x21-\x7e]{1,512}$/;
const SERVER_VERSION = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/;
const STORED_FILE = /^[0-9a-f]{64}\.json$/;
const PAGE_CURSOR = /^v1\.[0-9a-f]{64}\.[0-9a-f]{64}$/;

export interface FileMcpRunStoreOptions {
  maxBytes?: number;
  maxRuns?: number;
}

export interface McpRunStore {
  list(): Promise<readonly McpRunMetadataV0Alpha2[]>;
  listPage(
    options?: McpRunListPageOptionsV0Alpha2,
  ): Promise<McpRunListPageV0Alpha2>;
  load(runId: string): Promise<McpRunEnvelopeV0Alpha2 | undefined>;
  require(runId: string): Promise<McpRunEnvelopeV0Alpha2>;
  create(contract: unknown): Promise<CreateRunResultV0Alpha2>;
  append(
    runId: string,
    draft: unknown,
    expectedRunDigest: string,
    admission: unknown,
  ): Promise<AppendEventResultV0Alpha2>;
  admitVerifiedModelProposal(
    permit: unknown,
    admission: unknown,
  ): Promise<AdmitCompiledEventsResultV0Alpha2>;
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

  async list(): Promise<readonly McpRunMetadataV0Alpha2[]> {
    await this.ensureDirectory();
    const files = await this.storedFiles();
    if (files.length > this.maxRuns) {
      throw new TimelineMcpError(
        "timeline.mcp.store.limit",
        "timeline store exceeds its run limit",
      );
    }

    const timelines: McpRunMetadataV0Alpha2[] = [];
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
    options: McpRunListPageOptionsV0Alpha2 = {},
  ): Promise<McpRunListPageV0Alpha2> {
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
    const timelines: McpRunMetadataV0Alpha2[] = [];
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

  async load(runId: string): Promise<McpRunEnvelopeV0Alpha2 | undefined> {
    assertRunId(runId);
    return this.loadUnlocked(runId);
  }

  async require(runId: string): Promise<McpRunEnvelopeV0Alpha2> {
    const envelope = await this.load(runId);
    if (!envelope) {
      throw new TimelineMcpError(
        "timeline.mcp.store.not-found",
        "timeline does not exist",
      );
    }
    return envelope;
  }

  async create(contractValue: unknown): Promise<CreateRunResultV0Alpha2> {
    const contract = structuredClone(parseContractInput(contractValue));
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
    admissionValue: unknown,
  ): Promise<AppendEventResultV0Alpha2> {
    assertRunId(runId);
    if (!DIGEST.test(expectedRunDigest)) {
      throw new TimelineMcpError(
        "timeline.mcp.input.invalid",
        "expectedRunDigest must be a SHA-256 digest",
      );
    }
    const draft = structuredClone(parseDraft(draftValue));
    const admission = { ...parseAdmissionDecision(admissionValue) };
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
        const admissionRecord = directAdmissionForEvent(current, existing.id);
        const expectedAdmission = createDirectAdmissionRecord(
          current.run,
          existing.sequence,
          existing.id,
          admission,
          admissionRecord.writer,
        );
        if (!sameJson(admissionRecord, expectedAdmission)) {
          throw new TimelineMcpError(
            "timeline.mcp.store.conflict",
            "event ID already has a different admission decision",
          );
        }
        return {
          envelope: current,
          event: existing,
          admissionRecord,
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
      const admissionRecord = createDirectAdmissionRecord(
        current.run,
        current.revision,
        event.id,
        admission,
      );
      const envelope = createEnvelope(run, [
        ...current.admissions,
        admissionRecord,
      ]);
      await this.persist(runId, envelope);
      return { envelope, event, admissionRecord, appended: true };
    });
  }

  async admitVerifiedModelProposal(
    permitValue: unknown,
    admissionValue: unknown,
  ): Promise<AdmitCompiledEventsResultV0Alpha2> {
    const { artifact } = requireVerifiedModelProposalAdmission(permitValue);
    const { runId, events: eventValues, exactPrefix: expected } = artifact;
    assertRunId(runId);
    const prefix = parseExpectedPrefix(expected);
    const events = parseCompiledEvents(eventValues, prefix.revision);
    const decision = parseAdmissionDecision(admissionValue);
    const admission = {
      ...decision,
      candidateDigest: artifact.candidateDigest,
      proposalDigest: artifact.proposalDigest,
    };
    await this.ensureDirectory();

    return this.withLock(this.lockPath(runId), async () => {
      const current = await this.loadUnlocked(runId);
      if (!current) {
        throw new TimelineMcpError(
          "timeline.mcp.store.not-found",
          "timeline does not exist",
        );
      }
      bindRunPrefix(current, prefix);

      const existing = current.run.events.slice(
        prefix.revision,
        prefix.revision + events.length,
      );
      if (existing.length === events.length) {
        if (existing.every((event, index) => sameJson(event, events[index]))) {
          if (events.length === 0) {
            return {
              envelope: current,
              events: existing,
              admissionRecord: null,
              admissionStatus: "empty-candidate",
            };
          }
          const admissionRecord = modelAdmissionForEvent(
            current,
            events[0]!.id,
          );
          const expectedAdmission = createModelProposalAdmissionRecord(
            current.run,
            prefix.revision,
            events.map(({ id }) => id),
            admission,
            admissionRecord.writer,
          );
          if (!sameJson(admissionRecord, expectedAdmission)) {
            throw batchConflict();
          }
          return {
            envelope: current,
            events: existing,
            admissionRecord,
            admissionStatus: "already-admitted",
          };
        }
        throw batchConflict();
      }
      if (
        existing.length > 0 ||
        current.revision !== prefix.revision ||
        events.some((candidate) =>
          current.run.events.some(({ id }) => id === candidate.id),
        )
      ) {
        throw batchConflict();
      }

      const run = parseInputRun({
        ...current.run,
        events: [...current.run.events, ...events],
      });
      const admissionRecord =
        events.length === 0
          ? null
          : createModelProposalAdmissionRecord(
              current.run,
              prefix.revision,
              events.map(({ id }) => id),
              admission,
            );
      const envelope = admissionRecord
        ? createEnvelope(run, [...current.admissions, admissionRecord])
        : current;
      if (admissionRecord) {
        await this.persist(runId, envelope);
      }
      return {
        envelope,
        events,
        admissionRecord,
        admissionStatus: events.length > 0 ? "admitted" : "empty-candidate",
      };
    });
  }

  private async loadUnlocked(
    runId: string,
  ): Promise<McpRunEnvelopeV0Alpha2 | undefined> {
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

  private async loadPath(path: string): Promise<McpRunEnvelopeV0Alpha2> {
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
      const envelope = parseMcpRunEnvelopeV0Alpha2(parseJson(text));
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
    envelope: McpRunEnvelopeV0Alpha2,
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

export function parseMcpRunEnvelopeV0Alpha2(
  value: unknown,
): McpRunEnvelopeV0Alpha2 {
  const envelope = exactRecord(
    value,
    [
      "schema",
      "runId",
      "revision",
      "runDigest",
      "admissions",
      "lastWriter",
      "run",
    ],
    "stored timeline",
  );
  if (envelope.schema !== "covenant.timeline.mcp-run.v0alpha2") {
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
  const lastWriter = parseWriterIdentity(envelope.lastWriter);

  const run = parseStoredRun(envelope.run);
  const admissions = parseStoredAdmissions(envelope.admissions, run);
  const finalAdmission = admissions.at(-1);
  if (finalAdmission && !sameJson(lastWriter, finalAdmission.writer)) {
    corrupt("stored timeline last writer does not match its final admission");
  }
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
    schema: "covenant.timeline.mcp-run.v0alpha2",
    runId: envelope.runId,
    revision: envelope.revision,
    runDigest,
    admissions,
    lastWriter,
    run,
  };
}

function createEnvelope(
  run: TimelineRunDocumentV0Alpha3,
  admissions: readonly McpAdmissionRecordV0Alpha1[] = [],
): McpRunEnvelopeV0Alpha2 {
  enforceRunLimits(run);
  validateAdmissionCoverage(admissions, run);
  return {
    schema: "covenant.timeline.mcp-run.v0alpha2",
    runId: run.contract.id,
    revision: run.events.length,
    runDigest: contentDigest(run as unknown as JsonValue),
    admissions,
    lastWriter: MCP_WRITER_IDENTITY,
    run,
  };
}

export function metadataForEnvelope(
  envelope: McpRunEnvelopeV0Alpha2,
): McpRunMetadataV0Alpha2 {
  return {
    runId: envelope.runId,
    revision: envelope.revision,
    auditDigest: contentDigest(envelope as unknown as JsonValue),
    subject: envelope.run.contract.subject,
    contexts: envelope.run.contract.contexts,
    eventCount: envelope.run.events.length,
    admissionCount: envelope.admissions.length,
    latestRecordedThrough:
      envelope.run.events.length === 0 ? null : envelope.run.events.length - 1,
    runDigest: envelope.runDigest,
  };
}

export function bindRunPrefix(
  envelope: McpRunEnvelopeV0Alpha2,
  expectedValue: ExpectedRunPrefixV0Alpha2,
): TimelineRunDocumentV0Alpha3 {
  const expected = parseExpectedPrefix(expectedValue);
  if (expected.revision > envelope.revision) throw batchConflict();
  const run: TimelineRunDocumentV0Alpha3 = {
    schema: "covenant.timeline.run.v0alpha3",
    contract: envelope.run.contract,
    events: envelope.run.events.slice(0, expected.revision),
  };
  if (contentDigest(run as unknown as JsonValue) !== expected.runDigest) {
    throw batchConflict();
  }
  return run;
}

function parseAdmissionDecision(value: unknown): McpAdmissionDecisionV0Alpha1 {
  const decision = exactInputRecord(
    value,
    ["authorityId", "policyRef", "policyDigest"],
    "admission decision",
  );
  if (
    typeof decision.authorityId !== "string" ||
    !IDENTIFIER.test(decision.authorityId)
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "admission authority ID is invalid",
    );
  }
  if (
    typeof decision.policyRef !== "string" ||
    !POLICY_REFERENCE.test(decision.policyRef)
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "admission policy reference is invalid",
    );
  }
  if (
    typeof decision.policyDigest !== "string" ||
    !DIGEST.test(decision.policyDigest)
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "admission policy digest is invalid",
    );
  }
  return decision as unknown as McpAdmissionDecisionV0Alpha1;
}

function createDirectAdmissionRecord(
  run: TimelineRunDocumentV0Alpha3,
  baseRevision: number,
  eventId: string,
  decision: McpAdmissionDecisionV0Alpha1,
  writer: McpWriterIdentityV0Alpha1 = MCP_WRITER_IDENTITY,
): McpDirectAdmissionRecordV0Alpha1 {
  return withRecordDigest({
    schema: "covenant.timeline.mcp-admission.v0alpha1",
    kind: "direct-event",
    decision: "admitted",
    ...decision,
    writer,
    baseRevision,
    baseRunDigest: digestRunPrefix(run, baseRevision),
    eventIds: [eventId],
  });
}

function createModelProposalAdmissionRecord(
  run: TimelineRunDocumentV0Alpha3,
  baseRevision: number,
  eventIds: readonly string[],
  admission: McpAdmissionDecisionV0Alpha1 & {
    candidateDigest: `sha256:${string}`;
    proposalDigest: `sha256:${string}`;
  },
  writer: McpWriterIdentityV0Alpha1 = MCP_WRITER_IDENTITY,
): McpModelProposalAdmissionRecordV0Alpha1 {
  return withRecordDigest({
    schema: "covenant.timeline.mcp-admission.v0alpha1",
    kind: "model-proposal",
    decision: "admitted",
    authorityId: admission.authorityId,
    policyRef: admission.policyRef,
    policyDigest: admission.policyDigest,
    writer,
    baseRevision,
    baseRunDigest: digestRunPrefix(run, baseRevision),
    eventIds,
    candidateDigest: admission.candidateDigest as `sha256:${string}`,
    proposalDigest: admission.proposalDigest as `sha256:${string}`,
  });
}

function withRecordDigest<
  T extends Omit<McpAdmissionRecordV0Alpha1, "recordDigest">,
>(record: T): T & { recordDigest: `sha256:${string}` } {
  return {
    ...record,
    recordDigest: contentDigest(record as unknown as JsonValue),
  };
}

function digestRunPrefix(
  run: TimelineRunDocumentV0Alpha3,
  revision: number,
): `sha256:${string}` {
  return contentDigest({
    schema: "covenant.timeline.run.v0alpha3",
    contract: run.contract,
    events: run.events.slice(0, revision),
  } as unknown as JsonValue);
}

function admissionForEvent(
  envelope: McpRunEnvelopeV0Alpha2,
  eventId: string,
): McpAdmissionRecordV0Alpha1 {
  const record = envelope.admissions.find(({ eventIds }) =>
    eventIds.includes(eventId),
  );
  if (!record) {
    throw new TimelineMcpError(
      "timeline.mcp.store.corrupt",
      "stored event has no admission record",
    );
  }
  return record;
}

function directAdmissionForEvent(
  envelope: McpRunEnvelopeV0Alpha2,
  eventId: string,
): McpDirectAdmissionRecordV0Alpha1 {
  const record = admissionForEvent(envelope, eventId);
  if (record.kind !== "direct-event") throw batchConflict();
  return record;
}

function modelAdmissionForEvent(
  envelope: McpRunEnvelopeV0Alpha2,
  eventId: string,
): McpModelProposalAdmissionRecordV0Alpha1 {
  const record = admissionForEvent(envelope, eventId);
  if (record.kind !== "model-proposal") throw batchConflict();
  return record;
}

function parseStoredAdmissions(
  value: unknown,
  run: TimelineRunDocumentV0Alpha3,
): readonly McpAdmissionRecordV0Alpha1[] {
  if (!Array.isArray(value) || value.length > run.events.length) {
    corrupt("stored timeline admissions are invalid");
  }
  const admissions = value.map(parseStoredAdmission);
  validateAdmissionCoverage(admissions, run);
  return admissions;
}

function parseStoredAdmission(value: unknown): McpAdmissionRecordV0Alpha1 {
  const base = exactRecord(value, undefined, "admission record");
  const modelProposal = base.kind === "model-proposal";
  const keys = [
    "schema",
    "kind",
    "decision",
    "authorityId",
    "policyRef",
    "policyDigest",
    "writer",
    "baseRevision",
    "baseRunDigest",
    "eventIds",
    ...(modelProposal ? ["candidateDigest", "proposalDigest"] : []),
    "recordDigest",
  ];
  exactRecord(value, keys, "admission record");
  if (
    base.schema !== "covenant.timeline.mcp-admission.v0alpha1" ||
    (base.kind !== "direct-event" && base.kind !== "model-proposal") ||
    base.decision !== "admitted"
  ) {
    corrupt("stored admission identity is invalid");
  }
  let decision: McpAdmissionDecisionV0Alpha1;
  let writer: McpWriterIdentityV0Alpha1;
  try {
    decision = parseAdmissionDecision({
      authorityId: base.authorityId,
      policyRef: base.policyRef,
      policyDigest: base.policyDigest,
    });
    writer = parseWriterIdentity(base.writer);
  } catch {
    corrupt("stored admission decision or writer is invalid");
  }
  if (
    typeof base.baseRevision !== "number" ||
    !Number.isSafeInteger(base.baseRevision) ||
    base.baseRevision < 0 ||
    typeof base.baseRunDigest !== "string" ||
    !DIGEST.test(base.baseRunDigest) ||
    !Array.isArray(base.eventIds) ||
    base.eventIds.length === 0 ||
    base.eventIds.length > MAX_MODEL_PROPOSAL_EVENTS ||
    base.eventIds.some(
      (id) => typeof id !== "string" || !IDENTIFIER.test(id),
    ) ||
    new Set(base.eventIds).size !== base.eventIds.length ||
    typeof base.recordDigest !== "string" ||
    !DIGEST.test(base.recordDigest)
  ) {
    corrupt("stored admission fields are invalid");
  }
  if (base.kind === "direct-event" && base.eventIds.length !== 1) {
    corrupt("stored direct admission event count is invalid");
  }
  if (
    modelProposal &&
    (typeof base.candidateDigest !== "string" ||
      !DIGEST.test(base.candidateDigest) ||
      typeof base.proposalDigest !== "string" ||
      !DIGEST.test(base.proposalDigest))
  ) {
    corrupt("stored model proposal admission digest is invalid");
  }
  const { recordDigest, ...unsigned } = base;
  if (contentDigest(unsigned as JsonValue) !== recordDigest) {
    corrupt("stored admission digest does not match its record");
  }
  return {
    ...unsigned,
    ...decision,
    writer,
    recordDigest,
  } as unknown as McpAdmissionRecordV0Alpha1;
}

function validateAdmissionCoverage(
  admissions: readonly McpAdmissionRecordV0Alpha1[],
  run: TimelineRunDocumentV0Alpha3,
): void {
  const prefixHash = createRunPrefixHash(run);
  let revision = 0;
  for (const admission of admissions) {
    if (
      admission.baseRevision !== revision ||
      admission.baseRunDigest !== finishRunPrefixHash(prefixHash)
    ) {
      corrupt("stored admission prefix is invalid");
    }

    for (const eventId of admission.eventIds) {
      const event = run.events[revision];
      if (!event || event.id !== eventId) {
        corrupt("stored admission events do not match the run");
      }
      if (revision > 0) prefixHash.update(",");
      prefixHash.update(canonicalJson(event as unknown as JsonValue));
      revision += 1;
    }
  }
  if (revision !== run.events.length) {
    corrupt("stored timeline events are not fully admitted");
  }
}

function createRunPrefixHash(run: TimelineRunDocumentV0Alpha3): Hash {
  return createHash("sha256")
    .update('{"contract":')
    .update(canonicalJson(run.contract as unknown as JsonValue))
    .update(',"events":[');
}

function finishRunPrefixHash(hash: Hash): `sha256:${string}` {
  const digest = hash
    .copy()
    .update('],"schema":"covenant.timeline.run.v0alpha3"}')
    .digest("hex");
  return `sha256:${digest}`;
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

function parseExpectedPrefix(
  value: unknown,
): ExpectedRunPrefixV0Alpha2 & { runDigest: `sha256:${string}` } {
  const prefix = exactInputRecord(value, ["revision", "runDigest"], "prefix");
  if (
    typeof prefix.revision !== "number" ||
    !Number.isSafeInteger(prefix.revision) ||
    prefix.revision < 0
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "expected revision must be a non-negative safe integer",
    );
  }
  if (typeof prefix.runDigest !== "string" || !DIGEST.test(prefix.runDigest)) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "expected run digest must be a SHA-256 digest",
    );
  }
  return prefix as unknown as ExpectedRunPrefixV0Alpha2 & {
    runDigest: `sha256:${string}`;
  };
}

function parseCompiledEvents(
  value: unknown,
  expectedRevision: number,
): readonly TemporalEventV0Alpha3[] {
  if (!Array.isArray(value)) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "compiled events must be an array",
    );
  }
  if (value.length > MAX_MODEL_PROPOSAL_EVENTS) {
    throw new TimelineMcpError(
      "timeline.mcp.store.limit",
      `compiled event count must not exceed ${MAX_MODEL_PROPOSAL_EVENTS}`,
    );
  }
  if (expectedRevision + value.length > Number.MAX_SAFE_INTEGER) {
    throw new TimelineMcpError(
      "timeline.mcp.store.limit",
      "compiled event sequence exceeds the safe integer range",
    );
  }
  const events = value.map((event) => {
    try {
      return parseEventV0Alpha3(event, MCP_DOCUMENT_LIMITS);
    } catch {
      throw new TimelineMcpError(
        "timeline.mcp.input.invalid",
        "compiled event is invalid",
      );
    }
  });
  if (
    events.some(({ sequence }, index) => sequence !== expectedRevision + index)
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "compiled event sequence does not match the expected run prefix",
    );
  }
  if (new Set(events.map(({ id }) => id)).size !== events.length) {
    throw batchConflict();
  }
  return events;
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

function exactInputRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      `${label} must be an object`,
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.getOwnPropertySymbols(record).length > 0 ||
    Object.values(Object.getOwnPropertyDescriptors(record)).some(
      (descriptor) => !("value" in descriptor),
    ) ||
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      `${label} fields are invalid`,
    );
  }
  return record;
}

function parseWriterIdentity(value: unknown): McpWriterIdentityV0Alpha1 {
  const record = exactRecord(
    value,
    Object.keys(MCP_WRITER_IDENTITY),
    "writer identity",
  );
  if (
    record.timelinePackage !== MCP_WRITER_IDENTITY.timelinePackage ||
    record.timelineVersion !== MCP_WRITER_IDENTITY.timelineVersion ||
    record.reasoner !== MCP_WRITER_IDENTITY.reasoner ||
    record.serverPackage !== MCP_WRITER_IDENTITY.serverPackage ||
    typeof record.serverVersion !== "string" ||
    record.serverVersion.length > 64 ||
    !SERVER_VERSION.test(record.serverVersion)
  ) {
    corrupt("stored timeline writer identity is unsupported");
  }
  return {
    timelinePackage: MCP_WRITER_IDENTITY.timelinePackage,
    timelineVersion: MCP_WRITER_IDENTITY.timelineVersion,
    reasoner: MCP_WRITER_IDENTITY.reasoner,
    serverPackage: MCP_WRITER_IDENTITY.serverPackage,
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

function batchConflict(): TimelineMcpError {
  return new TimelineMcpError(
    "timeline.mcp.store.conflict",
    "compiled event batch does not match the expected timeline prefix",
  );
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

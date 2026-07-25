import {
  TimelineContractError,
  validateContract,
  type TimelineContract,
} from "./contract.js";
import { TimelineDocumentError, validateEvent } from "./document.js";
import { contentDigest, type JsonValue } from "./identity.js";
import {
  resolveTimelineLimits,
  type TimelineLimitOptions,
  type TimelineLimits,
} from "./limits.js";

export interface Evidence {
  id: string;
  kind: string;
  claims: readonly string[];
  payloadDigest: `sha256:${string}`;
  producer: string;
}

export interface Receipt {
  id: string;
  commandId: string;
  status: "succeeded" | "failed" | "indeterminate";
  effectDigest: `sha256:${string}`;
}

interface EventBase {
  schema: "covenant.timeline.event.v0alpha1";
  id: string;
  sequence: number;
}

export interface EvidenceRecorded extends EventBase {
  type: "evidence.recorded";
  evidence: Evidence;
}

export interface CheckpointEvaluated extends EventBase {
  type: "checkpoint.evaluated";
  checkpointId: string;
  evidenceRefs: readonly string[];
  policyRef: string;
}

export interface ReceiptRecorded extends EventBase {
  type: "receipt.recorded";
  receipt: Receipt;
}

export type RunEvent = EvidenceRecorded | CheckpointEvaluated | ReceiptRecorded;

export interface CheckpointDecision {
  schema: "covenant.timeline.decision.v0alpha1";
  checkpointId: string;
  outcome: "accepted" | "rejected";
  policyRef: string;
  evidenceRefs: readonly string[];
  missingRequirements: readonly string[];
}

export interface Command {
  schema: "covenant.timeline.command.v0alpha1";
  id: string;
  kind: string;
  payloadRef: string;
  idempotencyKey: string;
  replayPolicy: "forbid";
}

export interface CheckpointState {
  status: "pending" | "accepted" | "rejected";
  decision?: CheckpointDecision;
}

export interface Finding {
  code:
    | "timeline.checkpoint.finalized"
    | "timeline.checkpoint.unknown"
    | "timeline.command.unknown"
    | "timeline.event.duplicate"
    | "timeline.evidence.duplicate"
    | "timeline.evidence.unknown"
    | "timeline.receipt.duplicate"
    | "timeline.receipt.id_duplicate";
  eventId: string;
  detail: string;
}

export interface RunState {
  contractId: string;
  runId: string;
  nextSequence: number;
  eventIds: Readonly<Record<string, number>>;
  checkpoints: Readonly<Record<string, CheckpointState>>;
  evidence: Readonly<Record<string, Evidence>>;
  commands: Readonly<Record<string, Command>>;
  receipts: Readonly<Record<string, Receipt>>;
  findings: readonly Finding[];
}

export interface TimelineReduced {
  state: RunState;
  decision?: CheckpointDecision;
  commands: readonly Command[];
}

export interface VerifyRunResult {
  scope: "structural";
  evidenceAuthority: "external";
  effectAuthority: "external";
  ok: boolean;
  pendingCheckpoints: readonly string[];
  rejectedCheckpoints: readonly string[];
  unresolvedCommands: readonly string[];
  failedCommands: readonly string[];
  findings: readonly Finding[];
}

export type TimelineInputErrorCode =
  | "timeline.event.sequence"
  | "timeline.run.contract_mismatch"
  | "timeline.run.id"
  | "timeline.run.limit";

export class TimelineInputError extends RangeError {
  constructor(
    readonly code: TimelineInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TimelineInputError";
  }
}

interface MutableRunState {
  contractId: string;
  runId: string;
  nextSequence: number;
  eventIds: Record<string, number>;
  checkpoints: Record<string, CheckpointState>;
  evidence: Record<string, Evidence>;
  commands: Record<string, Command>;
  receipts: Record<string, Receipt>;
  findings: Finding[];
}

interface StateMetadata {
  contractDigest: `sha256:${string}`;
  receiptIds: Record<string, string>;
}

const stateMetadata = new WeakMap<RunState, StateMetadata>();

export function createRun(
  contract: TimelineContract,
  runId: string,
  options: TimelineLimitOptions = {},
): RunState {
  const limits = resolveTimelineLimits(options);
  const issues = validateContract(contract, limits);
  if (issues.length > 0) throw new TimelineContractError(issues);
  if (!/^[a-z0-9][a-z0-9._:/-]{0,127}$/.test(runId)) {
    throw new TimelineInputError(
      "timeline.run.id",
      "runId must be a lowercase portable identifier",
    );
  }

  const state: MutableRunState = {
    contractId: contract.id,
    runId,
    nextSequence: 0,
    eventIds: {},
    checkpoints: Object.fromEntries(
      contract.checkpoints.map(({ id }) => [id, { status: "pending" }]),
    ),
    evidence: {},
    commands: {},
    receipts: {},
    findings: [],
  };
  stateMetadata.set(state, {
    contractDigest: digestContract(contract, limits),
    receiptIds: {},
  });
  return state;
}

export function reduceRun(
  contract: TimelineContract,
  prior: RunState,
  event: RunEvent,
  options: TimelineLimitOptions = {},
): TimelineReduced {
  const limits = resolveTimelineLimits(options);
  const contractIssues = validateContract(contract, limits);
  if (contractIssues.length > 0) {
    throw new TimelineContractError(contractIssues);
  }
  const eventIssues = validateEvent(event, limits);
  if (eventIssues.length > 0) throw new TimelineDocumentError(eventIssues);
  const metadata = stateMetadata.get(prior);
  assertContract(contract, prior, metadata, limits);

  const cloned = cloneState(prior, metadata!);
  return applyEvent(contract, cloned.state, cloned.metadata, event);
}

export function replay(
  contract: TimelineContract,
  runId: string,
  events: readonly RunEvent[],
  options: TimelineLimitOptions = {},
): RunState {
  const limits = resolveTimelineLimits(options);
  if (events.length > limits.maxEvents) {
    throw new TimelineInputError(
      "timeline.run.limit",
      `run exceeds ${limits.maxEvents} events`,
    );
  }

  const state = createRun(contract, runId, limits) as MutableRunState;
  const metadata = stateMetadata.get(state)!;
  for (const event of events) {
    const issues = validateEvent(event, limits);
    if (issues.length > 0) throw new TimelineDocumentError(issues);
    applyEvent(contract, state, metadata, event);
  }
  return state;
}

export function verifyRun(state: RunState): VerifyRunResult {
  const pendingCheckpoints: string[] = [];
  const rejectedCheckpoints: string[] = [];
  const unresolvedCommands: string[] = [];
  const failedCommands: string[] = [];

  for (const [id, checkpoint] of Object.entries(state.checkpoints)) {
    if (checkpoint.status === "pending") pendingCheckpoints.push(id);
    if (checkpoint.status === "rejected") rejectedCheckpoints.push(id);
  }
  for (const id of Object.keys(state.commands)) {
    const receipt = state.receipts[id];
    if (!hasOwn(state.receipts, id)) {
      unresolvedCommands.push(id);
    } else if (receipt?.status !== "succeeded") {
      failedCommands.push(id);
    }
  }

  return {
    scope: "structural",
    evidenceAuthority: "external",
    effectAuthority: "external",
    ok:
      pendingCheckpoints.length === 0 &&
      rejectedCheckpoints.length === 0 &&
      unresolvedCommands.length === 0 &&
      failedCommands.length === 0 &&
      state.findings.length === 0,
    pendingCheckpoints,
    rejectedCheckpoints,
    unresolvedCommands,
    failedCommands,
    findings: state.findings,
  };
}

function applyEvent(
  contract: TimelineContract,
  state: MutableRunState,
  metadata: StateMetadata,
  event: RunEvent,
): TimelineReduced {
  if (event.sequence !== state.nextSequence) {
    throw new TimelineInputError(
      "timeline.event.sequence",
      `event sequence ${event.sequence} does not match ${state.nextSequence}`,
    );
  }

  const duplicate = hasOwn(state.eventIds, event.id);
  state.nextSequence += 1;
  state.eventIds[event.id] = event.sequence;
  if (duplicate) {
    return addFinding(state, {
      code: "timeline.event.duplicate",
      eventId: event.id,
      detail: event.id,
    });
  }
  if (event.type === "evidence.recorded") {
    return recordEvidence(state, event);
  }
  if (event.type === "checkpoint.evaluated") {
    return evaluateCheckpoint(contract, state, event);
  }
  return recordReceipt(state, metadata, event);
}

function recordEvidence(
  state: MutableRunState,
  event: EvidenceRecorded,
): TimelineReduced {
  if (hasOwn(state.evidence, event.evidence.id)) {
    return addFinding(state, {
      code: "timeline.evidence.duplicate",
      eventId: event.id,
      detail: event.evidence.id,
    });
  }

  state.evidence[event.evidence.id] = {
    ...event.evidence,
    claims: [...event.evidence.claims],
  };
  return { state, commands: [] };
}

function evaluateCheckpoint(
  contract: TimelineContract,
  state: MutableRunState,
  event: CheckpointEvaluated,
): TimelineReduced {
  const checkpoint = contract.checkpoints.find(
    ({ id }) => id === event.checkpointId,
  );
  if (!checkpoint) {
    return addFinding(state, {
      code: "timeline.checkpoint.unknown",
      eventId: event.id,
      detail: event.checkpointId,
    });
  }
  if (state.checkpoints[checkpoint.id]?.status === "accepted") {
    return addFinding(state, {
      code: "timeline.checkpoint.finalized",
      eventId: event.id,
      detail: event.checkpointId,
    });
  }

  const claims = new Set<string>();
  const unknownEvidence = event.evidenceRefs.filter((id) => {
    if (!hasOwn(state.evidence, id)) return true;
    state.evidence[id]!.claims.forEach((claim) => claims.add(claim));
    return false;
  });
  if (unknownEvidence.length > 0) {
    for (const id of unknownEvidence) {
      state.findings.push({
        code: "timeline.evidence.unknown",
        eventId: event.id,
        detail: id,
      });
    }
    return { state, commands: [] };
  }

  const missingRequirements = checkpoint.requirements.filter(
    (requirement) => !claims.has(requirement),
  );
  const decision: CheckpointDecision = {
    schema: "covenant.timeline.decision.v0alpha1",
    checkpointId: checkpoint.id,
    outcome: missingRequirements.length === 0 ? "accepted" : "rejected",
    policyRef: event.policyRef,
    evidenceRefs: [...event.evidenceRefs],
    missingRequirements,
  };
  state.checkpoints[checkpoint.id] = {
    status: decision.outcome,
    decision,
  };

  if (decision.outcome === "rejected" || !checkpoint.onAccept) {
    return { state, decision, commands: [] };
  }

  const command: Command = {
    schema: "covenant.timeline.command.v0alpha1",
    id: `${state.runId}:${checkpoint.id}:${event.sequence}`,
    kind: checkpoint.onAccept.kind,
    payloadRef: checkpoint.onAccept.payloadRef,
    idempotencyKey: `${state.runId}/${checkpoint.id}/${event.sequence}`,
    replayPolicy: "forbid",
  };
  state.commands[command.id] = command;
  return { state, decision, commands: [command] };
}

function recordReceipt(
  state: MutableRunState,
  metadata: StateMetadata,
  event: ReceiptRecorded,
): TimelineReduced {
  if (!hasOwn(state.commands, event.receipt.commandId)) {
    return addFinding(state, {
      code: "timeline.command.unknown",
      eventId: event.id,
      detail: event.receipt.commandId,
    });
  }
  if (hasOwn(state.receipts, event.receipt.commandId)) {
    return addFinding(state, {
      code: "timeline.receipt.duplicate",
      eventId: event.id,
      detail: event.receipt.commandId,
    });
  }
  if (hasOwn(metadata.receiptIds, event.receipt.id)) {
    return addFinding(state, {
      code: "timeline.receipt.id_duplicate",
      eventId: event.id,
      detail: event.receipt.id,
    });
  }

  state.receipts[event.receipt.commandId] = { ...event.receipt };
  metadata.receiptIds[event.receipt.id] = event.receipt.commandId;
  return { state, commands: [] };
}

function addFinding(state: MutableRunState, finding: Finding): TimelineReduced {
  state.findings.push(finding);
  return { state, commands: [] };
}

function assertContract(
  contract: TimelineContract,
  state: RunState,
  metadata: StateMetadata | undefined,
  limits: TimelineLimits,
): void {
  const digest = digestContract(contract, limits);
  if (
    state.contractId !== contract.id ||
    !metadata ||
    metadata.contractDigest !== digest
  ) {
    throw new TimelineInputError(
      "timeline.run.contract_mismatch",
      "run state does not belong to these exact contract bytes",
    );
  }
}

function digestContract(
  contract: TimelineContract,
  limits: TimelineLimits,
): `sha256:${string}` {
  return contentDigest(contract as unknown as JsonValue, limits);
}

function cloneState(
  state: RunState,
  metadata: StateMetadata,
): { state: MutableRunState; metadata: StateMetadata } {
  const cloned: MutableRunState = {
    ...state,
    eventIds: { ...state.eventIds },
    checkpoints: { ...state.checkpoints },
    evidence: { ...state.evidence },
    commands: { ...state.commands },
    receipts: { ...state.receipts },
    findings: [...state.findings],
  };
  const clonedMetadata = {
    contractDigest: metadata.contractDigest,
    receiptIds: { ...metadata.receiptIds },
  };
  stateMetadata.set(cloned, clonedMetadata);
  return { state: cloned, metadata: clonedMetadata };
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

import {
  TimelineContractError,
  validateContract,
  type TimelineContract,
} from "./contract.js";

export interface Evidence {
  id: string;
  kind: string;
  claims: readonly string[];
  payloadDigest: string;
  producer: string;
}

export interface Receipt {
  id: string;
  commandId: string;
  status: "succeeded" | "failed" | "indeterminate";
  effectDigest: string;
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
    | "timeline.checkpoint.unknown"
    | "timeline.command.unknown"
    | "timeline.event.duplicate"
    | "timeline.evidence.duplicate"
    | "timeline.evidence.unknown"
    | "timeline.receipt.duplicate";
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
  | "timeline.run.id";

export class TimelineInputError extends RangeError {
  constructor(
    readonly code: TimelineInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TimelineInputError";
  }
}

export function createRun(contract: TimelineContract, runId: string): RunState {
  const issues = validateContract(contract);
  if (issues.length > 0) throw new TimelineContractError(issues);
  if (!/^[a-z0-9][a-z0-9._:/-]{0,127}$/.test(runId)) {
    throw new TimelineInputError(
      "timeline.run.id",
      "runId must be a lowercase portable identifier",
    );
  }

  return {
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
}

export function reduceRun(
  contract: TimelineContract,
  prior: RunState,
  event: RunEvent,
): TimelineReduced {
  if (prior.contractId !== contract.id) {
    throw new TimelineInputError(
      "timeline.run.contract_mismatch",
      "run state does not belong to this contract",
    );
  }
  if (event.sequence !== prior.nextSequence) {
    throw new TimelineInputError(
      "timeline.event.sequence",
      `event sequence ${event.sequence} does not match ${prior.nextSequence}`,
    );
  }

  const state = advance(prior, event);
  if (prior.eventIds[event.id] !== undefined) {
    return withFinding(state, {
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
  return recordReceipt(state, event);
}

export function replay(
  contract: TimelineContract,
  runId: string,
  events: readonly RunEvent[],
): RunState {
  return events.reduce(
    (state, event) => reduceRun(contract, state, event).state,
    createRun(contract, runId),
  );
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
    if (!receipt) {
      unresolvedCommands.push(id);
    } else if (receipt.status !== "succeeded") {
      failedCommands.push(id);
    }
  }

  return {
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

function advance(prior: RunState, event: RunEvent): RunState {
  return {
    ...prior,
    nextSequence: prior.nextSequence + 1,
    eventIds: { ...prior.eventIds, [event.id]: event.sequence },
    checkpoints: { ...prior.checkpoints },
    evidence: { ...prior.evidence },
    commands: { ...prior.commands },
    receipts: { ...prior.receipts },
    findings: [...prior.findings],
  };
}

function recordEvidence(
  state: RunState,
  event: EvidenceRecorded,
): TimelineReduced {
  if (state.evidence[event.evidence.id]) {
    return withFinding(state, {
      code: "timeline.evidence.duplicate",
      eventId: event.id,
      detail: event.evidence.id,
    });
  }

  return {
    state: {
      ...state,
      evidence: { ...state.evidence, [event.evidence.id]: event.evidence },
    },
    commands: [],
  };
}

function evaluateCheckpoint(
  contract: TimelineContract,
  state: RunState,
  event: CheckpointEvaluated,
): TimelineReduced {
  const checkpoint = contract.checkpoints.find(
    ({ id }) => id === event.checkpointId,
  );
  if (!checkpoint) {
    return withFinding(state, {
      code: "timeline.checkpoint.unknown",
      eventId: event.id,
      detail: event.checkpointId,
    });
  }

  const claims = new Set<string>();
  const unknownEvidence = event.evidenceRefs.filter((id) => {
    const evidence = state.evidence[id];
    evidence?.claims.forEach((claim) => claims.add(claim));
    return !evidence;
  });
  if (unknownEvidence.length > 0) {
    const findings = unknownEvidence.map<Finding>((id) => ({
      code: "timeline.evidence.unknown",
      eventId: event.id,
      detail: id,
    }));
    return {
      state: { ...state, findings: [...state.findings, ...findings] },
      commands: [],
    };
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
  const checkpoints = {
    ...state.checkpoints,
    [checkpoint.id]: { status: decision.outcome, decision },
  };

  if (decision.outcome === "rejected" || !checkpoint.onAccept) {
    return {
      state: { ...state, checkpoints },
      decision,
      commands: [],
    };
  }

  const command: Command = {
    schema: "covenant.timeline.command.v0alpha1",
    id: `${state.runId}:${checkpoint.id}:${event.sequence}`,
    kind: checkpoint.onAccept.kind,
    payloadRef: checkpoint.onAccept.payloadRef,
    idempotencyKey: `${state.runId}/${checkpoint.id}/${event.sequence}`,
    replayPolicy: "forbid",
  };

  return {
    state: {
      ...state,
      checkpoints,
      commands: { ...state.commands, [command.id]: command },
    },
    decision,
    commands: [command],
  };
}

function recordReceipt(
  state: RunState,
  event: ReceiptRecorded,
): TimelineReduced {
  if (!state.commands[event.receipt.commandId]) {
    return withFinding(state, {
      code: "timeline.command.unknown",
      eventId: event.id,
      detail: event.receipt.commandId,
    });
  }
  if (state.receipts[event.receipt.commandId]) {
    return withFinding(state, {
      code: "timeline.receipt.duplicate",
      eventId: event.id,
      detail: event.receipt.commandId,
    });
  }

  return {
    state: {
      ...state,
      receipts: {
        ...state.receipts,
        [event.receipt.commandId]: event.receipt,
      },
    },
    commands: [],
  };
}

function withFinding(state: RunState, finding: Finding): TimelineReduced {
  return {
    state: { ...state, findings: [...state.findings, finding] },
    commands: [],
  };
}

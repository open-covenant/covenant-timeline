import { TimelineContractError } from "../contract.js";
import { TimelineDocumentError } from "../document.js";
import { contentDigest, type JsonValue } from "../identity.js";
import {
  resolveTimelineLimits,
  type TimelineLimitOptions,
  type TimelineLimits,
} from "../limits.js";
import { TimelineInputError } from "../run.js";
import {
  samePolicyBinding,
  validateContractV0Alpha2,
  type PolicyBindingV0Alpha2,
  type TimelineContractV0Alpha2,
} from "./contract.js";
import { validateEventV0Alpha2 } from "./document.js";

export interface EvidenceAuthorityV0Alpha2 extends PolicyBindingV0Alpha2 {
  proofDigest: `sha256:${string}`;
}

export interface EvidenceV0Alpha2 {
  id: string;
  kind: string;
  claims: readonly string[];
  payloadDigest: `sha256:${string}`;
  producer: string;
  authority: EvidenceAuthorityV0Alpha2;
}

export interface ReceiptV0Alpha2 {
  id: string;
  commandId: string;
  status: "succeeded" | "failed" | "indeterminate";
  effectDigest: `sha256:${string}`;
}

interface EventBaseV0Alpha2 {
  schema: "covenant.timeline.event.v0alpha2";
  id: string;
  sequence: number;
}

export interface EvidenceRecordedV0Alpha2 extends EventBaseV0Alpha2 {
  type: "evidence.recorded";
  evidence: EvidenceV0Alpha2;
}

export interface CheckpointEvaluatedV0Alpha2 extends EventBaseV0Alpha2 {
  type: "checkpoint.evaluated";
  checkpointId: string;
  evidenceRefs: readonly string[];
}

export interface ReceiptRecordedV0Alpha2 extends EventBaseV0Alpha2 {
  type: "receipt.recorded";
  receipt: ReceiptV0Alpha2;
}

export type RunEventV0Alpha2 =
  | EvidenceRecordedV0Alpha2
  | CheckpointEvaluatedV0Alpha2
  | ReceiptRecordedV0Alpha2;

export interface CheckpointDecisionV0Alpha2 {
  schema: "covenant.timeline.decision.v0alpha2";
  checkpointId: string;
  outcome: "accepted" | "rejected";
  policy: PolicyBindingV0Alpha2;
  evidenceRefs: readonly string[];
  missingRequirements: readonly string[];
}

export interface CommandV0Alpha2 {
  schema: "covenant.timeline.command.v0alpha2";
  id: string;
  kind: string;
  payloadRef: string;
  idempotencyKey: string;
  replayPolicy: "forbid";
}

export interface CheckpointStateV0Alpha2 {
  status: "pending" | "accepted" | "rejected";
  decision?: CheckpointDecisionV0Alpha2;
}

export interface FindingV0Alpha2 {
  code:
    | "timeline.checkpoint.finalized"
    | "timeline.checkpoint.unknown"
    | "timeline.command.unknown"
    | "timeline.event.duplicate"
    | "timeline.evidence.duplicate"
    | "timeline.evidence.policy_mismatch"
    | "timeline.evidence.unknown"
    | "timeline.receipt.duplicate"
    | "timeline.receipt.id_duplicate";
  eventId: string;
  detail: string;
}

export interface RunStateV0Alpha2 {
  contractId: string;
  runId: string;
  nextSequence: number;
  eventIds: Readonly<Record<string, number>>;
  checkpoints: Readonly<Record<string, CheckpointStateV0Alpha2>>;
  evidence: Readonly<Record<string, EvidenceV0Alpha2>>;
  commands: Readonly<Record<string, CommandV0Alpha2>>;
  receipts: Readonly<Record<string, ReceiptV0Alpha2>>;
  findings: readonly FindingV0Alpha2[];
}

export interface TimelineReducedV0Alpha2 {
  state: RunStateV0Alpha2;
  decision?: CheckpointDecisionV0Alpha2;
  commands: readonly CommandV0Alpha2[];
}

export interface VerifyRunResultV0Alpha2 {
  scope: "structural";
  evaluation: "requirement-coverage";
  evidenceAuthority: "external-profile";
  policyAuthority: "contract";
  policyBinding: "contract-digest";
  effectAuthority: "external";
  ok: boolean;
  pendingCheckpoints: readonly string[];
  rejectedCheckpoints: readonly string[];
  unresolvedCommands: readonly string[];
  failedCommands: readonly string[];
  findings: readonly FindingV0Alpha2[];
}

interface MutableRunStateV0Alpha2 {
  contractId: string;
  runId: string;
  nextSequence: number;
  eventIds: Record<string, number>;
  checkpoints: Record<string, CheckpointStateV0Alpha2>;
  evidence: Record<string, EvidenceV0Alpha2>;
  commands: Record<string, CommandV0Alpha2>;
  receipts: Record<string, ReceiptV0Alpha2>;
  findings: FindingV0Alpha2[];
}

interface StateMetadataV0Alpha2 {
  contractDigest: `sha256:${string}`;
  receiptIds: Record<string, string>;
}

const stateMetadata = new WeakMap<RunStateV0Alpha2, StateMetadataV0Alpha2>();

export function createRunV0Alpha2(
  contract: TimelineContractV0Alpha2,
  runId: string,
  options: TimelineLimitOptions = {},
): RunStateV0Alpha2 {
  const limits = resolveTimelineLimits(options);
  const issues = validateContractV0Alpha2(contract, limits);
  if (issues.length > 0) throw new TimelineContractError(issues);
  if (!/^[a-z0-9][a-z0-9._:/-]{0,127}$/.test(runId)) {
    throw new TimelineInputError(
      "timeline.run.id",
      "runId must be a lowercase portable identifier",
    );
  }

  const state: MutableRunStateV0Alpha2 = {
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

export function reduceRunV0Alpha2(
  contract: TimelineContractV0Alpha2,
  prior: RunStateV0Alpha2,
  event: RunEventV0Alpha2,
  options: TimelineLimitOptions = {},
): TimelineReducedV0Alpha2 {
  const limits = resolveTimelineLimits(options);
  const contractIssues = validateContractV0Alpha2(contract, limits);
  if (contractIssues.length > 0) {
    throw new TimelineContractError(contractIssues);
  }
  const eventIssues = validateEventV0Alpha2(event, limits);
  if (eventIssues.length > 0) throw new TimelineDocumentError(eventIssues);
  const metadata = stateMetadata.get(prior);
  assertContract(contract, prior, metadata, limits);

  const cloned = cloneState(prior, metadata!);
  return applyEvent(contract, cloned.state, cloned.metadata, event);
}

export function replayV0Alpha2(
  contract: TimelineContractV0Alpha2,
  runId: string,
  events: readonly RunEventV0Alpha2[],
  options: TimelineLimitOptions = {},
): RunStateV0Alpha2 {
  const limits = resolveTimelineLimits(options);
  if (events.length > limits.maxEvents) {
    throw new TimelineInputError(
      "timeline.run.limit",
      `run exceeds ${limits.maxEvents} events`,
    );
  }
  const state = createRunV0Alpha2(
    contract,
    runId,
    limits,
  ) as MutableRunStateV0Alpha2;
  const metadata = stateMetadata.get(state)!;
  for (const event of events) {
    const issues = validateEventV0Alpha2(event, limits);
    if (issues.length > 0) throw new TimelineDocumentError(issues);
    applyEvent(contract, state, metadata, event);
  }
  return state;
}

export function verifyRunV0Alpha2(
  state: RunStateV0Alpha2,
): VerifyRunResultV0Alpha2 {
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
    evaluation: "requirement-coverage",
    evidenceAuthority: "external-profile",
    policyAuthority: "contract",
    policyBinding: "contract-digest",
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
  contract: TimelineContractV0Alpha2,
  state: MutableRunStateV0Alpha2,
  metadata: StateMetadataV0Alpha2,
  event: RunEventV0Alpha2,
): TimelineReducedV0Alpha2 {
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
  state: MutableRunStateV0Alpha2,
  event: EvidenceRecordedV0Alpha2,
): TimelineReducedV0Alpha2 {
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
    authority: { ...event.evidence.authority },
  };
  return { state, commands: [] };
}

function evaluateCheckpoint(
  contract: TimelineContractV0Alpha2,
  state: MutableRunStateV0Alpha2,
  event: CheckpointEvaluatedV0Alpha2,
): TimelineReducedV0Alpha2 {
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
  for (const id of event.evidenceRefs) {
    const evidence = state.evidence[id];
    if (!evidence) {
      state.findings.push({
        code: "timeline.evidence.unknown",
        eventId: event.id,
        detail: id,
      });
      continue;
    }
    if (!samePolicyBinding(checkpoint.policy, evidence.authority)) {
      state.findings.push({
        code: "timeline.evidence.policy_mismatch",
        eventId: event.id,
        detail: id,
      });
      continue;
    }
    evidence.claims.forEach((claim) => claims.add(claim));
  }
  if (
    state.findings.some(
      ({ eventId, code }) =>
        eventId === event.id &&
        (code === "timeline.evidence.unknown" ||
          code === "timeline.evidence.policy_mismatch"),
    )
  ) {
    return { state, commands: [] };
  }

  const missingRequirements = checkpoint.requirements.filter(
    (requirement) => !claims.has(requirement),
  );
  const decision: CheckpointDecisionV0Alpha2 = {
    schema: "covenant.timeline.decision.v0alpha2",
    checkpointId: checkpoint.id,
    outcome: missingRequirements.length === 0 ? "accepted" : "rejected",
    policy: { ...checkpoint.policy },
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
  const command: CommandV0Alpha2 = {
    schema: "covenant.timeline.command.v0alpha2",
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
  state: MutableRunStateV0Alpha2,
  metadata: StateMetadataV0Alpha2,
  event: ReceiptRecordedV0Alpha2,
): TimelineReducedV0Alpha2 {
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

function addFinding(
  state: MutableRunStateV0Alpha2,
  finding: FindingV0Alpha2,
): TimelineReducedV0Alpha2 {
  state.findings.push(finding);
  return { state, commands: [] };
}

function assertContract(
  contract: TimelineContractV0Alpha2,
  state: RunStateV0Alpha2,
  metadata: StateMetadataV0Alpha2 | undefined,
  limits: TimelineLimits,
): void {
  if (
    state.contractId !== contract.id ||
    !metadata ||
    metadata.contractDigest !== digestContract(contract, limits)
  ) {
    throw new TimelineInputError(
      "timeline.run.contract_mismatch",
      "run state does not belong to these exact contract bytes",
    );
  }
}

function digestContract(
  contract: TimelineContractV0Alpha2,
  limits: TimelineLimits,
): `sha256:${string}` {
  return contentDigest(contract as unknown as JsonValue, limits);
}

function cloneState(
  state: RunStateV0Alpha2,
  metadata: StateMetadataV0Alpha2,
): {
  state: MutableRunStateV0Alpha2;
  metadata: StateMetadataV0Alpha2;
} {
  const cloned: MutableRunStateV0Alpha2 = {
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

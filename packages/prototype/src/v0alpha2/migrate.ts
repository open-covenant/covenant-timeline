import type {
  CheckpointEvaluated,
  EvidenceRecorded,
  ReceiptRecorded,
} from "../run.js";
import { parseRunDocument, type TimelineRunDocument } from "../document.js";
import { contentDigest, type JsonValue } from "../identity.js";
import {
  samePolicyBinding,
  validatePolicyBinding,
  type PolicyBindingV0Alpha2,
  type TimelineContractV0Alpha2,
} from "./contract.js";
import {
  parseRunDocumentV0Alpha2,
  type TimelineRunDocumentV0Alpha2,
} from "./document.js";
import type { EvidenceAuthorityV0Alpha2, RunEventV0Alpha2 } from "./run.js";

export interface MigrationOptionsV0Alpha1ToV0Alpha2 {
  policies: Readonly<Record<string, PolicyBindingV0Alpha2>>;
  unreferencedEvidencePolicy?: PolicyBindingV0Alpha2;
}

export class TimelineMigrationError extends Error {
  readonly code = "timeline.migration.invalid";

  constructor(message: string) {
    super(message);
    this.name = "TimelineMigrationError";
  }
}

export function migrateRunV0Alpha1ToV0Alpha2(
  value: unknown,
  options: MigrationOptionsV0Alpha1ToV0Alpha2,
): TimelineRunDocumentV0Alpha2 {
  const source = parseRunDocument(value);
  validateMigrationOptions(options);
  const checkpointPolicies = bindCheckpointPolicies(source, options.policies);
  const evidencePolicies = bindEvidencePolicies(
    source,
    checkpointPolicies,
    options.unreferencedEvidencePolicy,
  );
  const contract: TimelineContractV0Alpha2 = {
    schema: "covenant.timeline.contract.v0alpha2",
    id: source.contract.id,
    subject: { ...source.contract.subject },
    checkpoints: source.contract.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      requirements: [...checkpoint.requirements],
      policy: { ...checkpointPolicies[checkpoint.id]! },
      ...(checkpoint.onAccept ? { onAccept: { ...checkpoint.onAccept } } : {}),
    })),
    ...(source.contract.extensions
      ? { extensions: structuredClone(source.contract.extensions) }
      : {}),
  };
  const events = source.events.map((event): RunEventV0Alpha2 => {
    if (event.type === "evidence.recorded") {
      const policy = evidencePolicies[event.evidence.id]!;
      const authority: EvidenceAuthorityV0Alpha2 = {
        ...policy,
        proofDigest: digestLegacyEvidence(event),
      };
      return {
        schema: "covenant.timeline.event.v0alpha2",
        id: event.id,
        sequence: event.sequence,
        type: event.type,
        evidence: {
          ...event.evidence,
          claims: [...event.evidence.claims],
          authority,
        },
      };
    }
    if (event.type === "checkpoint.evaluated") {
      return {
        schema: "covenant.timeline.event.v0alpha2",
        id: event.id,
        sequence: event.sequence,
        type: event.type,
        checkpointId: event.checkpointId,
        evidenceRefs: [...event.evidenceRefs],
      };
    }
    return {
      schema: "covenant.timeline.event.v0alpha2",
      id: event.id,
      sequence: event.sequence,
      type: event.type,
      receipt: { ...event.receipt },
    };
  });

  return parseRunDocumentV0Alpha2({
    schema: "covenant.timeline.run.v0alpha2",
    runId: source.runId,
    contract,
    events,
  });
}

function bindCheckpointPolicies(
  source: TimelineRunDocument,
  policies: Readonly<Record<string, PolicyBindingV0Alpha2>>,
): Record<string, PolicyBindingV0Alpha2> {
  const bound: Record<string, PolicyBindingV0Alpha2> = Object.create(null);
  const checkpointIds = new Set(
    source.contract.checkpoints.map(({ id }) => id),
  );
  for (const checkpoint of source.contract.checkpoints) {
    if (!hasOwn(policies, checkpoint.id)) {
      throw new TimelineMigrationError(
        `checkpoint ${checkpoint.id} has no v0alpha2 policy binding`,
      );
    }
    const policy = policies[checkpoint.id]!;
    bound[checkpoint.id] = { ...policy };
  }
  for (const checkpointId of Object.keys(policies)) {
    if (!checkpointIds.has(checkpointId)) {
      throw new TimelineMigrationError(
        `policy binding references unknown checkpoint ${checkpointId}`,
      );
    }
  }
  for (const event of source.events) {
    if (event.type !== "checkpoint.evaluated") continue;
    const policy = bound[event.checkpointId];
    if (!policy) {
      throw new TimelineMigrationError(
        `event ${event.id} references unknown checkpoint ${event.checkpointId}`,
      );
    }
    if (event.policyRef !== policy.policyRef) {
      throw new TimelineMigrationError(
        `event ${event.id} policyRef does not match the bound policy`,
      );
    }
  }
  return bound;
}

function bindEvidencePolicies(
  source: TimelineRunDocument,
  policies: Readonly<Record<string, PolicyBindingV0Alpha2>>,
  fallback: PolicyBindingV0Alpha2 | undefined,
): Record<string, PolicyBindingV0Alpha2> {
  const bound: Record<string, PolicyBindingV0Alpha2> = Object.create(null);
  for (const event of source.events) {
    if (event.type !== "checkpoint.evaluated") continue;
    const policy = policies[event.checkpointId]!;
    for (const evidenceRef of event.evidenceRefs) {
      const prior = bound[evidenceRef];
      if (prior && !samePolicyBinding(prior, policy)) {
        throw new TimelineMigrationError(
          `evidence ${evidenceRef} is used under multiple policy bindings`,
        );
      }
      bound[evidenceRef] = policy;
    }
  }
  for (const event of source.events) {
    if (event.type !== "evidence.recorded") continue;
    if (!hasOwn(bound, event.evidence.id)) {
      if (!fallback) {
        throw new TimelineMigrationError(
          `unreferenced evidence ${event.evidence.id} needs a fallback policy`,
        );
      }
      bound[event.evidence.id] = fallback;
    }
  }
  return bound;
}

function validateMigrationOptions(
  value: unknown,
): asserts value is MigrationOptionsV0Alpha1ToV0Alpha2 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TimelineMigrationError(
      "migration options need checkpoint policy bindings",
    );
  }
  const options = value as Record<string, unknown>;
  if (
    !hasOwn(options, "policies") ||
    options.policies === null ||
    typeof options.policies !== "object" ||
    Array.isArray(options.policies)
  ) {
    throw new TimelineMigrationError(
      "migration options need checkpoint policy bindings",
    );
  }
  for (const [checkpointId, policy] of Object.entries(options.policies)) {
    const issues: { path: string; message: string }[] = [];
    if (
      !/^[a-z0-9][a-z0-9._:/-]{0,127}$/.test(checkpointId) ||
      !validatePolicyBinding(policy, `policies.${checkpointId}`, issues)
    ) {
      throw new TimelineMigrationError(
        `checkpoint ${checkpointId} has an invalid policy binding`,
      );
    }
  }
  if (hasOwn(options, "unreferencedEvidencePolicy")) {
    const issues: { path: string; message: string }[] = [];
    if (
      options.unreferencedEvidencePolicy === undefined ||
      !validatePolicyBinding(
        options.unreferencedEvidencePolicy,
        "unreferencedEvidencePolicy",
        issues,
      )
    ) {
      throw new TimelineMigrationError(
        "unreferenced evidence fallback policy is invalid",
      );
    }
  }
}

function digestLegacyEvidence(
  event: EvidenceRecorded | CheckpointEvaluated | ReceiptRecorded,
): `sha256:${string}` {
  return contentDigest({
    schema: "covenant.timeline.migration-proof.v0alpha1",
    event,
  } as unknown as JsonValue);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

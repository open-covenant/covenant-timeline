import {
  contentDigest,
  type JsonValue,
  type TemporalModelProposalCandidateV1,
} from "@covenant-org/timeline";
import { TimelineMcpError } from "./errors.js";
import type { ExpectedRunPrefixV0Alpha2 } from "./types.js";

const permits = new WeakSet<object>();

export interface VerifiedModelProposalAdmissionArtifact {
  readonly runId: string;
  readonly candidate: TemporalModelProposalCandidateV1;
  readonly candidateDigest: `sha256:${string}`;
  readonly proposalDigest: `sha256:${string}`;
  readonly events: TemporalModelProposalCandidateV1["candidateEvents"];
  readonly exactPrefix: Readonly<ExpectedRunPrefixV0Alpha2>;
}

export interface VerifiedModelProposalAdmissionPermit {
  readonly artifact: VerifiedModelProposalAdmissionArtifact;
}

export function sealVerifiedModelProposalAdmission(
  runId: string,
  candidateValue: TemporalModelProposalCandidateV1,
  proposal: unknown,
  exactPrefixValue: ExpectedRunPrefixV0Alpha2,
): VerifiedModelProposalAdmissionPermit {
  const candidate = deepFreeze(structuredClone(candidateValue));
  const exactPrefix = Object.freeze({ ...exactPrefixValue });
  const proposalDigest = contentDigest(proposal as JsonValue);

  if (
    candidate.baseRunDigest !== exactPrefix.runDigest ||
    candidate.proposalDigest !== proposalDigest ||
    candidate.candidateEvents.some(
      ({ sequence }, index) => sequence !== exactPrefix.revision + index,
    )
  ) {
    throw new TimelineMcpError(
      "timeline.mcp.internal",
      "compiled model proposal does not bind its source and run prefix",
    );
  }

  const artifact = Object.freeze({
    runId,
    candidate,
    candidateDigest: contentDigest(candidate as unknown as JsonValue),
    proposalDigest,
    events: candidate.candidateEvents,
    exactPrefix,
  });
  const permit = Object.freeze({ artifact });
  permits.add(permit);
  return permit;
}

export function requireVerifiedModelProposalAdmission(
  value: unknown,
): VerifiedModelProposalAdmissionPermit {
  if (typeof value !== "object" || value === null || !permits.has(value)) {
    throw new TimelineMcpError(
      "timeline.mcp.input.invalid",
      "verified model proposal admission capability is required",
    );
  }
  return value as VerifiedModelProposalAdmissionPermit;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

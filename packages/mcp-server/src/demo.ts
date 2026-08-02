import {
  contentDigest,
  parseQueryV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
  type JsonValue,
  type TemporalConclusionV0Alpha3,
  type TemporalQueryV0Alpha3,
  type TimelineContractV0Alpha3,
} from "@covenant-org/timeline";
import { MCP_KERNEL_LIMITS } from "./constants.js";
import { FileMcpRunStore } from "./store.js";
import type {
  McpAdmissionDecisionV0Alpha1,
  McpRunEnvelopeV0Alpha2,
  TemporalEventDraftV0Alpha3,
} from "./types.js";

interface DemoEvidence {
  schema: "covenant.timeline.demo-evidence.v1";
  id: string;
  text: string;
}

interface DemoAdmissionPolicy {
  schema: "covenant.timeline.demo-admission-policy.v1";
  id: "demo.explicit-host-admission";
  rule: string;
}

interface VerifiedCut {
  recordedThrough: number;
  query: TemporalQueryV0Alpha3;
  conclusion: TemporalConclusionV0Alpha3;
  verified: true;
}

export interface CorrectionDemo {
  schema: "covenant.timeline.mcp-demo.v1";
  scenario: "late-security-review-correction";
  reloadedFromDisk: true;
  evidence: readonly DemoEvidence[];
  admissionPolicy: DemoAdmissionPolicy;
  timeline: McpRunEnvelopeV0Alpha2;
  before: VerifiedCut;
  after: VerifiedCut;
}

const evidence = [
  {
    schema: "covenant.timeline.demo-evidence.v1",
    id: "review-initial",
    text: "Monday record: the security review finished at release offset 100.",
  },
  {
    schema: "covenant.timeline.demo-evidence.v1",
    id: "deployment",
    text: "Monday record: deployment completed at release offset 200.",
  },
  {
    schema: "covenant.timeline.demo-evidence.v1",
    id: "review-correction",
    text: "Thursday correction: the security review finished at release offset 300, superseding the offset-100 record.",
  },
] as const satisfies readonly DemoEvidence[];

const admissionPolicy: DemoAdmissionPolicy = {
  schema: "covenant.timeline.demo-admission-policy.v1",
  id: "demo.explicit-host-admission",
  rule: "Admit only the fixed records embedded in the correction demo.",
};

const admission: McpAdmissionDecisionV0Alpha1 = {
  authorityId: "demo.operator",
  policyRef: "urn:covenant:timeline:demo-admission:v1",
  policyDigest: contentDigest(admissionPolicy as unknown as JsonValue),
};

const contract: TimelineContractV0Alpha3 = {
  schema: "covenant.timeline.contract.v0alpha3",
  id: "demo.release",
  subject: {
    kind: "repository",
    id: "example/service",
  },
  axes: [
    {
      id: "release-offset-seconds",
      kind: "metric",
      unit: "second",
      origin: "demo.release.origin.v1",
    },
  ],
  contexts: [
    {
      id: "actual",
      mode: "actual",
    },
  ],
};

const evidenceRefs = new Map(
  evidence.map((record) => [
    record.id,
    contentDigest(record as unknown as JsonValue),
  ]),
);

const events: readonly TemporalEventDraftV0Alpha3[] = [
  {
    id: "event.review-declared",
    type: "point.declared",
    point: {
      id: "review-finished",
      contextId: "actual",
      axisId: "release-offset-seconds",
    },
  },
  {
    id: "event.deploy-declared",
    type: "point.declared",
    point: {
      id: "deployed",
      contextId: "actual",
      axisId: "release-offset-seconds",
    },
  },
  {
    id: "event.review-v1",
    type: "coordinate.asserted",
    assertion: {
      id: "review.v1",
      contextId: "actual",
      pointId: "review-finished",
      coordinate: {
        minimum: 100,
        maximum: 100,
      },
      evidenceRefs: [requireEvidenceRef("review-initial")],
    },
  },
  {
    id: "event.deploy-v1",
    type: "coordinate.asserted",
    assertion: {
      id: "deploy.v1",
      contextId: "actual",
      pointId: "deployed",
      coordinate: {
        minimum: 200,
        maximum: 200,
      },
      evidenceRefs: [requireEvidenceRef("deployment")],
    },
  },
  {
    id: "event.review-v2",
    type: "coordinate.asserted",
    assertion: {
      id: "review.v2",
      contextId: "actual",
      pointId: "review-finished",
      coordinate: {
        minimum: 300,
        maximum: 300,
      },
      evidenceRefs: [requireEvidenceRef("review-correction")],
      supersedes: ["review.v1"],
    },
  },
];

export async function runCorrectionDemo(
  directory: string,
): Promise<CorrectionDemo> {
  const writer = new FileMcpRunStore(directory);
  let { envelope } = await writer.create(contract);
  for (const event of events) {
    ({ envelope } = await writer.append(
      contract.id,
      event,
      envelope.runDigest,
      admission,
    ));
  }

  const reader = new FileMcpRunStore(directory);
  const reloaded = await reader.require(contract.id);
  return {
    schema: "covenant.timeline.mcp-demo.v1",
    scenario: "late-security-review-correction",
    reloadedFromDisk: true,
    evidence,
    admissionPolicy,
    timeline: reloaded,
    before: verifiedCut(reloaded, 3),
    after: verifiedCut(reloaded, 4),
  };
}

function verifiedCut(
  envelope: McpRunEnvelopeV0Alpha2,
  recordedThrough: number,
): VerifiedCut {
  const query = parseQueryV0Alpha3(
    {
      schema: "covenant.timeline.query.v0alpha3",
      id: "query.review-minus-deploy",
      contextId: "actual",
      recordedThrough,
      type: "difference.bounds",
      fromPointId: "deployed",
      toPointId: "review-finished",
    },
    envelope.run,
  );
  const conclusion = reasonTemporalQueryV0Alpha3(
    envelope.run,
    query,
    MCP_KERNEL_LIMITS,
  );
  if (
    !verifyTemporalConclusionV0Alpha3(
      envelope.run,
      query,
      conclusion,
      MCP_KERNEL_LIMITS,
    )
  ) {
    throw new Error("demo conclusion failed verification");
  }
  return { recordedThrough, query, conclusion, verified: true };
}

function requireEvidenceRef(
  id: (typeof evidence)[number]["id"],
): `sha256:${string}` {
  const digest = evidenceRefs.get(id);
  if (!digest) throw new Error(`demo evidence ${id} is missing`);
  return digest;
}

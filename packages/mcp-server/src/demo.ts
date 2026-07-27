import {
  parseQueryV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
  type TemporalConclusionV0Alpha3,
  type TemporalQueryV0Alpha3,
  type TimelineContractV0Alpha3,
  type TimelineRunDocumentV0Alpha3,
} from "@covenant-org/timeline";
import { MCP_KERNEL_LIMITS } from "./constants.js";
import { FileMcpRunStore } from "./store.js";
import type { TemporalEventDraftV0Alpha3 } from "./types.js";

const evidenceRef =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const contract: TimelineContractV0Alpha3 = {
  schema: "covenant.timeline.contract.v0alpha3",
  id: "demo.release",
  subject: {
    kind: "repository",
    id: "example/service",
  },
  axes: [
    {
      id: "utc-seconds",
      kind: "metric",
      unit: "second",
      origin: "release.utc-origin.v1",
    },
  ],
  contexts: [
    {
      id: "actual",
      mode: "actual",
    },
  ],
};

const events: readonly TemporalEventDraftV0Alpha3[] = [
  {
    id: "event.review-declared",
    type: "point.declared",
    point: {
      id: "review-finished",
      contextId: "actual",
      axisId: "utc-seconds",
    },
  },
  {
    id: "event.deploy-declared",
    type: "point.declared",
    point: {
      id: "deployed",
      contextId: "actual",
      axisId: "utc-seconds",
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
      evidenceRefs: [evidenceRef],
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
      evidenceRefs: [evidenceRef],
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
      evidenceRefs: [evidenceRef],
    },
  },
  {
    id: "event.review-v1-retracted",
    type: "assertion.retracted",
    assertionId: "review.v1",
    evidenceRefs: [evidenceRef],
  },
];

interface VerifiedCut {
  recordedThrough: number;
  query: TemporalQueryV0Alpha3;
  conclusion: TemporalConclusionV0Alpha3;
  verified: true;
}

export interface CorrectionDemo {
  schema: "covenant.timeline.mcp-demo.v1";
  runId: string;
  eventCount: number;
  reloadedFromDisk: true;
  run: TimelineRunDocumentV0Alpha3;
  before: VerifiedCut;
  after: VerifiedCut;
}

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
    ));
  }

  const reader = new FileMcpRunStore(directory);
  const reloaded = await reader.require(contract.id);
  const before = verifiedCut(reloaded.run, 3);
  const after = verifiedCut(reloaded.run, 5);

  return {
    schema: "covenant.timeline.mcp-demo.v1",
    runId: reloaded.runId,
    eventCount: reloaded.run.events.length,
    reloadedFromDisk: true,
    run: reloaded.run,
    before,
    after,
  };
}

function verifiedCut(
  run: TimelineRunDocumentV0Alpha3,
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
    run,
  );
  const conclusion = reasonTemporalQueryV0Alpha3(run, query, MCP_KERNEL_LIMITS);
  if (
    !verifyTemporalConclusionV0Alpha3(run, query, conclusion, MCP_KERNEL_LIMITS)
  ) {
    throw new Error("demo conclusion failed verification");
  }
  return { recordedThrough, query, conclusion, verified: true };
}

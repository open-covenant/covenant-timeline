import type { TimelineContractV0Alpha3 } from "@covenant-org/timeline";
import type { TemporalEventDraftV0Alpha3 } from "../index.js";

export const evidenceRef =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export function releaseContract(
  id = "agent.release",
): TimelineContractV0Alpha3 {
  return {
    schema: "covenant.timeline.contract.v0alpha3",
    id,
    subject: {
      kind: "repository",
      id: "example/service",
    },
    axes: [
      {
        id: "utc-seconds",
        kind: "metric",
        unit: "second",
        origin: "release-42.utc-origin.v1",
      },
    ],
    contexts: [
      {
        id: "actual",
        mode: "actual",
      },
    ],
  };
}

export const correctionEvents: readonly TemporalEventDraftV0Alpha3[] = [
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

export const beforeQuery = {
  id: "query.review-minus-deploy",
  contextId: "actual",
  recordedThrough: 3,
  type: "difference.bounds",
  fromPointId: "deployed",
  toPointId: "review-finished",
} as const;

export const afterQuery = {
  ...beforeQuery,
  recordedThrough: 5,
} as const;

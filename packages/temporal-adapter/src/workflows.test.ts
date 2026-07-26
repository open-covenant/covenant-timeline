import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RunEventV0Alpha2,
  TimelineRunDocumentV0Alpha2,
} from "@covenant-org/timeline";

const temporal = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  duringCondition: undefined as (() => void | Promise<void>) | undefined,
  evaluate: vi.fn(async (document: TimelineRunDocumentV0Alpha2) => ({
    receivedEvents: document.events,
  })),
}));

vi.mock("@temporalio/workflow", () => ({
  condition: vi.fn(async (predicate: () => boolean) => {
    await temporal.duringCondition?.();
    if (!predicate()) throw new Error("condition remained false");
  }),
  defineQuery: (name: string) => name,
  defineSignal: (name: string) => name,
  proxyActivities: () => ({ evaluateTimelineRun: temporal.evaluate }),
  setHandler: (
    definition: string,
    handler: (...args: unknown[]) => unknown,
  ) => {
    temporal.handlers.set(definition, handler);
  },
}));

import {
  appendTimelineEvent,
  finalizeTimelineRun,
  timelineEventCount,
  timelineWorkflow,
} from "./workflows.js";

const initial: TimelineRunDocumentV0Alpha2 = {
  schema: "covenant.timeline.run.v0alpha2",
  runId: "workflow.unit",
  contract: {
    schema: "covenant.timeline.contract.v0alpha2",
    id: "workflow.unit",
    subject: { kind: "repository", id: "example/service" },
    checkpoints: [
      {
        id: "complete",
        requirements: ["ready"],
        policy: {
          profile: "example.profile.v1",
          policyRef: "example.policy.v1",
          policyDigest:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    ],
  },
  events: [],
};
const event: RunEventV0Alpha2 = {
  schema: "covenant.timeline.event.v0alpha2",
  id: "event-0",
  sequence: 0,
  type: "checkpoint.evaluated",
  checkpointId: "complete",
  evidenceRefs: [],
};

describe("Temporal workflow handlers", () => {
  beforeEach(() => {
    temporal.handlers.clear();
    temporal.duringCondition = undefined;
    temporal.evaluate.mockClear();
  });

  it("collects ordered events and finalizes through the activity", async () => {
    temporal.duringCondition = () => {
      handler(appendTimelineEvent)(event);
      expect(handler(timelineEventCount)()).toBe(1);
      handler(finalizeTimelineRun)();
    };

    const result = await timelineWorkflow(initial);

    expect(result).toEqual({ receivedEvents: [event] });
    expect(temporal.evaluate).toHaveBeenCalledOnce();
  });

  it("rejects out-of-order event signals", async () => {
    temporal.duringCondition = () => {
      handler(appendTimelineEvent)({ ...event, sequence: 1 });
    };

    await expect(timelineWorkflow(initial)).rejects.toThrow(/does not match 0/);
  });

  it("rejects event signals after finalization", async () => {
    temporal.duringCondition = () => {
      handler(finalizeTimelineRun)();
      handler(appendTimelineEvent)(event);
    };

    await expect(timelineWorkflow(initial)).rejects.toThrow(/finalized/);
  });
});

function handler(definition: unknown): (...args: unknown[]) => unknown {
  const registered = temporal.handlers.get(String(definition));
  if (!registered) throw new Error(`handler is not registered: ${definition}`);
  return registered;
}

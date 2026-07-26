import { fileURLToPath } from "node:url";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  PolicyBindingV0Alpha2,
  RunEventV0Alpha2,
  TimelineRunDocumentV0Alpha2,
} from "@covenant-org/timeline";
import { evaluateTimelineRun } from "./activities.js";
import {
  appendTimelineEvent,
  finalizeTimelineRun,
  timelineEventCount,
  timelineWorkflow,
} from "./workflows.js";

const taskQueue = "timeline-adapter-test";
const workflowId = "timeline-restart-run";
const workflowsPath = fileURLToPath(new URL("./workflows.ts", import.meta.url));
const policy: PolicyBindingV0Alpha2 = {
  profile: "github.software-delivery.v1",
  policyRef: "software.release.v1",
  policyDigest:
    "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
};
const initial: TimelineRunDocumentV0Alpha2 = {
  schema: "covenant.timeline.run.v0alpha2",
  runId: "temporal.restart",
  contract: {
    schema: "covenant.timeline.contract.v0alpha2",
    id: "temporal.release",
    subject: { kind: "repository", id: "example/service" },
    checkpoints: [
      {
        id: "release-ready",
        requirements: ["ci.tests.pass"],
        policy,
        onAccept: {
          kind: "timeline.archive.publish",
          payloadRef: "release.archive",
        },
      },
    ],
  },
  events: [],
};
const events: RunEventV0Alpha2[] = [
  {
    schema: "covenant.timeline.event.v0alpha2",
    id: "event-0",
    sequence: 0,
    type: "evidence.recorded",
    evidence: {
      id: "ci",
      kind: "github.checks",
      claims: ["ci.tests.pass"],
      payloadDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      producer: "github-collector",
      authority: {
        ...policy,
        proofDigest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    },
  },
  {
    schema: "covenant.timeline.event.v0alpha2",
    id: "event-1",
    sequence: 1,
    type: "checkpoint.evaluated",
    checkpointId: "release-ready",
    evidenceRefs: ["ci"],
  },
  {
    schema: "covenant.timeline.event.v0alpha2",
    id: "event-2",
    sequence: 2,
    type: "receipt.recorded",
    receipt: {
      id: "receipt-1",
      commandId: "temporal.restart:release-ready:1",
      status: "succeeded",
      effectDigest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  },
];

describe("Temporal adapter", () => {
  let environment: TestWorkflowEnvironment;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await environment.teardown();
  });

  it("resumes event intake after a worker restart", async () => {
    const firstWorker = await createWorker(environment);
    await firstWorker.runUntil(async () => {
      const handle = await environment.client.workflow.start(timelineWorkflow, {
        workflowId,
        taskQueue,
        args: [initial],
      });
      await handle.signal(appendTimelineEvent, events[0]!);
      expect(await handle.query(timelineEventCount)).toBe(1);
    });

    const secondWorker = await createWorker(environment);
    const report = await secondWorker.runUntil(async () => {
      const handle = environment.client.workflow.getHandle(workflowId);
      await handle.signal(appendTimelineEvent, events[1]!);
      await handle.signal(appendTimelineEvent, events[2]!);
      await handle.signal(finalizeTimelineRun);
      return handle.result();
    });

    expect(report.verification.ok).toBe(true);
    expect(report.state.nextSequence).toBe(3);
  });
});

async function createWorker(
  environment: TestWorkflowEnvironment,
): Promise<Worker> {
  return Worker.create({
    connection: environment.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: { evaluateTimelineRun },
  });
}

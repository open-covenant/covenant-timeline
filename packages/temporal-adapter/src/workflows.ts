import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type {
  RunEventV0Alpha2,
  TimelineRunDocumentV0Alpha2,
  TimelineRunReportV0Alpha2,
} from "@covenant-org/timeline";
import type { TimelineActivities } from "./activities.js";

export const appendTimelineEvent = defineSignal<[RunEventV0Alpha2]>(
  "appendTimelineEvent",
);
export const finalizeTimelineRun = defineSignal("finalizeTimelineRun");
export const timelineEventCount = defineQuery<number>("timelineEventCount");

const { evaluateTimelineRun } = proxyActivities<TimelineActivities>({
  startToCloseTimeout: "30 seconds",
});

export async function timelineWorkflow(
  initial: TimelineRunDocumentV0Alpha2,
): Promise<TimelineRunReportV0Alpha2> {
  const events = [...initial.events];
  let finalized = false;

  setHandler(appendTimelineEvent, (event) => {
    if (finalized) throw new Error("timeline run is finalized");
    if (event.sequence !== events.length) {
      throw new Error(
        `event sequence ${event.sequence} does not match ${events.length}`,
      );
    }
    events.push(event);
  });
  setHandler(finalizeTimelineRun, () => {
    finalized = true;
  });
  setHandler(timelineEventCount, () => events.length);

  await condition(() => finalized);
  return evaluateTimelineRun({ ...initial, events });
}

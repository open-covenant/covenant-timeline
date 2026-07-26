import {
  evaluateRunDocumentV0Alpha2,
  type TimelineRunDocumentV0Alpha2,
  type TimelineRunReportV0Alpha2,
} from "@covenant-org/timeline";

export async function evaluateTimelineRun(
  document: TimelineRunDocumentV0Alpha2,
): Promise<TimelineRunReportV0Alpha2> {
  return evaluateRunDocumentV0Alpha2(document);
}

export interface TimelineActivities {
  evaluateTimelineRun: typeof evaluateTimelineRun;
}

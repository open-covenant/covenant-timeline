import {
  TimelineDefinitionError,
  dateEpoch,
  validateTimeline,
  type Cadence,
  type TimelineDefinition,
  type TimelineMilestone,
} from "./definition.js";

export interface TimelineCheckpoint {
  index: number;
  date: string;
  cadence: boolean;
  boundary: "start" | "end" | null;
  milestones: readonly TimelineMilestone[];
}

export interface TimelinePlan {
  definition: TimelineDefinition;
  checkpoints: readonly TimelineCheckpoint[];
}

export function buildTimeline(definition: TimelineDefinition): TimelinePlan {
  const errors = validateTimeline(definition);
  if (errors.length > 0) {
    throw new TimelineDefinitionError(errors);
  }

  const { startDate, endDate, cadence } = definition.project;
  const points = new Map<
    string,
    {
      cadence: boolean;
      boundary: "start" | "end" | null;
      milestones: TimelineMilestone[];
    }
  >();

  points.set(startDate, { cadence: true, boundary: "start", milestones: [] });
  points.set(endDate, { cadence: false, boundary: "end", milestones: [] });

  const endEpoch = dateEpoch(endDate);
  for (let step = 1; ; step += 1) {
    const date = cadenceDate(startDate, cadence, step);
    const epoch = dateEpoch(date);
    if (epoch > endEpoch) break;
    if (epoch === endEpoch) {
      const end = points.get(endDate);
      if (end) end.cadence = true;
      break;
    }
    points.set(date, { cadence: true, boundary: null, milestones: [] });
  }

  for (const milestone of definition.milestones ?? []) {
    const point = points.get(milestone.date) ?? {
      cadence: false,
      boundary: null,
      milestones: [],
    };
    point.milestones.push(milestone);
    points.set(milestone.date, point);
  }

  const checkpoints = [...points.entries()]
    .sort(([left], [right]) => dateEpoch(left) - dateEpoch(right))
    .map(([date, point], index) => ({ index, date, ...point }));

  return { definition, checkpoints };
}

function cadenceDate(
  startDate: string,
  cadence: Cadence,
  step: number,
): string {
  const start = new Date(dateEpoch(startDate));
  if (cadence === "weekly") {
    start.setUTCDate(start.getUTCDate() + step * 7);
    return start.toISOString().slice(0, 10);
  }

  const months =
    cadence === "monthly"
      ? step
      : cadence === "quarterly"
        ? step * 3
        : step * 12;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const day = start.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

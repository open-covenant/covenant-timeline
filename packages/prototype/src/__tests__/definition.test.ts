import { describe, expect, it } from "vitest";
import {
  TimelineDefinitionError,
  buildTimeline,
  validateTimeline,
  type TimelineDefinition,
} from "../index.js";

const definition: TimelineDefinition = {
  project: {
    startDate: "2023-01-31",
    endDate: "2023-05-15",
    cadence: "monthly",
  },
  milestones: [
    {
      date: "2023-03-15",
      requirements: ["audit logging"],
      targetNloc: 3_000,
    },
  ],
  qualityGates: {
    testPassRate: 1,
    minimumCoverage: 0.8,
    maximumAverageComplexity: 10,
    zeroRegressions: true,
    maximumCriticalSecurityFindings: 0,
  },
};

describe("validateTimeline", () => {
  it("accepts a bounded project definition", () => {
    expect(validateTimeline(definition)).toEqual([]);
  });

  it("reports invalid dates, ranges, and ratios", () => {
    const errors = validateTimeline({
      project: {
        startDate: "2023-02-30",
        endDate: "2023-01-01",
        cadence: "monthly",
      },
      growth: {
        nlocPerPeriod: [100, 50],
        maximumChurnRatio: 1.1,
      },
      milestones: [{ date: "invalid", requirements: [] }],
      qualityGates: { minimumCoverage: -0.1 },
    });

    expect(errors.map(({ path }) => path)).toEqual([
      "project.startDate",
      "growth.nlocPerPeriod",
      "growth.maximumChurnRatio",
      "qualityGates.minimumCoverage",
      "milestones[0].date",
      "milestones[0].requirements",
    ]);
  });
});

describe("buildTimeline", () => {
  it("merges cadence, milestone, and final checkpoints", () => {
    const plan = buildTimeline(definition);

    expect(plan.checkpoints.map(({ date }) => date)).toEqual([
      "2023-01-31",
      "2023-02-28",
      "2023-03-15",
      "2023-03-31",
      "2023-04-30",
      "2023-05-15",
    ]);
    expect(plan.checkpoints[2]?.milestones).toEqual(definition.milestones);
  });

  it("rejects invalid definitions", () => {
    expect(() =>
      buildTimeline({
        project: {
          startDate: "2023-01-01",
          endDate: "2023-01-01",
          cadence: "monthly",
        },
      }),
    ).toThrow(TimelineDefinitionError);
  });

  it("marks an end boundary that falls on the cadence", () => {
    const plan = buildTimeline({
      project: {
        startDate: "2023-01-01",
        endDate: "2023-03-01",
        cadence: "monthly",
      },
    });

    expect(plan.checkpoints[2]).toMatchObject({
      date: "2023-03-01",
      cadence: true,
      boundary: "end",
    });
  });
});

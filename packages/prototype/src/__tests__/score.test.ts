import { describe, expect, it } from "vitest";
import { scoreSnapshot, scoreTrajectory } from "../index.js";

describe("scoreSnapshot", () => {
  it("applies the default evidence weights", () => {
    expect(
      scoreSnapshot({
        functional: 1,
        regressionResistance: 1,
        maintainability: 0.8,
        coverage: 0.8,
        staticQuality: 1,
        architectureReview: 0.6,
      }),
    ).toBeCloseTo(93);
  });

  it("rejects out-of-range signals", () => {
    expect(() =>
      scoreSnapshot({
        functional: 1.1,
        regressionResistance: 1,
        maintainability: 1,
        coverage: 1,
        staticQuality: 1,
        architectureReview: 1,
      }),
    ).toThrow(RangeError);
  });
});

describe("scoreTrajectory", () => {
  it("combines the snapshot average with explicit adjustments", () => {
    expect(
      scoreTrajectory([80, 90, 100], {
        regressionPenalty: 5,
        volatilityPenalty: 2,
        sustainedImprovementBonus: 4,
      }),
    ).toEqual({
      score: 87,
      averageSnapshotScore: 90,
      regressionPenalty: 5,
      volatilityPenalty: 2,
      sustainedImprovementBonus: 4,
    });
  });

  it("requires at least one valid snapshot", () => {
    expect(() => scoreTrajectory([])).toThrow(RangeError);
    expect(() => scoreTrajectory([101])).toThrow(RangeError);
  });
});

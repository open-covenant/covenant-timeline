export interface SnapshotSignals {
  functional: number;
  regressionResistance: number;
  maintainability: number;
  coverage: number;
  staticQuality: number;
  architectureReview: number;
}

export type ScoreWeights = Readonly<Record<keyof SnapshotSignals, number>>;

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  functional: 0.4,
  regressionResistance: 0.2,
  maintainability: 0.15,
  coverage: 0.1,
  staticQuality: 0.1,
  architectureReview: 0.05,
};

export interface TrajectoryAdjustments {
  regressionPenalty?: number;
  volatilityPenalty?: number;
  sustainedImprovementBonus?: number;
}

export interface TrajectoryScore {
  score: number;
  averageSnapshotScore: number;
  regressionPenalty: number;
  volatilityPenalty: number;
  sustainedImprovementBonus: number;
}

export function scoreSnapshot(
  signals: SnapshotSignals,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): number {
  validateWeights(weights);

  const score = (Object.keys(weights) as (keyof SnapshotSignals)[]).reduce(
    (total, key) => {
      const signal = signals[key];
      if (!Number.isFinite(signal) || signal < 0 || signal > 1) {
        throw new RangeError(`${key} must be between 0 and 1`);
      }
      return total + signal * weights[key];
    },
    0,
  );

  return score * 100;
}

export function scoreTrajectory(
  snapshotScores: readonly number[],
  adjustments: TrajectoryAdjustments = {},
): TrajectoryScore {
  if (snapshotScores.length === 0) {
    throw new RangeError("at least one snapshot score is required");
  }
  snapshotScores.forEach((score) => {
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new RangeError("snapshot scores must be between 0 and 100");
    }
  });

  const regressionPenalty = adjustment(adjustments.regressionPenalty);
  const volatilityPenalty = adjustment(adjustments.volatilityPenalty);
  const sustainedImprovementBonus = adjustment(
    adjustments.sustainedImprovementBonus,
  );
  const averageSnapshotScore =
    snapshotScores.reduce((sum, score) => sum + score, 0) /
    snapshotScores.length;
  const score = clamp(
    averageSnapshotScore -
      regressionPenalty -
      volatilityPenalty +
      sustainedImprovementBonus,
    0,
    100,
  );

  return {
    score,
    averageSnapshotScore,
    regressionPenalty,
    volatilityPenalty,
    sustainedImprovementBonus,
  };
}

function validateWeights(weights: ScoreWeights): void {
  const values = Object.values(weights);
  if (values.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new RangeError("score weights must be non-negative");
  }

  const total = values.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > Number.EPSILON * values.length) {
    throw new RangeError("score weights must total 1");
  }
}

function adjustment(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("trajectory adjustments must be non-negative");
  }
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

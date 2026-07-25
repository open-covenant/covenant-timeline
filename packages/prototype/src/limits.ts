export interface TimelineLimits {
  maxCanonicalDepth: number;
  maxCanonicalNodes: number;
  maxCheckpoints: number;
  maxRequirementsPerCheckpoint: number;
  maxEvents: number;
  maxEvidenceClaims: number;
  maxEvidenceRefs: number;
}

export type TimelineLimitOptions = Partial<TimelineLimits>;

export const DEFAULT_TIMELINE_LIMITS: Readonly<TimelineLimits> = Object.freeze({
  maxCanonicalDepth: 128,
  maxCanonicalNodes: 1_000_000,
  maxCheckpoints: 10_000,
  maxRequirementsPerCheckpoint: 1_000,
  maxEvents: 50_000,
  maxEvidenceClaims: 1_000,
  maxEvidenceRefs: 10_000,
});

export function resolveTimelineLimits(
  options: TimelineLimitOptions = {},
): TimelineLimits {
  const limits = { ...DEFAULT_TIMELINE_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

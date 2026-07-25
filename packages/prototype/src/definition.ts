export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";

export interface GrowthTargets {
  targetFinalNloc?: number;
  nlocPerPeriod?: readonly [minimum: number, maximum: number];
  maximumChurnRatio?: number;
}

export interface TimelineMilestone {
  date: string;
  requirements: readonly string[];
  targetNloc?: number;
}

export interface QualityGates {
  testPassRate?: number;
  minimumCoverage?: number;
  maximumAverageComplexity?: number;
  zeroRegressions?: boolean;
  maximumCriticalSecurityFindings?: number;
}

export interface TimelineDefinition {
  project: {
    startDate: string;
    endDate: string;
    cadence: Cadence;
  };
  growth?: GrowthTargets;
  milestones?: readonly TimelineMilestone[];
  qualityGates?: QualityGates;
}

export interface TimelineValidationError {
  path: string;
  message: string;
}

const CADENCES = new Set<Cadence>(["weekly", "monthly", "quarterly", "yearly"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class TimelineDefinitionError extends Error {
  readonly errors: readonly TimelineValidationError[];

  constructor(errors: readonly TimelineValidationError[]) {
    super(errors.map(({ path, message }) => `${path}: ${message}`).join("; "));
    this.name = "TimelineDefinitionError";
    this.errors = errors;
  }
}

export function validateTimeline(
  definition: TimelineDefinition,
): TimelineValidationError[] {
  const errors: TimelineValidationError[] = [];
  const start = parseDate(definition.project.startDate);
  const end = parseDate(definition.project.endDate);

  if (start === null) {
    errors.push({
      path: "project.startDate",
      message: "must be a valid ISO date",
    });
  }
  if (end === null) {
    errors.push({
      path: "project.endDate",
      message: "must be a valid ISO date",
    });
  }
  if (start !== null && end !== null && start >= end) {
    errors.push({
      path: "project.endDate",
      message: "must be after project.startDate",
    });
  }
  if (!CADENCES.has(definition.project.cadence)) {
    errors.push({
      path: "project.cadence",
      message: "must be weekly, monthly, quarterly, or yearly",
    });
  }

  validateGrowth(definition.growth, errors);
  validateQualityGates(definition.qualityGates, errors);

  definition.milestones?.forEach((milestone, index) => {
    const path = `milestones[${index}]`;
    const date = parseDate(milestone.date);

    if (date === null) {
      errors.push({
        path: `${path}.date`,
        message: "must be a valid ISO date",
      });
    } else if (start !== null && end !== null && (date < start || date > end)) {
      errors.push({
        path: `${path}.date`,
        message: "must fall within the project timeline",
      });
    }

    if (
      milestone.requirements.length === 0 ||
      milestone.requirements.some(
        (requirement) => requirement.trim().length === 0,
      )
    ) {
      errors.push({
        path: `${path}.requirements`,
        message: "must contain non-empty requirements",
      });
    }

    if (
      milestone.targetNloc !== undefined &&
      !isNonNegativeInteger(milestone.targetNloc)
    ) {
      errors.push({
        path: `${path}.targetNloc`,
        message: "must be a non-negative integer",
      });
    }
  });

  return errors;
}

export function dateEpoch(date: string): number {
  const epoch = parseDate(date);
  if (epoch === null) {
    throw new RangeError(`invalid ISO date: ${date}`);
  }
  return epoch;
}

function validateGrowth(
  growth: GrowthTargets | undefined,
  errors: TimelineValidationError[],
): void {
  if (!growth) return;

  if (
    growth.targetFinalNloc !== undefined &&
    !isNonNegativeInteger(growth.targetFinalNloc)
  ) {
    errors.push({
      path: "growth.targetFinalNloc",
      message: "must be a non-negative integer",
    });
  }

  if (growth.nlocPerPeriod) {
    const [minimum, maximum] = growth.nlocPerPeriod;
    if (!isNonNegativeInteger(minimum) || !isNonNegativeInteger(maximum)) {
      errors.push({
        path: "growth.nlocPerPeriod",
        message: "must contain non-negative integers",
      });
    } else if (minimum > maximum) {
      errors.push({
        path: "growth.nlocPerPeriod",
        message: "minimum must not exceed maximum",
      });
    }
  }

  if (
    growth.maximumChurnRatio !== undefined &&
    !isRatio(growth.maximumChurnRatio)
  ) {
    errors.push({
      path: "growth.maximumChurnRatio",
      message: "must be between 0 and 1",
    });
  }
}

function validateQualityGates(
  gates: QualityGates | undefined,
  errors: TimelineValidationError[],
): void {
  if (!gates) return;

  for (const [name, value] of [
    ["testPassRate", gates.testPassRate],
    ["minimumCoverage", gates.minimumCoverage],
  ] as const) {
    if (value !== undefined && !isRatio(value)) {
      errors.push({
        path: `qualityGates.${name}`,
        message: "must be between 0 and 1",
      });
    }
  }

  if (
    gates.maximumAverageComplexity !== undefined &&
    (!Number.isFinite(gates.maximumAverageComplexity) ||
      gates.maximumAverageComplexity <= 0)
  ) {
    errors.push({
      path: "qualityGates.maximumAverageComplexity",
      message: "must be greater than 0",
    });
  }

  if (
    gates.maximumCriticalSecurityFindings !== undefined &&
    !isNonNegativeInteger(gates.maximumCriticalSecurityFindings)
  ) {
    errors.push({
      path: "qualityGates.maximumCriticalSecurityFindings",
      message: "must be a non-negative integer",
    });
  }
}

function parseDate(date: string): number | null {
  if (!ISO_DATE.test(date)) return null;

  const epoch = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(epoch)) return null;

  return new Date(epoch).toISOString().slice(0, 10) === date ? epoch : null;
}

function isRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

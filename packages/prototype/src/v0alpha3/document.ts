import { TimelineContractError, type ValidationIssue } from "../contract.js";
import { TimelineDocumentError } from "../document.js";
import {
  resolveTimelineLimits,
  type TimelineLimitOptions,
  type TimelineLimits,
} from "../limits.js";
import {
  appendCanonicalIssue,
  asRecord,
  joinPath,
  validateIdentifier,
  validateIdentifierArray,
  validateKeys,
} from "../v0alpha2/validation.js";
import type {
  TemporalEventV0Alpha3,
  TemporalQueryV0Alpha3,
  TimelineContractV0Alpha3,
  TimelineRunDocumentV0Alpha3,
} from "./types.js";

const CONTEXT_MODES = new Set([
  "actual",
  "forecast",
  "hypothetical",
  "planned",
]);
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

interface PointReference {
  axisId: string;
  contextId: string;
}

interface IntervalReference {
  axisId: string;
  contextId: string;
}

interface AssertionReference {
  contextId: string;
  kind: "constraint" | "coordinate" | "fact";
  pointId?: string;
}

export function validateContractV0Alpha3(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  appendContractIssues(value, "$", issues, limits);
  appendCanonicalIssue(value, issues, limits);
  return issues;
}

export function parseContractV0Alpha3(
  value: unknown,
  options: TimelineLimitOptions = {},
): TimelineContractV0Alpha3 {
  const issues = validateContractV0Alpha3(value, options);
  if (issues.length > 0) throw new TimelineContractError(issues);
  return value as TimelineContractV0Alpha3;
}

export function validateEventV0Alpha3(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  appendEventIssues(value, "$", issues, limits);
  appendCanonicalIssue(value, issues, limits);
  return issues;
}

export function parseEventV0Alpha3(
  value: unknown,
  options: TimelineLimitOptions = {},
): TemporalEventV0Alpha3 {
  const issues = validateEventV0Alpha3(value, options);
  if (issues.length > 0) throw new TimelineDocumentError(issues);
  return value as TemporalEventV0Alpha3;
}

export function validateRunDocumentV0Alpha3(
  value: unknown,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  const run = asRecord(value);
  if (!run) return [{ path: "$", message: "must be an object" }];

  validateKeys(run, ["schema", "contract", "events"], "$", issues);
  if (run.schema !== "covenant.timeline.run.v0alpha3") {
    issues.push({
      path: "schema",
      message: "must identify the v0alpha3 run schema",
    });
  }

  appendContractIssues(run.contract, "contract", issues, limits);
  if (!Array.isArray(run.events)) {
    issues.push({ path: "events", message: "must be an array" });
    appendCanonicalIssue(run, issues, limits);
    return issues;
  }
  if (run.events.length > limits.maxEvents) {
    issues.push({
      path: "events",
      message: `event count must not exceed ${limits.maxEvents}`,
    });
  }

  const contract = asRecord(run.contract);
  const axisIds = collectIds(contract?.axes);
  const contextIds = collectIds(contract?.contexts);
  const eventIds = new Set<string>();
  const temporalIds = new Set<string>();
  const points = new Map<string, PointReference>();
  const intervals = new Map<string, IntervalReference>();
  const assertions = new Map<string, AssertionReference>();

  run.events.slice(0, limits.maxEvents).forEach((event, index) => {
    const path = `events[${index}]`;
    appendEventIssues(event, path, issues, limits);
    const record = asRecord(event);
    if (!record) return;

    if (
      typeof record.sequence === "number" &&
      Number.isSafeInteger(record.sequence) &&
      record.sequence >= 0 &&
      record.sequence !== index
    ) {
      issues.push({
        path: `${path}.sequence`,
        message: `must equal ${index}`,
      });
    }
    registerUniqueId(record.id, `${path}.id`, eventIds, issues, "event");

    if (record.type === "point.declared") {
      const point = asRecord(record.point);
      if (!point) return;
      const pointPath = `${path}.point`;
      validateContractReference(
        point.contextId,
        `${pointPath}.contextId`,
        contextIds,
        "temporal context",
        issues,
      );
      validateContractReference(
        point.axisId,
        `${pointPath}.axisId`,
        axisIds,
        "temporal axis",
        issues,
      );
      if (
        registerUniqueId(
          point.id,
          `${pointPath}.id`,
          temporalIds,
          issues,
          "temporal object",
        ) &&
        typeof point.contextId === "string" &&
        typeof point.axisId === "string"
      ) {
        points.set(point.id as string, {
          contextId: point.contextId,
          axisId: point.axisId,
        });
      }
      return;
    }

    if (record.type === "interval.declared") {
      const interval = asRecord(record.interval);
      if (!interval) return;
      const intervalPath = `${path}.interval`;
      validateContractReference(
        interval.contextId,
        `${intervalPath}.contextId`,
        contextIds,
        "temporal context",
        issues,
      );
      const start = validateEarlierPoint(
        interval.startPointId,
        `${intervalPath}.startPointId`,
        interval.contextId,
        points,
        issues,
      );
      const end = validateEarlierPoint(
        interval.endPointId,
        `${intervalPath}.endPointId`,
        interval.contextId,
        points,
        issues,
      );
      if (start && end && start.axisId !== end.axisId) {
        issues.push({
          path: `${intervalPath}.endPointId`,
          message: "must reference a point on the same temporal axis",
        });
      }
      if (
        registerUniqueId(
          interval.id,
          `${intervalPath}.id`,
          temporalIds,
          issues,
          "temporal object",
        ) &&
        typeof interval.contextId === "string" &&
        start &&
        end &&
        start.axisId === end.axisId
      ) {
        intervals.set(interval.id as string, {
          contextId: interval.contextId,
          axisId: start.axisId,
        });
      }
      return;
    }

    if (record.type === "constraint.asserted") {
      const assertion = asRecord(record.assertion);
      if (!assertion) return;
      const assertionPath = `${path}.assertion`;
      validateContractReference(
        assertion.contextId,
        `${assertionPath}.contextId`,
        contextIds,
        "temporal context",
        issues,
      );
      const constraint = asRecord(assertion.constraint);
      if (constraint) {
        const from = validateEarlierPoint(
          constraint.fromPointId,
          `${assertionPath}.constraint.fromPointId`,
          assertion.contextId,
          points,
          issues,
        );
        const to = validateEarlierPoint(
          constraint.toPointId,
          `${assertionPath}.constraint.toPointId`,
          assertion.contextId,
          points,
          issues,
        );
        if (from && to && from.axisId !== to.axisId) {
          issues.push({
            path: `${assertionPath}.constraint.toPointId`,
            message: "must reference a point on the same temporal axis",
          });
        }
      }
      validateSupersededAssertions(
        assertion.supersedes,
        `${assertionPath}.supersedes`,
        "constraint",
        assertion.contextId,
        assertions,
        issues,
      );
      if (
        registerUniqueId(
          assertion.id,
          `${assertionPath}.id`,
          temporalIds,
          issues,
          "temporal object",
        ) &&
        typeof assertion.contextId === "string"
      ) {
        assertions.set(assertion.id as string, {
          kind: "constraint",
          contextId: assertion.contextId,
        });
      }
      return;
    }

    if (record.type === "coordinate.asserted") {
      const assertion = asRecord(record.assertion);
      if (!assertion) return;
      const assertionPath = `${path}.assertion`;
      validateContractReference(
        assertion.contextId,
        `${assertionPath}.contextId`,
        contextIds,
        "temporal context",
        issues,
      );
      validateEarlierPoint(
        assertion.pointId,
        `${assertionPath}.pointId`,
        assertion.contextId,
        points,
        issues,
      );
      validateSupersededAssertions(
        assertion.supersedes,
        `${assertionPath}.supersedes`,
        "coordinate",
        assertion.contextId,
        assertions,
        issues,
        assertion.pointId,
      );
      if (
        registerUniqueId(
          assertion.id,
          `${assertionPath}.id`,
          temporalIds,
          issues,
          "temporal object",
        ) &&
        typeof assertion.contextId === "string"
      ) {
        assertions.set(assertion.id as string, {
          kind: "coordinate",
          contextId: assertion.contextId,
          ...(typeof assertion.pointId === "string"
            ? { pointId: assertion.pointId }
            : {}),
        });
      }
      return;
    }

    if (record.type === "fact.asserted") {
      const assertion = asRecord(record.assertion);
      if (!assertion) return;
      const assertionPath = `${path}.assertion`;
      validateContractReference(
        assertion.contextId,
        `${assertionPath}.contextId`,
        contextIds,
        "temporal context",
        issues,
      );
      if (assertion.validDuring !== undefined) {
        validateEarlierInterval(
          assertion.validDuring,
          `${assertionPath}.validDuring`,
          assertion.contextId,
          intervals,
          issues,
        );
      }
      if (assertion.observedAt !== undefined) {
        validateEarlierPoint(
          assertion.observedAt,
          `${assertionPath}.observedAt`,
          assertion.contextId,
          points,
          issues,
        );
      }
      if (assertion.assertedAt !== undefined) {
        validateEarlierPoint(
          assertion.assertedAt,
          `${assertionPath}.assertedAt`,
          assertion.contextId,
          points,
          issues,
        );
      }
      validateSupersededAssertions(
        assertion.supersedes,
        `${assertionPath}.supersedes`,
        "fact",
        assertion.contextId,
        assertions,
        issues,
      );
      if (
        registerUniqueId(
          assertion.id,
          `${assertionPath}.id`,
          temporalIds,
          issues,
          "temporal object",
        ) &&
        typeof assertion.contextId === "string"
      ) {
        assertions.set(assertion.id as string, {
          kind: "fact",
          contextId: assertion.contextId,
        });
      }
      return;
    }

    if (record.type === "assertion.retracted") {
      if (
        typeof record.assertionId === "string" &&
        !assertions.has(record.assertionId)
      ) {
        issues.push({
          path: `${path}.assertionId`,
          message: "must reference an earlier assertion",
        });
      }
    }
  });

  appendCanonicalIssue(run, issues, limits);
  return issues;
}

export function parseRunDocumentV0Alpha3(
  value: unknown,
  options: TimelineLimitOptions = {},
): TimelineRunDocumentV0Alpha3 {
  const issues = validateRunDocumentV0Alpha3(value, options);
  if (issues.length > 0) throw new TimelineDocumentError(issues);
  return value as TimelineRunDocumentV0Alpha3;
}

export function validateQueryV0Alpha3(
  value: unknown,
  run: TimelineRunDocumentV0Alpha3,
  options: TimelineLimitOptions = {},
): ValidationIssue[] {
  const limits = resolveTimelineLimits(options);
  const issues: ValidationIssue[] = [];
  const query = asRecord(value);
  if (!query) return [{ path: "$", message: "must be an object" }];

  appendQueryIssues(query, "$", issues);

  const runRecord = asRecord(run);
  const events = Array.isArray(runRecord?.events) ? runRecord.events : [];
  const contract = asRecord(runRecord?.contract);
  const contextIds = collectIds(contract?.contexts);
  validateContractReference(
    query.contextId,
    "contextId",
    contextIds,
    "temporal context",
    issues,
  );

  const cut = query.recordedThrough;
  let cutIndex = -1;
  if (typeof cut === "number" && Number.isSafeInteger(cut) && cut >= 0) {
    if (cut >= events.length) {
      issues.push({
        path: "recordedThrough",
        message: "must identify a sequence within the run",
      });
    } else {
      cutIndex = cut;
    }
  }

  const { points, intervals } = collectDeclarationsAtCut(events, cutIndex);
  if (query.type === "difference.bounds") {
    const from = validateQueryPoint(
      query.fromPointId,
      "fromPointId",
      query.contextId,
      points,
      issues,
    );
    const to = validateQueryPoint(
      query.toPointId,
      "toPointId",
      query.contextId,
      points,
      issues,
    );
    if (from && to && from.axisId !== to.axisId) {
      issues.push({
        path: "toPointId",
        message: "must reference a point on the same temporal axis",
      });
    }
  } else if (query.type === "point.relations") {
    const left = validateQueryPoint(
      query.leftPointId,
      "leftPointId",
      query.contextId,
      points,
      issues,
    );
    const right = validateQueryPoint(
      query.rightPointId,
      "rightPointId",
      query.contextId,
      points,
      issues,
    );
    if (left && right && left.axisId !== right.axisId) {
      issues.push({
        path: "rightPointId",
        message: "must reference a point on the same temporal axis",
      });
    }
  } else if (query.type === "interval.relations") {
    const left = validateQueryInterval(
      query.leftIntervalId,
      "leftIntervalId",
      query.contextId,
      intervals,
      issues,
    );
    const right = validateQueryInterval(
      query.rightIntervalId,
      "rightIntervalId",
      query.contextId,
      intervals,
      issues,
    );
    if (left && right && left.axisId !== right.axisId) {
      issues.push({
        path: "rightIntervalId",
        message: "must reference an interval on the same temporal axis",
      });
    }
  }

  appendCanonicalIssue(query, issues, limits);
  return issues;
}

export function parseQueryV0Alpha3(
  value: unknown,
  run: TimelineRunDocumentV0Alpha3,
  options: TimelineLimitOptions = {},
): TemporalQueryV0Alpha3 {
  const issues = validateQueryV0Alpha3(value, run, options);
  if (issues.length > 0) throw new TimelineDocumentError(issues);
  return value as TemporalQueryV0Alpha3;
}

function appendContractIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  const contract = asRecord(value);
  if (!contract) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  const field = (name: string) => joinPath(path, name);
  validateKeys(
    contract,
    ["schema", "id", "subject", "axes", "contexts"],
    path,
    issues,
  );
  if (contract.schema !== "covenant.timeline.contract.v0alpha3") {
    issues.push({
      path: field("schema"),
      message: "must identify the v0alpha3 contract schema",
    });
  }
  validateIdentifier(contract.id, field("id"), issues);

  const subject = asRecord(contract.subject);
  if (!subject) {
    issues.push({ path: field("subject"), message: "must be an object" });
  } else {
    const subjectPath = field("subject");
    validateKeys(subject, ["kind", "id"], subjectPath, issues);
    validateIdentifier(subject.kind, joinPath(subjectPath, "kind"), issues);
    validateIdentifier(subject.id, joinPath(subjectPath, "id"), issues);
  }

  appendAxesIssues(contract.axes, field("axes"), issues, limits);
  appendContextsIssues(contract.contexts, field("contexts"), issues, limits);
}

function appendAxesIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return;
  }
  if (value.length === 0) {
    issues.push({ path, message: "must not be empty" });
  }
  if (value.length > limits.maxCheckpoints) {
    issues.push({
      path,
      message: `must contain at most ${limits.maxCheckpoints} entries`,
    });
  }

  const ids = new Set<string>();
  value.slice(0, limits.maxCheckpoints).forEach((entry, index) => {
    const axisPath = `${path}[${index}]`;
    const axis = asRecord(entry);
    if (!axis) {
      issues.push({ path: axisPath, message: "must be an object" });
      return;
    }
    validateKeys(axis, ["id", "kind", "unit", "origin"], axisPath, issues);
    if (validateIdentifier(axis.id, `${axisPath}.id`, issues)) {
      if (ids.has(axis.id)) {
        issues.push({ path: `${axisPath}.id`, message: "must be unique" });
      }
      ids.add(axis.id);
    }
    if (axis.kind !== "metric" && axis.kind !== "ordinal") {
      issues.push({
        path: `${axisPath}.kind`,
        message: "must be metric or ordinal",
      });
    }
    validateIdentifier(axis.unit, `${axisPath}.unit`, issues);
    validateIdentifier(axis.origin, `${axisPath}.origin`, issues);
  });
}

function appendContextsIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return;
  }
  if (value.length === 0) {
    issues.push({ path, message: "must not be empty" });
  }
  if (value.length > limits.maxCheckpoints) {
    issues.push({
      path,
      message: `must contain at most ${limits.maxCheckpoints} entries`,
    });
  }

  const ids = new Set<string>();
  value.slice(0, limits.maxCheckpoints).forEach((entry, index) => {
    const contextPath = `${path}[${index}]`;
    const context = asRecord(entry);
    if (!context) {
      issues.push({ path: contextPath, message: "must be an object" });
      return;
    }
    validateKeys(context, ["id", "mode"], contextPath, issues);
    if (validateIdentifier(context.id, `${contextPath}.id`, issues)) {
      if (ids.has(context.id)) {
        issues.push({ path: `${contextPath}.id`, message: "must be unique" });
      }
      ids.add(context.id);
    }
    if (typeof context.mode !== "string" || !CONTEXT_MODES.has(context.mode)) {
      issues.push({
        path: `${contextPath}.mode`,
        message: "must be actual, forecast, hypothetical, or planned",
      });
    }
  });
}

function appendEventIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  const event = asRecord(value);
  if (!event) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  const field = (name: string) => joinPath(path, name);
  if (event.schema !== "covenant.timeline.event.v0alpha3") {
    issues.push({
      path: field("schema"),
      message: "must identify the v0alpha3 event schema",
    });
  }
  validateIdentifier(event.id, field("id"), issues);
  validateNonNegativeSafeInteger(event.sequence, field("sequence"), issues);

  if (event.type === "point.declared") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "point"],
      path,
      issues,
    );
    appendPointIssues(event.point, field("point"), issues);
    return;
  }
  if (event.type === "interval.declared") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "interval"],
      path,
      issues,
    );
    appendIntervalIssues(event.interval, field("interval"), issues);
    return;
  }
  if (event.type === "constraint.asserted") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "assertion"],
      path,
      issues,
    );
    appendConstraintAssertionIssues(
      event.assertion,
      field("assertion"),
      issues,
      limits,
    );
    return;
  }
  if (event.type === "coordinate.asserted") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "assertion"],
      path,
      issues,
    );
    appendCoordinateAssertionIssues(
      event.assertion,
      field("assertion"),
      issues,
      limits,
    );
    return;
  }
  if (event.type === "fact.asserted") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "assertion"],
      path,
      issues,
    );
    appendFactAssertionIssues(
      event.assertion,
      field("assertion"),
      issues,
      limits,
    );
    return;
  }
  if (event.type === "assertion.retracted") {
    validateKeys(
      event,
      ["schema", "id", "sequence", "type", "assertionId", "evidenceRefs"],
      path,
      issues,
    );
    validateIdentifier(event.assertionId, field("assertionId"), issues);
    validateEvidenceRefs(
      event.evidenceRefs,
      field("evidenceRefs"),
      limits.maxEvidenceRefs,
      issues,
    );
    return;
  }
  issues.push({
    path: field("type"),
    message: "must identify a supported event type",
  });
}

function appendPointIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  const point = asRecord(value);
  if (!point) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  validateKeys(point, ["id", "contextId", "axisId"], path, issues);
  validateIdentifier(point.id, `${path}.id`, issues);
  validateIdentifier(point.contextId, `${path}.contextId`, issues);
  validateIdentifier(point.axisId, `${path}.axisId`, issues);
}

function appendIntervalIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  const interval = asRecord(value);
  if (!interval) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  validateKeys(
    interval,
    ["id", "contextId", "startPointId", "endPointId"],
    path,
    issues,
  );
  validateIdentifier(interval.id, `${path}.id`, issues);
  validateIdentifier(interval.contextId, `${path}.contextId`, issues);
  validateIdentifier(interval.startPointId, `${path}.startPointId`, issues);
  validateIdentifier(interval.endPointId, `${path}.endPointId`, issues);
}

function appendConstraintAssertionIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  const assertion = asRecord(value);
  if (!assertion) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  validateKeys(
    assertion,
    ["id", "contextId", "constraint", "evidenceRefs", "supersedes"],
    path,
    issues,
  );
  validateIdentifier(assertion.id, `${path}.id`, issues);
  validateIdentifier(assertion.contextId, `${path}.contextId`, issues);

  const constraint = asRecord(assertion.constraint);
  if (!constraint) {
    issues.push({ path: `${path}.constraint`, message: "must be an object" });
  } else {
    validateKeys(
      constraint,
      ["fromPointId", "toPointId", "minimum", "maximum"],
      `${path}.constraint`,
      issues,
    );
    validateIdentifier(
      constraint.fromPointId,
      `${path}.constraint.fromPointId`,
      issues,
    );
    validateIdentifier(
      constraint.toPointId,
      `${path}.constraint.toPointId`,
      issues,
    );
    appendNumericBoundsIssues(constraint, `${path}.constraint`, issues, true);
  }
  appendEvidenceAndSupersessionIssues(assertion, path, issues, limits);
}

function appendCoordinateAssertionIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  const assertion = asRecord(value);
  if (!assertion) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  validateKeys(
    assertion,
    ["id", "contextId", "pointId", "coordinate", "evidenceRefs", "supersedes"],
    path,
    issues,
  );
  validateIdentifier(assertion.id, `${path}.id`, issues);
  validateIdentifier(assertion.contextId, `${path}.contextId`, issues);
  validateIdentifier(assertion.pointId, `${path}.pointId`, issues);
  appendBoundsIssues(assertion.coordinate, `${path}.coordinate`, issues, true);
  appendEvidenceAndSupersessionIssues(assertion, path, issues, limits);
}

function appendFactAssertionIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  const assertion = asRecord(value);
  if (!assertion) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  validateKeys(
    assertion,
    [
      "id",
      "contextId",
      "propositionRef",
      "validDuring",
      "observedAt",
      "assertedAt",
      "evidenceRefs",
      "supersedes",
    ],
    path,
    issues,
  );
  validateIdentifier(assertion.id, `${path}.id`, issues);
  validateIdentifier(assertion.contextId, `${path}.contextId`, issues);
  validateIdentifier(
    assertion.propositionRef,
    `${path}.propositionRef`,
    issues,
  );
  if (assertion.validDuring !== undefined) {
    validateIdentifier(assertion.validDuring, `${path}.validDuring`, issues);
  }
  if (assertion.observedAt !== undefined) {
    validateIdentifier(assertion.observedAt, `${path}.observedAt`, issues);
  }
  if (assertion.assertedAt !== undefined) {
    validateIdentifier(assertion.assertedAt, `${path}.assertedAt`, issues);
  }
  appendEvidenceAndSupersessionIssues(assertion, path, issues, limits);
}

function appendEvidenceAndSupersessionIssues(
  assertion: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
  limits: TimelineLimits,
): void {
  validateEvidenceRefs(
    assertion.evidenceRefs,
    `${path}.evidenceRefs`,
    limits.maxEvidenceRefs,
    issues,
  );
  if (assertion.supersedes !== undefined) {
    validateIdentifierArray(
      assertion.supersedes,
      `${path}.supersedes`,
      false,
      limits.maxEvidenceRefs,
      issues,
    );
  }
}

function appendBoundsIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  requireBound: boolean,
): void {
  const bounds = asRecord(value);
  if (!bounds) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  validateKeys(bounds, ["minimum", "maximum"], path, issues);
  appendNumericBoundsIssues(bounds, path, issues, requireBound);
}

function appendNumericBoundsIssues(
  bounds: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
  requireBound: boolean,
): void {
  if (
    requireBound &&
    bounds.minimum === undefined &&
    bounds.maximum === undefined
  ) {
    issues.push({
      path,
      message: "must define at least one of minimum or maximum",
    });
  }
  const minimumValid =
    bounds.minimum === undefined ||
    validateSafeInteger(bounds.minimum, `${path}.minimum`, issues);
  const maximumValid =
    bounds.maximum === undefined ||
    validateSafeInteger(bounds.maximum, `${path}.maximum`, issues);
  if (
    minimumValid &&
    maximumValid &&
    typeof bounds.minimum === "number" &&
    typeof bounds.maximum === "number" &&
    bounds.minimum > bounds.maximum
  ) {
    issues.push({
      path: `${path}.maximum`,
      message: "must be greater than or equal to minimum",
    });
  }
}

function appendQueryIssues(
  query: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  const field = (name: string) => joinPath(path, name);
  if (query.schema !== "covenant.timeline.query.v0alpha3") {
    issues.push({
      path: field("schema"),
      message: "must identify the v0alpha3 query schema",
    });
  }
  validateIdentifier(query.id, field("id"), issues);
  validateIdentifier(query.contextId, field("contextId"), issues);
  if (query.recordedThrough !== null) {
    validateNonNegativeSafeInteger(
      query.recordedThrough,
      field("recordedThrough"),
      issues,
    );
  }

  if (query.type === "context.consistency") {
    validateKeys(
      query,
      ["schema", "id", "contextId", "recordedThrough", "type"],
      path,
      issues,
    );
    return;
  }
  if (query.type === "difference.bounds") {
    validateKeys(
      query,
      [
        "schema",
        "id",
        "contextId",
        "recordedThrough",
        "type",
        "fromPointId",
        "toPointId",
      ],
      path,
      issues,
    );
    validateIdentifier(query.fromPointId, field("fromPointId"), issues);
    validateIdentifier(query.toPointId, field("toPointId"), issues);
    return;
  }
  if (query.type === "point.relations") {
    validateKeys(
      query,
      [
        "schema",
        "id",
        "contextId",
        "recordedThrough",
        "type",
        "leftPointId",
        "rightPointId",
      ],
      path,
      issues,
    );
    validateIdentifier(query.leftPointId, field("leftPointId"), issues);
    validateIdentifier(query.rightPointId, field("rightPointId"), issues);
    return;
  }
  if (query.type === "interval.relations") {
    validateKeys(
      query,
      [
        "schema",
        "id",
        "contextId",
        "recordedThrough",
        "type",
        "leftIntervalId",
        "rightIntervalId",
      ],
      path,
      issues,
    );
    validateIdentifier(query.leftIntervalId, field("leftIntervalId"), issues);
    validateIdentifier(query.rightIntervalId, field("rightIntervalId"), issues);
    return;
  }
  issues.push({
    path: field("type"),
    message: "must identify a supported query type",
  });
}

function collectIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value)) return ids;
  for (const entry of value) {
    const record = asRecord(entry);
    if (record && typeof record.id === "string") ids.add(record.id);
  }
  return ids;
}

function registerUniqueId(
  value: unknown,
  path: string,
  ids: Set<string>,
  issues: ValidationIssue[],
  namespace: string,
): value is string {
  if (typeof value !== "string") return false;
  if (ids.has(value)) {
    issues.push({
      path,
      message: `must be unique within the ${namespace} namespace`,
    });
    return false;
  }
  ids.add(value);
  return true;
}

function validateContractReference(
  value: unknown,
  path: string,
  ids: ReadonlySet<string>,
  kind: string,
  issues: ValidationIssue[],
): void {
  if (typeof value === "string" && !ids.has(value)) {
    issues.push({ path, message: `must reference a declared ${kind}` });
  }
}

function validateEarlierPoint(
  value: unknown,
  path: string,
  contextId: unknown,
  points: ReadonlyMap<string, PointReference>,
  issues: ValidationIssue[],
): PointReference | undefined {
  if (typeof value !== "string") return undefined;
  const point = points.get(value);
  if (!point) {
    issues.push({ path, message: "must reference an earlier point" });
    return undefined;
  }
  if (typeof contextId === "string" && point.contextId !== contextId) {
    issues.push({
      path,
      message: "must reference a point in the same temporal context",
    });
    return undefined;
  }
  return point;
}

function validateEarlierInterval(
  value: unknown,
  path: string,
  contextId: unknown,
  intervals: ReadonlyMap<string, IntervalReference>,
  issues: ValidationIssue[],
): IntervalReference | undefined {
  if (typeof value !== "string") return undefined;
  const interval = intervals.get(value);
  if (!interval) {
    issues.push({ path, message: "must reference an earlier interval" });
    return undefined;
  }
  if (typeof contextId === "string" && interval.contextId !== contextId) {
    issues.push({
      path,
      message: "must reference an interval in the same temporal context",
    });
    return undefined;
  }
  return interval;
}

function validateSupersededAssertions(
  value: unknown,
  path: string,
  kind: AssertionReference["kind"],
  contextId: unknown,
  assertions: ReadonlyMap<string, AssertionReference>,
  issues: ValidationIssue[],
  pointId?: unknown,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    if (typeof entry !== "string") return;
    const target = assertions.get(entry);
    if (!target) {
      issues.push({
        path: `${path}[${index}]`,
        message: "must reference an earlier assertion",
      });
      return;
    }
    if (target.kind !== kind) {
      issues.push({
        path: `${path}[${index}]`,
        message: `must reference an earlier ${kind} assertion`,
      });
      return;
    }
    if (typeof contextId === "string" && target.contextId !== contextId) {
      issues.push({
        path: `${path}[${index}]`,
        message: "must reference an assertion in the same temporal context",
      });
    }
    if (
      kind === "coordinate" &&
      typeof pointId === "string" &&
      target.pointId !== pointId
    ) {
      issues.push({
        path: `${path}[${index}]`,
        message: "must reference a coordinate assertion for the same point",
      });
    }
  });
}

function collectDeclarationsAtCut(
  events: readonly unknown[],
  cut: number,
): {
  points: Map<string, PointReference>;
  intervals: Map<string, IntervalReference>;
} {
  const points = new Map<string, PointReference>();
  const intervals = new Map<string, IntervalReference>();
  events.slice(0, cut + 1).forEach((entry) => {
    const event = asRecord(entry);
    if (event?.type === "point.declared") {
      const point = asRecord(event.point);
      if (
        point &&
        typeof point.id === "string" &&
        typeof point.contextId === "string" &&
        typeof point.axisId === "string"
      ) {
        points.set(point.id, {
          contextId: point.contextId,
          axisId: point.axisId,
        });
      }
      return;
    }
    if (event?.type === "interval.declared") {
      const interval = asRecord(event.interval);
      if (
        interval &&
        typeof interval.id === "string" &&
        typeof interval.contextId === "string" &&
        typeof interval.startPointId === "string"
      ) {
        const start = points.get(interval.startPointId);
        if (start) {
          intervals.set(interval.id, {
            contextId: interval.contextId,
            axisId: start.axisId,
          });
        }
      }
    }
  });
  return { points, intervals };
}

function validateQueryPoint(
  value: unknown,
  path: string,
  contextId: unknown,
  points: ReadonlyMap<string, PointReference>,
  issues: ValidationIssue[],
): PointReference | undefined {
  if (typeof value !== "string") return undefined;
  const point = points.get(value);
  if (!point) {
    issues.push({
      path,
      message: "must reference a point available at the knowledge cut",
    });
    return undefined;
  }
  if (typeof contextId === "string" && point.contextId !== contextId) {
    issues.push({
      path,
      message: "must reference a point in the query temporal context",
    });
    return undefined;
  }
  return point;
}

function validateQueryInterval(
  value: unknown,
  path: string,
  contextId: unknown,
  intervals: ReadonlyMap<string, IntervalReference>,
  issues: ValidationIssue[],
): IntervalReference | undefined {
  if (typeof value !== "string") return undefined;
  const interval = intervals.get(value);
  if (!interval) {
    issues.push({
      path,
      message: "must reference an interval available at the knowledge cut",
    });
    return undefined;
  }
  if (typeof contextId === "string" && interval.contextId !== contextId) {
    issues.push({
      path,
      message: "must reference an interval in the query temporal context",
    });
    return undefined;
  }
  return interval;
}

function validateSafeInteger(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    issues.push({ path, message: "must be a safe integer" });
    return false;
  }
  return true;
}

function validateEvidenceRefs(
  value: unknown,
  path: string,
  maximum: number,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return;
  }
  if (value.length === 0) {
    issues.push({ path, message: "must not be empty" });
  }
  if (value.length > maximum) {
    issues.push({ path, message: `must contain at most ${maximum} entries` });
  }

  const seen = new Set<string>();
  value.slice(0, maximum).forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (typeof entry !== "string" || !SHA256_DIGEST.test(entry)) {
      issues.push({
        path: entryPath,
        message: "must be a lowercase SHA-256 content digest",
      });
      return;
    }
    if (seen.has(entry)) {
      issues.push({ path: entryPath, message: "must be unique" });
    }
    seen.add(entry);
  });
}

function validateNonNegativeSafeInteger(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push({ path, message: "must be a non-negative safe integer" });
    return false;
  }
  return true;
}

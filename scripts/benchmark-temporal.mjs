#!/usr/bin/env node

import {
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "../packages/prototype/dist/index.js";

const pointCount = 500;
const evidenceRef = `sha256:${"a".repeat(64)}`;
const pointEvents = Array.from({ length: pointCount }, (_, index) => ({
  schema: "covenant.timeline.event.v0alpha3",
  id: `event-${index}`,
  sequence: index,
  type: "point.declared",
  point: {
    id: `point-${index}`,
    contextId: "actual",
    axisId: "elapsed-ticks",
  },
}));
const coordinateEvent = {
  schema: "covenant.timeline.event.v0alpha3",
  id: `event-${pointCount}`,
  sequence: pointCount,
  type: "coordinate.asserted",
  assertion: {
    id: "coordinate-0",
    contextId: "actual",
    pointId: "point-0",
    coordinate: { minimum: 0, maximum: 0 },
    evidenceRefs: [evidenceRef],
  },
};
const constraintEvents = Array.from({ length: pointCount - 1 }, (_, offset) => {
  const index = offset + pointCount + 1;
  return {
    schema: "covenant.timeline.event.v0alpha3",
    id: `event-${index}`,
    sequence: index,
    type: "constraint.asserted",
    assertion: {
      id: `constraint-${offset}`,
      contextId: "actual",
      constraint: {
        fromPointId: `point-${offset}`,
        toPointId: `point-${offset + 1}`,
        minimum: 1,
        maximum: 2,
      },
      evidenceRefs: [evidenceRef],
    },
  };
});
const run = {
  schema: "covenant.timeline.run.v0alpha3",
  contract: {
    schema: "covenant.timeline.contract.v0alpha3",
    id: "benchmark.temporal.v1",
    subject: { kind: "benchmark", id: "difference-chain" },
    axes: [
      {
        id: "elapsed-ticks",
        kind: "metric",
        unit: "tick",
        origin: "benchmark.origin.v1",
      },
    ],
    contexts: [{ id: "actual", mode: "actual" }],
  },
  events: [...pointEvents, coordinateEvent, ...constraintEvents],
};
const query = {
  schema: "covenant.timeline.query.v0alpha3",
  id: "query.chain-bounds",
  contextId: "actual",
  recordedThrough: run.events.length - 1,
  type: "difference.bounds",
  fromPointId: "point-0",
  toPointId: `point-${pointCount - 1}`,
};

reasonTemporalQueryV0Alpha3(run, query);
const samples = [];
let conclusion;
for (let index = 0; index < 3; index += 1) {
  const started = process.hrtime.bigint();
  conclusion = reasonTemporalQueryV0Alpha3(run, query);
  samples.push(Number(process.hrtime.bigint() - started) / 1_000_000);
}
samples.sort((left, right) => left - right);

if (
  conclusion.result.minimum !== pointCount - 1 ||
  conclusion.result.maximum !== (pointCount - 1) * 2 ||
  !verifyTemporalConclusionV0Alpha3(run, query, conclusion)
) {
  throw new Error("temporal benchmark result or proof changed");
}

process.stdout.write(
  `${JSON.stringify({
    schema: "covenant.timeline.benchmark.temporal.v0alpha3",
    node: process.versions.node,
    points: pointCount,
    constraints: pointCount - 1,
    samplesMs: samples.map((value) => Math.round(value * 100) / 100),
    medianMs: Math.round(samples[1] * 100) / 100,
    result: conclusion.result,
    proofVerified: true,
  })}\n`,
);

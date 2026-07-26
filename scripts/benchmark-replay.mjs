#!/usr/bin/env node

import {
  replayV0Alpha2,
  verifyRunV0Alpha2,
} from "../packages/prototype/dist/index.js";

const eventCount = 50_000;
const policy = {
  profile: "benchmark.profile.v1",
  policyRef: "benchmark.policy.v1",
  policyDigest:
    "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
};
const contract = {
  schema: "covenant.timeline.contract.v0alpha2",
  id: "benchmark",
  subject: { kind: "benchmark", id: "replay" },
  checkpoints: [
    {
      id: "complete",
      requirements: ["benchmark.complete"],
      policy,
    },
  ],
};
const events = Array.from({ length: eventCount }, (_, index) => ({
  schema: "covenant.timeline.event.v0alpha2",
  id: `event-${index}`,
  sequence: index,
  type: "evidence.recorded",
  evidence: {
    id: `evidence-${index}`,
    kind: "benchmark",
    claims: ["benchmark.observed"],
    payloadDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    producer: "benchmark",
    authority: {
      ...policy,
      proofDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  },
}));

replayV0Alpha2(contract, "warmup", events);
const samples = [];
let finalState;
for (let index = 0; index < 3; index += 1) {
  const started = process.hrtime.bigint();
  finalState = replayV0Alpha2(contract, `benchmark-${index}`, events);
  const elapsed = Number(process.hrtime.bigint() - started) / 1_000_000;
  samples.push(Math.round(elapsed * 100) / 100);
}
samples.sort((left, right) => left - right);

console.log(
  JSON.stringify({
    schema: "covenant.timeline.benchmark.replay.v1",
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    events: eventCount,
    samplesMs: samples,
    medianMs: samples[1],
    projectedEvidence: Object.keys(finalState.evidence).length,
    structurallyComplete: verifyRunV0Alpha2(finalState).ok,
  }),
);

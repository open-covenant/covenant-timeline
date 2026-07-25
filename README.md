# Covenant Timeline

Covenant Timeline is an open temporal contract engine. A timeline is executable
input: it defines a clock, subjects, checkpoints, requirements, evidence,
evaluation policies, and outputs for work that unfolds across time.

Covenant is the first reference consumer, not the boundary. The core must remain
portable enough to fork and use without Covenant, a blockchain, a particular
agent runtime, or a particular kind of work.

## What it enables

- Plan and govern long software-engineering builds across releases or calendar
  periods.
- Measure code quality and regression resistance across a complete trajectory,
  not only the final snapshot.
- Evaluate agent capabilities from a history of scoped, evidenced deliveries.
- Produce explainable trust and credit scorecards from signed outcomes,
  settlement receipts, attestations, and policy checks.
- Drive any function whose eligibility or behavior depends on a declared
  timeline.
- Replay or fork a prior checkpoint under different requirements or policies.

Code quality, agent reputation, provider reliability, and partnership telemetry
are adapters over the same primitive. They are not hard-coded into the core.

## Core model

```text
Timeline Contract
      │
      ▼
Deterministic Compiler ──► Checkpoint Plan
                                │
                                ▼
                         Runner / Integrations
                                │
                                ▼
                       Evidence + Evaluations
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
               Scorecards             Attestations
```

The engine separates:

- **time** from wall-clock dates;
- **evidence** from claims;
- **scores** from the underlying evidence vector;
- **policy** from execution;
- **portable core semantics** from Covenant-specific trust and settlement.

See the [program plan](./PROGRAM.md), [architecture](./docs/architecture.md),
[domain profiles](./docs/domain-profiles.md),
[financial safety model](./docs/financial-safety.md), and
[roadmap](./ROADMAP.md).

## Current status

This repository is pre-alpha. The TypeScript code in `packages/prototype`
proves calendar checkpoint generation and deterministic snapshot and trajectory
scoring. It is not the canonical engine and does not implement the complete
protocol.

The v0alpha1 specification, schemas, conformance cases, and RFCs are being
developed before the canonical Rust kernel. Financial material is an
architecture and safety boundary, not a live-trading product. Do not use this
repository to grant financial authority or control funds.

## Verify

Requirements:

- Node.js 22 or later;
- pnpm 10.31.

```sh
pnpm install --frozen-lockfile
pnpm verify
```

## Prototype API

```ts
import { buildTimeline, scoreSnapshot } from "@covenant-org/timeline";

const definition = {
  project: {
    startDate: "2023-01-01",
    endDate: "2025-12-31",
    cadence: "monthly",
  },
  growth: {
    targetFinalNloc: 75_000,
    nlocPerPeriod: [1_000, 3_500],
    maximumChurnRatio: 0.45,
  },
  milestones: [
    {
      date: "2023-03-31",
      requirements: ["authentication", "account management"],
      targetNloc: 8_000,
    },
  ],
  qualityGates: {
    testPassRate: 1,
    minimumCoverage: 0.8,
    maximumAverageComplexity: 10,
    zeroRegressions: true,
    maximumCriticalSecurityFindings: 0,
  },
} as const;

const plan = buildTimeline(definition);
const score = scoreSnapshot({
  functional: 1,
  regressionResistance: 1,
  maintainability: 0.9,
  coverage: 0.85,
  staticQuality: 1,
  architectureReview: 0.8,
});
```

The prototype deliberately does not parse files, mutate repositories, execute
agents, collect metrics, persist checkpoints, or enforce quality gates. Those
surfaces will be added behind versioned contracts and conformance fixtures.

## Scoring rule

A score is a versioned view over evidence, not truth. Covenant Timeline will
retain the complete dimension vector, policy version, evidence references, and
confidence alongside every aggregate.

It will not define a universal agent score. Capability and trust scorecards must
be scoped to a domain, policy, subject, and time window. Human consumer credit
scoring is out of scope.

## Related work

Covenant Timeline is designed to interoperate with, rather than replace:

- [SWE-CI](https://arxiv.org/abs/2603.03823) for long-horizon maintainability
  evaluation;
- [SWE-EVO](https://github.com/SWE-EVO/SWE-EVO) for multi-version software
  evolution tasks;
- [PyDriller](https://pydriller.readthedocs.io/) for repository history and
  process metrics;
- checkpointing and replay systems such as
  [LangGraph time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel).

# Covenant Timeline

[![CI](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/open-covenant/covenant-timeline)](./LICENSE)

Portable, proof-carrying temporal reasoning for AI systems.

Covenant Timeline gives model-backed applications a portable representation of
temporal facts and constraints. Its deterministic kernel turns admitted records
into conclusions and proof receipts that can be replayed and verified across
processes and runtimes.

Applications can reconstruct earlier knowledge; reason about actual events,
plans, forecasts, and hypotheses without conflating them; preserve corrections
without rewriting prior answers; and surface inconsistent dates, durations, or
ordering constraints.

[Run the temporal reasoner](#run-the-temporal-reasoner-from-source) ·
[Integrate a model](./docs/model-interface.md) ·
[Review Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md) ·
[See release status](#release-status)

## Core capabilities

- **Represent** metric and ordinal time, points and intervals, bounded
  constraints, and isolated actual, planned, forecast, and hypothetical
  contexts.
- **Reason** about consistency, tight bounds, point order, and interval
  relations without inventing precision that the admitted facts do not support.
- **Revise** assertions through correction, supersession, and retraction while
  reconstructing the active assertions at every prior record cut.
- **Verify** canonical inputs and conclusions using machine-checkable schedules,
  bound paths, relation cases, or negative cycles.

Every conclusion is bound to the exact projected state, query, semantic result,
and reasoner profile that produced it.

## Architecture

Timeline separates probabilistic interpretation from deterministic inference:

```text
evidence or narrative
        │
        ▼
model or application proposes temporal records + query
        │
        ▼
host authenticates evidence and admits records
        │
        ▼
deterministic temporal kernel
        │
        ▼
proof | alternatives | contradiction
        │
        ▼
model or application continues from checked state
```

The model interprets source material, the host authenticates and admits
records, the kernel computes the conclusion, and a verifier checks the proof
against the same run and query. Timeline establishes what follows from admitted
constraints; the deploying system decides whether the underlying evidence is
authentic, authoritative, and complete.

## Temporal model

| Primitive          | Purpose                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| Axis               | Defines discrete metric or ordinal time with an explicit origin and unit |
| Context            | Isolates actual, planned, forecast, and hypothetical worlds              |
| Point and interval | Represents occurrences, boundaries, and periods                          |
| Assertion          | Adds evidence-bound coordinates, constraints, or temporal facts          |
| Knowledge cut      | Reconstructs the state visible through a specific record sequence        |
| Query              | Requests consistency, bounds, point order, or interval relations         |
| Conclusion         | Returns a content-bound result and a proof receipt                       |

Assertions are append-only records. A correction does not erase history:
retraction and persistent supersession determine which assertions are active at
each knowledge cut. Facts can distinguish when something was valid, when it was
observed, and when it was asserted.

Temporal coordinates live on explicit axes. Record sequence establishes
knowledge order, while points, intervals, and constraints describe occurrence
and validity. This makes late observations and corrections reproducible without
changing earlier answers.

The reference kernel uses exact integer arithmetic and a resource-bounded
Simple Temporal Network solver. It supports tight difference bounds, three
point relations, and all 13 Allen interval relations.

## Run the temporal reasoner from source

Requirements:

- Node.js 22 or 24
- pnpm 10

From the repository root, run the example and query the included conformance
run:

```sh
pnpm install --frozen-lockfile
pnpm temporal:demo
pnpm timeline reason \
  conformance/v0alpha3/runs/software-release.json \
  conformance/v0alpha3/queries/difference-bounds.json \
  --json
```

The v0alpha3 API exposes parsing, reasoning, and verification as separate
operations:

```ts
import {
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "@covenant-org/timeline";

const run = parseRunDocumentV0Alpha3(runInput);
const query = parseQueryV0Alpha3(queryInput, run);
const conclusion = reasonTemporalQueryV0Alpha3(run, query);

if (!verifyTemporalConclusionV0Alpha3(run, query, conclusion)) {
  throw new Error("temporal proof verification failed");
}
```

The v0alpha3 API is currently distributed from this repository. The published
npm alpha exposes the checkpoint compatibility API described in
[Release status](#release-status).

The example returns canonical state and query digests, metric bounds, possible
relations, consistency results, and the proof material required for
verification. The [model interface](./docs/model-interface.md) defines the
admission boundary for model-generated assertions.

## Use cases

Timeline is designed for systems that need temporal conclusions to survive
beyond one prompt or process:

- **Software delivery:** reason about dependencies, readiness windows, review
  order, deployment plans, and late-arriving corrections.
- **Long-running agents:** preserve temporal state across sessions, workers, and
  restarts without relying on narrative memory alone.
- **Planning and operations:** keep actual execution separate from plans,
  forecasts, and counterfactual scenarios.
- **Research:** record partial order, observation time, validity, and competing
  hypotheses without collapsing them into one chronology.
- **Governed domains:** pair the neutral kernel with domain-owned evidence,
  privacy, authority, and evaluation profiles.

## Adoption path

Begin with one bounded temporal question:

1. Export the evidence required to answer the question.
2. Have a model or application propose typed temporal assertions.
3. Admit those records under an explicit host policy.
4. Run a query and retain the conclusion with its proof receipt.
5. Correct or retract one assertion and replay from a prior knowledge cut.
6. Restart in a clean process and verify the exported result.

A pilot succeeds when the same admitted run and query produce the same
conclusion digest, the proof passes a separate verification call, and actual,
planned, forecast, and hypothetical records remain isolated.

Use the [temporal pilot](./docs/temporal-pilot.md) for the executable path and
the [adoption guide](./docs/adoption-guide.md) for integration and operating
evidence.

## Assurance

- strict runtime validation and versioned JSON Schemas;
- duplicate-key rejection and bounded processing of untrusted documents;
- RFC 8785 canonical JSON and SHA-256 content identity;
- exact-integer temporal reasoning with explicit resource budgets;
- deterministic projection across historical knowledge cuts;
- direct verification of schedules, paths, relation cases, and negative cycles;
- positive, negative, malformed, correction, and substitution conformance
  fixtures;
- cross-platform CI on Ubuntu, macOS, and Windows.

Before deployment, review the
[production audit](./docs/production-audit-timeline.md), the
[threat model](./docs/threat-model.md), and
the [operations guide](./docs/operations.md).

## Release status

| Surface  | Capability                                               | Distribution      | Status            |
| -------- | -------------------------------------------------------- | ----------------- | ----------------- |
| v0alpha3 | Temporal state, queries, conclusions, and proof receipts | Repository source | Draft             |
| v0alpha2 | Contract-bound checkpoint policy identity                | Repository source | Compatibility API |
| v0alpha1 | Checkpoint contracts and deterministic replay            | npm alpha and CLI | Published alpha   |

v0alpha3 is defined by
[Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md). Its schemas and
APIs may change while the RFC is Draft. No second conforming temporal
implementation has yet been demonstrated.

<a id="install-the-released-alpha"></a>

### Install the npm alpha

The current npm package provides portable checkpoint contracts, deterministic
replay, and the Timeline CLI:

```sh
npm install @covenant-org/timeline@0.0.0-alpha.1
```

For the v0alpha3 temporal API, build the current repository source. See
[Getting started](./docs/getting-started.md) for package and CLI workflows.

## Current scope

| Area                   | Current boundary                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Time model             | Discrete metric and ordinal axes; civil time, calendar arithmetic, recurrence, and cross-axis mappings are future profiles |
| Reasoning              | Simple Temporal Networks and Allen base relations; disjunctive constraints and dynamic controllability are future work     |
| Evidence               | SHA-256 content binding in core; storage, authentication, authority, and admission policy belong to the deployment         |
| Knowledge completeness | Reasons from explicit assertions; completeness-based absence queries are not yet supported                                 |
| Model integration      | Tool and API integration; no training-time or model-architecture integration                                               |
| Interoperability       | TypeScript reference implementation; no second conforming temporal implementation yet                                      |

Workflow orchestration, persistence, scheduling, and domain authority remain
separate services. High-stakes profiles require domain-owned evidence policy,
privacy review, and evaluation.

## Relationship to Covenant

[Covenant](https://github.com/open-covenant/covenant) provides runtime control,
scoped capabilities, continuity, audit, provenance, and settlement for
long-running agents. Timeline provides portable temporal state and checked
temporal conclusions.

```text
model or runtime ── typed records + query ──► Timeline
evidence authority ── admitted records ─────► Timeline
Timeline ── conclusion + proof ─────────────► model or runtime
Timeline ── verified temporal evidence ─────► Covenant policy and capabilities
```

Each project can operate independently. The Timeline repository owns the
portable contract, schemas, reference kernel, and verifier. Covenant owns its
adapter and runtime policy.

## Project map

| Area              | Entry points                                                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model integration | [Model interface](./docs/model-interface.md), [temporal pilot](./docs/temporal-pilot.md), [temporal reasoning vision](./docs/temporal-reasoning-vision.md)                                                |
| Contract          | [Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md), [`spec/v0alpha3`](./spec/v0alpha3), [`schemas/v0alpha3`](./schemas/v0alpha3), [`conformance/v0alpha3`](./conformance/v0alpha3)             |
| Reference code    | [`packages/prototype`](./packages/prototype)                                                                                                                                                              |
| Compatibility     | [Temporal.io v0alpha2 checkpoint adapter](./packages/temporal-adapter), [Python v0alpha1/v0alpha2 checkpoint reducer](./implementations/python), [v0alpha2 checkpoint public run](./examples/public-runs) |
| Adoption          | [Adoption guide](./docs/adoption-guide.md), [operator pilot](./docs/operator-pilot.md), [temporal pilot](./docs/temporal-pilot.md)                                                                        |
| Operations        | [Operations guide](./docs/operations.md), [threat model](./docs/threat-model.md), [production audit](./docs/production-audit-timeline.md)                                                                 |
| Governance        | [RFCs](./rfcs), [roadmap](./ROADMAP.md), [program](./PROGRAM.md), [governance](./GOVERNANCE.md)                                                                                                           |

## Verify

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm temporal:benchmark
```

The repository is Apache-2.0 licensed. See
[Contributing](./CONTRIBUTING.md) and [Security](./SECURITY.md) before opening a
change or reporting a vulnerability.

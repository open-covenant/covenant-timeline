# Covenant Timeline

[![CI](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/open-covenant/covenant-timeline)](./LICENSE)

Portable, proof-carrying temporal reasoning for AI systems.

Covenant Timeline gives model-backed applications a deterministic way to
represent when things happened, compare admitted state at different record
cuts, reason across plans and possible futures, detect contradictions, and
carry verifiable temporal conclusions across processes and runtimes.

**Timeline does not treat event sequence as time.** Sequence orders records and
historical knowledge cuts. Explicit temporal axes and constraints model when
events occurred, may occur, or were valid. Keeping those orders separate
prevents hindsight leakage and makes temporal answers reproducible.

> **Project status:** The temporal API is available in this repository as the
> Draft v0alpha3 reference implementation. The published npm alpha provides the
> checkpoint compatibility surface. See [Release status](#release-status) for
> the exact availability and stability boundary.

[Run the temporal reasoner](#run-the-temporal-reasoner-from-source) ·
[Integrate a model](./docs/model-interface.md) ·
[Review Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md)

## What Timeline enables

- **Represent** metric and ordinal time, points and intervals, bounded
  constraints, and isolated actual, planned, forecast, and hypothetical
  contexts.
- **Reason** about consistency, tight bounds, point order, and interval
  relations without inventing precision that the admitted facts do not support.
- **Revise** assertions through correction, supersession, and retraction while
  reconstructing the active assertions at every prior record cut.
- **Verify** canonical inputs and conclusions using machine-checkable schedules,
  bound paths, relation cases, or negative cycles.

The result is a portable temporal state that a model, runtime, operator, or
independent verifier can inspect and replay.

## Operating model

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

The model interprets source material. The host decides which evidence and
records are admissible. The kernel computes a deterministic conclusion. The
verifier checks that conclusion against the same run and query.

Timeline proves that a conclusion follows from admitted temporal constraints.
It does not prove that the source evidence was true, authentic, complete, or
authorized. The deploying system remains responsible for evidence
authentication, authority, and admission policy.

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

The current kernel uses exact integer arithmetic and a resource-bounded Simple
Temporal Network solver. It supports tight difference bounds, three point
relations, and all 13 Allen interval relations.

## Run the temporal reasoner from source

Requirements:

- Node.js 22 or 24
- pnpm 10

From a clone of this repository, run the temporal example and query a portable
run:

```sh
pnpm install --frozen-lockfile
pnpm temporal:demo
pnpm timeline reason \
  conformance/v0alpha3/runs/software-release.json \
  conformance/v0alpha3/queries/difference-bounds.json \
  --json
```

In this workspace build, the API keeps parsing, reasoning, and verification
explicit:

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

The example returns canonical state and query digests, tight metric bounds,
possible relations, consistency results, and the proof material required for
verification. Read the [model interface](./docs/model-interface.md) before
admitting model-generated assertions.

## Where it fits

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

Timeline is useful when reproducibility and revision matter. It is not a
replacement for a workflow engine, database, scheduler, or evidence authority.

## Adoption path

Start with one real temporal question, not a platform migration:

1. Export the evidence required to answer the question.
2. Have a model or application propose typed temporal assertions.
3. Admit those records under an explicit host policy.
4. Run a query and retain the conclusion with its proof receipt.
5. Correct or retract one assertion and replay from a prior knowledge cut.
6. Restart in a clean process and verify the exported result.

A pilot succeeds when the same admitted run and query produce the same
conclusion digest, the proof verifies independently of the reasoning call, and
actual, planned, forecast, and hypothetical records remain isolated.

Use the [temporal pilot](./docs/temporal-pilot.md) for the executable path and
the [adoption guide](./docs/adoption-guide.md) for the evidence required to
claim independent operation.

## Assurance

### Temporal v0alpha3

- strict runtime validation and versioned JSON Schemas;
- duplicate-key rejection and bounded processing of untrusted documents;
- RFC 8785 canonical JSON and SHA-256 content identity;
- exact-integer temporal reasoning with explicit resource budgets;
- deterministic projection across historical knowledge cuts;
- direct verification of schedules, paths, relation cases, and negative cycles;
- positive, negative, malformed, correction, and substitution conformance
  fixtures;
- cross-platform CI on Ubuntu, macOS, and Windows.

### Checkpoint compatibility

The compatibility surface has separate operational evidence:

- a collector-signed public software-delivery archive;
- a Temporal.io adapter tested across a server and worker restart; and
- checkpoint-reducer agreement between TypeScript and Python.

This is evidence for the stated implementation boundary, not proof of
independent production adoption. Review the
[production audit](./docs/production-audit-timeline.md),
[threat model](./docs/threat-model.md), and
[operations guide](./docs/operations.md) before deployment.

## Release status

| Surface  | Purpose                                                  | Availability                             |
| -------- | -------------------------------------------------------- | ---------------------------------------- |
| v0alpha3 | Temporal state, queries, conclusions, and proof receipts | Draft reference implementation in source |
| v0alpha2 | Contract-bound checkpoint policy identity                | Source-only compatibility surface        |
| v0alpha1 | Checkpoint contracts and deterministic replay            | Published npm alpha and CLI              |

v0alpha3 is neither stable nor normative. Its contract is governed by
[Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md). The contract does
not depend on Covenant. No independent v0alpha3 implementation has yet been
demonstrated.

<a id="install-the-released-alpha"></a>

## Checkpoint compatibility

The published alpha provides portable checkpoint contracts and deterministic
replay:

```sh
npm install @covenant-org/timeline@0.0.0-alpha.1
```

The checkpoint alpha does not expose the v0alpha3 temporal reasoning API.
See [Getting started](./docs/getting-started.md) for its contract, CLI, and
verification workflow.

## Boundaries

The current temporal source does not provide:

- civil-time normalization, time zones, calendar arithmetic, or recurrence;
- arbitrary disjunctive interval constraints, cross-axis conversion, or dynamic
  controllability;
- causal inference from temporal precedence;
- completeness-based absence queries;
- automatic authority admission for model-extracted assertions;
- evidence storage or source authentication beyond content-digest binding;
- portable snapshot hydration;
- stable SDK compatibility or normative governance;
- a second temporal reasoner for cross-implementation verification; or
- training-time or architecture-level model integration.

An external kernel can make temporal reasoning part of an AI system's inference
loop. It cannot by itself make time native to model weights. Medical,
scientific, financial, and other high-stakes profiles require independent
domain owners, evidence authority, privacy review, and domain evaluation.

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

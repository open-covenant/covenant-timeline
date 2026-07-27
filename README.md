# Covenant Timeline

[![CI](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/open-covenant/covenant-timeline)](./LICENSE)

Portable, proof-carrying temporal reasoning for AI systems.

An agent schedules a release after a security review. Days later, new evidence
shows that the review finished after deployment. Timeline reconstructs what the
agent could conclude at each point, incorporates the correction without
rewriting history, and returns a machine-checkable derivation of what follows
from the records before and after the correction.

Covenant Timeline is a portable temporal reasoning substrate for model-backed
applications. Its deterministic kernel reasons over typed temporal records,
keeps plans and observations in separate contexts, detects contradictions, and
produces conclusions that can be replayed across processes and runtimes.

[Install and run](#install-and-run) ·
[Integrate a model](./docs/model-interface.md) ·
[Run the model benchmark](./docs/model-evaluation.md) ·
[Build a second implementation](https://github.com/open-covenant/covenant-timeline/issues/19) ·
[See release status](#release-status)

## Core capabilities

- **Represent** metric and ordinal time, points and intervals, bounded
  constraints, and isolated actual, planned, forecast, and hypothetical
  contexts.
- **Reason** about consistency, tight bounds, point order, and interval
  relations without inventing precision that the available evidence does not
  support.
- **Revise** assertions through correction, supersession, and retraction while
  reconstructing the active assertions at any earlier point in the run.
- **Verify** canonical inputs and conclusions using machine-checkable schedules,
  bound paths, relation cases, or negative cycles.

Every conclusion is bound to the exact projected state, query, semantic result,
and reasoner profile that produced it.

## How model output becomes checked state

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

Models extract dates, intervals, dependencies, and corrections from source
material. Their assertions remain proposals until the host validates shape,
provenance, and authority. Timeline then computes what follows from the accepted
records, and a verifier checks the proof against the same run and query.

The [model interface](./docs/model-interface.md) defines this admission path.
The [model-interface benchmark](./benchmarks/model-interface/v1/README.md)
measures extraction, admission, and proof verification separately while
comparing direct text, narrative memory, and Timeline state.

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

## Install and run

Package requirement:

- Node.js 22 or 24

Install the alpha preview:

```sh
npm install --save-exact @covenant-org/timeline@0.0.0-alpha.2
npx timeline --version
```

The current preview is
[`@covenant-org/timeline@0.0.0-alpha.2`](https://www.npmjs.com/package/@covenant-org/timeline/v/0.0.0-alpha.2).
The corresponding
[GitHub prerelease](https://github.com/open-covenant/covenant-timeline/releases/tag/timeline-v0.0.0-alpha.2)
includes the release tarball, checksum, and SPDX SBOM.

The v0alpha3 library separates parsing, reasoning, and verification:

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

`runInput` and `queryInput` are decoded v0alpha3 JSON documents. A conclusion
contains canonical state and query digests, the semantic result, and the proof
material required for verification. The
[model interface](./docs/model-interface.md) defines the admission boundary for
model-generated assertions.

To run the repository example and conformance query, install pnpm 10 and use:

```sh
pnpm install --frozen-lockfile
pnpm temporal:demo
pnpm timeline reason \
  conformance/v0alpha3/runs/software-release.json \
  conformance/v0alpha3/queries/difference-bounds.json \
  --json
```

## Built for long-running agents

Timeline is built first for agent work that spans sessions, workers, and
late-arriving evidence:

- preserve plans, forecasts, and observed execution across process restarts;
- verify the order and timing of review, build, deployment, and recovery work;
- replay what the agent could conclude before and after a correction; and
- carry checked temporal state into the next model call without relying on
  narrative memory alone.

The same contract can support other domains, but current implementation and
adoption work are focused on long-running agents and software delivery.

## Adoption path

Start by testing the model boundary. The
[model-interface benchmark](./docs/model-evaluation.md) provides 12 temporal
scenarios, a vendor-neutral JSONL adapter protocol, strict failure accounting,
and paired scoring across three interfaces. This public v1 suite is a
development and smoke benchmark. No model result has been published, and the
visible corpus does not establish a general performance gain. The
[roadmap](./ROADMAP.md) defines the blinded scale evaluation required to close
the model-interface gate.

Begin with one bounded temporal question:

1. Export the evidence required to answer the question.
2. Have a model or application propose typed temporal assertions.
3. Admit those records under an explicit host policy.
4. Run a query and retain the conclusion with its proof receipt.
5. Correct or retract one assertion and replay from a prior knowledge cut.
6. Restart in a clean process and verify the exported result.

A pilot succeeds when an external operator publishes a redacted run whose
conclusions another process can reproduce and verify, together with one
measured benefit, failure, or required contract change.

Use the [temporal pilot](./docs/temporal-pilot.md) for the executable path and
the [model interface](./docs/model-interface.md) for the integration contract.

### Build the second implementation

Timeline is seeking an independent implementation of Draft RFC 0009. The
smallest useful contribution can begin with projection, consistency, and
difference bounds in a separately maintained codebase, in any language. See
[issue #19](https://github.com/open-covenant/covenant-timeline/issues/19) for
the conformance target, acceptance evidence, and maintainer support.

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
| v0alpha3 | Temporal state, queries, conclusions, and proof receipts | npm alpha and CLI | Draft             |
| v0alpha2 | Contract-bound checkpoint policy identity                | npm alpha and CLI | Compatibility API |
| v0alpha1 | Checkpoint contracts and deterministic replay            | npm alpha and CLI | Compatibility API |

v0alpha3 is defined by
[Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md). Its schemas and
APIs may change while the RFC is Draft. No second conforming temporal
implementation has yet been demonstrated.

The alpha package includes all three surfaces. See
[Getting started](./docs/getting-started.md) for package and CLI workflows.
The npm release includes registry provenance, and the GitHub tarball is covered
by build and SBOM attestations. The
[machine-readable release record](./releases/timeline-v0.0.0-alpha.2.json)
binds the source tag, protocol inputs, workflow, artifacts, SBOM, and
attestations; the [release policy](./docs/policies/releases.md) defines offline
and public-state verification. Cryptographic public-state verification requires
GitHub CLI 2.88 or newer.

## Current scope

| Area                   | Current boundary                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time model             | Discrete metric and ordinal axes. v0alpha3 does not parse civil timestamps or named time zones; applications must map them to integers under a pinned policy. [No shared profile ships yet.](https://github.com/open-covenant/covenant-timeline/issues/20) |
| Reasoning              | Simple Temporal Networks and Allen base relations; disjunctive constraints and dynamic controllability are future work                                                                                                                                     |
| Evidence               | SHA-256 content binding in core; storage, authentication, authority, and admission policy belong to the deployment                                                                                                                                         |
| Knowledge completeness | Reasons from explicit assertions; completeness-based absence queries are not yet supported                                                                                                                                                                 |
| Model integration      | Tool and API integration; no training-time or model-architecture integration                                                                                                                                                                               |
| Interoperability       | TypeScript reference implementation; no second conforming temporal implementation yet                                                                                                                                                                      |

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

| Area              | Entry points                                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model integration | [Model interface](./docs/model-interface.md), [model evaluation](./docs/model-evaluation.md), [benchmark protocol](./benchmarks/model-interface/v1/README.md)                                                                                                    |
| Contract          | [Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md), [`spec/v0alpha3`](./spec/v0alpha3), [`schemas/v0alpha3`](./schemas/v0alpha3), [`conformance/v0alpha3`](./conformance/v0alpha3)                                                                    |
| Reference code    | [`packages/prototype`](./packages/prototype)                                                                                                                                                                                                                     |
| Compatibility     | [Temporal.io v0alpha2 checkpoint adapter](./packages/temporal-adapter), [Python v0alpha1/v0alpha2 checkpoint reducer](./implementations/python), [v0alpha2 checkpoint public run](./examples/public-runs), [checkpoint adoption guide](./docs/adoption-guide.md) |
| Adoption          | [Model-interface benchmark](./benchmarks/model-interface/v1/README.md), [temporal pilot](./docs/temporal-pilot.md), [second-implementation issue](https://github.com/open-covenant/covenant-timeline/issues/19)                                                  |
| Operations        | [Operations guide](./docs/operations.md), [threat model](./docs/threat-model.md), [production audit](./docs/production-audit-timeline.md)                                                                                                                        |

## Verify

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm temporal:benchmark
pnpm model-eval:test
```

The repository is Apache-2.0 licensed. See
[Contributing](./CONTRIBUTING.md) and [Security](./SECURITY.md) before opening a
change or reporting a vulnerability.

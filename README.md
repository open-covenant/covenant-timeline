# Covenant Timeline

[![CI](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40covenant-org%2Ftimeline?label=npm)](https://www.npmjs.com/package/@covenant-org/timeline)
[![License](https://img.shields.io/github/license/open-covenant/covenant-timeline)](./LICENSE)

Covenant Timeline is an experimental proof-carrying temporal reasoning
substrate for AI systems. Its temporal-first v0alpha3 source gives any model or
application a portable way to represent temporal state, ask bounded questions,
and receive deterministic results with proof receipts.

The published `0.0.0-alpha.1` package is narrower: a checkpoint contract and
deterministic verifier for long-running agent and software work. Source-only
v0alpha2 adds contract-bound policy identity. Those checkpoint formats remain
replayable compatibility surfaces, but they are not the architecture being
extended.

v0alpha3 replaces checkpoints at the center of the contract with explicit
axes, isolated scenario contexts, points, proper intervals, bounded
constraints, record-time knowledge cuts, typed queries, and proof-carrying
conclusions. See the
[temporal reasoning vision](./docs/temporal-reasoning-vision.md) and
[draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md).

Covenant is the first reference adopter. It is not a required dependency.

## Status at a glance

- **Published:** `@covenant-org/timeline@0.0.0-alpha.1` provides the v0alpha1
  checkpoint library and CLI.
- **Experimental in source:** v0alpha3 document validation, deterministic state
  projection, a resource-bounded exact-integer Simple Temporal Network kernel,
  difference and relation queries, ordered proof certificates, a CLI, and a
  model-facing example.
- **Checkpoint compatibility in source:** contract-bound v0alpha2 policy
  identity, a collector-signed GitHub evidence profile, atomic run archives, a
  Temporal.io restart adapter, a Python reducer, and a public five-day replay
  archive.
- **Still required for adoption:** an external organization operating Timeline
  independently. The Temporal.io adapter and public archive are maintained here
  and do not count as independent adoption.
- **Governance boundary:** v0alpha3 remains a Draft RFC and source-only
  experiment. It is not a stable or normative release.

[Run the first independent operator pilot](./docs/operator-pilot.md) with one
existing workflow, one checkpoint, one process restart, and one redacted
portable run. A small independent maintainer qualifies; this does not require a
partnership with a workflow vendor.

For the temporal-first contract, use the
[independent temporal pilot](./docs/temporal-pilot.md): one real temporal
question, one correction, one restart, and exported proof receipts.

## Why this exists

Models encounter occurrence time, duration, partial order, uncertainty,
scenario, observation time, validity, and changing knowledge. Flattening those
dimensions into prose, timestamps, or event sequence produces hindsight
leakage, false precision, and answers that cannot be replayed.

Covenant Timeline separates probabilistic interpretation from deterministic
temporal inference:

```text
source material
      │
      ▼
model proposes temporal records + query
      │
      ▼
host admission + deterministic kernel
      │
      ▼
canonical result + proof receipt + alternatives
      │
      ▼
model or application continues from checked state
```

The project does not replace a workflow engine, database, model, evidence
authority, or agent runtime.

## Temporal-first contract

Long-running models face several different kinds of time at once: the order in
which records arrive, when an event occurred, when a source observed it, when a
claim was valid, what the system knew at a prior point, and which obligations
remain possible. Collapsing those dimensions into timestamps or prose causes
hindsight leakage, false precision, and irreproducible reasoning.

The implemented experimental loop is:

```text
evidence or narrative
        │
        ▼
model proposes typed temporal records and a query
        │
        ▼
host admission + deterministic temporal kernel
        │
        ▼
proof | alternatives | contradiction
        │
        ▼
model continues from a checked temporal-state digest
```

An external kernel can make temporal reasoning foundational to an AI system's
inference loop. It cannot by itself make time native to a transformer's weights.
Training-time or architecture-level integration is a separate research track
with its own held-out evaluation gate.

The existing checkpoint reducer is not being stretched into this engine.
v0alpha1 and v0alpha2 keep their current bytes, state digests, and
sequence-only record semantics. v0alpha3 uses a new contract, event, query,
state, conclusion, and proof family. Existing checkpoints may consume verified
temporal conclusions as evidence through an explicit profile.

## Install the released alpha

Requirements:

- Node.js 22 or 24

```sh
npm install @covenant-org/timeline@0.0.0-alpha.1
npx timeline --version
```

To run the repository demo from source:

```sh
pnpm install --frozen-lockfile
pnpm demo
```

The demo replays a software-release contract with CI and review evidence,
evaluates its release checkpoint, emits a Covenant capability request, joins
the resulting receipt, and structurally verifies the final run.

The API is intentionally small:

```ts
import { evaluateRunDocument } from "@covenant-org/timeline";

const report = evaluateRunDocument(run);
console.log(report.stateDigest, report.verification);
```

The CLI validates, replays, inspects, and verifies portable runs:

```sh
pnpm timeline inspect conformance/v0alpha1/runs/corrected.json
pnpm timeline verify conformance/v0alpha1/runs/successful.json --json
pnpm timeline verify conformance/v0alpha2/runs/successful.json --json
```

See [Getting started](./docs/getting-started.md) for the complete local path.

## Try the experimental temporal source

The v0alpha3 source is not in the published alpha package. From this repository:

```sh
pnpm install --frozen-lockfile
pnpm temporal:demo
pnpm timeline reason \
  conformance/v0alpha3/runs/software-release.json \
  conformance/v0alpha3/queries/difference-bounds.json \
  --json
```

The library boundary is:

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

The example returns tight metric bounds, possible point and interval
relations, a consistency result, content digests, and ordered proof edges or
schedules. Read the [model interface](./docs/model-interface.md) before feeding
model-generated assertions into a run.

The repository also contains independently repeatable evidence for the M4
reference implementation:

```sh
pnpm public-runs:check
pnpm --filter @covenant-org/timeline-temporal test
pnpm reducer:cross-check
```

## Compatibility and temporal boundaries

The released v0alpha1 core is limited to:

- checkpoint contracts;
- ordered events;
- opaque evidence references;
- deterministic requirement-coverage decisions with a recorded policy label;
- idempotent command requests and effect receipts;
- deterministic replay and verification findings.

Core v0alpha1 does not resolve, execute, authenticate, or contract-bind the
recorded policy label. The contract bytes pin checkpoint requirements and
effect templates, not evaluator policy. “Timeline” currently means ordered
history: the event sequence is the only normative clock in released core.

The unreleased v0alpha2 source schema contract-binds `profile`, `policyRef`, and
`policyDigest`. Evaluation events cannot override them, and evidence with a
different authority binding fails closed. Domain profiles still perform policy
resolution and evidence authentication outside the generic reducer.

The experimental v0alpha3 source adds:

- discrete metric and ordinal axes with explicit origins and units;
- isolated actual, planned, forecast, and hypothetical contexts;
- points, proper intervals, and bounded difference constraints;
- append-only facts, corrections, supersession, and retraction;
- explicit record-time knowledge cuts;
- consistency, tight-bound, point-relation, and Allen interval-relation
  queries; and
- content-bound conclusions with schedules, ordered bound paths, exhaustive
  relation cases, or ordered negative cycles.

v0alpha3 does not yet provide civil-time normalization, recurrence, arbitrary
disjunctive interval constraints, cross-axis conversion, dynamic
controllability, causal inference, completeness-based absence queries, or
training-time model integration.

Both kernels are pure. The legacy checkpoint reducer is:

```text
(pinned contract, prior state, accepted event)
    -> (next state, decision, commands, findings)
```

Commands request effects. Adapters execute them and return receipts as later
events. Replay never calls an adapter.

## Implementation status

This repository contains a production-hardened alpha release. That means the
implementation defends its stated boundary; it does not mean the protocol has
independent production adoption.

Implemented:

- runtime validation for contracts, events, and portable runs;
- immutable single-event reduction and linear full replay for evidence,
  checkpoint decisions, commands, and receipts;
- exact contract-byte binding and final accepted checkpoints;
- RFC 8785 canonical JSON and SHA-256 content identities;
- strict duplicate-key JSON parsing and bounded untrusted input;
- deterministic replay with stable state digests;
- human-readable and JSON CLI output;
- run verification;
- JSON Schemas and successful, rejected, incomplete, corrected, and malformed
  conformance runs;
- TypeScript and Python agreement on the upstream canonicalization fixtures;
- a landed Covenant reference adapter with an offline-verifiable M3 run;
- additive v0alpha2 schemas, migration, contract-bound policy decisions, and
  substitution-negative fixtures;
- a GitHub software-delivery profile with Ed25519 collector signatures,
  freshness, revocation, head-check, review, merge, and payload verification;
- a public five-day software-delivery archive replayed across separate
  processes;
- a Temporal.io adapter tested across a real local server and worker restart;
- a Python v0alpha2 reducer matching the TypeScript state-digest corpus;
- atomic portable event archives and a measured snapshot decision;
- experimental v0alpha3 contracts, events, queries, conclusions, strict runtime
  validation, and JSON Schemas;
- deterministic v0alpha3 projection across explicit historical knowledge cuts;
- digest-referenced, revisable coordinate, constraint, and fact assertions using
  SHA-256 content references;
- a resource-bounded, exact-integer Simple Temporal Network kernel for
  consistency, tight bounds, point relations, and all 13 Allen interval base
  relations;
- content-bound temporal conclusions with independently verifiable schedules,
  ordered paths, relation cases, and negative cycles;
- a `timeline reason` command, model-interface guide, executable demo, and
  baseline benchmark.

Not implemented:

- independent external operation or adoption;
- production deployment evidence in the public run;
- stable or normative v0alpha3 semantics;
- civil-time timestamps, calendar arithmetic, recurrence, cross-axis
  conversion, arbitrary disjunctive constraints, or dynamic controllability;
- authority admission for model-extracted temporal assertions;
- evidence storage and source authentication beyond content-digest binding;
- any training-time or architecture-level model integration;
- a second v0alpha3 implementation or cross-reasoner proof interoperability;
- portable state snapshot hydration;
- production SDK compatibility guarantees;
- independently maintained implementation governance.

`@covenant-org/timeline@0.0.0-alpha.1` is published on npm under the `next`
channel with registry provenance. v0alpha2, v0alpha3, and the Temporal.io
adapter are currently source-only and have not been published. Future releases
prefer npm trusted publishing but can use a short-lived, package-scoped token
from the protected `npm` environment. No long-lived npm token is stored in
GitHub.

`verification.ok` means the pinned run is structurally complete under its
declared claims. Generic replay does not re-run profile proofs or verify real
external effects. v0alpha2 profile verification is a separate admission step.
A process restart rebuilds state from the exact contract and complete event
stream; the in-memory `RunState` projection is not a portable continuation
snapshot. See the
[threat model](./docs/threat-model.md) and
[production operations guide](./docs/operations.md).

## Relationship to Covenant

Covenant provides runtime control, capabilities, continuity, audit, provenance,
and settlement for long-running agents. Timeline adds a portable way to declare
and verify how that work progresses. The temporal research program extends that
boundary toward checked reasoning over when events and states occur, overlap,
change, or remain possible.

The intended integration is:

```text
Covenant audit and provenance ──► Timeline evidence events
Timeline checkpoint decision ──► Covenant capability request
Covenant effect result ─────────► Timeline receipt event
```

The standalone repository owns the portable contract and reducer. Covenant
owns only its adapter.

## Non-goals

Covenant Timeline does not:

- implement a distributed workflow runtime;
- define a universal quality, trust, reputation, or credit score;
- infer causality from temporal precedence;
- grant authority solely because a score or model output crossed a threshold;
- execute tools, deploy software, move funds, or place trades;
- require Covenant, a blockchain, or a particular storage system;
- claim that schema conformance proves correctness, security, or fitness;
- claim that the current alpha gives LLMs native temporal understanding.

The temporal core is intended to remain domain-neutral. Medical, scientific,
and other high-stakes profiles require independent domain owners, evidence
authority, privacy review, and domain evaluation. They are not part of the first
release.

## Project map

- [`spec/v0alpha1`](./spec/v0alpha1): draft language-neutral semantics
- [`spec/v0alpha2`](./spec/v0alpha2): contract-bound policy semantics
- [`spec/v0alpha3`](./spec/v0alpha3): experimental temporal-first semantics
- [`schemas/v0alpha1`](./schemas/v0alpha1): versioned JSON Schemas
- [`schemas/v0alpha2`](./schemas/v0alpha2): additive alpha schemas
- [`schemas/v0alpha3`](./schemas/v0alpha3): temporal document and proof schemas
- [`conformance/v0alpha1`](./conformance/v0alpha1): bootstrap fixtures
- [`conformance/v0alpha2`](./conformance/v0alpha2): policy-binding fixtures
- [`conformance/v0alpha3`](./conformance/v0alpha3): temporal state, query, and
  proof fixtures
- [`conformance/rfc8785`](./conformance/rfc8785): canonical byte fixtures
- [`packages/prototype`](./packages/prototype): TypeScript reference prototype
- [`packages/temporal-adapter`](./packages/temporal-adapter): durable
  Temporal.io host
- [`profiles/github/v1`](./profiles/github/v1): software-delivery authority
- [`implementations/python`](./implementations/python): second-language reducer
- [`examples/public-runs`](./examples/public-runs): signed public run archive
- [`docs/operator-pilot.md`](./docs/operator-pilot.md): first-operator pilot
- [`docs/temporal-pilot.md`](./docs/temporal-pilot.md): independent v0alpha3
  pilot
- [`docs/adoption-guide.md`](./docs/adoption-guide.md): independent-adoption
  evidence contract
- [`docs/temporal-reasoning-vision.md`](./docs/temporal-reasoning-vision.md):
  long-term thesis, research hypotheses, and claim boundary
- [`docs/model-interface.md`](./docs/model-interface.md): model-to-kernel
  integration contract
- [`rfcs`](./rfcs): design decisions and unresolved questions
- [`ROADMAP.md`](./ROADMAP.md): adoption-gated delivery sequence
- [`PROGRAM.md`](./PROGRAM.md): scope, staffing, and success criteria
- [`docs/production-audit-timeline.md`](./docs/production-audit-timeline.md):
  production audit and remaining external gates

## Verify

```sh
pnpm verify
```

The repository is Apache-2.0 licensed. See [`CONTRIBUTING.md`](./CONTRIBUTING.md)
and [`SECURITY.md`](./SECURITY.md) before contributing or reporting a
vulnerability.

# Covenant Timeline

[![CI](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40covenant-org%2Ftimeline?label=npm)](https://www.npmjs.com/package/@covenant-org/timeline)
[![License](https://img.shields.io/github/license/open-covenant/covenant-timeline)](./LICENSE)

Covenant Timeline is a portable checkpoint contract and verifier for
long-running agent and software work.

A timeline contract declares checkpoints, required evidence claims, and
permitted effect requests. v0alpha1 records the policy label reported by an
evaluator. The additive v0alpha2 schema instead pins profile and policy identity
in each checkpoint and rejects evidence carrying another binding. A
deterministic reducer replays the event stream and explains whether referenced
evidence covers each checkpoint's declared requirements.

Covenant is the first reference adopter. It is not a required dependency.

## Status at a glance

- **Published:** `@covenant-org/timeline@0.0.0-alpha.1` provides the v0alpha1
  TypeScript library and CLI.
- **Implemented in source:** contract-bound v0alpha2 policy identity, a
  collector-signed GitHub evidence profile, atomic run archives, a Temporal
  restart adapter, a Python reducer, and a public five-day replay archive.
- **Still required for adoption:** an external organization operating Timeline
  independently. The Temporal adapter and public archive are maintained here
  and do not count as independent adoption.

[Run the first independent operator pilot](./docs/operator-pilot.md) with one
existing workflow, one checkpoint, one process restart, and one redacted
portable run. A small independent maintainer qualifies; this does not require a
partnership with a workflow vendor.

## Why this exists

Long-running agent work survives process restarts, model changes, handoffs,
reviews, and releases. A final status does not explain how the work evolved or
which evidence justified a decision.

Covenant Timeline makes that history portable:

```text
contract + ordered events
            │
            ▼
    deterministic reducer
            │
            ├── checkpoint decisions
            ├── effect requests
            ├── receipts
            └── verification findings
```

The project specifies the evidence and decision boundary. It does not replace a
workflow engine, database, CI system, or agent runtime.

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

The repository also contains independently repeatable evidence for the M4
reference implementation:

```sh
pnpm public-runs:check
pnpm --filter @covenant-org/timeline-temporal test
pnpm reducer:cross-check
```

## Core boundary

The released v0alpha1 core is limited to:

- checkpoint contracts;
- ordered events;
- content-addressed evidence references;
- deterministic requirement-coverage decisions with a recorded policy label;
- idempotent command requests and effect receipts;
- deterministic replay and verification findings.

Core v0alpha1 does not resolve, execute, authenticate, or contract-bind the
recorded policy label. The contract bytes pin checkpoint requirements and
effect templates, not evaluator policy. “Timeline” currently means ordered
history: the event sequence is the only normative clock.

The unreleased v0alpha2 source schema contract-binds `profile`, `policyRef`, and
`policyDigest`. Evaluation events cannot override them, and evidence with a
different authority binding fails closed. Domain profiles still perform policy
resolution and evidence authentication outside the generic reducer.

The reducer is pure:

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
- a Temporal adapter tested across a real local server and worker restart;
- a Python v0alpha2 reducer matching the TypeScript state-digest corpus;
- atomic portable event archives and a measured snapshot decision.

Not implemented:

- independent external operation or adoption;
- production deployment evidence in the public run;
- timestamps, deadlines, validity windows, or temporal predicates;
- portable state snapshot hydration;
- production SDK compatibility guarantees;
- independently maintained implementation governance.

`@covenant-org/timeline@0.0.0-alpha.1` is published on npm under the `next`
channel with registry provenance. v0alpha2 and the Temporal adapter are
currently source-only and have not been published. Future releases prefer npm
trusted publishing but can use a short-lived, package-scoped token from the
protected `npm` environment. No long-lived npm token is stored in GitHub.

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
and verify how that work progresses.

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
- grant authority solely because a score or model output crossed a threshold;
- execute tools, deploy software, move funds, or place trades;
- require Covenant, a blockchain, or a particular storage system;
- claim that schema conformance proves correctness, security, or fitness.

Broader domains may be explored after the core has an independent adopter.
They are not part of the first release.

## Project map

- [`spec/v0alpha1`](./spec/v0alpha1): draft language-neutral semantics
- [`spec/v0alpha2`](./spec/v0alpha2): contract-bound policy semantics
- [`schemas/v0alpha1`](./schemas/v0alpha1): versioned JSON Schemas
- [`schemas/v0alpha2`](./schemas/v0alpha2): additive alpha schemas
- [`conformance/v0alpha1`](./conformance/v0alpha1): bootstrap fixtures
- [`conformance/v0alpha2`](./conformance/v0alpha2): policy-binding fixtures
- [`conformance/rfc8785`](./conformance/rfc8785): canonical byte fixtures
- [`packages/prototype`](./packages/prototype): TypeScript reference prototype
- [`packages/temporal-adapter`](./packages/temporal-adapter): durable Temporal host
- [`profiles/github/v1`](./profiles/github/v1): software-delivery authority
- [`implementations/python`](./implementations/python): second-language reducer
- [`examples/public-runs`](./examples/public-runs): signed public run archive
- [`docs/operator-pilot.md`](./docs/operator-pilot.md): first-operator pilot
- [`docs/adoption-guide.md`](./docs/adoption-guide.md): independent-adoption
  evidence contract
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

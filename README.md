# Covenant Timeline

Covenant Timeline is an open contract format and verifier for long-running
agent and software work.

A timeline contract declares checkpoints, required evidence, evaluation policy,
and permitted effect requests. An append-only event stream records what
happened. A deterministic reducer can replay that stream and explain why each
checkpoint was accepted or rejected.

Covenant is the first reference adopter. It is not a required dependency.

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
npm install @covenant-org/timeline@next
timeline --version
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
```

See [Getting started](./docs/getting-started.md) for the complete local path.

## Core boundary

The first release is limited to:

- temporal contracts and checkpoints;
- ordered events;
- content-addressed evidence references;
- policy-pinned checkpoint decisions;
- idempotent command requests and effect receipts;
- deterministic replay and verification findings.

The reducer is pure:

```text
(pinned contract, prior state, accepted event)
    -> (next state, decision, commands, findings)
```

Commands request effects. Adapters execute them and return receipts as later
events. Replay never calls an adapter.

## Current status

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
- a landed Covenant reference adapter with an offline-verifiable M3 run.

Not implemented:

- persistent storage or distributed execution;
- cryptographic evidence verification;
- production SDK compatibility guarantees;
- an independent conforming implementation.

`@covenant-org/timeline@0.0.0-alpha.1` is published on npm under the `next`
channel with registry provenance. Future releases require the npm trusted
publisher to be linked to the repository workflow; no long-lived npm token is
stored in GitHub. Cross-language agreement currently covers canonical bytes,
not an independent reducer.

`verification.ok` means the pinned run is structurally complete under its
declared claims. It does not verify evidence authority, payload possession,
producer signatures, or real external effects. See the
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
- [`schemas/v0alpha1`](./schemas/v0alpha1): versioned JSON Schemas
- [`conformance/v0alpha1`](./conformance/v0alpha1): bootstrap fixtures
- [`conformance/rfc8785`](./conformance/rfc8785): canonical byte fixtures
- [`packages/prototype`](./packages/prototype): TypeScript reference prototype
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

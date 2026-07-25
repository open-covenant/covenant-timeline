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

## Try the current prototype

Requirements:

- Node.js 22 or later
- pnpm 10

```sh
pnpm install --frozen-lockfile
pnpm demo
```

The demo replays a software-release contract with CI and review evidence,
evaluates its release checkpoint, emits a Covenant capability request, joins
the resulting receipt, and verifies the final run.

The prototype API is intentionally small:

```ts
import { replay, verifyRun } from "@covenant-org/timeline";

const state = replay(contract, "run-42", events);
const result = verifyRun(state);
```

See [`examples/software-release.mjs`](./examples/software-release.mjs) for the
complete runnable example.

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

This repository is pre-alpha.

Implemented:

- a TypeScript contract validator;
- an immutable reducer for evidence, checkpoint decisions, commands, and
  receipts;
- deterministic replay;
- run verification;
- JSON Schemas and a bootstrap conformance corpus;
- a runnable software-release example.

Not implemented:

- a canonical compiler or complete RFC 8785 implementation;
- persistent storage or distributed execution;
- cryptographic evidence verification;
- production SDK compatibility guarantees;
- an independent conforming implementation.

The conformance corpus currently validates schemas and selected semantics. It
does not establish cross-language interoperability.

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
- [`packages/prototype`](./packages/prototype): TypeScript reference prototype
- [`rfcs`](./rfcs): design decisions and unresolved questions
- [`ROADMAP.md`](./ROADMAP.md): adoption-gated delivery sequence
- [`PROGRAM.md`](./PROGRAM.md): scope, staffing, and success criteria

## Verify

```sh
pnpm verify
```

The repository is Apache-2.0 licensed. See [`CONTRIBUTING.md`](./CONTRIBUTING.md)
and [`SECURITY.md`](./SECURITY.md) before contributing or reporting a
vulnerability.

# RFC 0001: Core Boundary

- Status: Draft
- Compatibility: Foundational

## Problem

A portable verifier becomes another workflow platform if execution,
persistence, and domain policy enter its core.

## Proposed design

The deterministic core owns schemas, contract validation, reduction, replay,
and verification.

```text
(pinned contract, prior state, accepted event)
    -> (next state, findings, decisions, commands)
```

The core performs no network, filesystem, ambient clock, randomness, database,
or Covenant operation. Those belong to adapters and host runtimes.

## Invariants

- Covenant types never appear in normative schemas.
- Profiles cannot redefine ordering, identity, replay, or the effect boundary.
- Effects return as receipts and accepted events.

## Rejected alternatives

- Making Covenant the canonical runtime would prevent independent adoption.
- Building a distributed runtime would duplicate established systems and make
  adoption materially harder.

## Conformance

Boundary checks reject Covenant imports and implicit environment reads.

## Unresolved questions

- Whether policy evaluation remains a reducer operation or becomes a separately
  versioned pure function before beta.

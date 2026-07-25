# RFC 0001: Core Boundary

- Status: Draft
- Compatibility: Foundational

## Problem

A multidisciplinary project will collapse into vendor-specific behavior unless
the portable core is explicit.

## Proposed design

The deterministic core owns schemas, canonicalization, compilation, reduction,
evaluation, replay, verification, and language-neutral plugin contracts.

```text
(pinned contract, prior state, accepted event)
    -> (next state, findings, decisions, commands)
```

The core performs no network, filesystem, ambient clock, randomness, custody,
order execution, or Covenant operation. Those belong to adapters and runtimes.

## Invariants

- Covenant types never appear in normative schemas.
- Domain profiles cannot redefine ordering, identity, replay, or authority.
- Effects return as receipts and accepted events.

## Rejected alternatives

- Making Covenant the canonical runtime would prevent independent adoption.
- Embedding exchanges or agent frameworks would turn the core into a monolith.

## Conformance

Boundary checks reject Covenant imports and implicit environment reads.

## Unresolved questions

- Which evaluator operations belong in the kernel rather than the plugin ABI?

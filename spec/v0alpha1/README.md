# Covenant Timeline Core v0alpha1

Status: bootstrap draft

This specification defines a minimal portable model for replaying checkpointed
software and agent work. It is intentionally smaller than the long-term design.

Normative requirements use `MUST`, `MUST NOT`, `SHOULD`, and `MAY` as defined by
RFC 2119 and RFC 8174.

## Scope

Core v0alpha1 defines:

- contracts and checkpoints;
- ordered events;
- evidence references;
- checkpoint decisions;
- commands and receipts;
- replay and findings;
- canonical object identity.

It does not define persistence, scheduling, transport, cryptographic trust,
scoring, authorization enforcement, or a distributed runtime.

## Documents

- [Object model](./object-model.md)
- [Ordering](./clocks.md)
- [Events](./events.md)
- [Evidence and decisions](./evidence-and-authority.md)
- [Replay and effects](./replay-and-effects.md)
- [Canonicalization](./canonicalization.md)
- [Compatibility](./compatibility.md)
- [Errors](./errors.md)
- [Requirements and fixtures](./requirements.md)

## Conformance

The bootstrap conformance corpus validates schemas, runtime-validator
agreement, successful and failure replay projections, pinned state digests, and
the upstream RFC 8785 fixture subset in TypeScript and Python. Adversarial
reducer behavior is also covered by the reference implementation tests.

No versioned conformance release or independent reducer result exists yet. An
implementation MUST NOT claim independent Core v0alpha1 interoperability until
those surfaces are published and observed.

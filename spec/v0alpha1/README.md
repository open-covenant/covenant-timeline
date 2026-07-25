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

The bootstrap conformance corpus validates schemas and selected semantics. It
does not yet test the complete reducer or RFC 8785 edge cases across languages.

An implementation MUST NOT claim full Core v0alpha1 conformance until those
surfaces are covered by a published conformance release.

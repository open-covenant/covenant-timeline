# RFC 0002: Time and Ordering

- Status: Draft
- Compatibility: Foundational

## Problem

Replay needs one unambiguous input order. A universal clock ontology would add
complexity before the first adopter demonstrates a need for it.

This RFC governs the v0alpha1 and v0alpha2 checkpoint ledger only. It does not
define the future product boundary. The temporal-first v0alpha3 contract
proposed in [RFC 0009](./0009-temporal-reasoning-substrate.md) keeps sequence as
record order while adding explicit temporal axes, entities, constraints,
knowledge cuts, queries, and proof receipts.

## Proposed design

Core v0alpha1 uses a contiguous zero-based event sequence as its only normative
clock. Calendar and source timestamps may appear inside evidence payloads but do
not affect reduction.

Typed clocks and cross-clock mappings are deferred to a later RFC backed by
adopter fixtures.

## Invariants

- Event sequence is explicit.
- Gaps, duplicates, and reordering fail before reduction.
- Ambient wall-clock time cannot change a decision.

## Conformance

Cases cover valid sequence fields. Reducer tests cover gaps and duplicate
delivery.

## Unresolved questions

- Which real Covenant workflow first requires a second clock.
- Whether occurrence and observation time become core or profile fields.

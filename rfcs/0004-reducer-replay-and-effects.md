# RFC 0004: Reducer, Replay, and Effects

- Status: Draft
- Compatibility: Foundational

## Problem

Long-running workflows need durable replay without repeating external side
effects.

## Proposed design

Accepted events drive a deterministic reducer. It emits commands with stable
idempotency keys. Effectors run outside the kernel and return receipts as later
events. Delivery is at least once.

Replay may reproduce recorded commands for verification but marks them
non-executable. Effectful re-execution is a separate run with explicit
authority and lineage.

## Invariants

- Replay never performs an effect.
- Exactly-once execution is not claimed across uncontrolled systems.
- Snapshots are replaceable acceleration artifacts.
- Branches retain their ancestor and observed or counterfactual status.

## Conformance

Duplicate delivery, crashes, expected-version conflicts, replay, receipts, and
branch-lineage cases are required.

## Unresolved questions

- Normative command-key derivation.
- Compensation semantics across independently operated effectors.

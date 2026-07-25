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

Replay reproduces command records for verification but never invokes an
adapter. Effect execution is a separate host-runtime action over newly emitted
commands.

## Invariants

- Replay never performs an effect.
- Exactly-once execution is not claimed across uncontrolled systems.
- Snapshots are replaceable acceleration artifacts.

## Conformance

Sequence conflicts, duplicate evidence, replay, unknown receipts, and unresolved
commands are covered by fixtures and reducer tests.

## Unresolved questions

- Normative command-key derivation.
- How exported hosts prove that an adapter executed only newly emitted commands.

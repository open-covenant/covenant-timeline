# RFC 0007: State Binding and Checkpoint Finalization

- Status: Implemented bootstrap decision; independent review required before beta
- Authors: Project contributors
- Created: 2026-07-25
- Compatibility: breaking state projection

## Problem

A state that records only a contract ID can be reduced with different contract
bytes carrying the same ID. An accepted checkpoint can also be evaluated again
at a later sequence and emit another command with a different idempotency key.
Both behaviors are unsafe at an effect boundary.

## Scope

- Bind every run state to the RFC 8785 SHA-256 digest of its contract.
- Reject incremental reduction when either the contract ID or digest differs.
- Make checkpoint acceptance final within a run.
- Give receipt IDs run-wide uniqueness.
- Preserve rejected-to-accepted correction by appended evidence and evaluation.

## Non-goals

- Define branch, supersession, or accepted-decision revocation semantics.
- Authenticate evidence producers or effect receipts.
- Execute or authorize commands.

## Design

`createRun` binds the canonical contract digest to the returned in-process
state. `reduceRun` validates the contract and event, recomputes the contract
digest, and fails before advancing the stream if the binding differs or is
missing. The binding is private reducer metadata so the existing portable state
projection and digest remain stable. A process boundary recreates state by
replay rather than treating a projected state object as authoritative input.

Once a checkpoint is accepted, a later evaluation produces
`timeline.checkpoint.finalized` and no decision or command. An adopter that
must revise an accepted decision creates a new run until a versioned branch or
supersession protocol exists.

Receipt IDs are indexed independently from command IDs. Reusing a receipt ID
for another command produces `timeline.receipt.id_duplicate`.

The reference implementation may use a private mutable accumulator for linear
full replay. This does not change the pure public reduction contract.

## Alternatives

- **Bind only the contract ID:** rejected because IDs are caller-selected.
- **Allow accepted checkpoint re-evaluation:** rejected because a new sequence
  creates a new command and idempotency key.
- **Replace an accepted decision in place:** rejected because it obscures the
  effect history and creates ambiguous rollback semantics.

## Compatibility and Migration

The projected state, state digest, portable contracts, and event bytes do not
change. Existing fixture digests remain pinned.

Consumers already must treat snapshots as replaceable acceleration artifacts.
After a process boundary they replay the contract and event stream to recreate
the private binding. Persisted event streams remain the source of truth.

## Security and Privacy

Exact binding prevents same-ID policy and effect-template substitution.
Finalization prevents accidental or adversarial duplicate effect eligibility.
The contract digest reveals no contract bytes that were not already required
to replay the run.

## Effect-Boundary Impact

Hosts execute only commands returned from the append operation for a newly
accepted checkpoint. Replay returns historical command records but performs no
execution. A finalized finding never creates a command.

## Conformance Cases

- exact contract substitution fails;
- accepted checkpoint re-evaluation emits no command;
- rejected-to-accepted correction remains valid;
- duplicate receipt IDs produce a stable finding;
- updated state digests remain pinned.

## Rollback

Reverting this decision requires a new schema or package version because doing
so would weaken an effect-boundary invariant and change projected state bytes.

## Unresolved Questions

- Versioned branch and supersession representation.
- Whether finalization should become an explicit event in a later schema.

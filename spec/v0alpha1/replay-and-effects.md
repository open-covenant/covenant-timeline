# Reducer, Replay, and Effects

## Deterministic reduction

The reducer operates only on pinned inputs. Replaying identical canonical
inputs MUST produce byte-identical canonical outputs (`CTL-REPLAY-001`).

Snapshots are acceleration artifacts. A snapshot does not replace event
history, and verification may restart from the last verified snapshot plus all
subsequent events.

## Commands and receipts

A command is a request, not proof that an effect happened. Every command MUST
have a stable idempotency key derived from declared inputs
(`CTL-EFFECT-001`). Effectors execute commands outside the kernel and return a
receipt as a later event.

Delivery is at least once. The protocol does not claim exactly-once execution
against an uncontrolled external system.

## Replay safety

Replay MUST mark emitted or recorded commands as non-executable
(`CTL-REPLAY-002`). Effectful re-execution is a separate run with explicit
authority and lineage.

## Branching

A branch MUST identify its ancestor and divergence (`CTL-BRANCH-001`). It also
declares whether it represents an observed run, simulation, or counterfactual.
A branch cannot conceal or rewrite its parent.

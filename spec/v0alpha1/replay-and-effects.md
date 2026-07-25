# Replay and Effects

## Deterministic reduction

Replaying identical supported JSON inputs MUST produce identical projected
output (`CTL-REPLAY-001`).

Snapshots are optional acceleration artifacts. They do not replace the event
stream.

## Commands

An accepted checkpoint may emit a command from its pinned template. Every
command MUST contain:

- an ID;
- effect kind;
- payload reference;
- stable idempotency key;
- `replayPolicy: "forbid"`.

A command is a request, not proof that an effect happened
(`CTL-EFFECT-001`).

## Receipts

Adapters execute commands outside the kernel and return receipts as later
events. A receipt MUST identify its command, status, and effect digest
(`CTL-RECEIPT-001`).

A receipt for an unknown command produces a finding. Timeline does not claim
exactly-once execution against an external system.

## Replay safety

Replay reconstructs command records but MUST NOT invoke an adapter. Execution is
a separate host-runtime action over newly emitted commands.

# Events

Core v0alpha1 accepts three event types:

| Type                   | Payload                                     |
| ---------------------- | ------------------------------------------- |
| `evidence.recorded`    | One evidence object                         |
| `checkpoint.evaluated` | Checkpoint, policy, and evidence references |
| `receipt.recorded`     | One effect receipt                          |

Events are append-only. Accepted events MUST NOT be overwritten or renumbered.
Correction is represented by appending new evidence and re-evaluating the
checkpoint.

The bootstrap schema validates event shape. The reducer validates sequence,
references, duplicate evidence, and command joins.

Future versions may introduce explicit correction and branch events. They are
not part of the initial core.

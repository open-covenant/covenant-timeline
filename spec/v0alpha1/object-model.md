# Object Model

## Contract

A contract identifies one subject and one or more checkpoints. Each checkpoint
has:

- a unique identifier;
- one or more evidence claims required for acceptance;
- an optional command template emitted after acceptance.

The contract is immutable within a run. An implementation MUST reject unknown
contract fields outside the extension namespace (`CTL-CORE-002`).

Core v0alpha1 contracts do not contain an evaluator policy reference or policy
artifact digest. Contract identity therefore binds checkpoint requirements and
effect templates, not evaluator policy.

## Run

A portable run document pins a run ID, one contract, and its ordered event
stream (`CTL-RUN-001`). The run state is a projection and can be rebuilt from
that document.

## Core objects

| Object    | Purpose                                                           |
| --------- | ----------------------------------------------------------------- |
| Contract  | Declares subject, checkpoints, requirements, and effect templates |
| Event     | Adds one ordered input                                            |
| Evidence  | References material supporting claims                             |
| Decision  | Records a checkpoint evaluation                                   |
| Command   | Requests an external effect                                       |
| Receipt   | Records an observed effect result                                 |
| Run state | Derived projection of accepted events                             |

Every portable contract and event MUST identify its schema version
(`CTL-CORE-001`).

## Kernel boundary

The kernel computes:

```text
(pinned contract, prior state, accepted event)
    -> (next state, decision, commands, findings)
```

The kernel MUST NOT access a network, filesystem, ambient clock, locale, random
source, secret, database, or Covenant service.

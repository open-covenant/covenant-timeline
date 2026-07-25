# Object Model

## Core objects

A Timeline definition is immutable authoring input. Compilation produces a
canonical contract pinned to all semantics needed for deterministic execution.
A run applies accepted events to that contract.

The core object set is:

| Object              | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| Timeline definition | Declares subject, clocks, checkpoints, policies, and outputs |
| Compiled contract   | Canonical execution form and digest                          |
| Run                 | One execution pinned to a compiled contract                  |
| Observation         | Assertion about an external state or clock                   |
| Event               | Accepted reducer input                                       |
| Evidence            | Material supporting a claim                                  |
| Evaluation          | Deterministic derivation from declared evidence              |
| Scorecard           | Scoped interpretation of evaluation dimensions               |
| Decision            | Eligibility, authority recommendation, review, or limit      |
| Command             | Idempotent request for an external effect                    |
| Receipt             | Result of an attempted effect                                |
| Branch              | New lineage from an accepted ancestor                        |
| Attestation         | Signed statement about a versioned object or root            |

Every normative object MUST identify its schema and version
(`CTL-CORE-001`). Unknown semantic fields MUST fail outside the `extensions`
namespace (`CTL-CORE-002`).

## Kernel boundary

The deterministic kernel computes:

```text
(pinned contract, prior state, accepted event)
    -> (next state, findings, decisions, commands)
```

The kernel does not access a network, filesystem, ambient clock, locale,
randomness source, secret, exchange, chain, or Covenant service.

Domain profiles may add schemas and policies. They cannot redefine ordering,
canonical identity, replay, effect safety, or authority semantics.

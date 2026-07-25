# Architecture

## Definition

A timeline contract is immutable input describing:

- the subject being evaluated;
- ordered checkpoints;
- the evidence claims required at each checkpoint;
- the policy used to evaluate those claims;
- optional effect requests that become eligible after acceptance.

A run is an ordered event stream applied to a pinned contract. The exported run
contains enough information for another implementation to replay its decisions.

## Boundary

```text
        adopter runtime
              │
      evidence and receipts
              ▼
┌──────────────────────────────┐
│ Timeline reducer and verifier│
│                              │
│ contract + prior state + event
│   -> state + decision + command
└──────────────────────────────┘
              │
        command request
              ▼
        adopter adapter
```

The reducer has no network, filesystem, clock, random source, secret, or
database access. Adopters provide those capabilities outside the core.

Timeline does not schedule work. A host such as Covenant, Temporal, Restate,
DBOS, a CI system, or an application database owns durability and execution.

## First-release objects

| Object    | Responsibility                                                   |
| --------- | ---------------------------------------------------------------- |
| Contract  | Pins subject, checkpoints, requirements, and effect templates    |
| Event     | Adds one ordered input to a run                                  |
| Evidence  | References material supporting named claims                      |
| Decision  | Records checkpoint outcome, policy, evidence, and missing claims |
| Command   | Requests an idempotent external effect                           |
| Receipt   | Records the observed result of one command                       |
| Run state | Projection derived by replaying accepted events                  |

Compilation, branches, attestations, and domain scorecards may be introduced
later. They are not required to understand or implement the initial reducer.

## Reduction

The core operation is:

```text
(contract, prior state, event)
    -> (next state, decision?, commands[], findings[])
```

Required properties:

- identical pinned inputs produce identical output;
- input ordering is explicit and gaps fail;
- evidence is append-only within a run;
- a checkpoint decision names its policy and evidence set;
- missing requirements remain visible;
- every command has a stable idempotency key;
- a receipt joins one known command;
- replay returns command records but never executes them.

The current TypeScript prototype implements this model. It does not yet claim
byte-level interoperability.

## Evidence

Evidence is a reference, not truth. At minimum it identifies:

- a stable evidence ID;
- a kind and producer;
- the claims it supports;
- the digest of its payload.

Adapters decide how to retrieve and authenticate a payload. Policies decide
whether a producer is authoritative, whether evidence is fresh enough, and
whether conflicting evidence blocks acceptance.

The reducer only determines whether the referenced evidence covers the claims a
checkpoint requires. Cryptographic verification and domain interpretation stay
outside the minimal core until their contracts are specified.

## Decisions

A checkpoint evaluation produces:

```text
checkpoint
policy reference
evidence references
missing requirements
accepted | rejected
```

There is no default scoring function. A domain may publish a versioned
evaluation policy, but its dimensions and weights are explicit inputs. A score
cannot directly become authority.

## Commands and receipts

An accepted checkpoint may produce a command from a contract-pinned template.
A command is an effect request, not evidence that the effect happened.

```text
decision -> command -> adapter -> receipt event
```

Adapters enforce authorization, expiry, limits, and idempotency. Timeline
verifies that a receipt refers to a known command. It does not claim exactly-once
execution against uncontrolled systems.

## Covenant adapter

The Covenant integration translates between existing Covenant records and the
portable model:

| Covenant surface              | Timeline object   |
| ----------------------------- | ----------------- |
| Commit-scoped provenance      | Evidence          |
| Audit event                   | Event or evidence |
| Review and policy result      | Evidence          |
| Capability request            | Command           |
| Runtime or settlement receipt | Receipt           |

The adapter may persist Timeline state in Covenant, but exported contracts and
events must remain verifiable without Covenant.

## External runtime adapters

An adapter may:

- persist contracts, events, and snapshots;
- deliver events with retries;
- schedule future observations;
- call effectors for newly emitted commands;
- return receipts;
- export a portable run archive.

An adapter must not:

- change reducer output;
- omit accepted events from export;
- execute commands while replaying;
- infer policy from ambient configuration;
- make Timeline conformance claims for host-runtime behavior.

## Canonicalization

Normative objects will use I-JSON-compatible values and RFC 8785 canonical JSON.
Content identifiers will use SHA-256 over canonical UTF-8 bytes.

The bootstrap conformance runner currently includes only a small stable-JSON
check. It is not the normative RFC 8785 implementation. M2 requires a reviewed
implementation, official edge-case fixtures, and cross-language agreement
before byte identity becomes a compatibility promise.

## Storage

The core defines no mandatory database. A portable run archive will contain:

```text
contract
events[]
optional evidence payloads or retrieval metadata
optional snapshots
verification manifest
```

Snapshots are acceleration artifacts. Verification can always restart from the
contract and accepted event stream.

## Versioning

Every portable object identifies its schema version. Before beta, breaking
changes are expected and released as new alpha versions.

Stable compatibility starts only after:

- two implementations agree on canonical fixtures;
- Covenant has upgraded a real historical run;
- an external adopter has completed the same migration;
- rollback and verification behavior are documented.

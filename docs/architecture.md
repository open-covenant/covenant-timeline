# Architecture

## Definition

Covenant Timeline is a portable, proof-carrying temporal reasoning substrate.
Applications can submit explicit temporal records directly. Language models
submit request-scoped claim and query proposals that a deterministic compiler
lowers into candidate records. After host admission, the kernel returns a
canonical result and a reasoner-bound proof receipt.

The experimental v0alpha3 contract declares:

- the subject;
- discrete temporal axes with units and origins; and
- isolated actual, planned, forecast, or hypothetical contexts.

Its append-only run declares points, proper intervals, temporal facts,
difference constraints, corrections, and retractions. Event sequence defines
record order only. Modeled time exists on the declared axes.

Every query pins a context and an explicit event-prefix knowledge cut. Every
conclusion binds the projected state, query, semantic result, reasoner, and
proof.

v0alpha1 and v0alpha2 remain replayable checkpoint compatibility formats.

## Boundary

```text
       model runtime          application runtime
             │                        │
       model proposal           explicit records
             │                        │
             ▼                        │
 deterministic proposal compiler     │
             │                        │
             └───────────┬────────────┘
                         ▼
            evidence and authority admission
                    │
                    ▼
┌────────────────────────────────────────┐
│ Covenant Timeline                      │
│                                        │
│ contract + event prefix + query        │
│     -> active state                    │
│     -> semantic result + proof receipt │
└────────────────────────────────────────┘
                    │
          checked temporal conclusion
                    ▼
          adopter or model runtime
```

The projector and reasoner have no network, filesystem, ambient clock, random
source, secret, database, or effect access. Adopters provide those capabilities
outside the core.

Timeline does not schedule work. Covenant, Temporal.io, Restate, DBOS, a CI
system, or an application database may persist runs and invoke the kernel.
v0alpha3 does not parse civil timestamps or named time zones. Applications must
map them to integer axes under an explicit calendar, time-zone database, and
ambiguity policy before admission. No shared normalization profile ships yet.
Source authority and clock mappings are also host or profile inputs.

## Temporal objects

| Object               | Responsibility                                                         |
| -------------------- | ---------------------------------------------------------------------- |
| Contract             | Pins subject, axes, and isolated contexts                              |
| Event                | Appends one declaration, assertion, correction, or retraction          |
| Point                | Names an instant in one context and on one axis                        |
| Interval             | Names a proper start/end pair on one axis                              |
| Coordinate assertion | Places digest-referenced exact or bounded coordinates on a point       |
| Constraint           | Bounds the integer difference between two points                       |
| Temporal fact        | Retains an opaque proposition with validity and observation references |
| Query                | Pins context, knowledge cut, and one typed temporal operation          |
| Conclusion           | Binds a canonical result to state, query, reasoner, and proof          |

Explicit coordinates, bounds, finite results, and proof schedules use safe
integers. The solver uses exact integer arithmetic internally; the safe range is
a portable representation boundary, not an implicit bound on every unanchored
variable. The first kernel treats strict order as at least one declared tick.
It does not implement floating point or dense time.

Facts may distinguish validity, observation, and assertion references without
claiming that the generic kernel authenticated or established the proposition.
Different scenario contexts remain separate possible worlds unless a future
explicit bridge says otherwise.

## Projection and knowledge time

Projection is:

```text
(contract, event prefix, context)
    -> active declarations and assertions
```

`recordedThrough: null` selects the empty prefix. A non-negative integer selects
events through that sequence, inclusive. There is no implicit latest query.

Projection preserves append-only history while removing retracted or
superseded assertions from the active view. A later correction cannot alter the
projection at an earlier cut.

Supersession is persistent: making the replacement inactive does not silently
restore the assertion it displaced. Restoration is an explicit new assertion.

The state digest binds the canonical contract, selected context, explicit
global cut, and that context's admitted prefix events, including inactive
history. Event payloads belonging only to another context are excluded. This
keeps provenance-distinct histories distinct even when they produce the same
active graph.

A knowledge cut means “admitted by this record position.” It does not mean
“objectively true” or “believed by the system.”

## Reasoning kernel

The initial reasoner compiles active coordinate assertions, interval properness,
and active difference assertions into a resource-bounded, exact-integer Simple
Temporal Network.

Supported queries are:

- context consistency;
- tight lower and upper difference bounds;
- possible point relations; and
- possible Allen interval base relations.

Consistency evaluates the complete selected context. Bounds and relation
queries evaluate the connected components containing the referenced entities.
An unrelated contradiction therefore does not contaminate a separate query.

Results use operation-specific statuses:

- consistency: `consistent` or `inconsistent`;
- bounds: `bounded`, `partially-bounded`, `unbounded`, or `inconsistent`; and
- relations: `resolved`, `indeterminate`, or `inconsistent`.

The kernel never turns temporal precedence into causality. It never turns an
unbounded side into an estimate or an indeterminate relation into a definite
one.

## Proof receipts

The initial reasoner profile is `covenant.timeline.stn.v0alpha1`.

Proof variants are:

- a satisfying integer schedule;
- ordered upper and lower path edges;
- exhaustive relation cases with schedules for possible cases and
  contradictions for impossible cases; or
- an ordered negative cycle.

Each proof edge identifies its source, direction, and weight. A verifier
reconstructs the exact graph, checks the bound digests, confirms every edge,
and checks the path, schedule, or negative cycle. It does not trust model prose,
hidden chain of thought, or an unbound solver label.

The semantic result is canonical across conforming implementations. Proof bytes
are deterministic for one reasoner profile and independently checkable; another
reasoner may choose a different valid witness.

## Model interface

```text
unstructured source
        │
        ▼
model proposes claims, revisions, query intent, and exact quotes
        │
        ▼
deterministic compiler resolves host handles and derives candidate records
        │
        ▼
host verifies evidence, entailment, and authority, then admits records
        │
        ▼
deterministic temporal kernel
        │
        ├── checked result
        ├── unresolved alternatives
        └── proof or contradiction
        │
        ▼
model continues from bound temporal state
```

The model proposes semantics, not ledger mechanics or temporal authority. The
host owns the request-scoped handle catalogs. The compiler derives identifiers,
sequences, evidence digests, and exact quote spans. Extraction, compilation,
admission, solver, and response errors remain separate. The host retains
evidence bytes, authenticates authority, checks whether each quote supports its
claim, and surfaces rejected candidates.

Using the kernel as a tool is tool-integrated temporal reasoning. Calling it
inside a constrained generation loop is inference-integrated temporal
reasoning. Temporal behavior becomes model-native only if a training or
architecture experiment transfers to held-out temporal structures without
depending solely on the external kernel.

See [Model interface](./model-interface.md) for the executable loop.

## Legacy checkpoint compatibility

The published v0alpha1 contract declares checkpoints, required claim strings,
and optional effect templates. Its reducer performs deterministic requirement
coverage and records an evaluator-supplied `policyRef` label. It does not
resolve, authenticate, or contract-bind that label.

v0alpha2 pins profile, policy reference, and policy digest in each checkpoint.
Evidence must carry the same authority binding. Domain profiles still
authenticate source material outside the reducer.

The checkpoint reducer remains pure:

```text
(contract, prior state, event)
    -> (next state, decision?, commands[], findings[])
```

Commands are effect requests. Adapters execute them and return later receipt
events. Replay never calls an adapter.

A verified v0alpha3 conclusion may enter a checkpoint only through an explicit
evidence profile. There is no implied conversion from arbitrary checkpoint
requirements to temporal semantics.

## Covenant and runtime adapters

Covenant remains the first reference adopter. It maps audit and provenance
records to evidence, checkpoint commands to capability requests, and effect
results to receipts. Exported records remain verifiable without Covenant
running.

The Temporal.io compatibility adapter stores ordered checkpoint intake in
workflow history. Its integration test stops one worker, starts another against
the same local server, and completes after restart. That adapter demonstrates a
host boundary; it is not the v0alpha3 temporal reasoner.

An external adapter may:

- persist contracts, events, queries, conclusions, and replaceable
  acceleration snapshots;
- deliver records with retries;
- append authenticated observations from clocks or external systems;
- export a portable run and proof receipts; and
- execute legacy commands outside replay.

It must not:

- change projector or reasoner output;
- omit admitted events from export;
- read ambient time during replay;
- merge contexts or axes implicitly;
- infer source authority from model confidence; or
- claim core conformance for host-runtime behavior.

## Canonicalization and storage

Normative candidate objects use I-JSON-compatible values and RFC 8785 canonical
JSON. Content identifiers use SHA-256 over canonical UTF-8 bytes. Strict CLI
parsing rejects duplicate keys before canonicalization.

The core defines no mandatory database. The portable source of truth is the
exact contract and append-only event stream. Queries and conclusions are
separate content-bound records.

Legacy `FileRunArchiveStore` atomically persists checkpoint runs. Legacy
`RunState` is an in-process projection, not a hydration format; after a process
boundary the safe path is replay from exact contract and events. v0alpha3
likewise derives active state from portable history. Snapshot semantics remain
future work driven by real operational need.

## Versioning

Every portable object identifies its schema version. The npm alpha distributes
the experimental v0alpha3 reference implementation governed by Draft RFC 0009.
It is not a stable or normative release.

v0alpha1 and v0alpha2 fixtures remain unchanged. Stable temporal compatibility
starts only after:

- RFC governance completes;
- two implementations agree on semantic results;
- proofs are independently verified across implementations;
- real historical runs survive an upgrade; and
- an external adopter operates the temporal substrate without Covenant
  services.

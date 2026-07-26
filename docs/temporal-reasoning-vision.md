# Temporal Reasoning Vision

## North star

Covenant Timeline aims to give AI systems a portable temporal state and a
proof-producing way to reason over events, intervals, uncertainty, and change.

The released alpha is a deterministic checkpoint ledger with portable replay.
It does not yet make an LLM understand time. Its only normative clock is event
sequence, and its only core decision procedure is checkpoint requirement
coverage.

That contract is now treated as a historical compatibility format, not the
future product boundary. The temporal-first v0alpha3 contract rewrites the core
around explicit time while keeping v0alpha1 and v0alpha2 runs verifiable.

The intended system is larger:

```text
narrative, tools, sensors, and records
                   │
                   ▼
  digest-referenced temporal assertions
                   │
                   ▼
        deterministic temporal kernel
                   │
        ┌──────────┼───────────┐
        ▼          ▼           ▼
    conclusion  ambiguity  contradiction
        │          │           │
        └──────────┴───────────┘
                   │
                   ▼
       content-addressed temporal state
                   │
        ┌──────────┴───────────┐
        ▼                      ▼
 proof-carrying results      model inference
```

This makes time foundational to an agent's reasoning loop without pretending
that an external protocol has changed the model's internal architecture.

## What “understand time” means here

“Understanding” is an evaluation target, not a property inferred from fluent
language. A temporally capable system should be able to:

1. distinguish when something happened, when it was observed or asserted, when
   it was recorded, and when a fact was valid;
2. represent instants, intervals, durations, deadlines, recurrence, partial
   order, and concurrency without forcing all of them onto one wall clock;
3. resolve relative expressions only against explicit anchors, calendars, time
   zones, and clock mappings;
4. preserve bounded, ambiguous, conflicting, and missing time instead of
   inventing a precise timestamp;
5. derive temporal consequences, reject inconsistent constraints, and separate
   temporal precedence from causality;
6. revise knowledge by appending corrections or superseding assertions without
   rewriting what was known earlier;
7. answer both “what was asserted valid then?” and “what assertions had been
   admitted then?”;
8. carry temporal coherence across sessions, process restarts, model changes,
   and context compaction; and
9. expose the exact facts, assumptions, reasoner, and derivation behind an
   answer or plan.

These capabilities must be measured independently. A system that gets date
arithmetic right may still fail on overlapping intervals, knowledge revision,
or uncertain durations.

## The proposed substrate

### Temporal intermediate representation

The temporal intermediate representation, or temporal IR, is the v0alpha3
contract and event model: a portable graph of typed temporal entities,
assertions, constraints, contexts, and provenance.

It must keep these dimensions distinct:

| Dimension        | Meaning                                                     |
| ---------------- | ----------------------------------------------------------- |
| Stream sequence  | Deterministic order in which Timeline accepted records      |
| Occurrence time  | When an event happened in a declared temporal reference     |
| Valid time       | When an asserted state or fact applies in the modeled world |
| Observation time | When a source observed the subject                          |
| Assertion time   | When a source made the claim                                |
| Record time      | When the system accepted the assertion                      |
| Dependency order | Which event or obligation must precede another              |

Storage order does not establish occurrence time, and occurrence order does not
establish causality. Clock and calendar conversions are explicit, versioned
inputs. The reducer and temporal kernel never read ambient wall time.

Assertions remain evidence, not truth. Every admitted temporal assertion binds
to its source evidence. Corrections, supersession, and retraction remain
append-only. A knowledge cut can therefore reproduce the admitted temporal
state at a prior record sequence.

### Deterministic temporal kernel

The temporal kernel is a pure constraint engine, not an LLM prompt and not a
workflow scheduler. The initial implementation uses discrete integer axes and
a deliberately tractable subset of established formalisms:

- point relations and Allen relations over proper intervals;
- bounded metric differences for durations, windows, and deadlines;
- explicit partial order and concurrency;
- exact and bounded coordinates with declared precision;
- valid-time and record-time queries; and
- contradiction detection with a minimal or reproducible conflict witness.

Calendar arithmetic, recurrence, cross-axis mappings, uncontrollable durations,
and state-transition semantics should arrive after the smaller kernel has
executable conformance cases. The project should reuse established work
such as [Allen interval relations](https://doi.org/10.1145/182.358434),
[Simple Temporal Networks](<https://doi.org/10.1016/0004-3702(91)90006-6>),
[Lamport's happens-before relation](https://lamport.org/pubs/time-clocks.pdf),
[OWL-Time](https://www.w3.org/TR/owl-time/),
[W3C PROV](https://www.w3.org/TR/prov-o/), and
[RFC 5545 recurrence rules](https://www.rfc-editor.org/rfc/rfc5545) rather than
renaming their concepts.

### Proof-carrying conclusions

A temporal query must not return only prose. Its portable result binds to:

- the temporal-state, query, and semantic-result digests;
- the exact assertion and evidence identifiers used;
- the reasoner name, version, and semantic profile;
- normalized constraints and explicit assumptions;
- a result type specific to the query, such as tight bounds, possible point or
  interval relations, or context consistency; and
- a bound path, satisfying schedule, relation-case witness, or negative cycle
  appropriate to that result.

The exact schema remains an RFC question. The invariant is that another
implementation can check the result from pinned inputs without trusting the
model that requested it. Independent reasoners must agree on the semantic
result but may emit different proof receipts unless a later specification
requires canonical witness selection.

### Model interface

The LLM has two distinct roles:

1. propose typed temporal assertions and queries from unstructured material;
2. continue reasoning from checked conclusions and diagnostics.

The deterministic kernel owns neither natural-language interpretation nor
domain truth. A correct solver cannot repair a semantically wrong extraction,
so extraction accuracy, admission authority, and inference correctness must be
reported separately.

The interface should let a model:

- retrieve a bounded temporal-state capsule instead of an undifferentiated
  transcript;
- submit candidate facts with source references;
- ask typed relation, duration, satisfiability, deadline, and knowledge-as-of
  queries;
- receive proofs, ambiguity, or contradictions;
- repair invalid candidate representations; and
- bind a later decision or plan to the exact checked state.

An accepted temporal conclusion can become evidence for a legacy Timeline
checkpoint. The new contract is temporal-first; it does not keep checkpoints as
the center of the object model.

## Two integration levels

The project must distinguish two claims:

### Tool-integrated temporal reasoning

A model reads and writes temporal IR and calls the deterministic kernel during
inference. This is achievable without controlling model weights and can work
across model vendors. It can make temporal reasoning explicit, portable, and
auditable, but it is still a neuro-symbolic system.

### Model-integrated and model-native temporal reasoning

A kernel can also participate inside constrained decoding or another model
inference stage. That is inference-integrated temporal reasoning, but it still
depends on the kernel.

Model-native temporal reasoning means a model is trained or architected to
internalize the temporal representation and apply it reliably when the external
kernel is withheld. This requires open-weight experiments, time-aware training
data, controlled ablations, and held-out evaluation. It is a research track,
not a current product claim.

Work on temporal graphs and tool use gives this direction a credible basis.
[TG-LLM](https://aclanthology.org/2024.acl-long.563/) improved temporal
reasoning by training text-to-temporal-graph translation and graph reasoning.
[TReMu](https://aclanthology.org/2025.findings-acl.972/) improved multi-session
temporal question answering with time-aware memory and executable
calculations. Those results support structured temporal interfaces; they do not
establish general or native temporal understanding.

## Falsifiable research program

The program succeeds through measured behavior, not vocabulary.

| Hypothesis                                    | Test                                                                                                    | Failure condition                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A typed temporal IR reduces inconsistency     | Compare a fixed model with identical evidence using direct prompting, chain of thought, and Timeline IR | No repeatable gain, or gains disappear on held-out structures         |
| A deterministic kernel improves correctness   | Score conclusions and proof checks separately from text-to-IR extraction                                | Solver-assisted answers remain wrong when extraction is correct       |
| Proof-carrying conclusions improve continuity | Run multi-session tasks across restarts, corrections, and context compaction                            | Answers drift from the pinned knowledge cut or cannot be reproduced   |
| The representation transfers                  | Train on synthetic temporal structures and test unseen task forms and domains                           | Gains are confined to templates or memorized facts                    |
| Model-native integration is possible          | Compare an open-weight model before and after temporal training, both with and without the kernel       | Improvement exists only while the external solver supplies the answer |

Public benchmarks provide useful baselines, not a complete definition.
[TimeBench](https://aclanthology.org/2024.acl-long.66/) separates symbolic,
commonsense, and event temporal reasoning.
[CoTempQA](https://aclanthology.org/2024.acl-long.703/) tests its `Equal`,
`Overlap`, `During`, and `Mix` scenarios.
[ETRQA](https://aclanthology.org/2025.findings-acl.1198/) stresses spans,
compound questions, and fine granularity. Timeline should add adversarial tests
for bitemporal revision, provenance, partial order, uncertainty, and
longitudinal agent state because those are not fully covered by question
answering benchmarks.

Results must report:

- temporal fact extraction accuracy;
- constraint and query accuracy;
- contradiction and abstention precision and recall;
- proof verification rate;
- temporal consistency under paraphrase and fact reordering;
- continuity across sessions and restarts;
- latency, token use, and solver resource use; and
- performance by relation and temporal dimension, not only one aggregate.

## Novelty bar

Events, interval algebra, temporal graphs, constraint solvers, bitemporal data,
and neuro-symbolic reasoning already exist. TimeML and
[jTLEX](https://aclanthology.org/2023.eacl-demo.4/) already cover temporal graph
construction, point-algebra conversion, consistency, indeterminacy, and
timeline extraction. Covenant Timeline should not claim to invent them.

The integration hypothesis is that combining them into a portable,
digest-referenced, proof-carrying temporal state that:

- survives runtimes, models, restarts, and organizations;
- separates model interpretation from deterministic inference;
- preserves asserted validity and prior knowledge cuts;
- gives every conclusion a canonical semantic result and an independently
  checkable derivation; and
- connects verified temporal conclusions to real agent decisions and effects.

That becomes a novel contribution only if a prior-art review and controlled
evaluation show that it adds something not already demonstrated by existing
temporal graphs, agent memory systems, or neuro-symbolic question-answering
methods.

“Digest-referenced” here means that assertion records name claimed evidence
bytes by SHA-256 digest. The host must retain those bytes and validate the
digest. Authentication, source authority, and extraction correctness remain
host responsibilities unless a future profile pins them.

## Domain path

Software engineering is the first proving ground because its evidence,
dependencies, deadlines, revisions, and effects are inspectable. Scientific and
medical workflows are plausible later applications of the same temporal core,
but domain correctness, privacy, authority, and safety are not portable by
assumption.

A high-stakes domain profile requires independent domain maintainers, real
fixtures, appropriate evidence authority, privacy review, and evaluation
against domain practice. A generic temporal proof can establish that a
conclusion follows from admitted facts. It cannot establish that the facts were
clinically or scientifically sound.

## Current boundary

The released npm alpha remains the checkpoint verifier. The temporal-first
v0alpha3 source implementation is experimental while
[RFC 0009](../rfcs/0009-temporal-reasoning-substrate.md) is Draft. Existing
alpha runs and state digests will not be reinterpreted.

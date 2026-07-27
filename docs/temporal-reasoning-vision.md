# Temporal Reasoning Vision

## The problem

A long-running agent plans a release on Monday. On Thursday it receives a
correction showing that the security review finished after the deployment. A
transcript contains both claims, but it does not reliably preserve what the
agent knew at each point, which assertion was corrected, or whether the release
order was valid.

Covenant Timeline gives the agent a typed temporal state for those distinctions.
The model proposes assertions and questions; a deterministic kernel checks what
follows and returns evidence that another implementation can verify.

```text
narrative, tools, sensors, and records
                   │
                   ▼
 evidence-referenced temporal assertions
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
       proof-carrying temporal state
```

The current release implements tool-integrated temporal reasoning: models
exchange typed state with an external deterministic kernel during inference.

## The current substrate

Draft v0alpha3 represents:

- explicit metric and ordinal axes;
- isolated actual, planned, forecast, and hypothetical contexts;
- points, proper intervals, and bounded integer coordinates;
- duration, ordering, and overlap constraints;
- append-only correction, supersession, and retraction;
- historical record-time knowledge cuts;
- typed consistency, bound, point-relation, and interval-relation queries; and
- checked conclusions with schedules, paths, relation witnesses, or negative
  cycles.

The reducer and kernel operate on declared inputs. Calendar arithmetic,
time-zone conversion, recurrence, dense time, and cross-axis clock mapping are
not part of the current alpha.

Different temporal dimensions remain explicit:

| Dimension        | Meaning                                                     |
| ---------------- | ----------------------------------------------------------- |
| Occurrence time  | When an event happened in a declared temporal reference     |
| Valid time       | When an asserted state or fact applies in the modeled world |
| Observation time | When a source observed the subject                          |
| Assertion time   | When a source made the claim                                |
| Record time      | When the system admitted the assertion                      |
| Dependency order | Which event or obligation must precede another              |

Assertions bind to source evidence by content identity. Authentication, source
authority, and extraction correctness remain host responsibilities.

## The model boundary

The critical adoption test is whether models can reliably turn real evidence
into typed assertions and queries that deserve admission.

The model has two roles:

1. propose evidence-referenced temporal assertions and typed questions;
2. continue reasoning from checked conclusions, ambiguity, and diagnostics.

The kernel cannot repair a semantically wrong extraction. Evaluation therefore
has to separate assertion extraction, query construction, admission, solver
behavior, and final-answer accuracy.

The public
[model-interface v1 development benchmark](../benchmarks/model-interface/v1/README.md)
compares Timeline-assisted reasoning with direct full-context answers and
rolling narrative memory. Its smoke suite measures delayed observations,
historical cuts, corrections, contradictions, bounded time, scenario isolation,
and interval relations while keeping invalid output visible. No model evaluation
with an external model has been run; the roadmap defines the blinded scale
evaluation required for an efficacy claim.

## What success means

For the current product, useful temporal reasoning means that a system can:

- preserve uncertainty instead of inventing precise timestamps;
- distinguish occurrence, observation, assertion, and record time;
- reconstruct what was knowable before a later correction arrived;
- detect inconsistent constraints and return a reproducible witness;
- keep planned, actual, forecast, and hypothetical scenarios isolated; and
- carry checked temporal state across model sessions and process restarts.

The model benchmark and external pilot measure these capabilities directly.

## Evidence path

The [roadmap](../ROADMAP.md) defines the current evidence sequence and its exit
criteria: a blinded model evaluation, an external long-running-agent pilot, and
an independently maintained implementation. These establish model reliability,
operational value, and protocol portability respectively.

## Research boundary

Tool-integrated temporal reasoning is the current scope: a model reads and
writes temporal state and calls a deterministic kernel during inference. This
can work across model vendors without controlling their weights.

Inference-integrated research may place the kernel inside constrained decoding
or another inference stage. Model-native temporal reasoning is a stronger
claim: a trained or architected model must retain the capability when the
external kernel is withheld. That requires open-weight experiments, controlled
ablations, and held-out evaluation. Current product claims stop at
tool-integrated reasoning.

Temporal graphs, interval algebra, constraint solvers, bitemporal data, and
neuro-symbolic reasoning are established fields. The substrate builds on
[Allen interval relations](https://doi.org/10.1145/182.358434),
[Simple Temporal Networks](<https://doi.org/10.1016/0004-3702(91)90006-6>),
[Lamport's happens-before relation](https://lamport.org/pubs/time-clocks.pdf),
[OWL-Time](https://www.w3.org/TR/owl-time/), and
[W3C PROV](https://www.w3.org/TR/prov-o/).

The integration hypothesis is that a portable, evidence-referenced,
proof-carrying temporal state can survive models, runtimes, restarts, and
organizations while preserving prior knowledge cuts. It becomes a meaningful
contribution only if controlled evaluation, external operation, and an
independent implementation support it.

## Adoption scope

Long-running agents are the first wedge because their evidence, revisions,
dependencies, and effects can be inspected. High-stakes medical, scientific,
and financial uses require independent domain owners, evidence authority,
privacy review, and domain-specific evaluation. A temporal proof can show that
a conclusion follows from admitted assertions; it cannot establish that those
assertions were clinically, scientifically, or financially sound.

The npm alpha contains the v0alpha3 reference implementation alongside frozen
v0alpha1 and v0alpha2 checkpoint compatibility APIs. v0alpha3 remains
experimental while [RFC 0009](../rfcs/0009-temporal-reasoning-substrate.md) is
Draft.

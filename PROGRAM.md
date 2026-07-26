# Covenant Timeline Program

## Product decision

Covenant Timeline is being developed as a portable, proof-carrying temporal
reasoning substrate for AI systems.

v0alpha3 is the temporal contract. It represents explicit axes, scenario
contexts, points, proper intervals, bounded constraints, knowledge cuts, typed
queries, and checked conclusions. A model can propose assertions and questions;
a deterministic kernel returns bounds, possible relations, schedules, or
contradictions with independently checkable evidence.

The v0alpha1 and v0alpha2 checkpoint contracts remain immutable compatibility
formats for portable replay, canonical event history, evidence identity, and
effect receipts. Checkpoints may consume verified temporal conclusions.

This is an immediately buildable neuro-symbolic interface, not a claim that an
external solver changes model weights. Model-native temporal reasoning requires
separate open-weight training or architecture experiments.

## Current status

- v0alpha1 and v0alpha2 retain frozen checkpoint semantics and compatibility
  fixtures.
- [RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md) defines the
  temporal-first v0alpha3 contract and is currently Draft.
- The npm alpha distributes the experimental v0alpha3 reference implementation.
  Stable semantics require the RFC, schemas, conformance corpus, and
  final-comment period to complete.
- The project is seeking an independent v0alpha3 implementation and an
  externally operated long-running-agent pilot.

## Product boundary

The project owns:

1. a language-neutral temporal contract, event, query, and conclusion model;
2. deterministic projection at an explicit record-time knowledge cut;
3. a bounded temporal constraint kernel;
4. canonical semantic results and independently checkable proof receipts;
5. model-facing JSON, CLI, and library interfaces;
6. schemas, fixtures, compatibility tests, and multiple conforming
   implementations; and
7. adapters through which models, runtimes, and legacy checkpoints use the
   substrate.

It does not own:

- workflow scheduling, queues, retries, workers, or durable storage;
- ambient wall-clock, locale, calendar, or time-zone policy;
- natural-language truth, evidence authority, or a universal ontology;
- causal inference from temporal order;
- domain policy, medical judgment, financial authority, or safety approval; or
- model-native capability claims without training-time or architecture-level
  evidence.

Existing workflow and agent runtimes should host Timeline through adapters.
Covenant remains the first reference adopter, not a required service.

## First temporal kernel

The initial kernel is intentionally small and deterministic:

- discrete safe-integer metric and ordinal axes;
- isolated actual, planned, forecast, and hypothetical contexts;
- points and proper intervals;
- exact and bounded coordinates;
- Simple Temporal Network difference constraints;
- append-only assertion, supersession, and retraction;
- explicit record-time knowledge cuts;
- consistency, difference-bound, point-relation, and interval-relation queries;
  and
- schedules, bound paths, relation cases, and negative cycles as proof
  receipts.

The first kernel does not implement dense time, arbitrary disjunctive interval
algebra, recurrence, calendar arithmetic, cross-axis conversion, uncertain
controllability, deontic obligations, or absence inference without a future
completeness profile.

## Success criteria

### Experimental temporal implementation

- A contributor can run a temporal query and verify its receipt locally in
  fifteen minutes.
- Identical contract, event prefix, context, and query produce the same
  semantic result across supported environments.
- Contradictory and underdetermined inputs remain explicit.
- v0alpha1 and v0alpha2 fixtures and digests do not change.
- Draft status and unsupported semantics are visible at every public entry
  point.

### Temporal alpha

- TypeScript and an independent second implementation agree on semantic
  results for the shared corpus.
- Historical knowledge cuts do not leak later corrections.
- A model-facing evaluation reports extraction, admission, solver, and final
  answer errors separately.
- One real run spans restarts, delayed observations, corrections, concurrency,
  and deadlines.
- An independent operator can reproduce every checked conclusion from exported
  records.

### Beta

- The temporal RFC and compatibility policy have completed governance review.
- At least one model or runtime outside Covenant uses the temporal contract.
- Two independently maintained implementations verify each other's results and
  receipts.
- Real runs have crossed multiple package versions without losing historical
  verification.
- Security and privacy reviews cover parsing, resource limits, provenance,
  projection, proof verification, and adapter authority.

### Stable release

- Contract, query, and semantic-result formats have demonstrated
  interoperability across implementations and adopters.
- Migration tests back the compatibility policy.
- At least two organizations actively maintain implementations or adapters.
- Operators can reproduce every accepted temporal conclusion from pinned
  inputs without trusting the requesting model or Covenant services.

## Delivery sequence

### Historical foundation: M0–M4

The checkpoint work proved canonical replay, content identity, a safe effect
boundary, a Covenant integration, a real Temporal.io restart test, a public
longitudinal archive, and cross-language verification. External operation of
the checkpoint adapter is still open.

Those results remain compatibility and adoption assets. They do not constrain
the v0alpha3 object model.

### Temporal contract and kernel: M5

- Land the v0alpha3 contract, projection rules, schemas, and conformance cases.
- Implement the bounded TypeScript kernel and receipt verifier.
- Expose a small library, CLI, and model-facing JSON example.
- Freeze v0alpha1 and v0alpha2 compatibility tests.

Exit gate: a model or application can submit portable temporal state and a
typed query, receive a checked result, and verify it without a hosted service.

### Knowledge time and proofs: M6

- Harden correction, retraction, supersession, and historical knowledge cuts.
- Expand valid-time facts and explicit completeness semantics.
- Add an independent implementation and solver-oracle testing.
- Define proof profiles without requiring different reasoners to emit identical
  receipt bytes.

Exit gate: independent implementations agree on semantic results and verify
each other's supported proofs across historical cuts and contradictions.

### Model inference bridge: M7

- Add source-linked, content-bound text-to-IR and query interfaces.
- Return bounded state capsules, alternatives, and repair diagnostics.
- Bind downstream decisions to exact state, query, and result identities.
- Compare direct prompting, chain of thought, and kernel-integrated inference
  on fixed evidence and models.

Exit gate: held-out evaluation shows a repeatable gain without hiding
extraction failures or increasing unsupported definite answers.

### Longitudinal operation: M8

- Run a real workflow across weeks, restarts, corrections, concurrent work, and
  deadlines.
- Measure temporal errors and manual reconciliation before and after
  integration.
- Recruit an independent model or runtime operator.

Exit gate: exported records reproduce every conclusion and demonstrate
operational value beyond a synthetic benchmark.

### Model-integrated research: M9

- Test constrained-decoding or inference-stage kernel integration.
- Train or adapt an open-weight model on temporal IR and proof traces.
- Evaluate transfer on held-out structures with and without the external
  kernel.

Exit gate: claims distinguish tool-integrated, inference-integrated, and
model-native behavior, and any model-native gain survives removal of the
external kernel.

### Interoperable beta: M10

- Complete governance, compatibility, security, and privacy review.
- Stabilize supported APIs and migration tooling from observed use.
- Establish independent maintenance and release participation.

Exit gate: external operators can adopt, run, verify, and upgrade the temporal
substrate without Covenant services.

## Team shape

The temporal program needs sustained ownership in four areas:

| Responsibility                                   |                           Capacity |
| ------------------------------------------------ | ---------------------------------: |
| Contract, kernel, and reference implementation   |                                1–2 |
| Model interface and evaluation                   |                                  1 |
| Runtime integration and developer experience     |                                  1 |
| Security, temporal methods, and benchmark review | fractional, increasing before beta |

Model-native work also requires open-weight training infrastructure and
independent evaluation. Domain profiles require their own maintainers and
reviewers; core maintainers should not simulate expertise in medicine,
finance, scientific validation, or engineering certification.

## Adoption principles

- Make the portable JSON contract useful from any model vendor or runtime.
- Keep the local path smaller than adopting a workflow platform.
- Separate probabilistic extraction from deterministic inference.
- Preserve ambiguity instead of inventing precision.
- Treat record order, occurrence order, and causality as different concepts.
- Bind every admitted assertion and conclusion to provenance and content
  identity.
- Reuse established temporal algebra, provenance, calendar, and
  canonicalization standards.
- Integrate with Temporal.io, Restate, DBOS, and similar systems instead of
  rebuilding their operational responsibilities.
- Treat examples, fixtures, and independent runs as stronger evidence than
  roadmap breadth.
- Treat “understanding time” as measured behavior, not branding.

Track:

- time to first checked temporal query;
- semantic-result and proof-verification agreement across implementations;
- contradiction detection, abstention, and unsupported precision;
- extraction, admission, solver, and final-answer error rates;
- reproducibility across knowledge cuts, restarts, and upgrades;
- external models, runtimes, implementations, and operators; and
- support burden.

Stars, package downloads, profile count, and raw checkpoint count are
secondary.

## Expansion gate

A new domain enters the public roadmap only when:

- an external adopter brings a concrete workflow;
- a named domain maintainer owns the evidence semantics;
- required core semantics have executable conformance cases;
- safety, privacy, and authority boundaries are independently reviewed; and
- public capability claims follow a real exported run.

The domain-neutral temporal substrate may advance before any high-stakes
profile. Medical, scientific, financial, and other regulated uses remain
outside the product claim until qualified independent owners supply their
domain rules and evaluation.

## Stop conditions

Pause expansion when:

- identical pinned inputs produce different semantic results;
- historical knowledge cuts leak later corrections;
- a proof cannot be checked independently from its pinned inputs;
- unrelated scenario contexts constrain one another;
- record order is presented as occurrence order or causality;
- temporal inference collapses ambiguity into unsupported precision;
- model-generated assertions lose source or extraction provenance;
- an adapter grants authority that the portable record does not justify;
- the core becomes harder to adopt than the runtime it integrates with; or
- claimed gains disappear when extraction and solver performance are measured
  separately.

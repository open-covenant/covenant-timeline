# Covenant Timeline Program

## Current hypothesis

Long-running agents need more than a transcript or summary to reason coherently
about time. They need explicit events, intervals, uncertainty, corrections, and
historical knowledge states that survive context compaction and process
restarts.

Covenant Timeline is testing a portable interface for that job. A model
proposes typed temporal assertions and questions. A deterministic kernel
returns bounded conclusions, possible relations, schedules, or contradictions
with independently checkable evidence.

The kernel is implemented. The central product question is whether models can
reliably produce assertions and queries worth admitting. Broad adoption claims
depend on evidence at that boundary.

## What exists

- Draft [RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md) defines the
  experimental v0alpha3 temporal contract.
- The npm alpha includes the v0alpha3 TypeScript reference implementation and
  proof verifier.
- The kernel supports explicit axes and scenario contexts, points and proper
  intervals, bounded integer constraints, historical knowledge cuts, typed
  queries, contradictions, and proof receipts.
- v0alpha1 and v0alpha2 remain frozen compatibility formats for checkpoint
  replay, evidence identity, decisions, and effect receipts.

The current kernel does not provide calendar arithmetic, time-zone conversion,
recurrence, dense time, or cross-axis conversion. Those features should follow
demonstrated use. Domain-specific authority remains a host or profile
responsibility.

## Evidence program

The [roadmap](./ROADMAP.md) is the canonical source for the project's three
current gates: model reliability, operational value, and protocol portability.

The checked-in model-interface v1 suite includes a public development corpus and
a preregistered public paraphrase corpus for a formal frontier-model
falsification gate. No formal frontier-model result has been published. A
failure ends the standalone model-memory thesis; a pass justifies a broader
blinded evaluation but does not establish general efficacy. Pilot and
interoperability work advance through exported evidence.

## Product boundary

The project owns:

- the language-neutral temporal contract, schemas, and canonicalization rules;
- deterministic projection at an explicit knowledge cut;
- the bounded temporal constraint kernel and proof verification;
- model-facing JSON, CLI, and library interfaces;
- conformance cases and compatibility tests; and
- reference adapters for models, runtimes, and legacy checkpoints.

It does not own:

- natural-language truth, evidence authority, or a universal ontology;
- workflow scheduling, queues, retries, workers, or durable storage;
- ambient wall-clock, locale, calendar, or time-zone policy;
- causal inference from temporal order;
- domain policy, medical judgment, financial authority, or safety approval; or
- model-native capability claims without training or architecture evidence.

Existing agent and workflow runtimes should host Timeline through adapters.
Covenant is the first reference adopter, not a required service.

## What the evidence decides

If the frontier-model gate passes, the next interface work and broader blinded
evaluation should follow its observed extraction and continuity failures. If it
fails, standalone model-memory expansion stops. If the pilot succeeds,
operational features should follow the operator's measured friction. If the
independent implementation succeeds, the interoperable subset can advance
through the RFC process.

Until then, new protocol breadth is secondary to:

- end-to-end temporal answer accuracy;
- unsupported-definite and contradiction error rates;
- reproducibility across knowledge cuts, restarts, and package versions;
- semantic agreement across implementations; and
- time and effort required for an external operator to adopt the system.

Pause expansion if pinned inputs produce different semantic results, later
corrections leak into earlier knowledge cuts, proofs cannot be checked from
their bound inputs, model-generated assertions lose evidence references, or a
claimed gain disappears when extraction and solver performance are measured
separately.

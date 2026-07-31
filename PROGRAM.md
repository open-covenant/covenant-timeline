# Covenant Timeline Program

## Recorded result

Long-running agents need more than a transcript or summary to reason coherently
about time. They need explicit events, intervals, uncertainty, corrections, and
historical knowledge states that survive context compaction and process
restarts.

Covenant Timeline implements a portable interface for that job. A model can
propose typed temporal assertions and questions. A deterministic kernel returns
bounded conclusions, possible relations, schedules, or contradictions with
independently checkable evidence.

The preregistered model-interface evaluation found strong extraction and
end-to-end accuracy, but rolling Timeline state did not outperform stateless
full-context structured extraction on answer accuracy. The result rejects the
current standalone model-memory claim. It does not change the kernel's
deterministic properties.

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

The [roadmap](./ROADMAP.md) records the completed model gate and the two
remaining evidence tracks: operational value and protocol portability.

The model-interface v1 suite includes a public development corpus and a
preregistered public paraphrase corpus. Its 2026-07-31 GPT-5.6 Sol run completed
all 432 observations and returned `kill`: Timeline beat bounded narrative
memory but not stateless full-context structured extraction. The immutable
[result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-eval-v1-gpt-5.6-sol-2026-07-31)
contains the configuration, raw responses, scores, diagnostics, gate output,
and checksums.

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

## What continues

Standalone model-memory expansion has stopped under the predeclared rule.
Remaining work is limited to deterministic kernel maintenance, integration
inside Covenant or systems that need audit and replay, independently operated
pilots, and interoperability evidence. A new model-side product claim requires
a separate preregistration; v1 is a fixed negative result.

New protocol breadth remains secondary to:

- reproducibility across knowledge cuts, restarts, and package versions;
- semantic agreement across implementations; and
- time and effort required for an external operator to adopt the system.

Pause kernel expansion if pinned inputs produce different semantic results,
later corrections leak into earlier knowledge cuts, proofs cannot be checked
from their bound inputs, or model-generated assertions lose evidence
references.

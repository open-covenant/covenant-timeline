# Covenant Timeline Program

## Current scope

Covenant Timeline provides deterministic temporal reasoning over records that a
host has admitted. It represents events, intervals, uncertainty, corrections,
and historical knowledge cuts explicitly, then returns bounded conclusions,
possible relations, schedules, or contradictions with a machine-checkable proof
receipt.

The current evidence supports that infrastructure claim. It does not show that
Timeline makes a model understand time or improves model accuracy over a
simpler structured pipeline. Model-generated records remain untrusted proposals
until a host reviews and admits their exact candidate bytes.

## Available surfaces

- Draft [RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md) defines the
  v0alpha3 temporal contract.
- Published `@covenant-org/timeline@0.0.0-alpha.2` includes the v0alpha3
  TypeScript reference kernel and proof verifier.
- Source candidate `@covenant-org/timeline@0.0.0-alpha.3` adds the bounded
  model-proposal compiler.
- Source candidate `@covenant-org/timeline-mcp@0.0.0-alpha.1` adds a local stdio
  integration with separate model and operator roles.
- v0alpha1 and v0alpha2 remain compatibility formats for checkpoint replay,
  evidence identity, decisions, and effect receipts.

The kernel supports explicit axes and scenario contexts, points and proper
intervals, bounded integer constraints, historical knowledge cuts, typed
queries, contradictions, and proof receipts. It does not yet provide calendar
arithmetic, time-zone conversion, recurrence, dense time, or cross-axis
conversion.

## Evaluation evidence

The model-interface v1 evaluation completed 432 GPT-5.6 Sol requests across
bounded narrative memory, stateless full-context structured extraction, and
Timeline-backed state. Timeline returned 106/108 exact answers, compared with
65/108 for narrative memory and 107/108 for structured extraction. It did not
meet the preregistered requirement to beat both simpler baselines. The
[complete v1 result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-eval-v1-gpt-5.6-sol-2026-07-31)
contains the configuration, raw responses, scores, diagnostics, decision, and
checksums.

The v2 proposal-interface evaluation completed 108 observations. Every response
was schema-valid, but assertion F1 was 0.7692 and only 76 projected states were
exact. The model selected the relevant evidence but frequently collapsed lower,
upper, and range bounds into exact coordinates. That result does not support
automatic admission of free-form model output. The
[complete v2 result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-proposal-v2-attempt-1-2026-08-01)
is public.

[The first composed real-model pilot](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-1-2026-08-01)
then exercised the source-built MCP path across separate host and MCP processes.
It retained two model-call reservations, four explicit admission records, the
historical and corrected conclusions, and three receipts that reproduced in a
credential-free verifier. The run stages public historical evidence and is
maintainer-operated; it is not independent adoption or a live delayed-evidence
observation.

## Product boundary

Timeline provides:

- a language-neutral temporal contract, schemas, and canonicalization rules;
- deterministic projection at an explicit knowledge cut;
- a bounded temporal constraint kernel and proof verifier;
- JSON, CLI, library, and source-built MCP interfaces;
- conformance cases and compatibility tests; and
- reference adapters for models, runtimes, and legacy checkpoints.

Timeline does not establish natural-language truth, evidence authority,
causality, domain policy, medical judgment, financial authority, or safety
approval. The kernel does not schedule workflows, run workers, manage a
distributed database, or define ambient wall-clock, locale, calendar, and
time-zone policy. The source MCP integration provides a single-host local store;
it is not a distributed workflow-durability service.

Agent and workflow runtimes can integrate Timeline through adapters. Covenant
is an intended host integration, not a required service.

## Current priorities

- publish and independently verify the exact core and MCP package artifacts;
- support an external operator running Timeline in its own workflow;
- support a separately maintained implementation through the conformance
  corpus; and
- let observed integration needs determine any calendar, storage, or protocol
  expansion.

A future model-efficacy claim requires a new preregistration and held-out
evaluation. The existing v1 and v2 results remain fixed negative evidence for
their tested claims. Kernel changes must preserve identical semantic results
for pinned inputs, prevent later corrections from leaking into earlier
knowledge cuts, keep proof receipts verifiable from their bound inputs, and
retain evidence references on model-generated proposals.

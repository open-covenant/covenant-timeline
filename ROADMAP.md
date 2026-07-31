# Roadmap

Timeline provides deterministic temporal projection, replay, and proof
verification for long-running systems. Its preregistered model evaluation did
not support a standalone model-memory product. This roadmap now prioritizes
kernel adoption inside Covenant or independent systems, operational value, and
protocol portability.

Release history belongs in the [changelog](./CHANGELOG.md). This document
records the evidence required before the project can make broader claims.

## Available foundation

The `0.0.0-alpha.2` npm package includes:

- explicit metric and ordinal axes;
- isolated actual, planned, forecast, and hypothetical contexts;
- points, proper intervals, coordinates, bounded constraints, and temporal
  facts;
- correction, supersession, retraction, and historical knowledge cuts;
- consistency, difference-bounds, point-order, and interval-relation queries;
- deterministic conclusions with independently checkable proof receipts; and
- the v0alpha1 and v0alpha2 checkpoint formats as compatibility APIs.

The schemas, conformance corpus, CLI, reference kernel, correction-and-replay
example, model interface, and benchmark artifacts are public. They establish a
working substrate and include a formal negative model result; they do not
establish adoption.

The repository also provides deterministic model-proposal compilation with
exact source-span provenance, a request-scoped Structured Outputs schema, and
an atomic local MCP write path. The compiler reproduces the admitted state and
checked result for all 36 cuts in the public corpus. That establishes lowering
equivalence, not model extraction quality.

The
[model-proposal boundary benchmark](./benchmarks/model-proposal-boundary/v1/README.md)
runs that production interface as a rolling evaluation, preserves every
failure, and independently scores extraction, state, query, answer, and proof
outcomes. Its checked oracle proves benchmark representability; it is not a
model result.

## Evidence gates

### 1. Model result: standalone accuracy claim rejected

The checked-in proposal-boundary benchmark is the primary engineering suite for
model extraction. The lower-level
[model-interface benchmark v1](./benchmarks/model-interface/v1/README.md)
compares bounded narrative memory, stateless full-context structured
extraction, and rolling Timeline state. Direct full-context answering remains a
secondary diagnostic. Both suites use stateless adapters and strict replayable
artifacts.

The
[frontier-model preregistration](./benchmarks/model-interface/v1/PREREGISTRATION.md)
fixed one model and configuration, three repeats, a public paraphrase corpus
held out from prompt and schema development, three primary arms, failure
accounting, paired analysis, and a binary continue-or-kill rule before any
held-out inference.

The 2026-07-31 GPT-5.6 Sol run completed 324 primary observations and 108
teacher-forced observations without an operational error. Timeline met every
absolute threshold: 106/108 answers and end-to-end artifacts were exact,
assertion F1 was 0.9574, and all 108 proofs verified. It beat bounded narrative
memory, 106/108 versus 65/108 answers, but not stateless full-context structured
extraction, which scored 107/108. The paired Timeline difference against
structured extraction was -0.0093 with case-cluster `p = 0.875`.

The gate returned `kill`. The
[complete result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-eval-v1-gpt-5.6-sol-2026-07-31)
is bound to the evaluated source commit. Teacher forcing reached 108/108 answer
and end-to-end exactness, with 0.9787 assertion F1 across all cuts. Current-cut
extraction was strong, but rolling Timeline state produced no answer-accuracy
advantage over full-context structured extraction.

### 2. Low-friction agent integration

The separate local stdio MCP server keeps the portable kernel dependency-light
while giving MCP-capable agents durable temporal state through six explicit
tools:

1. create a run from an exact v0alpha3 contract;
2. list bounded run metadata after a new session;
3. append one structurally validated event under optimistic concurrency;
4. compile and atomically apply an evidence-backed model proposal against an
   exact run prefix;
5. project active state at an explicit knowledge cut; and
6. reason over an exact query and return a verified conclusion.

The server requires a data directory, retains only evidence digests, makes no
network calls, and classifies direct and compiled writes as structurally valid
but unauthenticated. Proposal evidence text is processed transiently and is not
written or returned. The server does not provide semantic memory search,
civil-time normalization, remote hosting, or evidence authority.

The source-first pilot creates a run, appends a correction, stops and restarts
the server, projects both historical and current state, exports the complete
artifact, and verifies both receipts in another process. Registry publication
is a distribution milestone; it does not block source pilots, model
evaluation, or independent implementation work.

### 3. Independent temporal pilot

One operator outside the project must run Timeline in a real long-running-agent
workflow. The run must cross a restart, include delayed or corrected evidence,
and contain a decision where explicit temporal state changes the result or
reduces reconciliation work.

The [pilot contract](./docs/temporal-pilot.md) requires a redacted export that
another process can replay and verify. A negative result is useful if it
identifies the wrong abstraction or shows that Timeline adds no operational
value. The checked-in MCP starter supplies the export and verification
mechanics so the operator can focus on its own evidence and workflow.

### 4. Protocol portability

The project is seeking a second implementer of
[Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md). The
[interoperability issue](https://github.com/open-covenant/covenant-timeline/issues/19)
defines a bounded starting point.

The gate requires an independently maintained implementation that agrees with
the reference implementation on semantic results for the shared corpus and
verifies its supported receipts. This is evidence that Timeline is a portable
contract rather than a TypeScript-specific format.

## Standalone expansion decision

The preregistered gate required a model result that beat both simpler
baselines. That requirement was not met, so the planned 90-day standalone
adoption window will not begin and no standalone beta is scheduled.

The package remains available under Apache-2.0 as a deterministic temporal
kernel and verifier. Work may continue where an integration needs its
auditability, replay, or portable proof contract. An external pilot or second
implementation can still establish operational value or portability, but it
cannot retroactively change the v1 model result.

Reconsidering a standalone model product requires a new, separately
preregistered hypothesis and benchmark. The v1 corpus, thresholds, and decision
will not be retuned or reinterpreted.

## Work justified by evidence

Follow-on work is driven by observed needs:

- Covenant and adopter integrations determine kernel ergonomics;
- integration friction determines MCP ergonomics and storage limits;
- pilot evidence determines calendar, civil-time, and operational features;
- interoperability failures determine specification and conformance changes;
  and
- real upgrade experience determines migration tooling.

No new protocol surface or governance layer is added until one of these needs
requires it. Any future beta proposal must define its product claim, evidence
gate, external pilot, interoperability requirement, and security and privacy
review before implementation begins.

# Roadmap

Timeline succeeds when independent teams use it to give long-running agents
verifiable temporal state. Work is ranked by the adoption risks that could
invalidate the product: model extraction, integration cost, operational value,
and protocol portability.

Release history belongs in the [changelog](./CHANGELOG.md). This document
defines the evidence required to keep expanding the standalone project.

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
example, model interface, and development benchmark are public. They establish
a working substrate, not adoption or model-quality evidence.

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

### 1. Model reliability

The checked-in proposal-boundary benchmark is the primary engineering suite for
model extraction. The lower-level
[model-interface benchmark v1](./benchmarks/model-interface/v1/README.md)
retains direct text, narrative memory, and raw Timeline authorship as research
diagnostics. Both use stateless adapters and strict replayable artifacts.

No external model result has been published. The visible corpus is too small
and too exposed to support a performance claim.

The next evidence step is a reproducible baseline on the proposal boundary.
Comparative claims against narrative memory or raw ledger authorship still
require the blinded suite below.

The model gate requires a preregistered blinded suite that:

- uses opaque case and entity identifiers;
- includes distractors and no-op cuts;
- evaluates controlled paraphrase families;
- spans rolling histories from 20 to 200 cuts;
- fixes context and memory budgets before corpus generation;
- reserves generation seeds and variants unavailable during adapter
  development;
- keeps model, decoding, retry, and structured-output settings identical
  across paired arms;
- counts malformed output, admission failures, and unsupported definite
  answers as failures; and
- reports case-clustered uncertainty rather than treating every cut as an
  independent observation.

The preregistration must fix the primary outcome, exclusions, stopping rule,
sample size, model configuration, and analysis before results are observed.
Published results must separate extraction, query, admission, kernel, proof,
and final-answer errors.

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

## Adoption review

The 90-day adoption window begins after a public release includes all of the
following:

- the installable temporal API;
- the correction-and-replay demo;
- the local MCP integration; and
- one published blinded model evaluation.

Standalone product expansion continues only if that window produces:

- one independent operator who completes the pilot or publishes an equivalent
  replayable integration; and
- qualified adoption signals from at least three independent teams, such as
  an integration, reproducible implementation feedback, or a conformance
  attempt.

Repository stars alone do not satisfy either criterion. If the threshold is
not met, the maintainers will publish the evidence and reassess standalone
expansion. The portable contract and verifier remain available under
Apache-2.0 regardless of that decision.

## Work justified by evidence

Follow-on work is driven by observed failures:

- extraction and query errors determine model-interface and repair work;
- integration friction determines MCP ergonomics and storage limits;
- pilot evidence determines calendar, civil-time, and operational features;
- interoperability failures determine specification and conformance changes;
  and
- real upgrade experience determines migration tooling.

No new protocol surface or governance layer is added until one of these gates
requires it. Beta requires a successful model evaluation, an external pilot, a
second conforming implementation, and security and privacy review of the
supported model, parsing, provenance, projection, and proof boundaries.

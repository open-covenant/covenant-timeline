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

## Evidence gates

### 1. Model reliability

The checked-in
[model-interface benchmark v1](./benchmarks/model-interface/v1/README.md) is a
12-case development and smoke suite. It exercises direct text, narrative
memory, and Timeline-backed state with a strict JSONL adapter protocol. The
repository also includes a stateless OpenAI Responses adapter.

No external model result has been published. The visible corpus is too small
and too exposed to support a performance claim.

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

The next integration surface is a separate local stdio package,
`@covenant-org/timeline-mcp`. It will keep the portable kernel package
dependency-light while giving MCP-capable agents durable temporal state through
five explicit tools:

1. create a run from an exact v0alpha3 contract;
2. list bounded run metadata after a new session;
3. append one structurally validated event under optimistic concurrency;
4. project active state at an explicit knowledge cut; and
5. reason over an exact query and return a verified conclusion.

The first alpha will require a data directory, retain only evidence digests,
make no network calls, and classify direct model writes as structurally valid
but unauthenticated. It will not provide semantic memory search, civil-time
normalization, remote hosting, or evidence authority.

This gate closes when a clean installed-package test can create a run, append a
correction, stop the server, restart it, project both historical and current
state, and obtain verified receipts over stdio on Node.js 22 and 24.

### 3. Independent temporal pilot

One operator outside the project must run Timeline in a real long-running-agent
workflow. The run must cross a restart, include delayed or corrected evidence,
and contain a decision where explicit temporal state changes the result or
reduces reconciliation work.

The [pilot contract](./docs/temporal-pilot.md) requires a redacted export that
another process can replay and verify. A negative result is useful if it
identifies the wrong abstraction or shows that Timeline adds no operational
value.

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

# Covenant Timeline Program

## Product decision

Covenant Timeline will be developed as a thin temporal-contract protocol with
an embeddable verifier.

It will not build a general durable workflow runtime. Existing runtimes and
databases may host timeline runs through adapters. Covenant is the first
reference adopter and provides the initial production use case.

The first product wedge is verifiable long-running software and agent work:

- declare checkpoints and evidence requirements;
- ingest audit, commit, CI, review, and delivery evidence;
- replay decisions under pinned policy;
- request bounded Covenant effects;
- prove which receipt resolved each request.

General scoring, financial authority, trading, prediction markets, and
multidisciplinary engineering are outside the first release.

## First-release surfaces

The project owns:

1. a language-neutral contract and event specification;
2. JSON Schemas and portable fixtures;
3. a deterministic embedded reducer and verifier;
4. a CLI and one software-work profile;
5. a Covenant adapter;
6. import and export guidance for external runtimes.

It does not own:

- job scheduling or worker orchestration;
- persistent queues, timers, leases, or retries;
- databases, object stores, or observability backends;
- domain-specific CI, review, or deployment policy;
- authority enforcement outside an adopter's adapter.

## Success criteria

### Useful pre-alpha

- A new contributor completes the local demo in fifteen minutes.
- A software contract can be replayed from evidence through decision and
  receipt.
- Invalid ordering, missing evidence, and unresolved commands produce stable
  findings.
- Covenant can translate its audit and provenance records into timeline events.

### Beta

- Covenant operates a real multi-checkpoint engineering run.
- One external project uses Timeline without Covenant.
- A second implementation agrees on the portable conformance corpus.
- Historical fixtures remain verifiable across an upgrade.
- Security review covers parsing, canonicalization, evidence identity, replay,
  and the command boundary.

### Stable release

- The contract and event formats have demonstrated interoperability.
- Compatibility policy is backed by migration tests.
- At least two organizations actively maintain implementations or adapters.
- Operators can explain every accepted decision from pinned policy and evidence.

Version 1 is adoption-gated, not date-gated.

## Delivery sequence

### Phase 1: useful core — weeks 0–8

- Replace the calendar-and-score demo with the contract reducer.
- Stabilize the minimal object vocabulary.
- Add a proper RFC 8785 implementation and byte-level fixtures.
- Build CLI commands for validate, replay, inspect, and verify.
- Implement the software-work profile.
- Translate Covenant audit and provenance records into portable evidence.
- Publish one end-to-end local tutorial.

Exit gate: the Covenant engineering example is useful without reading the
architecture documents.

### Phase 2: real integration — weeks 8–16

- Run a multi-release Covenant build through Timeline.
- Add storage interfaces without selecting a mandatory database.
- Add one adapter for an established durable execution system.
- Add correction, branching, and upgrade fixtures driven by adopter needs.
- Recruit one independent design partner.

Exit gate: a run survives interruption through its host runtime and remains
independently verifiable from exported records.

### Phase 3: external beta — months 4–9

- Publish stable TypeScript and one additional language binding.
- Complete cross-language canonicalization and reducer tests.
- Document compatibility and migrations from observed upgrades.
- Complete threat, privacy, and security reviews.
- Accept one non-software profile only if an external adopter maintains it.

Exit gate: an external organization can operate and upgrade Timeline without
Covenant services.

## Team shape

The narrow program is credible with two to three sustained contributors:

| Responsibility                                |                           Capacity |
| --------------------------------------------- | ---------------------------------: |
| Protocol and reference implementation         |                                1–2 |
| Covenant integration and developer experience |                                  1 |
| Security and independent review               | fractional, increasing before beta |

Additional domain profiles require their own maintainers and reviewers. Core
maintainers should not simulate expertise in finance, market structure,
accounting, or engineering certification.

## Adoption principles

- Solve one painful problem before generalizing.
- Keep the local path smaller than adopting a workflow platform.
- Make every exported record usable without Covenant.
- Reuse CloudEvents, W3C PROV, in-toto, and established canonicalization
  standards where they fit.
- Integrate with Temporal, Restate, DBOS, and similar systems instead of
  reimplementing their operational responsibilities.
- Treat examples and fixtures as stronger evidence than roadmap breadth.

Track:

- time to first verified run;
- real run duration and checkpoint count;
- unexplained or irreproducible decisions;
- upgrade success;
- external implementations and adopters;
- support burden.

Stars, package downloads, and profile count are secondary.

## Expansion gate

A new domain enters the public roadmap only when:

- an external adopter brings a concrete workflow;
- a named maintainer owns the profile;
- the domain does not require new core semantics;
- safety and privacy boundaries are reviewed;
- executable fixtures precede public capability claims.

Until those conditions exist, broader applications remain research notes
outside the core repository.

## Stop conditions

Pause expansion when:

- replay produces a different decision from pinned inputs;
- an adapter can execute an effect during replay;
- evidence cannot be traced to its producer and payload identity;
- a profile needs vendor-specific behavior in the core;
- a decision hides missing evidence or policy version;
- the core becomes harder to adopt than the runtime it integrates with.

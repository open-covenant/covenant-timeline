# Covenant Timeline Program

## Decision

Covenant Timeline will be developed as an independent open protocol and
reference implementation for temporal contracts.

It is not a Covenant feature with a public package around it. Covenant is the
first serious adopter and reference adapter. The portable project owns:

1. a language-neutral specification;
2. a public conformance suite;
3. a deterministic reference engine;
4. a durable reference runtime;
5. SDK and plugin contracts;
6. governed domain profiles and adapters.

The program is planned for twelve months with a dedicated team. Version 1 is
adoption-gated, not date-gated. If the interoperability, security, governance,
and pilot requirements are not met at the end of the schedule, the project
remains a release candidate.

## Mission

Make change across time a portable, executable, and independently verifiable
input.

A temporal contract declares:

- the subject and applicable environment;
- which clocks and conditions govern progress;
- required states, transitions, and checkpoints;
- which evidence can establish a claim;
- how evidence is evaluated;
- which decisions become eligible;
- which external effects may be requested;
- how runs are replayed, corrected, disputed, and forked.

The same kernel should be capable of representing:

- a multi-release software build;
- an agent capability probation or renewal period;
- a bounded financial delegation;
- a spot or perpetuals strategy moving from backtest to shadow operation;
- a prediction market from creation through disputed resolution;
- a multidisciplinary engineering simulation or staged certification process.

It should not embed the domain behavior of any of those systems.

## Hard constraints

### The kernel stays small

The portable reducer is:

```text
(pinned contract, prior state, accepted event)
    -> (next state, findings, decisions, commands)
```

Commands request effects. Adapters execute them and return receipts as later
events. Replay never executes effects.

Exchanges, ledgers, agent runtimes, CI systems, blockchains, policy engines,
oracles, and Covenant remain outside the normative kernel.

### Time is typed

There is no universal timestamp and no implicit global ordering.

The specification must distinguish at least:

- domain-effective time;
- source occurrence time;
- collector observation time;
- ledger record time;
- evaluation or decision time.

It must also model causality, uncertainty, lateness, correction, reversion, and
finality. Cross-clock comparison is invalid unless a contract declares the
mapping or arbiter.

### Evidence precedes interpretation

Evidence, evaluation, scorecard, decision, and authorization are different
objects.

A valid signature only proves that an identity signed particular bytes. It
does not prove that the claim is true. Source authority, collection method,
freshness, coverage, confidence, and applicability remain part of policy.

### No universal trust or credit score

The minimum scope of an agent scorecard is:

```text
subject × capability × environment × policy × time window
```

An optional aggregate cannot erase its dimensions, missing data, uncertainty,
evidence references, or policy version.

Operational credit means a bounded machine authority such as a budget, maximum
notional, leverage ceiling, collateral requirement, capability duration, or
review interval. Human consumer, employment, insurance, and housing credit
scoring are outside the project.

### Financial effects are not core behavior

The core never holds funds, places orders, chooses trades, or treats a score as
authority. Financial adapters must enforce:

- fixed-point or integer quantities with explicit units;
- double-entry accounting where value moves;
- idempotent authorization, execution, and settlement joins;
- pre-trade controls and post-trade reconciliation;
- stale-data and oracle-confidence rules;
- separated simulation, paper, shadow, capped-live, and production namespaces;
- expiring grants, revocation, monitoring, and kill conditions.

### Historical verification survives upgrades

A run pins exact versions and digests for its contract, schemas, calendars,
policies, evaluators, plugins, models, prompts, fixtures, and dependencies.
Accepted events are append-only. Corrections and changed interpretations are
new events.

## Product architecture

```text
                         Covenant Timeline

  ┌───────────────────────────────────────────────────────────────┐
  │ Specification                                                │
  │ clocks · state · events · evidence · policy · decisions      │
  └──────────────────────────────┬────────────────────────────────┘
                                 │
  ┌──────────────────────────────▼────────────────────────────────┐
  │ Deterministic kernel                                          │
  │ canonicalize · compile · reduce · evaluate · replay · verify │
  └──────────────────────────────┬────────────────────────────────┘
                                 │
  ┌──────────────────────────────▼────────────────────────────────┐
  │ Durable runtime                                               │
  │ ledger · timers · leases · retries · branches · projections  │
  └───────────────┬──────────────────────────────┬────────────────┘
                  │                              │
  ┌───────────────▼──────────────┐  ┌────────────▼───────────────┐
  │ Domain profiles             │  │ Plugin and adapter system   │
  │ software · agents · markets │  │ clocks · evidence · effects │
  └───────────────┬──────────────┘  └────────────┬───────────────┘
                  │                              │
  ┌───────────────▼──────────────────────────────▼────────────────┐
  │ Adopters                                                      │
  │ Covenant · independent runtimes · engineering and finance    │
  └───────────────────────────────────────────────────────────────┘
```

### Normative objects

| Object              | Responsibility                                           |
| ------------------- | -------------------------------------------------------- |
| Timeline definition | Immutable authoring form                                 |
| Compiled contract   | Canonical, content-addressed execution plan              |
| Run                 | One execution pinned to a contract and dependency set    |
| Observation         | Assertion about a clock or external state                |
| Event               | Accepted transition input                                |
| Evidence            | Content-addressed material supporting a claim            |
| Evaluation          | Deterministic derivation from a declared evidence set    |
| Scorecard           | Scoped, dimensional interpretation of evaluations        |
| Decision            | Eligibility, limit, duration, approval, or review output |
| Command             | Idempotent request for an external effect                |
| Receipt             | Evidence of attempted or completed effect execution      |
| Attestation         | Signed statement about a versioned object or root        |

### Required clock classes

- calendar and civil time;
- monotonic elapsed duration;
- logical and causal time;
- event time with watermarks and late-data policy;
- external protocol coordinates such as block, slot, oracle round, venue
  sequence, build, release, or settlement batch;
- simulation and virtual time;
- composite predicates over multiple clocks.

Each clock declares its coordinate schema, epoch, resolution, authority,
ordering, uncertainty, finality, and calendar or time-zone data version.

### Run semantics

The runtime must support:

- hierarchical states and parallel regions;
- waits, timeouts, retries, compensation, cancellation, and suspension;
- immutable workflow version per run;
- explicit migrations;
- optimistic concurrency per run stream;
- at-least-once command delivery with idempotency keys;
- durable timers as clock subscriptions;
- replay from genesis or a verified snapshot;
- branching from any accepted event;
- permanently visible observed and counterfactual lineage;
- deterministic virtual-clock execution.

The authoritative event ledger is append-only. Materialized views, indexes,
dashboards, and snapshots are replaceable projections.

### Interoperability choices

The initial technical direction is:

| Concern                   | Direction                                      |
| ------------------------- | ---------------------------------------------- |
| Normative schemas         | JSON Schema 2020-12                            |
| Canonical identity        | I-JSON constraints and RFC 8785 JCS            |
| Optional compact encoding | Deterministic CBOR                             |
| Event interchange         | CloudEvents mapping                            |
| Provenance interchange    | W3C PROV mapping                               |
| Attestations              | in-toto Statement predicates in DSSE envelopes |
| Artifact distribution     | OCI artifacts by digest                        |
| Telemetry                 | OpenTelemetry                                  |
| Deterministic guards      | CEL profile                                    |
| General policy            | OPA and Cedar adapters                         |
| Plugin ABI                | WebAssembly Components with WIT                |
| Canonical engine          | Rust                                           |
| Local runtime             | SQLite                                         |
| Team runtime              | PostgreSQL and object storage                  |
| SDKs                      | Rust, TypeScript/WASM, Python                  |

These are subject to RFCs and conformance prototypes. They are not dependencies
that every adopter must operate.

## Domain profiles

Profiles add vocabulary, evidence schemas, policies, and fixtures without
changing core semantics.

| Profile                 | Clock and lifecycle                             | Evidence                                                                        | Decisions                                             |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Software evolution      | commit, build, release, incident, calendar      | source tree, tests, coverage, security, maintainability, architecture, delivery | accept release, require repair, pause, review         |
| Agent capability        | task, delivery, review, expiry, incident        | tool calls, approvals, outcomes, cost, policy, disputes, repairs                | capability, budget, TTL, monitoring, approval         |
| Spot trading operations | venue event, session, order, fill, settlement   | market data, orders, fills, slippage, PnL, limits, reconciliation               | allowlist, notional, order rate, pause                |
| Perpetuals operations   | oracle, funding, position, margin, liquidation  | prices, confidence, funding, exposure, collateral, liquidation distance         | leverage, margin, exposure, kill condition            |
| Prediction markets      | open, trade, close, resolve, dispute, finalize  | market rules, oracle claims, disputes, rulings, settlement                      | participation, exposure, finality, payout eligibility |
| Engineering simulation  | simulation, scenario, model step, certification | model package, inputs, seed, traces, tolerances, validation                     | advance stage, repeat, certify, reject                |
| Partnership delivery    | milestone, acceptance, correction, settlement   | deliverables, service levels, approval, invoices, receipts                      | accept, pay, repair, renew                            |

The detailed boundary and rollout rules live in
[Domain profiles](./docs/domain-profiles.md).

## Program organization

### Sustained team

A credible twelve-month effort needs five to seven sustained contributors:

| Responsibility                          | Typical capacity |
| --------------------------------------- | ---------------- |
| Protocol and architecture               | 1–2              |
| Rust kernel and runtime                 | 2                |
| SDKs, plugins, and developer experience | 1                |
| Security and release engineering        | 1                |
| Documentation, governance, and adoption | 1                |

Domain reviewers and pilot implementers are additional. Market structure,
financial risk, accounting, security, privacy, and model-governance decisions
require named reviewers who can reject unsafe designs.

With one or two engineers, the realistic schedule is eighteen to twenty-four
months or a v1 limited to the core and software-evolution profile.

### Workstreams

#### A. Specification and formal semantics

- terminology and object model;
- clocks, ordering, bitemporal history, and finality;
- state machine, command, receipt, retry, and replay semantics;
- canonicalization, hashing, identifiers, and error taxonomy;
- compatibility, extension, and migration rules;
- reference state-machine model and property catalogue.

#### B. Kernel and runtime

- Rust compiler, reducer, evaluator, replay, and verifier;
- virtual clocks and fixed-point arithmetic;
- event ledger, snapshots, and bitemporal projections;
- SQLite and PostgreSQL stores;
- timers, leases, transactional outbox, retries, and compensation;
- CLI, server, worker, and operational APIs.

#### C. Evidence, policy, and trust

- evidence manifests and set roots;
- provenance and attestation mappings;
- source authority, freshness, confidence, missingness, and finality;
- evaluator and policy packaging;
- scorecards and bounded-authority decisions;
- disputes, correction, revocation, expiry, and redaction.

#### D. SDK and extension ecosystem

- Rust embedding API;
- TypeScript/WASM and Python bindings;
- WIT plugin interfaces and sandboxed host;
- plugin manifests, capabilities, resource limits, and lifecycle;
- adapter SDK, fixtures, certification harness, and registry;
- HTTP, CloudEvents, OpenTelemetry, MCP, and webhook surfaces.

#### E. Domain profiles and pilots

- software evolution;
- agent capability and financial delegation;
- trading operations;
- prediction-market lifecycle;
- engineering simulation;
- Covenant reference integration.

#### F. Security, releases, and governance

- threat and privacy models;
- fuzzing, model checking, adversarial and chaos testing;
- reproducible, signed, SBOM-equipped releases;
- vulnerability intake and response;
- RFC, maintainer, compatibility, and trademark governance;
- independent security review and conformance registry.

Workstreams overlap, but semantic dependency is strict. Profiles may prototype
early to test the model; they cannot freeze core behavior before the
specification and conformance tests define it.

## Twelve-month execution plan

### Weeks 0–4: independence and charter

Deliver:

- standalone Apache-2.0 monorepo with history-preserving extraction;
- dependency gate forbidding Covenant imports in the core;
- charter, governance, security, release, compatibility, and RFC policies;
- threat model and privacy model;
- normative vocabulary and object inventory;
- reference scenarios for software, agent delegation, trading shadow mode,
  prediction-market resolution, and engineering simulation;
- domain advisory group and independent implementation outreach.

Exit gate:

- fresh clone builds without Covenant;
- Covenant consumes a pinned preview package;
- public claims describe only implemented behavior;
- v0 design RFCs, threat model, and non-goals are published;
- at least two prospective independent implementers have reviewed the core
  boundary.

### Weeks 3–10: specification alpha

Deliver:

- Core v0 prose specification;
- clock and coordinate algebra;
- compiled intermediate representation;
- schemas for events, evidence, evaluations, scorecards, decisions, commands,
  receipts, branches, and attestations;
- canonical serialization and hash construction;
- fixed-point quantity and unit rules;
- state-machine and error taxonomy;
- correction, dispute, reversion, migration, and extension rules;
- positive, negative, boundary, and adversarial conformance corpus.

Exit gate:

- each normative requirement is linked to a conformance case or is explicitly
  classified as non-mechanical;
- equivalent inputs produce byte-identical canonical outputs;
- at least two implementation oracles agree on the fixture set;
- adversarial fixtures cover clocks, duplicates, corrections, missing
  evidence, policy substitution, overflow, rounding, and unknown extensions.

### Weeks 7–18: deterministic kernel and SDK alpha

Deliver:

- pure Rust compiler, reducer, evaluator, replay, and verifier;
- deterministic virtual clocks;
- fixed decimal or rational arithmetic;
- property tests, fuzzing, and model checking for lifecycle invariants;
- local CLI and embedded SQLite runner;
- TypeScript/WASM and Python bindings;
- differential, cross-platform, locale, and time-zone CI;
- preview package and binary releases.

Exit gate:

- repeated replay is byte-identical across supported platforms;
- the core performs no implicit I/O;
- replay cannot issue effects;
- all SDKs pass the same conformance suite;
- historical objects verify under their pinned schema and policy versions;
- randomized crash tests preserve accepted state.

### Weeks 13–26: durable runtime and deployment

Deliver:

- PostgreSQL event store and bitemporal projections;
- content-addressed evidence storage;
- optimistic concurrency, leases, timers, retries, compensation, and
  transactional outbox;
- pause, resume, cancel, branch, import, and export;
- HTTP API, worker, and operator surfaces;
- OpenTelemetry signals and operational dashboards;
- local binary, Compose, Helm, backup, restore, and upgrade paths;
- compatibility prototypes for organizations already using Temporal, Restate,
  or DBOS.

Exit gate:

- thirty-day accelerated soak has no state corruption;
- crash injection produces no duplicate acknowledged effects;
- backup, restore, and two-version upgrade tests pass;
- a run survives process and host replacement;
- read-only replay performs no external effects;
- SLOs, capacity limits, and operator runbooks are published.

### Weeks 18–30: evidence and plugin ecosystem

Deliver:

- WIT interfaces for clocks, collectors, evaluators, policy engines, effectors,
  attesters, projections, identity resolvers, and simulators;
- sandboxed WebAssembly host for deterministic plugins;
- isolated-process contract for effectful executors;
- OCI distribution, in-toto predicates, DSSE signing, and provenance;
- adapter SDK and public plugin conformance harness;
- CEL profile and OPA/Cedar adapters;
- CloudEvents, OpenTelemetry, webhook, and signed-JSON adapters;
- public compatibility and conformance registry.

Exit gate:

- third-party collectors and evaluators written in different languages pass
  conformance;
- deterministic evaluators have no ambient network, clock, filesystem, or
  randomness;
- plugin capabilities and resource ceilings are enforced;
- every published artifact has source, license, SBOM, digest, provenance, and
  maintainer metadata.

### Weeks 19–34: profiles and pilots

Deliver:

- software-evolution profile and reproducible long-build dataset;
- agent-capability and bounded-financial-authority profile;
- trading replay, backtest, shadow, risk, and reconciliation profile;
- prediction-market resolution and finality profile;
- engineering simulation profile;
- generic Git, CI, issue, release, incident, market-data, execution-report,
  oracle, and model-package adapters;
- Covenant capability, budget, settlement, audit, provenance, and attestation
  adapter;
- pilot reports with explicit applicability and failure boundaries.

Exit gate:

- every profile runs an end-to-end eight-week pilot or accelerated equivalent;
- simulated and observed runs have distinct, verifiable identities;
- no profile can redefine core ordering, hashing, replay, or score semantics;
- financial pilots remain read-only or simulated until security and risk gates
  pass;
- Covenant runs against a pinned release;
- an independent system runs without Covenant.

### Weeks 27–40: beta hardening

Deliver:

- load, chaos, reorg, clock-skew, late-event, poison-event, and branch-explosion
  tests;
- adversarial score-gaming and evidence-poisoning program;
- privacy retention, encryption, redaction, and cryptographic-erasure design;
- signed releases, SPDX SBOMs, provenance attestations, and trusted publishing;
- reproducible build checks;
- compatibility, deprecation, and long-support policies;
- external security and cryptography assessment;
- public performance envelope and cost model.

Exit gate:

- no unresolved critical or high audit findings;
- release artifacts verify from source tag to registry;
- determinism, recovery, and resource budgets pass;
- upgrades from the prior two beta releases preserve verification;
- at least three independent organizations operate pilots;
- security findings and remediations are published at an appropriate level.

### Weeks 39–52: v1 interoperability and governance

Deliver:

- frozen Core v1 release candidate;
- two public release-candidate cycles;
- interoperability event and signed result publication;
- adopter reports and compatibility matrix;
- complete tutorials, how-to guides, reference, explanations, and operator
  runbooks;
- governance transition from bootstrap control when thresholds are met;
- stable SDK and plugin compatibility commitments.

Version 1 gate:

- two independently maintained conforming Core implementations;
- five production or production-like adopters across at least three
  organizations and three disciplines;
- Rust, TypeScript/WASM, and Python behavioral parity;
- three months of durable-runtime pilot operation;
- no unresolved critical or high external-review findings;
- signed, attested, SBOM-equipped releases;
- public governance with decision-makers from more than one organization.

If those conditions are not met, the project remains `1.0.0-rc`.

## Domain rollout gates

### Software evolution

1. Replay an existing multi-release repository history.
2. Run a synthetic build with seeded regressions.
3. Run a real long build in advisory mode.
4. Allow policies to pause or require review.
5. Permit bounded build actions through Covenant capabilities.

The final snapshot cannot hide failed intermediate checkpoints. Code volume is
never used as an exact target.

### Agent capability and financial delegation

1. Observe delivery and policy outcomes without scoring.
2. Publish scoped dimensional scorecards.
3. Validate score stability, gaming resistance, missingness, and correction.
4. Produce advisory budget recommendations.
5. Issue expiring, approval-gated sandbox capabilities.
6. Permit capped financial authority with continuous monitoring and revocation.

A score cannot directly grant authority.

### Trading operations

1. Historical replay with strict available-at-time data.
2. Deterministic backtest with costs and venue constraints.
3. Forward paper execution.
4. Read-only shadow of live markets and account state.
5. Capped capital with independent reconciliation and kill switch.
6. Policy-limited production after external review.

Promotion is a decision object with explicit evidence and approvals. It is not
an environment flag.

### Prediction markets

1. Replay complete market and resolution histories.
2. Model provisional, challenged, resolved, reverted, and final states.
3. Shadow live oracle and dispute events.
4. Apply bounded participation and exposure policies.
5. Permit settlement only after the declared finality policy is satisfied.

Market outcome, oracle claim, dispute ruling, and settlement finality remain
separate facts.

### Engineering simulation

1. Pin model packages, inputs, units, tolerances, and deterministic seed.
2. Run virtual-clock scenarios and branches.
3. Compare model and real-world evidence without conflating them.
4. Require independent validation at declared stage gates.
5. Attest to the complete scenario and evidence roots.

## Conformance program

Conformance is a public product with independently versioned profiles:

- `CORE`: canonicalization, compilation, evaluation, replay;
- `RUNTIME`: persistence, transitions, idempotency, recovery;
- `EVIDENCE`: envelopes, roots, signatures, corrections;
- `PLUGIN`: manifests, ABI, capabilities, and resource limits;
- `HTTP`: wire behavior and stable errors;
- one profile for each domain pack.

Every fixture records:

```text
spec version
profile and required capability
input bytes
normalized object
expected output bytes
expected digest or root
expected error
fixture provenance
```

The corpus must cover:

- leap years, time zones, calendar updates, and month boundaries;
- partial ordering and cross-clock mapping;
- duplicates, lateness, conflicts, corrections, revocations, and reorgs;
- policy and evaluator substitution;
- unavailable, sparse, and provisional evidence;
- cross-language differential behavior;
- integer overflow, unit conversion, and rounding;
- malicious plugins, oversized payloads, and signature confusion;
- crash, replay, and state-machine failures;
- all supported historical schema versions.

Public conformance results include exact implementation, spec, profile,
platform, suite commit, signed result, and expiry. Conformance establishes
protocol compatibility only. It does not establish security, policy quality,
regulatory compliance, trading safety, or profitability.

## Security and assurance program

The threat model includes:

- forged, replayed, poisoned, or authority-confused evidence;
- clock manipulation, stale data, reorgs, and disputed finality;
- nondeterministic replay after upgrades;
- duplicate effects and false exactly-once claims;
- policy, evaluator, model, prompt, or weight substitution;
- Goodhart effects and cherry-picked evaluation windows;
- malicious plugins and effectors;
- secret exfiltration and sensitive evidence disclosure;
- storage rollback, equivocation, and branch rewriting;
- maintainer, registry, signer, and release compromise;
- financial authority escalation and reconciliation failure.

Required assurance work:

- networkless deterministic kernel;
- capability-gated, isolated effectors;
- formal lifecycle invariants and property tests;
- fuzzing of parsers, canonicalization, reducers, and plugin boundaries;
- model checking of concurrency, idempotency, authorization, and settlement;
- signed policies, plugins, releases, and run roots;
- protected releases with short-lived publishing credentials;
- SBOM, provenance, reproducibility, dependency, secret, and license checks;
- private vulnerability intake and response targets;
- external security review before v1;
- separate privacy review for longitudinal and financial evidence.

Live financial authority requires an additional review of policy limits,
accounting invariants, venue behavior, oracle assumptions, failure modes,
incident response, and applicable law. Protocol conformance is not a substitute
for that review.

## Open-source operating model

### Repository

Start with one independent monorepo:

```text
covenant-timeline/
  spec/
  schemas/
  conformance/
  crates/
    timeline-types/
    timeline-canonical/
    timeline-compiler/
    timeline-evaluator/
    timeline-runtime/
    timeline-store/
    timeline-cli/
    timeline-server/
  sdk/
    rust/
    typescript/
    python/
  wit/
  profiles/
    software-evolution/
    agent-capability/
    trading-operations/
    prediction-market/
    engineering-simulation/
  adapters/
    reference/
    covenant/
  deploy/
  benchmarks/
  examples/
  docs/
  rfcs/
  security/
  tools/
```

Do not split repositories until interfaces and maintainership are stable.

### Governance

Bootstrap governance must be transparent about the initial sponsor. It should
define:

- contributor, reviewer, maintainer, security-responder, and steering roles;
- RFC and compatibility decision rules;
- conflict-of-interest and funding disclosure;
- release, vulnerability, trademark, and conformance-mark policies;
- transition to a technical steering committee after at least three active
  maintainers from two organizations;
- representation limits so one organization does not permanently control the
  project.

Do not claim project neutrality before independent governance exists.

### Versioning

Version independently:

- specification;
- wire schemas;
- engine;
- storage;
- HTTP API;
- plugin ABI;
- SDKs;
- adapters;
- domain profiles;
- conformance suite.

Major-zero releases are explicitly unstable. Stable readers must keep
verifying historical runs under their original versions. Deprecated fields
remain readable for a declared minimum window. Unknown semantic fields fail
except inside a defined extensions namespace.

### Releases

Each stable release manifest binds:

- source commit;
- all component versions;
- artifact and SBOM digests;
- build workflow identity and provenance;
- compatibility matrix;
- known issues and migrations.

Stable releases require a clean tree, complete conformance matrix, package dry
runs, reproducibility checks, two-person approval, signed checksums and
attestations, and documented rollback or yank behavior.

### Documentation

Documentation follows four modes:

- tutorials;
- task-oriented how-to guides;
- specification and API reference;
- design explanations.

Required material includes a fifteen-minute local quickstart, profile
tutorials, contract and policy authoring, plugin development, conformance
submission, deployment, backup, upgrades, incident response, governance, and
clear explanations of what conformance and scorecards do not mean.

### Adoption

Before beta, recruit design partners for:

- long-horizon software engineering;
- agent capability and bounded authority;
- a financial workflow in simulation or read-only shadow mode.

Track:

- time to first verified run;
- upgrade success and operator burden;
- independent implementations and contributions;
- profile and adapter maintainership;
- continuous pilot duration;
- support and incident load.

Repository stars, download counts, and adapter quantity are secondary.

## Benchmark program

Initial suites:

- deterministic output across architectures, locales, and time zones;
- compilation at 100, 10,000, and 1,000,000 checkpoints;
- evidence ingestion and root construction;
- replay and branching over long histories;
- runtime crash recovery and duplicate-delivery resistance;
- worker contention and storage recovery;
- plugin startup, memory, timeout, and capability enforcement;
- trading streams with duplicates, corrections, lateness, and reorgs;
- adversarial score-policy gaming and evidence poisoning.

Ratify numerical targets after collecting real adopter traces. Determinism,
historical verification, effect safety, and recovery are release gates.
Throughput is an optimization within those constraints.

## Program controls

### Critical path

```text
clock and state semantics
  -> canonicalization and conformance
  -> deterministic kernel
  -> durable effect boundary
  -> evidence and plugin trust
  -> domain pilots
  -> security and interoperability
  -> v1
```

Partner adapters, dashboards, and broad SDK work cannot compensate for an
unstable core.

### Decision process

Core semantics, public APIs, cryptography, score behavior, and financial
authority require an RFC with:

- problem and non-goals;
- alternatives;
- safety and privacy impact;
- compatibility classification;
- schema and fixture changes;
- migration and rollback;
- domain reviewer sign-off where applicable.

No semantic rule is stable until the reference engine and an independent
implementation pass its fixtures.

### Program metrics

Report monthly:

- normative requirements with conformance coverage;
- cross-implementation fixture agreement;
- historical versions still verifiable;
- replay and crash-test failures;
- duplicate or unreconciled effect attempts;
- open security findings by severity and age;
- SDK parity and adapter ownership;
- pilot duration, upgrade success, and operator incidents;
- independent maintainers and contributors;
- evidence-to-decision explainability coverage.

### Stop conditions

Pause expansion and repair the foundation when:

- a historical run cannot be verified after an upgrade;
- independent implementations disagree on canonical output;
- replay can cause an effect;
- a financial effect cannot be reconciled to one authorization and receipt;
- a profile needs to change core semantics for one vendor;
- a score cannot be decomposed to evidence and policy;
- security or privacy review finds an unresolved critical risk.

## First thirty days

1. Approve the independent-project charter and non-goals.
2. Create the standalone repository after explicit publishing authorization.
3. Extract this incubation package with history and make Covenant consume a
   pinned preview version.
4. Write RFCs for the object model, clock ontology, event ledger,
   canonicalization, effect boundary, evidence model, and plugin ABI.
5. Publish the threat and privacy models.
6. Build four executable reference scenarios before stabilizing schemas.
7. Recruit market-risk, accounting, security, and model-governance reviewers.
8. Recruit two independent implementation teams and three pilot organizations.
9. Build the first cross-language canonicalization oracle and adversarial
   fixture corpus.
10. Set a public weekly protocol review and monthly program review.

## Research basis

The design intentionally builds on established semantics instead of replacing
them:

- [Temporal workflow execution](https://docs.temporal.io/workflow-execution)
  for durable deterministic replay;
- [CloudEvents](https://github.com/cloudevents/spec) for event interchange;
- [Apache Flink event time and watermarks](https://nightlies.apache.org/flink/flink-docs-stable/docs/learn-flink/streaming_analytics/)
  for late and out-of-order event processing;
- [W3C PROV](https://www.w3.org/TR/prov-overview/) for provenance;
- [in-toto Statement](https://in-toto.io/Statement/v1) and
  [DSSE](https://github.com/secure-systems-lab/dsse) for attestations;
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) for canonical JSON;
- [OpenTelemetry](https://opentelemetry.io/docs/specs/otel/overview/) for
  observability;
- [WebAssembly WIT](https://github.com/WebAssembly/component-model/blob/main/design/mvp/WIT.md)
  for language-neutral plugin interfaces;
- [FIX standards](https://www.fixtrading.org/standards/) for trading
  interoperability;
- [FMI 3.0](https://fmi-standard.org/docs/3.0.2/) for engineering simulation;
- [SWE-CI](https://arxiv.org/abs/2603.03823) and
  [SWE-EVO](https://github.com/SWE-EVO/SWE-EVO) for long-horizon software
  evaluation;
- [TigerBeetle accounting invariants](https://docs.tigerbeetle.com/reference/account/)
  for immutable, balanced value movement.

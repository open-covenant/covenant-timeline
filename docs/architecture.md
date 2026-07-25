# Architecture

## Definition

Covenant Timeline is a portable engine for temporal contracts.

A temporal contract declares how a subject is expected to change across a
timeline, what evidence must exist at each checkpoint, how that evidence is
evaluated, and which outputs or actions become eligible.

The engine is not a scheduler with extra metadata and is not a scoring formula
wrapped around a Git log. Its stable abstraction is:

```text
contract + prior state + evidence -> deterministic next state + evaluations
```

Execution, observation, persistence, signing, and publication remain pluggable
boundaries.

## Design principles

1. **Portable core.** No dependency on Covenant, a chain, an LLM provider, or
   one workload type.
2. **Deterministic semantics.** The same contract, prior state, and evidence
   produce byte-equivalent decisions.
3. **Evidence before scores.** Aggregates always retain their source dimensions,
   policies, confidence, and evidence references.
4. **Clock neutrality.** Calendar dates are one clock type, not the universal
   representation of time.
5. **Replay by construction.** Every accepted transition can be reconstructed,
   compared, and forked.
6. **Policy is versioned data.** Evaluators and weights are named, hashed, and
   immutable within a run.
7. **Fail closed on authority.** The core can compute eligibility; privileged
   execution requires an external capability decision.
8. **No hidden LLM judgment.** Model reviews can contribute evidence, but never
   silently replace deterministic checks.
9. **Effects return as evidence.** The reducer emits commands; adapters execute
   them and return receipts as later events.
10. **Authorization is not scoring.** A scorecard can inform a decision but
    cannot grant authority.

## Vocabulary

| Primitive         | Meaning                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Timeline contract | Versioned declaration of clock, subject, checkpoints, policies, and outputs.                         |
| Subject           | The entity being planned or evaluated: repository, agent, capability, service, account, or workflow. |
| Clock             | Maps external or logical progress into ordered coordinates.                                          |
| Checkpoint        | A coordinate where requirements, observations, evaluations, or actions become due.                   |
| Transition        | State change between two accepted checkpoints.                                                       |
| Evidence          | Content-addressed observation about a subject at a coordinate.                                       |
| Evaluator         | Deterministic policy that transforms evidence into findings or dimensions.                           |
| Scorecard         | Versioned, explainable view over evaluation dimensions.                                              |
| Run               | One execution of a contract against a subject.                                                       |
| Branch            | A run forked from an existing checkpoint with an explicit divergence.                                |
| Attestation       | Signed commitment to a contract, checkpoint, evidence set, evaluation, or run root.                  |

## Clock model

The current prototype only supports ISO dates and calendar cadence. The stable
model must support multiple clock families through a common ordered coordinate.

### Calendar clock

Coordinates are timestamps or civil dates. Cadence can be fixed-duration or
calendar-aware.

Examples:

- monthly product increments;
- quarterly provider reviews;
- capability expiry and renewal;
- service-level delivery windows.

### Logical clock

Coordinates are monotonic steps independent of wall time.

Examples:

- release 1 through release 20;
- iteration 0 through iteration 500;
- benchmark stage or milestone index;
- governance proposal phases.

### External clock

Coordinates are provided by another protocol.

Examples:

- Solana slot or epoch;
- EVM block number;
- settlement batch sequence;
- CI build number;
- signed partner event sequence.

### Event clock

Progress occurs when a predicate over evidence becomes true.

Examples:

- advance after five accepted deliveries;
- review after a regression or missed SLA;
- unlock after an attestation and settlement receipt both exist;
- downgrade a capability after repeated policy failures.

### Simulation clock

Coordinates advance under a pinned virtual-clock policy.

Examples:

- deterministic backtests;
- engineering model steps;
- accelerated long-build evaluation;
- counterfactual failure and recovery scenarios.

### Market clock

Coordinates are native venue, oracle, funding, risk, or market-lifecycle
events.

Examples:

- market-data and execution sequences;
- order, fill, cancel, and settlement states;
- oracle observation, publication, and finality;
- funding, margin, liquidation, and reconciliation;
- prediction-market open, close, determination, dispute, and resolution.

All coordinates need:

- a clock type and version;
- a canonical encoded value;
- total ordering rules within one clock domain;
- an optional mapping to observed wall time;
- an explicit source of authority.

Cross-clock comparison is forbidden unless a contract declares a mapping.

Every accepted observation distinguishes:

- when the source says it occurred;
- when it became effective in the domain;
- when a collector observed it;
- when the ledger recorded it;
- when a policy evaluated it;
- causal parents and source sequence;
- uncertainty and finality;
- correction, supersession, or reversion.

This is bitemporal at minimum: what was considered true in the domain and when
the system learned it. A backtest cannot use evidence observed after the
simulated decision coordinate.

## Contract model

The versioned contract schema will contain:

```yaml
schema: covenant.timeline.contract.v1
id: example
subject:
  kind: repository
  ref: example/project
clock:
  kind: calendar
  start: 2026-01-01
  end: 2027-12-31
  cadence: monthly
objectives: []
checkpoints: []
policies: []
evaluators: []
outputs: []
```

The schema distinguishes:

- objectives from numeric growth targets;
- requirements from implementation instructions;
- hard gates from scoring dimensions;
- evidence requests from evidence values;
- scheduled checkpoints from event-triggered checkpoints;
- eligibility decisions from side effects.

Exact code-volume targets are not a default objective. They reward padding.
Capability delivery, maximum budgets, expected ranges, regression limits, and
maintainability constraints are safer defaults.

## Compiler

The compiler is pure and deterministic. It:

1. validates the contract and referenced schemas;
2. normalizes clocks and checkpoint coordinates;
3. expands cadence into explicit checkpoints;
4. merges scheduled and conditional checkpoint definitions;
5. resolves policy and evaluator versions;
6. emits a canonical plan plus its content hash.

Compilation performs no network calls and reads no implicit environment state.

## Runtime

The runner consumes a compiled plan. It owns orchestration but not domain
judgment.

The runner applies a deterministic reducer:

```text
(pinned contract, prior state, accepted event)
    -> (next state, findings, decisions, commands)
```

Commands are requests for external effects. Adapters execute them and return
receipts as new events. Replay never executes commands.

Checkpoint states:

```text
pending -> eligible -> running -> observed -> evaluated -> accepted
                      │             │             │
                      └-> failed    └-> disputed  └-> rejected
```

Required properties:

- idempotent checkpoint execution;
- bounded retries with recorded reasons;
- pause, resume, and cancellation;
- capability checks before external effects;
- explicit budgets and timeouts;
- lease-based ownership for concurrent workers;
- deterministic re-evaluation from stored evidence;
- no silent mutation of prior accepted checkpoints.

Executors are adapters. Initial targets:

- shell and CI;
- coding-agent harnesses;
- HTTP and MCP tools;
- Covenant daemon intents;
- partner-specific APIs.

## Event ledger

The accepted event ledger is authoritative. Snapshots, indexes, dashboards, and
materialized views are disposable projections.

Each event records:

```text
digest
run and stream identity
stream sequence and expected prior version
event type and schema
contract digest
causation, correlation, and causal parents
clock observations
payload digest or inline payload
actor and collector
recorded logical time
signature state
```

Corrections, reorgs, revocations, redactions, and changed interpretations append
events. They do not rewrite prior events. Large or sensitive evidence remains
outside the ledger; the ledger retains its digest, metadata, access class, and
retention state.

## Evidence

Evidence is append-only and content-addressed. A canonical envelope contains:

```text
schema
subject
coordinate
observed_at
source
payload_hash
payload_location
producer
signature
provenance
```

Payloads may include:

- test and coverage reports;
- static-analysis findings;
- Git tree and commit identities;
- change, churn, complexity, and maintainability metrics;
- signed delivery receipts;
- Covenant audit and provenance roots;
- settlement receipts;
- capability grants and policy outcomes;
- provider health and latency observations;
- chain attestations.

An evidence source declares freshness, authority, and confidence. Missing
evidence remains missing; it is never coerced into a zero score unless the
active policy explicitly says so.

## Evaluation and scorecards

Evaluators consume evidence and emit typed findings:

```text
dimension
value
unit
confidence
policy
evidence_refs
explanation
```

Scorecards preserve this vector. An aggregate is optional and always records:

- dimension weights;
- normalization functions;
- policy version and hash;
- time window;
- missing-data behavior;
- confidence calculation;
- all contributing evidence.

### Software evolution

Example dimensions:

- functional correctness;
- regression resistance;
- maintainability and complexity;
- test quality and coverage;
- security and static-analysis health;
- delivery efficiency;
- architecture review.

Snapshot scores and trajectory scores are separate. Trajectory evaluation may
include regression penalties, volatility, recovery time, and sustained
improvement, but each term must be independently inspectable.

### Agent capability and trust

A universal agent trust score is not supported. Scorecards are scoped:

```text
subject + capability + environment + policy + time window
```

Example dimensions:

- delivery acceptance rate;
- evidence completeness;
- policy compliance;
- deadline reliability;
- cost and budget adherence;
- dispute and repair history;
- attestation strength;
- recency and sample size.

One agent can be highly trusted for a scoped capability and unevaluated for
another. Aggregation across unrelated capabilities requires an explicit policy.

### Credit

Agent or service credit is an operational limit derived from a scoped
scorecard, not a human consumer-credit product. A credit policy can translate
evidence into:

- budget capacity;
- payment or settlement limits;
- stake or collateral requirements;
- maximum delegated authority;
- review frequency;
- capability duration.

The decision, scorecard, and policy hash remain linked so credit changes are
explainable and reversible.

### Financial operations

Financial hard controls are independent from scorecards. A score cannot
override:

- venue, account, chain, instrument, asset, and action allowlists;
- per-action and rolling notional;
- exposure, inventory, concentration, leverage, margin, and loss limits;
- price, slippage, liquidity, oracle, and stale-data gates;
- expiry, replay protection, revocation, and human approval;
- pause, reduce-only, and emergency kill behavior.

Value uses fixed-point integers or normalized decimal strings with explicit
units. Financial adapters own double-entry accounting, pre-trade checks,
post-trade reconciliation, venue formulas, oracle rules, and custody. The core
never holds funds or places orders.

Simulation, historical replay, paper, shadow, capped-live, and production runs
have distinct identities and attestations. Promotion between them is a
versioned policy decision, not an environment flag.

See [Financial safety and market operations](./financial-safety.md).

## Replay and branching

Each accepted checkpoint commits to:

- parent checkpoint;
- contract and plan hashes;
- subject state hash;
- evidence-set root;
- evaluation-set root;
- output decisions.

A branch names its parent and divergence:

- changed requirements;
- different executor;
- alternative policy;
- modified evidence;
- simulated clock.

Replay can verify past results without external effects. Re-execution is
separate and must declare which effects may run again.

## Storage

The first durable store should be SQLite plus portable JSON/JSONL exports.
PostgreSQL and object storage are later adapters.

Storage needs:

- schema migrations;
- transactionally accepted checkpoints;
- content-addressed evidence references;
- append-only transition history;
- Merkle or hash-chain roots for exported runs;
- deterministic export and import;
- retention without breaking committed roots.

## Public surfaces

The standalone project should ship:

- a language-neutral JSON Schema specification;
- canonical conformance fixtures;
- a Rust core and CLI;
- a TypeScript SDK and WASM build;
- a Python metrics adapter;
- a local daemon or worker for long-running runs;
- an HTTP API and MCP tools;
- a read-only timeline and scorecard UI.

The specification and fixtures are authoritative. Implementations must pass the
same conformance suite.

## Adapter boundary

Adapters implement narrow interfaces:

```text
ClockAdapter
Executor
EvidenceCollector
Evaluator
Store
Attestor
Publisher
```

Adapters cannot redefine core ordering, hashing, or policy semantics.

Initial adapter families:

- Git and PyDriller metrics;
- CI, coverage, lint, type-check, dependency, and security reports;
- OpenHands, SWE-agent, and other coding-agent harnesses;
- Covenant audit, provenance, capability, budget, and settlement;
- x402 delivery and payment receipts;
- Metaplex and ERC-8004 attestations;
- MagicBlock provenance roots and enclave verification;
- provider-directory health and telemetry.
- market-data, execution, account, and risk sources;
- oracle, chain, settlement, and prediction-resolution sources;
- financial authority enforcement and independent reconciliation;
- engineering model and simulation packages.

## Covenant integration

Covenant consumes the portable engine through a dedicated adapter:

```text
Covenant intent / workflow
        │
        ▼
Timeline contract + run
        │
        ├─ capability checks
        ├─ budget and settlement
        ├─ audit and provenance
        ├─ memory and handoff
        └─ optional attestations
```

Covenant-specific responsibilities:

- authorize executors and evidence collectors;
- meter resources and apply budgets;
- record privileged actions;
- persist resumable ownership and handoff;
- sign run roots and scorecards;
- publish selected attestations.

Covenant Timeline remains usable without any of them.

## Existing integration opportunities

The current Covenant repository already exposes evidence sources that fit this
model:

- x402 paid-call receipts and provider reputation;
- Hyre delivery, cost, and budget outcomes;
- MagicBlock provenance roots, validator health, and enclave attestations;
- Metaplex identity and audit-root attestations;
- zauth endpoint health and settlement-backed provider telemetry.

These are adapter candidates, not claims about partnership commitments or
delivery schedules.

## Security and integrity

The threat model includes:

- forged or replayed evidence;
- clock manipulation;
- evaluator or weight substitution;
- hidden missing-data defaults;
- score gaming and metric Goodharting;
- duplicate checkpoint execution;
- malicious executors;
- compromised partner telemetry;
- privacy leakage through public scorecards;
- re-executed financial or external side effects during replay.

Required controls:

- canonical serialization and content hashes;
- signed evidence where authority matters;
- nonce and sequence validation;
- policy and evaluator pinning;
- sandboxed executors;
- capability checks and least authority;
- explicit missing-data semantics;
- provenance-preserving redaction;
- separation of replay from effectful re-execution;
- auditability of every aggregate score.

## Target repository

The project should move into a standalone repository:

```text
covenant-timeline/
  spec/
  conformance/
  crates/
    timeline-core/
    timeline-cli/
    timeline-store/
  packages/
    sdk/
  python/
    timeline-metrics/
  adapters/
  examples/
  docs/
```

The current TypeScript package becomes the SDK prototype. It should not remain
the canonical core once the specification and Rust engine exist.

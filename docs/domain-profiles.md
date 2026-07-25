# Domain Profiles

## Purpose

Domain profiles make Covenant Timeline useful in a discipline without changing
the temporal kernel. A profile may define:

- domain vocabulary and schemas;
- clock authorities and finality rules;
- evidence types and collection requirements;
- evaluators and scorecard dimensions;
- policy packs and decision types;
- conformance and adversarial fixtures;
- adapter interfaces and rollout gates.

A profile cannot redefine canonicalization, event ordering, replay, branching,
effect safety, or the distinction between evidence, score, decision, and
authority.

## Shared contract

Every profile declares:

```text
scope
applicability
subject identity
environment identity
clock authorities
units and quantity rules
evidence authority
finality and correction policy
evaluation windows
missing-data behavior
decision and expiry policy
effect boundary
known limitations
```

Simulation, counterfactual, shadow, and observed runs have different
attestation types. One cannot be relabeled as another.

## Software evolution

### Subject

A repository, component, service, dependency graph, or release train pinned to
source and toolchain identities.

### Clocks

- commit and merge sequence;
- CI build sequence;
- release and milestone sequence;
- incident lifecycle;
- calendar and service-level windows.

### Evidence

- source tree and dependency locks;
- requirements and acceptance records;
- tests, coverage, type checks, lint, static analysis, and security reports;
- churn, complexity, maintainability, and process metrics;
- architecture decisions and review outcomes;
- incidents, regressions, repair time, and rollback;
- build and release provenance.

### Evaluation

Snapshot and trajectory evaluation remain separate. Dimensions may include:

- functional correctness;
- regression resistance;
- maintainability;
- test quality;
- security health;
- architecture integrity;
- delivery reliability;
- recovery behavior.

An aggregate cannot hide a failed checkpoint. Exact code-volume targets are
prohibited as a default quality objective because they reward padding.

### Decisions

- accept or reject a checkpoint;
- require repair or review;
- pause progression;
- change monitoring frequency;
- permit a bounded build or release action through an external capability.

## Agent capability

### Subject

An agent identity performing a named capability in a defined environment under
a versioned tool, model, and policy configuration.

### Clocks

- task and delivery sequence;
- approval and delegation lifecycle;
- capability issue, renewal, and expiry;
- incident, dispute, repair, and review sequence;
- calendar lookback windows.

### Evidence

- accepted and rejected deliveries;
- tool calls and approvals;
- policy outcomes;
- cost, budget, and resource use;
- deadlines and service levels;
- disputes, reversals, repairs, and incidents;
- human or independent review;
- attestation and provenance strength.

### Scorecards

Every scorecard is scoped:

```text
agent × capability × environment × policy × time window
```

It retains sample size, coverage, missingness, uncertainty, calibration,
recency, evidence references, evaluator version, and applicability limits.

The project does not produce a permanent global agent rank.

### Bounded financial authority

A financial decision combines a scoped scorecard with current exposure,
collateral, policy, approvals, and state:

```text
scorecard + exposure + collateral + policy + state
  -> eligibility + limit + TTL + monitoring + kill conditions
```

Possible outputs:

- spending budget;
- settlement ceiling;
- maximum order notional;
- leverage ceiling;
- required stake or collateral;
- approval threshold;
- capability duration;
- review frequency.

A score never grants authority by itself. Grants expire, can be revoked, and
must be continuously reconciled.

## Trading operations

Trading support evaluates and governs an operational process. It does not
predict markets or certify profitability.

### Shared clocks

- market-data event and venue sequence;
- order, acknowledgement, fill, correction, and cancel sequence;
- session and calendar;
- account ledger and settlement;
- chain block, slot, or finality when applicable;
- oracle round and confidence;
- evaluation and risk-review windows.

Occurred, observed, available, recorded, and evaluated time remain distinct.
Backtests may only use information available at the simulated decision time.

### Shared evidence

- raw market data and source sequence;
- strategy and configuration digest;
- order intents, approvals, acknowledgements, fills, corrections, and rejects;
- fees, slippage, latency, and venue health;
- positions, cash, collateral, exposure, and realized or unrealized PnL;
- risk-limit checks and kill-switch events;
- independent account and venue reconciliation;
- deployment, incident, and rollback records.

### Spot

Spot-specific policy includes:

- asset and venue allowlists;
- cash and inventory limits;
- order type and rate limits;
- price collars and stale-book rules;
- settlement and custody boundaries;
- concentration and liquidity limits.

### Perpetuals

Perpetuals-specific evidence and policy includes:

- oracle price, source, confidence, and staleness;
- mark and index price construction;
- funding intervals and payments;
- position, maintenance margin, liquidation distance, and open interest;
- leverage, concentration, basis, and correlation limits;
- liquidation, deleveraging, insurance, and venue-failure events.

A favorable historical score cannot override current margin, stale-oracle, or
kill-switch rules.

### Rollout

```text
historical replay
  -> deterministic backtest
  -> forward paper
  -> read-only live shadow
  -> capped capital
  -> policy-limited production
```

Promotion requires evidence, a versioned decision, independent approval, and a
rollback path. Production and simulation stores, credentials, identities, and
attestations are separated.

## Prediction markets

### Subject

A market, position, strategy, oracle claim, resolution process, or settlement
process.

### Lifecycle

```text
draft -> open -> suspended/closed -> provisional resolution
      -> challenge/dispute -> final resolution -> settlement
```

Cancellation, invalid-market, supersession, and reversion are explicit states.

### Evidence

- market rules and outcome schema;
- trading and liquidity events;
- oracle request, response, source, and timestamp;
- challenge and dispute materials;
- ruling and appeal records;
- finality and settlement receipts.

### Decisions

- market or outcome eligibility;
- participation and exposure limit;
- resolution confidence and review requirement;
- payout eligibility after declared finality;
- pause or reversal on dispute or reorg.

An oracle claim, a dispute ruling, a final market outcome, and a completed
settlement are separate objects.

## Multidisciplinary engineering

### Subject

A system, component, model, experiment, manufacturing stage, certification
case, or operational process.

### Clocks

- simulation and model step;
- experiment and measurement sequence;
- design revision and stage gate;
- manufacturing or test cycle;
- calendar and maintenance windows;
- external certification lifecycle.

### Evidence

- model package and dependency digest;
- units, parameters, inputs, tolerances, and deterministic seed;
- simulation and real-world traces;
- calibration and validation records;
- test equipment and collector identity;
- deviations, failures, repairs, and independent reviews.

### Decisions

- advance, repeat, pause, or reject a stage;
- require independent verification;
- update a bounded operating envelope;
- certify only the declared scenario and evidence set.

The same compiled contract and reducer should run simulation and production.
Their inputs and attestations remain explicitly distinct.

## Partnership delivery

### Subject

A versioned integration commitment, milestone, service, or delivery stream.

### Evidence

- accepted scope and change records;
- deliverables and acceptance tests;
- service levels, incidents, and repairs;
- cost, invoice, approval, and settlement receipts;
- provider health and signed provenance.

### Decisions

- accept, reject, or request correction;
- release a bounded payment;
- renew or reduce capability;
- change review frequency;
- suspend after missed obligations.

Partner-specific APIs remain adapters. No partner can redefine score or clock
semantics in the core.

## Cross-profile composition

Contracts may compose profiles without merging their scorecards.

Example:

```text
software release evidence
  -> agent delivery scorecard
  -> bounded deployment capability
  -> trading shadow run
  -> risk review
  -> capped-live decision
```

Each arrow is a versioned policy decision with its own evidence and scope.
Failures and uncertainty propagate according to declared policy. A score from
one profile is evidence to another policy, not universal authority.

## Profile maturity

Profiles move through:

```text
proposal -> incubating -> preview -> stable
         -> maintenance -> deprecated -> archived
```

A stable profile requires:

- accepted scope and applicability statement;
- named maintainers and domain reviewers;
- complete positive, negative, and adversarial fixtures;
- at least two independent implementations or adapters;
- reproducible reference datasets;
- security and privacy review;
- documented failure and non-goal boundaries;
- a migration and deprecation policy.

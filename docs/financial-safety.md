# Financial Safety and Market Operations

## Boundary

Covenant Timeline can collect financial evidence, evaluate operational
performance, recommend bounded authority, and verify whether a declared
financial process was followed.

It does not:

- predict markets;
- certify profitability or solvency;
- hold funds or private keys;
- place orders from the deterministic core;
- infer legal eligibility;
- claim regulatory compliance;
- turn reputation into automatic financial authority.

Rules and standards referenced here are design inputs. Applicability depends on
the entity, activity, venue, product, user, and jurisdiction and requires
qualified review.

## Financial event model

Every market or financial event records:

```text
event_id
stream_id
source
source_version
source_sequence
occurred_at
observed_at
ingested_at
effective_at
recorded_at
monotonic_time
block_or_slot
finality
schema_version
payload_hash
signature_or_proof
causal_parents
correction_of
environment
```

Required clock domains include:

- wall and local monotonic time;
- venue market-data and execution sequence;
- exchange session;
- oracle observation, aggregation, publication, and acceptance;
- block, slot, confirmation, finalization, and reorg;
- funding sample, accrual, and payment;
- position, balance, collateral, margin, and limit mutation;
- market open, close, determination, dispute, amendment, and finalization;
- mandate issue, activation, review, expiry, and revocation;
- when evidence was true and when the system knew it.

Decision-time knowledge is a release invariant. A replay or backtest cannot use
evidence that was not available at the simulated decision coordinate.

## Hard policy and score separation

Hard financial controls are evaluated independently from scorecards. No score,
profit, model output, or attestation may override:

- venue, account, chain, instrument, asset, action, and contract allowlists;
- per-order and rolling notional;
- gross and net exposure;
- inventory, concentration, leverage, and margin buffer;
- loss, drawdown, velocity, fee, gas, and open-order ceilings;
- price collars, slippage, liquidity, stale-data, and oracle-confidence limits;
- human approval and dual-control thresholds;
- expiry, nonce, replay protection, revocation, and cooling-off;
- pause, reduce-only, and emergency kill behavior;
- prohibition on self-modifying, self-extending, or subdelegating a mandate.

[SEC market-access controls](https://www.sec.gov/rules-regulations/2011/06/risk-management-controls-brokers-or-dealers-market-access)
provide a useful safety baseline even when the rule is not legally applicable:
pre-set thresholds, erroneous-order controls, restricted access, timely
reporting, and regular control review.

Restriction is immediate. Promotion is slow, evidence-gated, and independently
approved. Limits never increase solely because of recent profit.

## Authority envelope

A mandate identifies:

- principal, agent, account, venue, and chain;
- capability, strategy, model, and policy versions;
- allowed actions, targets, assets, instruments, and directions;
- capital band and environment;
- per-action, rolling, cumulative, open-risk, leverage, loss, fee, and gas
  ceilings;
- not-before, expiry, nonce, policy hash, approval rules, and revocation;
- monitoring cadence, review checkpoints, and kill conditions;
- whether reduce-only actions remain permitted during degraded operation.

An independent risk controller enforces the mandate with credentials and a
failure domain separate from the acting agent.

Authority maturity:

```text
observe
  -> simulation
  -> shadow
  -> human-approved single action
  -> capped canary
  -> scoped recurring mandate
```

Fine-grained authorization adapters may map to
[RFC 9396 Rich Authorization Requests](https://datatracker.ietf.org/doc/html/rfc9396)
or [ERC-7715 wallet permissions](https://eips.ethereum.org/EIPS/eip-7715).
Portable scorecard attestations may map to
[Verifiable Credentials 2.0](https://www.w3.org/TR/vc-data-model-2.0/).

## Accounting and settlement

Value movement uses integer or fixed-scale decimal quantities with explicit
asset, venue or network, and valuation source. The accounting adapter must
preserve double-entry invariants. Timeline never uses binary floating point for
normative financial decisions.

Authorization, execution, and settlement are separate records joined by stable
idempotency keys. A typical settlement lifecycle is:

```text
submitted -> accepted -> matched -> executed
  -> mined or recorded -> confirmed -> finalized -> reconciled
```

Failed, rejected, replaced, corrected, reverted, reorged, disputed, and amended
states remain representable. Inclusion is not finality, and finality is not
reconciliation.

The architecture should follow the operational principles behind
[PFMI](https://www.bis.org/cpmi/publ/d101.htm) and
[BCBS 239](https://www.bis.org/publ/bcbs239.htm): explicit settlement
finality, resilient operation, accurate and complete risk aggregation, timely
reporting, and crisis operation.

## Oracle policy

Oracle evidence includes:

- value and unit;
- confidence or uncertainty;
- publisher and independent-source count;
- observation, publication, observation-by-Timeline, and execution time;
- staleness and market-session state;
- source, aggregation, and adapter versions;
- proof, finality, correction, and reversion state.

Policies define:

- maximum age and observation-to-execution latency;
- minimum source count;
- maximum confidence-to-price ratio;
- cross-source divergence;
- conservative valuation side and rounding;
- pause or reduce-only behavior during gaps;
- delayed settlement or independent fallback.

[Pyth integration guidance](https://docs.pyth.network/price-feeds/core/best-practices)
documents why a signed price can still be stale, unavailable, adversarially
selected, or too uncertain for execution. Signed evidence remains subject to
quality policy.

## Spot operations

### Lifecycle

1. Capture decision-time market state.
2. Evaluate mandate and pre-trade risk.
3. Sign or submit an order.
4. Record acknowledgement or rejection.
5. Record rest, partial fill, fill, cancel, correction, or expiry.
6. Record fees and account mutation.
7. Track venue or chain settlement.
8. Reconcile against an independent account source.
9. Evaluate session and rolling risk.

### Evidence

- complete sequenced decision-time market snapshot;
- strategy, model, configuration, and mandate digests;
- intent and pre-trade reason codes;
- acknowledgement, fill, cancel, reject, fee, rebate, and latency;
- balance, inventory, custody, receipt, finality, and reconciliation;
- for automated market makers: pool, liquidity, route, quote, gas, impact,
  ordering, hook or extension, MEV, and reorg state.

### Evaluation

- implementation shortfall;
- effective and realized spread;
- adverse selection;
- fill, cancel, and reject behavior;
- fee-adjusted PnL attribution;
- drawdown and tail loss;
- concentration, turnover, and inventory;
- reconciliation breaks and policy violations;
- liquidity and regime coverage.

Profit is not a capability score. Leverage and tail exposure can manufacture
strong short-term returns.

## Perpetuals operations

Perpetuals add:

- index, oracle, and mark publication clocks;
- funding sample, tick, accrual, and payment;
- initial and maintenance margin recalculation;
- liquidation eligibility, execution, penalty, insurance, and deleveraging;
- cross and isolated portfolio context.

Evidence captures exact venue contract and risk-parameter versions, prices and
confidence, collateral, position, realized and unrealized PnL, margin state,
liquidation distance, funding, insurance use, and deleveraging exposure after
each mutation.

Venue formulas stay in adapters. For example,
[Hyperliquid liquidation](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations)
and [funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)
have venue-specific definitions, while dYdX exposes separately versioned
[market risk](https://docs.dydx.community/dydx/modules/governance/governance-adjustable-parameters/markets),
[funding](https://docs.dydx.community/dydx/modules/governance/governance-adjustable-parameters/perpetual),
and
[liquidation and backstop](https://docs.dydx.community/dydx/modules/governance/governance-adjustable-parameters/trading-core)
parameters.

Required policies include:

- a margin buffer above venue minimum;
- gross, net, market, and open-interest limits;
- liquidation-distance and stress-liquidation floors;
- separate cross and isolated limits;
- funding-rate and cumulative-funding budgets;
- oracle freshness, confidence, divergence, and source-count gates;
- reduce-only transition before forced liquidation;
- conservative correlation and cross-margin assumptions;
- insurance-fund and deleveraging exposure ceilings.

Evaluation includes time-weighted margin buffer, near-liquidation incidence,
funding-adjusted return, tail loss, expected shortfall, drawdown, stress loss,
basis risk, oracle exposure, policy-compliant time, and degraded-mode response.

The [Basel market-risk framework](https://www.bis.org/basel_framework/chapter/MAR/33.htm)
is a useful model-design reference for expected shortfall and liquidity
horizons, not a claim that the project satisfies bank capital rules.

## Prediction markets

The profile keeps the following states separate:

```text
draft -> open -> paused or closed -> provisional determination
  -> challenge or dispute -> final resolution -> settlement
```

Cancellation, invalid-market, amendment, supersession, and reversion are
explicit.

Evidence includes the immutable market terms and amendments, order and
liquidity events, source publications, oracle assertions and bonds, dispute
materials, rulings, finality, and payout receipts.

Policies cover:

- maximum binary loss and correlated-event exposure;
- liquidity, spread, expiry, and settlement delay;
- rule ambiguity and source reliability;
- no new risk after close or during pause or dispute;
- conservative treatment of amended or disputed outcomes;
- eligibility and restricted-information controls supplied by external policy.

Scorecards separate:

- forecast quality such as calibration, Brier score, and log loss;
- execution quality, fees, liquidity, and exposure;
- resolution ambiguity, disputes, reversals, and delay.

A market price is not automatically a calibrated probability.

[Kalshi's market lifecycle](https://docs.kalshi.com/getting_started/market_lifecycle),
[Polymarket's order lifecycle](https://docs.polymarket.com/concepts/order-lifecycle),
and [UMA's optimistic oracle](https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work)
demonstrate why trading, determination, challenge, resolution, finality, and
redemption need distinct clocks.

Jurisdiction rules are versioned external policy packs. They are not inferred
from a global identity and are not hard-coded into the core.

## Simulation and validation

The same compiled contract, policy interface, and reducer run in every
environment:

```text
historical replay
  -> deterministic backtest
  -> forward paper
  -> live read-only shadow
  -> capped live
  -> policy-limited production
```

Each environment has separate identities, credentials, storage, and
attestations.

Required simulator families:

- sequence-aware central-limit order book;
- automated market maker and routing;
- venue-specific perpetual margin, funding, and liquidation;
- prediction-market amendments, disputes, and reversals;
- stale, divergent, wide-confidence, and unavailable oracles;
- failed, replaced, delayed, and reorged settlement;
- nonce races, overlapping mandates, key compromise, self-escalation attempts,
  and kill-switch delay.

Validation requires:

- immutable datasets and content hashes;
- strict available-at-decision-time filtering;
- deterministic seeds;
- walk-forward and out-of-sample evaluation;
- historical and hypothetical stress;
- realistic spreads, depth, fees, funding, gas, latency, and settlement;
- sensitivity and parameter stability;
- shadow-to-live divergence reporting;
- canary capital ceilings;
- ongoing drift, outcome analysis, and independent validation.

Model validation is proportional to use and materiality. Known limitations and
unvalidated uses remain visible.

## Scorecard controls

Financial-capability scorecards include:

- principal and agent;
- capability and strategy or model version;
- environment, venue, account, instrument, and asset class;
- jurisdiction policy identifier;
- capital band and authority policy;
- observation window and market regimes;
- live versus simulated evidence;
- evidence tier and provenance;
- sample size, recency, missingness, uncertainty, and confidence;
- forecast, execution, risk, margin, settlement, operational, incident, and
  recovery dimensions.

Missing, expired, disputed, provisional, or unverifiable evidence cannot
promote authority. Scorecards recommend; independent policy decides.

Natural-person consumer credit is out of scope. Using complex models for
natural-person credit brings explanation, fairness, privacy, and other legal
obligations that this project does not attempt to satisfy.

## Release gates for financial authority

Before any capped-live pilot:

- independent risk controller is deployed;
- agent credentials cannot alter policy or limits;
- reconciliation and reduce-only paths work during degraded operation;
- fault injection covers venue, oracle, chain, network, storage, and signer
  failures;
- authority, accounting, and settlement invariants pass property and model
  checks;
- incident response and emergency revocation are exercised;
- security, model-risk, economic-risk, privacy, and applicable legal reviews
  are complete;
- all critical and high findings are resolved.

Before a production profile:

- at least two pilots meet predefined safety and replay criteria;
- shadow and capped-live divergence is within declared bounds;
- a second review covers changes made after the first assessment;
- conformance, operational duration, and incident data are public where safe;
- governance approves the stable profile through an RFC.

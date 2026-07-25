# RFC 0007: Financial Safety Boundary

- Status: Draft
- Compatibility: Foundational

## Problem

Financial evidence can inform bounded authority, but performance scores cannot
safely replace independent risk limits, accounting, reconciliation, or legal
review.

## Proposed design

Financial adapters own venue formulas, custody, pre-trade controls,
double-entry accounting, settlement, oracles, reconciliation, and kill
switches. The core records evidence and decisions but never holds funds or
places orders.

Authority progresses through observation, simulation, shadow operation,
human-approved action, capped canary, and scoped recurring mandate.

## Invariants

- Hard limits are independent from scores and profit.
- Agents cannot change, extend, or subdelegate their own mandate.
- Simulation and live environments have different identities and credentials.
- Every value movement joins authorization, execution, receipt, and
  reconciliation.

## Conformance

Future profile cases cover future-data leakage, stale oracles, limit bypass,
nonce races, duplicate effects, liquidation, reorg, dispute, and failed
reconciliation.

## Unresolved questions

- Initial venue and oracle adapters.
- Formal model boundaries for authorization and settlement.
- Jurisdiction-policy plugin requirements.

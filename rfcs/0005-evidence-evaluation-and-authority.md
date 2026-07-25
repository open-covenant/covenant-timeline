# RFC 0005: Evidence, Evaluation, and Authority

- Status: Draft
- Compatibility: Foundational

## Problem

Claims, evidence, scores, policy decisions, and authority are routinely
collapsed into one unsafe number.

## Proposed design

Evidence retains subject, claim, payload digest, provenance, collection method,
time coverage, source authority, confidence, completeness, and finality.

Scorecards are scoped to subject, capability, environment, policy, and time
window. They retain their dimensions, evidence, missingness, and uncertainty.
A separate hard policy issues eligibility, limits, reviews, or authority.

## Invariants

- A signature proves signed bytes, not truth.
- Missing evidence is not silently converted to failure.
- A score never grants authority by itself.
- Human consumer credit is out of scope.

## Conformance

Cases cover scope, missingness, policy substitution, correction, score
decomposition, and direct score-to-authority rejection.

## Unresolved questions

- Confidence composition across correlated evidence.
- Privacy-preserving public scorecard projections.

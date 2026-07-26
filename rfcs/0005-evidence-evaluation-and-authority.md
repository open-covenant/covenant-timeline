# RFC 0005: Evidence and Decisions

- Status: Draft
- Compatibility: Foundational

## Problem

Claims, evidence, decisions, and authority are routinely collapsed into a final
status that cannot be independently explained.

## Proposed design

Core evidence retains an ID, kind, claims, payload digest, and producer.
A checkpoint decision retains an evaluator-supplied policy label, evidence
references, missing requirements, and accepted or rejected outcome.

Source authority, freshness, signatures, confidence, and conflict resolution
are explicit policy concerns outside the minimal reducer.

Core v0alpha1 does not bind `policyRef` to the contract or verify a policy
artifact. Its only evaluator is requirement coverage over referenced claim
strings.

## Invariants

- A signature proves signed bytes, not truth.
- Missing evidence remains visible in a rejected decision.
- Unknown evidence produces a finding and no decision.
- A recorded policy label is not proof that the named policy was enforced.
- A decision does not bypass host-runtime authorization.

## Conformance

Cases cover evidence identity and complete decision shape. Reducer tests cover
missing and unknown evidence.

## Unresolved questions

- How a new alpha schema contract-binds evaluator and policy-artifact identity.
- How conflicting evidence is represented without expanding the core.

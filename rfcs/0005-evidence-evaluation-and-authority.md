# RFC 0005: Evidence and Decisions

- Status: Draft
- Compatibility: Foundational

## Problem

Claims, evidence, decisions, and authority are routinely collapsed into a final
status that cannot be independently explained.

## Proposed design

Core evidence retains an ID, kind, claims, payload digest, and producer.
A checkpoint decision retains its policy, evidence references, missing
requirements, and accepted or rejected outcome.

Source authority, freshness, signatures, confidence, and conflict resolution
are explicit policy concerns outside the minimal reducer.

## Invariants

- A signature proves signed bytes, not truth.
- Missing evidence remains visible in a rejected decision.
- Unknown evidence produces a finding and no decision.
- A decision does not bypass host-runtime authorization.

## Conformance

Cases cover evidence identity and complete decision shape. Reducer tests cover
missing and unknown evidence.

## Unresolved questions

- How policy artifacts receive canonical identity.
- How conflicting evidence is represented without expanding the core.

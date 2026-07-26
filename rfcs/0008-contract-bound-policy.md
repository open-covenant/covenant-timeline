# RFC 0008: Contract-bound Policy Identity

- Status: Implemented bootstrap decision; independent review required before beta
- Authors: Project contributors
- Created: 2026-07-26
- Compatibility: new alpha schema

## Problem

v0alpha1 evaluation events supply `policyRef`. The contract does not bind that
label or policy bytes, so it cannot prevent policy substitution.

## Decision

Every v0alpha2 checkpoint contains:

```json
{
  "profile": "github.software-delivery.v1",
  "policyRef": "software.release.v1",
  "policyDigest": "sha256:..."
}
```

Evaluation events contain no policy field. Decisions copy policy identity from
the contract. Referenced evidence must carry the same profile, reference, and
digest plus a proof digest.

## Consequences

The generic reducer prevents event-time policy substitution and remains a
deterministic requirement-coverage engine. It does not execute domain policy.
Authority profiles resolve policy bytes, authenticate producers, enforce
freshness and revocation, and create the proof bound by evidence.

v0alpha1 remains unchanged. Migration requires explicit checkpoint bindings and
refuses conflicting legacy labels or evidence shared across different policy
bindings.

## Bootstrap rationale

The change resolves a documented alpha integrity gap without rewriting the
released corpus. It remains eligible for revision after independent adopter and
security review.

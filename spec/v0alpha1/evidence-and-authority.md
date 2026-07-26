# Evidence and Decisions

## Evidence

Evidence identifies:

- a stable ID;
- a kind and producer;
- one or more named claims;
- the SHA-256 digest of its payload.

Evidence MUST retain these fields (`CTL-EVID-001`). The digest identifies bytes;
it does not prove the claim is true.

Producer authority, signatures, freshness, coverage, confidentiality, and
conflict resolution belong to versioned adopter or profile policy.

## Checkpoint evaluation

A checkpoint evaluation names:

- the checkpoint;
- the evidence references being considered;
- an evaluator-supplied policy label.

The reducer gathers claims only from known evidence. Unknown references produce
findings and no decision. Otherwise it accepts exactly when the union of
referenced claim strings covers every requirement declared by the checkpoint.

A decision retains:

- accepted or rejected outcome;
- policy reference;
- evidence references;
- missing requirements.

These fields MUST remain available even when an adopter presents a simplified
status (`CTL-DECISION-001`).

`policyRef` is recorded for audit continuity. Core v0alpha1 does not resolve,
hash, execute, authenticate, or compare it with anything in the contract.
Consequently, a v0alpha1 decision is deterministic requirement coverage under
an unverified policy label, not proof that a named policy was enforced.
The reference verifier exposes this as `evaluation: "requirement-coverage"`,
`policyAuthority: "external"`, and
`policyBinding: "unverified-event-label"`.

## Authority

A decision may make a command eligible when the pinned checkpoint declares an
effect template. The command still requires authorization and enforcement by
the adopter.

Core v0alpha1 defines no scores and grants no authority. Adopters MUST NOT treat
the presence of `policyRef` as policy identity or policy execution evidence.

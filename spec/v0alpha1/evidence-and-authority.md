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
- the policy reference.

The reducer gathers claims only from known evidence. Unknown references produce
findings and no decision.

A decision retains:

- accepted or rejected outcome;
- policy reference;
- evidence references;
- missing requirements.

These fields MUST remain available even when an adopter presents a simplified
status (`CTL-DECISION-001`).

## Authority

A decision may make a command eligible when the pinned checkpoint declares an
effect template. The command still requires authorization and enforcement by
the adopter.

Core v0alpha1 defines no scores and grants no authority.

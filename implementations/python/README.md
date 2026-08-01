# Python reducer

This is a second-language v0alpha2 reducer using Python and RFC 8785
canonicalization. It has no effect dispatcher and no dependency on the
TypeScript implementation.

`scripts/check-python-reducer.py` runs every v0alpha2 replay fixture and the
public longitudinal archive through this reducer and compares their state
digests with the corpus pinned by the TypeScript implementation.

Both implementations currently live in this repository. This establishes
cross-language conformance, not independent maintenance or governance.

## Temporal receipt verifier

`covenant_timeline_v0alpha3.py` is a separate Python verifier for the bounded
v0alpha3 proof profile. It projects one context at an explicit record cut,
reconstructs the constraint graph, checks the state, query, and result digests,
and verifies consistency schedules, negative cycles, and tight difference-bound
paths. It rejects point- and interval-relation queries because those exhaustive
proof cases are not yet implemented.

The verifier applies the reference profile's 1,000,000-node and 128-level
canonicalization limits, along with its axis, context, event, assertion, point,
interval, edge, evidence-reference, and operation limits. Malformed or
over-budget inputs fail closed with a `False` result.

`scripts/check-python-v0alpha3-verifier.py` verifies two conformance schedules,
the checked conformance bounds receipt, and all three correction-replay
receipts, including the transitional negative cycle. It also checks digest and
proof-edge substitution failures, malformed canonicalization inputs, numeric
type confusion, oversized arrays, and operation-budget exhaustion.

This demonstrates a repository-maintained cross-language bounds verifier. It
is not an independent implementation and does not satisfy the full v0alpha3
conformance or adoption gates.

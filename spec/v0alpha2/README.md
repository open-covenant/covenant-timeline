# Covenant Timeline v0alpha2

v0alpha2 is an additive alpha schema. It preserves v0alpha1 replay and replaces
the evaluator-supplied policy label with a policy identity pinned by each
checkpoint.

Normative documents:

- [Object model](object-model.md)
- [Policy binding and authority](policy-and-authority.md)
- [Replay and migration](replay-and-migration.md)
- [Requirements](requirements.md)

The reducer still performs deterministic requirement coverage. Domain profiles
authenticate evidence and interpret policy artifacts before evidence is
recorded. Pinning a policy digest does not make the generic reducer a policy
engine.

# Covenant Timeline v0alpha3

v0alpha3 is the experimental temporal-first contract candidate. It replaces
checkpoints as the central object with explicit temporal axes, isolated
contexts, points, proper intervals, digest-referenced coordinate and difference
assertions, record-time knowledge cuts, typed queries, and proof-carrying
conclusions.

v0alpha1 and v0alpha2 remain immutable compatibility formats. Their sequence
numbers continue to define record order for replay. In v0alpha3, record sequence
still orders admitted events, but modeled time exists on declared axes and is
never inferred from sequence alone.

Normative candidate documents:

- [Object model](object-model.md)
- [Projection and reasoning](reasoning.md)
- [Requirements](requirements.md)

RFC 0009 controls this candidate. The npm alpha distributes the reference
implementation for evaluation, but v0alpha3 is not a stable or normative
conformance target while the RFC remains Draft.

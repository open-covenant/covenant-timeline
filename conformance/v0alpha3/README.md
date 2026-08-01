# v0alpha3 temporal conformance

This corpus exercises the first temporal reasoning substrate: explicit temporal
axes and contexts, digest-referenced coordinate assertions, proper intervals,
difference constraints, append-only correction and retraction, knowledge cuts,
typed queries, and proof-carrying conclusions.

[`runs/software-release.json`](./runs/software-release.json) models time as
integer seconds on a declared axis. Event `sequence` remains record order; it is
not used as the modeled time coordinate. The run corrects a deployment-delay
constraint, retracts its superseded assertion, and repeats that revision
pattern for a valid-time fact.

Query `recordedThrough` is an inclusive knowledge cut. An integer includes
events through that sequence; `null` selects the empty prefix. The latest-state
fixtures therefore bind explicitly to sequence `16`.

The query fixtures cover:

- [`difference-bounds.json`](./queries/difference-bounds.json): metric bounds;
- [`point-relations-at-cut.json`](./queries/point-relations-at-cut.json): point
  relations at a prior knowledge cut;
- [`interval-relations.json`](./queries/interval-relations.json): Allen-style
  interval relations;
- [`consistency-before-correction.json`](./queries/consistency-before-correction.json):
  consistency before corrected records were admitted; and
- [`consistency-after-correction.json`](./queries/consistency-after-correction.json):
  consistency through the latest admitted record.

The [`conclusions`](./conclusions) directory retains the generated bounds
receipt and the consistency schedules before and after correction. The
TypeScript verifier checks the complete query surface. A separate
repository-maintained Python proof profile projects the same run and verifies
the schedules and bounds receipts directly; it does not yet implement point or
interval relation cases. [`cases.json`](./cases.json) contains positive and
negative shape cases for closed objects, safe integer bounds, discriminated
unions, result/proof invariants, and digest syntax.

These are schema fixtures. Cross-reference integrity, contiguous record
sequence, proper interval ordering, assertion revision, knowledge-cut
semantics, solver results, and proof verification are semantic conformance
requirements enforced by the implementation rather than JSON Schema alone.

This is an initial experimental corpus, not the complete RFC 0009 conformance
program. Normative status still requires the full relation, revision,
substitution, resource-boundary, property-generated, and cross-implementation
matrix listed in that RFC.

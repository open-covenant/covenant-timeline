# Changelog

## Unreleased

### Added

- Add a checked correction-and-replay example with before, inconsistent
  transition, and after knowledge cuts; content-bound evidence documents; exact
  conclusion fixtures; verifier-checked proofs; and a repository command that
  reproduces the complete artifact.
- Add the model-interface v1 development benchmark: 12 kernel-derived temporal
  cases, paired direct, narrative-memory, and Timeline arms, a one-shot JSONL adapter
  protocol, strict admission and capacity limits, replayable request and
  response artifacts, paired scoring, and adversarial harness tests.
- Add a stateless OpenAI Responses benchmark adapter with model-revision
  verification, arm-specific Structured Outputs, mock-provider conformance
  tests, a separate adapter-error protocol, and source-bound configuration
  generation. Counterbalance arm order, bind runs to unchanged source/runtime
  bytes, and retain validated paid artifacts when atomic publication fails.
- Add a schema-validated alpha.2 release record bound to the annotated source
  tag, component manifests, protocol inputs, migration, workflow attempt,
  registry metadata, release assets, SBOM, and attestations.
- Add offline release-record validation and a public-state verifier that
  compares npm and GitHub bytes, verifies the remote annotated tag, delegates
  Sigstore verification to GitHub CLI, binds provenance and SBOM statements to
  the recorded release, and runs npm signature checks plus a clean
  installed-package temporal proof.

### Changed

- Lead the repository and npm package with the long-running-agent correction
  workflow, one installable temporal API, the actual proof receipt, and explicit
  distinctions from event sourcing, bitemporal databases, established STN
  mathematics, and Temporal.io.
- Define civil-time normalization and derivation-versus-evidence trust as
  deployment boundaries, and present older checkpoint surfaces only as
  compatibility APIs.
- Rank a local stdio MCP integration after the model benchmark, define its
  unauthenticated admission boundary, and add a 90-day evidence threshold for
  continued standalone product expansion.
- Refocus the public roadmap on model reliability, an external temporal pilot,
  and an independently maintained implementation, with a blinded scale
  evaluation required before any model-performance claim.
- Record the alpha.2 token-fallback publication and operator-observed credential
  cleanup without presenting trusted publishing as an alpha release gate.
- Move artifact upload to its Node.js 24 action and consolidate SBOM
  attestation on the supported GitHub attestation action.

## @covenant-org/timeline-mcp 0.0.0-alpha.1 - 2026-07-27

### Added

- Add a zero-setup installed correction demo that reloads the run from disk and
  emits verifier-checked conclusions and proof receipts for the original and
  corrected knowledge cuts.
- Add a local stdio server with five bounded temporal-state tools, portable run
  resources, explicit knowledge cuts, structural-only admission labels,
  optimistic concurrency, canonical append-only persistence, restart recovery,
  and installed-package correction-and-proof verification.
- Add a separate reproducible MCP release workflow with checksum, SPDX SBOM,
  GitHub build and SBOM attestations, npm provenance, OIDC publishing, and the
  documented alpha token fallback.

## 0.0.0-alpha.2 - 2026-07-27

### Added

- Add v0alpha2 contracts, events, decisions, migration, schemas, specification,
  and conformance fixtures with contract-bound policy identity.
- Add a signed GitHub software-delivery authority profile with freshness,
  revocation, check, review, merge, deployment, and webhook verification.
- Add a public five-day delivery archive that verifies across separate
  collector, resume, and finalization processes.
- Add a Temporal durable-runtime adapter and real local-server worker-restart
  integration test.
- Add a Python v0alpha2 reducer checked against the TypeScript state-digest
  corpus.
- Add atomic portable run archives and a 50,000-event replay benchmark.
- Add a bounded independent-operator pilot and proposal template.
- Add the temporal reasoning vision and Draft RFC for the temporal-first
  v0alpha3 contract.
- Add experimental v0alpha3 axes, contexts, points, proper intervals,
  digest-referenced coordinate and difference assertions, temporal facts,
  historical knowledge cuts, typed queries, and proof-carrying conclusions.
- Add strict v0alpha3 runtime validation and JSON Schemas.
- Add a resource-bounded, exact-integer Simple Temporal Network reasoner for
  consistency, tight bounds, point relations, and all 13 Allen interval base
  relations.
- Add independently verifiable schedules, ordered bound paths, exhaustive
  relation cases, and negative-cycle proofs bound to state, query, and result
  digests.
- Add `timeline reason`, a model-facing integration guide, an executable
  temporal demo, and a baseline kernel benchmark.
- Publish the Draft v0alpha3 temporal API in the npm alpha channel.

### Changed

- Describe Core v0alpha1 as deterministic checkpoint requirement coverage,
  rather than policy-pinned or temporal evaluation.
- Document that `policyRef` is an evaluator-supplied, unverified label and that
  contract-bound policy identity requires a new alpha schema.
- Report requirement-coverage evaluation and the external, unverified policy
  boundary in machine and CLI verification output.
- Document replay from the exact contract and event stream as the only portable
  restart path; `RunState` is not a hydration format.
- Allow the protected npm release workflow to use a short-lived,
  package-scoped token when OIDC trusted publishing is unavailable.
- Position the checkpoint verifier as the implemented first foundation of the
  broader temporal reasoning program without changing released alpha
  semantics.
- Make temporal-first v0alpha3 the next product contract while retaining
  v0alpha1 and v0alpha2 as checkpoint compatibility formats.

## 0.0.0-alpha.1 - 2026-07-26

### Added

- Standalone project scaffold.
- Draft Core v0alpha1 specification and schemas.
- Bootstrap conformance harness and cases.
- Governance, security, compatibility, and release policies.
- Extracted TypeScript incubation prototype.
- Runtime-safe contract, event, and portable-run validation.
- Successful, rejected, incomplete, corrected, and malformed run fixtures with
  pinned state digests.
- RFC 8785 canonical JSON, SHA-256 content identities, and independent Python
  fixture agreement.
- `timeline validate`, `replay`, `inspect`, and `verify` with human-readable and
  canonical JSON output.
- Published `@covenant-org/timeline@0.0.0-alpha.1` with npm provenance.
- Covenant reference-adapter fixture covering pause, resume, review, release
  readiness, capability requests, receipts, and offline verification.
- Strict duplicate-key JSON parsing, bounded CLI input, stdin, and version
  output.
- Exact contract-byte state binding and payload-byte digest helpers.
- Runtime/JSON Schema conformance cross-checks and implementation resource
  limits.
- Installed-package, SBOM, supply-chain, and trusted-release verification.

### Changed

- Replay now uses a linear mutable accumulator internally while public
  single-event reduction remains immutable.
- Structural verification explicitly reports that evidence and effect
  authority are external.
- Accepted checkpoints are final within a run and cannot emit another command.
- Reducer state carries private exact-contract and receipt-identity bindings
  without changing portable state digests.

### Security

- Reject duplicate JSON keys, unsafe event sequence integers, inherited-property
  identifier collisions, repeated receipt IDs, excessive canonical depth, and
  excessive canonical node counts.

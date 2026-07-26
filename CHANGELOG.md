# Changelog

## Unreleased

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

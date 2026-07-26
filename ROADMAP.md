# Roadmap

This roadmap is ordered by adoption risk. Dates are planning ranges, not release
promises.

## M0: Narrow the product

Status: complete

- Define Timeline as a checkpoint-contract verifier, not a workflow runtime.
- Make software and long-running agent work the first profile.
- Remove universal scoring and premature financial-domain claims.
- Establish the standalone repository as the only portable source of truth.
- Keep Covenant integration behind an adapter boundary.

Exit criteria:

- The README, specification, implementation, and organization overview describe
  the same product.
- `pnpm demo` produces a useful verified run.
- `pnpm verify` passes.

## M1: Minimal portable core

Status: complete

- Contract validation.
- Ordered event ingestion.
- Evidence registration and requirement coverage.
- Checkpoint decisions retaining the evaluator's recorded policy label.
- Command and receipt joins.
- Stable findings for invalid runs.
- Deterministic replay.

Exit criteria:

- Fixtures cover successful, rejected, incomplete, corrected, and malformed
  runs.
- Replaying identical inputs produces identical exported output.
- The command boundary cannot execute adapters during replay.

## M2: Canonical bytes and CLI

Status: complete

- RFC 8785 canonicalization using a reviewed implementation.
- SHA-256 content identity.
- Byte-level conformance fixtures.
- `timeline validate`, `replay`, `inspect`, and `verify`.
- Human-readable and JSON output.

Exit criteria:

- Canonical output agrees across two languages and supported platforms.
- Locale and time-zone changes do not affect output.
- Historical fixtures remain verifiable after a CLI upgrade.

Completion evidence:

- TypeScript and Python produce the same canonical bytes for the RFC 8785
  corpus.
- The full verification suite passes on Ubuntu, macOS, and Windows with the
  Node.js versions in the CI matrix.
- The conformance harness compares canonical CLI replay output across distinct
  locale and time-zone environments.
- Run fixtures pin state digests as the compatibility baseline for upgrades.

## M3: Covenant reference integration

Status: complete

- Map Covenant audit and provenance envelopes to evidence events.
- Map Timeline commands to explicit Covenant capability requests.
- Return Covenant receipts as timeline events.
- Demonstrate pause, resume, review, and release checkpoints in a real build.

Exit criteria:

- Covenant depends on a versioned Timeline package or commit.
- Covenant contains adapter code only, not a fork of the reducer.
- A complete run can be exported and verified without Covenant running.

Completion evidence:

- Covenant pins the M1-M3 Timeline implementation revision from its adapter
  metadata.
- The landed adapter maps provenance and audit records to payload-free
  evidence, maps commands to typed capability requests, and maps typed
  responses to receipts.
- The pause, resume, review, and release run verifies offline with its state
  digest pinned.

## M4: Independent adoption

- One concrete software-delivery authority profile covering payload binding,
  producer authentication, freshness, revocation, and policy identity.
- One independently operated adapter for Temporal, Restate, DBOS, or another
  external runtime.
- One public longitudinal run spanning real elapsed time, restart, CI, review,
  effect dispatch, and receipt verification.
- Contract-bound evaluator identity in a new alpha schema, or removal of the
  policy label if adopter evidence shows it has no interoperable meaning.
- Storage interface and portable run archive; snapshot hydration only after an
  adopter demonstrates that full replay is operationally inadequate.
- Correction and branch semantics driven by real incidents.
- Second implementation of the portable core.

Exit criteria:

- One external project operates Timeline without Covenant.
- One authority profile authenticates real evidence instead of synthetic claim
  strings.
- One exported run crosses a real process restart and remains independently
  verifiable.
- The policy field is contract-bound or absent; it is never merely trusted
  because an event supplied it.
- Both implementations pass the same conformance corpus.
- Upgrade and migration tests preserve historical verification.

## M5: Beta

- Stable TypeScript API and one additional language binding.
- Published compatibility policy.
- Security review and remediation record.
- Maintainer and release process backed by actual contributors.

Exit criteria:

- Two organizations maintain an implementation or adapter.
- Real runs have crossed multiple releases and upgrades.
- No critical replay, identity, or effect-boundary finding remains unresolved.

## Deferred

The following are not beta requirements:

- a distributed runtime;
- a general policy language;
- WASM plugins;
- trading or prediction-market profiles;
- financial authority;
- universal agent reputation;
- engineering simulation standards;
- broad dashboard and operator infrastructure.

They may return through the expansion gate in [`PROGRAM.md`](./PROGRAM.md).

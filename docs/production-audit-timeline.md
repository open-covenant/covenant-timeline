# Production Audit: Covenant Timeline

## Executive Summary

Covenant Timeline began this audit with a coherent alpha protocol boundary,
deterministic canonicalization fixtures, a small typed implementation, and
unusually good cross-platform bootstrap CI, but it was not production safe.
The reducer bound state to a contract ID rather than the contract bytes,
permitted an accepted checkpoint to emit additional effect commands, replayed
growing runs in quadratic time, and accepted unbounded, ambiguous CLI input.

The repository now closes those local integrity, availability, parser,
packaging, and supply-chain gaps. It is a production-hardened alpha release
candidate, not a production protocol. The package is still unpublished, and no
external authority profile or independent implementation exists. Registry
authority, protected release configuration, external adoption, and independent
interoperability remain real release and adoption blockers.

This audit treats "production ready" as two separate gates:

1. **Production-safe alpha implementation:** untrusted input is bounded,
   replay is linear, state is bound to exact contract bytes, effect eligibility
   cannot be duplicated accidentally, errors are stable, artifacts are
   inspectable, and release automation fails closed.
2. **Production protocol claim:** an external runtime and a second
   implementation verify the same runs, an authority profile verifies evidence
   authenticity and freshness, and release governance is independently
   exercised.

The first gate is achievable in this repository. The second requires external
adopters and registry/governance configuration and must remain an explicit
blocker until observed.

## Evidence Reviewed

- All specification, RFC, schema, conformance, scenario, governance, package,
  source, test, script, and workflow files on `main` at `4f8c2b6`.
- Local baseline `pnpm verify`.
- npm production dependency audit: no known vulnerabilities on 2026-07-25.
- npm registry lookup: `@covenant-org/timeline` returned `E404` on 2026-07-25.
- Hardened local gate: 73 tests, 82.71% statements, 74.44% branches,
  93.93% functions, 83.36% lines, installed-tarball smoke, deterministic SPDX
  SBOM, reproducible tarball bytes, actionlint, and no known full dependency
  audit findings.
- GitHub control-plane audit on 2026-07-25:
  - no `main` branch protection, repository ruleset, or environment existed;
  - Dependabot security updates, secret scanning, and push protection were
    enabled during this audit;
  - immutable Actions SHA enforcement was enabled during this audit;
  - secret validity checks and non-provider-pattern scanning remained
    unavailable or disabled.
- Baseline replay benchmark on the local Node.js runtime:
  - 1,000 evidence events: approximately 106 ms.
  - 5,000 evidence events: approximately 5,404 ms.
- Hardened replay benchmark on the same runtime:
  - 1,000 evidence events: approximately 8 ms.
  - 5,000 evidence events: approximately 27 ms.
  - 10,000 evidence events: approximately 50 ms.
- M3 Covenant adapter and offline run evidence recorded in the repository
  roadmap and merged integration history.

## Critical Issues (P0 - Block Release)

- [x] **Bind state to exact contract bytes.** Private reducer metadata now binds
      the canonical contract digest and incremental reduction fails closed on
      an ID mismatch, byte mismatch, or missing binding without changing
      portable state digests.
- [x] **Prevent repeated effect eligibility.** Re-evaluating an already accepted
      checkpoint emits a new command and idempotency key. Make acceptance final
      within a run and require an explicit new run or future branch protocol for
      correction.
- [x] **Make replay linear and bounded.** Immutable whole-map copies make replay
      quadratic. Use one private mutable accumulator during replay while
      preserving immutable single-event reduction, then enforce documented
      implementation limits.
- [x] **Bound CLI input before allocation and parse.** Unbounded reads allow
      memory exhaustion. Enforce a byte ceiling, stable input errors, and
      bounded stdin support.
- [x] **Reject ambiguous JSON.** Duplicate object keys can be interpreted
      differently before canonicalization. Use a strict parse path that rejects
      duplicates, comments, and trailing commas.
- [x] **Create a fail-closed release workflow.** Releases need tag/version
      agreement, a clean rebuild, tests, artifact inspection, checksums, SBOM,
      provenance, and an approval-protected npm environment.
- [ ] **Protect `main` and release tags.** Apply rules using the check names
      observed on this pull request; no protection or repository ruleset existed
      at audit time.
- [ ] **Resolve external release authority.** The npm package does not exist or
      is not visible to the current registry identity. Scope ownership, trusted
      publisher configuration, protected environment reviewers, and tag
      protection cannot be proven from this checkout.

## High Priority (P1 - Fix Before Launch)

- [x] **Validate every runtime boundary.** Typed callers can still supply
      malformed JavaScript values. `reduceRun`, canonicalization, and exported
      validators must return stable errors instead of throwing incidental
      runtime exceptions.
- [x] **Detect schema/runtime validator drift.** Conformance now compares every
      supported standalone JSON Schema case to its runtime validator.
- [x] **Close inherited-property hazards.** Valid identifiers such as
      `constructor` collide with properties inherited by ordinary objects.
      Membership tests must use own-property checks and receipt IDs must be
      unique across the run.
- [x] **Make verification scope explicit.** A structurally successful run does
      not establish evidence truth, producer authority, payload possession, or
      real effect execution. Machine and human output must state this.
- [x] **Harden canonical input.** Reject accessors, symbol properties, excessive
      depth, excessive node counts, cycles, non-finite values, and lone
      surrogates before hashing.
- [x] **Complete package metadata and artifact contents.** Add repository,
      homepage, bugs, keywords, source maps, license, version output, and an
      installed-tarball smoke test.
- [x] **Add resilience coverage.** Test contract substitution, finalized
      checkpoint replay, prototype-name identifiers, duplicate receipt IDs,
      malformed runtime values, input limits, deep JSON, duplicate keys,
      installed CLI behavior, and large-run performance.
- [x] **Add supply-chain gates.** Run production dependency audit, CodeQL, and
      artifact/SBOM checks with actions pinned to immutable commits.
- [x] **Document the threat and trust model.** State assets, trust boundaries,
      attacker capabilities, replay/effect abuse paths, privacy constraints,
      and adopter obligations.

## Medium Priority (P2 - Fix Soon After Launch)

- [x] **Define host observability guidance.** Document safe metrics and logs
      without leaking evidence identifiers or payload-derived data.
- [ ] **Define correction and branch semantics.** Alpha supports
      rejected-to-accepted correction only. Accepted decisions need a versioned
      supersession or branch model before mutable workflows can rely on them.
- [ ] **Publish an authority profile.** Specify signature algorithms, key
      discovery, freshness, revocation, policy pinning, and payload retention for
      at least one real deployment profile.
- [ ] **Exercise rollback.** Verify package deprecation/yank instructions and
      historical run verification against a released artifact.

## Low Priority (P3 - Technical Debt)

- [ ] Add browser-runtime compatibility only if an adopter needs it; the current
      package intentionally targets Node.js.
- [ ] Add richer inspection filters after the stable machine report contract is
      adopted.
- [ ] Add benchmark trend storage once run sizes from real adopters are known.

## Security Assessment

### Assets

- Canonical contract, event, run, state, and artifact bytes.
- The binding between a run and its policy/effect template.
- Idempotency keys and the host decision to execute a command.
- Evidence payload digests and potentially sensitive producer metadata.
- Package source, release artifacts, checksums, SBOM, and provenance.

### Trust Boundaries

- JSON or JavaScript values entering the package.
- Portable run files entering the CLI.
- Evidence metadata entering a host runtime.
- Commands leaving the pure reducer for an effect adapter.
- Receipts returning from an effect adapter.
- GitHub Actions publishing to npm.

### Principal Risks

- Same-ID contract substitution changes policy after state creation.
- Repeated accepted evaluations create multiple executable commands.
- Claims are declarative and can be self-asserted unless a host validates
  producer authority and payload integrity.
- Receipt status and effect digest are declarations unless the host validates
  them against the external system.
- Duplicate JSON keys and unbounded input create ambiguity and denial-of-service
  paths.
- Producer, subject, policy, and evidence identifiers may be operationally
  sensitive even though payload bytes are excluded.
- A compromised release path could replace the verifier used to validate
  historical runs.

Cryptographic evidence verification is not present in core v0alpha1. That is an
honest architectural boundary, but no deployment may translate structural
verification into authority without a versioned external policy.

## Performance Assessment

The current replay path repeatedly spreads `eventIds`, `evidence`, `commands`,
`receipts`, and `findings`. This is quadratic as state grows. The measured jump
from roughly 106 ms at 1,000 events to roughly 5,404 ms at 5,000 events confirms
the design issue. Production replay needs one mutable accumulator per replay,
immutable outputs at API boundaries, explicit input ceilings, and a regression
test over a representative large run.

Canonicalization is recursive and has no explicit depth or node budget.
Programmatic callers can trigger stack exhaustion or excessive traversal even
when the CLI byte ceiling is active.

## Observability Assessment

The library is correctly free of implicit logging and network calls. The
canonical report and stable findings are useful machine telemetry. Missing
pieces are a documented host metric set, privacy-safe cardinality guidance,
stable CLI input error codes, and an explicit assurance scope in reports.

Recommended host metrics:

- replay duration and event count;
- validation failures by stable code, never raw payload;
- findings by stable code;
- pending, rejected, unresolved, and failed counts;
- command dispatch and receipt latency outside the core;
- package/spec/profile versions attached to every observation.

## Recommended Architecture Changes

1. Add exact contract identity and finalized-checkpoint invariants to the core
   state machine.
2. Split private mutable replay accumulation from public immutable
   single-event reduction.
3. Centralize runtime validation primitives and implementation limits.
4. Add strict JSON parsing and bounded byte acquisition at the CLI boundary.
5. Make structural assurance explicit in the report contract.
6. Treat effect execution and evidence authority as host/profile concerns with
   documented interfaces and tests, never hidden reducer behavior.
7. Build release artifacts once in an approval-protected workflow and attest
   those exact bytes.

## Test Coverage Gaps

- No exact-contract substitution regression.
- No accepted-checkpoint replay regression.
- No large-run complexity regression.
- No resource-limit tests.
- No duplicate JSON-key test.
- No prototype-name identifier test.
- No duplicate receipt-ID test.
- No programmatic malformed-event test.
- No installed-artifact test in CI.
- No release-script or tag/version test.
- No package checksum, SBOM, or provenance dry-run.

## Action Plan

1. Fix reducer integrity, linear replay, own-property membership, receipt
   identity, runtime validation, and structural assurance output.
2. Add canonicalization and document limits plus strict bounded CLI input.
3. Cross-check all runtime validators against JSON Schema conformance cases.
4. Add adversarial, recovery, and large-run regression tests.
5. Complete package metadata, license, maps, installed-tarball smoke, and
   release validation scripts.
6. Add CI security/audit jobs and an approval-protected trusted-publishing
   workflow with checksums and SBOM.
7. Add threat model, operations, adopter, and release runbooks.
8. Run local verification, clean-install artifact verification, supported
   platform CI, and post-merge CI.
9. Leave external authority profile, independent implementation, registry
   ownership, and protected-environment configuration visibly blocked until
   directly verified.

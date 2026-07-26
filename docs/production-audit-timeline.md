# Production Audit: Covenant Timeline

## Executive Summary

Covenant Timeline began this audit with a coherent alpha protocol boundary,
deterministic canonicalization fixtures, a small typed implementation, and
unusually good cross-platform bootstrap CI, but it was not production safe.
The reducer bound state to a contract ID rather than the contract bytes,
permitted an accepted checkpoint to emit additional effect commands, replayed
growing runs in quadratic time, and accepted unbounded, ambiguous CLI input.

The repository now closes those local integrity, availability, parser,
packaging, and supply-chain gaps. It is a released, production-hardened alpha,
not a production protocol. The package and its registry provenance are public,
but no external authority profile or independent implementation exists.
Core v0alpha1 deterministically checks requirement coverage and records an
unverified policy label; it does not enforce contract-bound evaluator policy or
temporal predicates. “Timeline” means ordered history in the released core.
Trusted-publisher linkage, protected release approval, external adoption, and
independent interoperability remain real release and adoption blockers.

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
  source, test, script, and workflow files through the released `main` commit
  `20f720f`.
- Local baseline `pnpm verify`.
- npm production dependency audit: no known vulnerabilities on 2026-07-26.
- npm release `@covenant-org/timeline@0.0.0-alpha.1` published from
  `timeline-v0.0.0-alpha.1` on 2026-07-26 with SLSA provenance. The public
  registry tarball matched the GitHub release artifact byte for byte, and an
  unauthenticated install passed the CLI and API smoke tests.
- Hardened local gate: 73 tests, 82.71% statements, 74.44% branches,
  93.93% functions, 83.36% lines, installed-tarball smoke, deterministic SPDX
  SBOM, reproducible tarball bytes, actionlint, and no known full dependency
  audit findings.
- GitHub control-plane audit on 2026-07-26:
  - `main` initially had no branch protection, repository ruleset, or
    environment;
  - `main` now requires a pull request, the seven observed CI and CodeQL checks
    from the GitHub Actions app, an up-to-date branch, and resolved
    conversations; the rule applies to administrators and blocks force pushes
    and deletion;
  - the active `Protect timeline release tags` ruleset prevents updates and
    deletion of `timeline-v*` tags without a bypass actor;
  - Dependabot security updates, secret scanning, and push protection were
    enabled during this audit;
  - immutable Actions SHA enforcement was enabled during this audit;
  - the `npm` environment permits only `timeline-v*` tags and contains no npm
    token secret, but it has no required reviewer;
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
      checkpoint previously emitted a new command and idempotency key.
      Acceptance is now final within a run and correction requires an explicit
      new run or future branch protocol.
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
      provenance, and a tag-restricted npm environment. The workflow now has no
      token fallback, so it fails closed until trusted publishing is linked.
- [x] **Protect `main` and release tags.** `main` now requires the seven observed
      first-party checks and pull-request flow with administrator enforcement;
      force pushes and deletion are disabled. `timeline-v*` tags cannot be
      updated or deleted under the active no-bypass ruleset.
- [x] **Establish registry package authority.**
      `@covenant-org/timeline@0.0.0-alpha.1` was published from the protected
      release tag with registry provenance and independently verified bytes.
- [ ] **Complete credentialless release governance.** Trusted publisher
      configuration and required `npm` environment reviewers remain unverified.

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
- [x] **Stop overstating evaluator policy.** Core v0alpha1 records an
      event-supplied `policyRef`; it does not bind, resolve, hash, execute, or
      authenticate policy. Public, specification, threat-model, and operations
      language and machine verification output now describe deterministic
      requirement coverage under an unverified label.
- [ ] **Contract-bind evaluator identity in a new alpha schema.** The released
      v0alpha1 schema cannot gain a required field without breaking its
      published corpus. v0alpha2 must either bind evaluator and policy-artifact
      identity in each checkpoint or remove `policyRef`.
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
- [ ] **Publish and exercise one authority profile.** Specify signature
      algorithms, key discovery, freshness, revocation, policy identity, and
      payload retention, then verify real software-delivery evidence with it.
- [ ] **Prove one longitudinal restart.** Export and independently verify a real
      run spanning elapsed time, process restart, CI, review, effect dispatch,
      and receipt verification.
- [ ] **Add snapshot hydration only from adopter evidence.** v0alpha1 requires
      full replay after a process boundary. Design a versioned hydration
      contract only if an independent adopter measures replay as an operational
      constraint.
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
- The binding between a run and its requirements and effect template.
- The distinction between a recorded policy label and authenticated policy.
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

- Same-ID contract substitution can change requirements or effect templates
  unless exact contract bytes are bound.
- An event can supply any syntactically valid `policyRef`; v0alpha1 records it
  without establishing that the named policy exists or was enforced.
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

Full replay now uses one private mutable accumulator while public single-event
reduction stays immutable. The hardened benchmark measured approximately 8 ms
at 1,000 evidence events, 27 ms at 5,000, and 50 ms at 10,000. Explicit event,
checkpoint, collection, canonical-depth, canonical-node, and CLI-byte limits
bound reference-implementation work.

These are local bootstrap measurements, not an adopter workload model. Trend
storage and snapshot hydration should wait for longitudinal run sizes from an
independent host.

## Observability Assessment

The library is correctly free of implicit logging and network calls. The
canonical report and stable findings are useful machine telemetry. Host metric
guidance, privacy-safe cardinality rules, stable CLI input codes, and explicit
structural assurance scope are documented. No real operator has yet exercised
them across a longitudinal run.

Recommended host metrics:

- replay duration and event count;
- validation failures by stable code, never raw payload;
- findings by stable code;
- pending, rejected, unresolved, and failed counts;
- command dispatch and receipt latency outside the core;
- package/spec/profile versions attached to every observation.

## Recommended Architecture Changes

1. Define contract-bound evaluator and policy-artifact identity in v0alpha2, or
   remove `policyRef`.
2. Implement and exercise one GitHub software-delivery authority profile.
3. Operate one public longitudinal run through restart and external effects.
4. Integrate one independently operated durable runtime.
5. Add portable snapshot hydration only if measured replay cost requires it.
6. Obtain a second conforming reducer before any beta interoperability claim.

## Test Coverage Gaps

- No v0alpha2 contract-bound policy fixture or migration test.
- No real authority-profile evidence fixture.
- No longitudinal restart and replay corpus.
- No independently maintained reducer result.
- No external-runtime recovery test.
- No portable snapshot hydration test; intentionally deferred until adopter
  need is measured.

## Action Plan

1. Preserve v0alpha1 replay while removing every policy and temporal overclaim.
2. Specify v0alpha2 contract-bound evaluator identity and migration fixtures.
3. Implement and exercise one real software-delivery authority profile.
4. Operate and publish one longitudinal Covenant run spanning restart and
   effects.
5. Recruit one independent runtime adopter before designing snapshot hydration.
6. Obtain a second reducer result before beta.
7. Complete trusted-publisher linkage and protected-environment review before
   the next npm release.

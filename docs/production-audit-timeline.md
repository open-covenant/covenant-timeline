# Production Audit: Covenant Timeline

## Executive Summary

Covenant Timeline began this audit with a coherent alpha boundary and useful
conformance corpus, but it was not production safe. The reducer bound state to
a contract ID rather than the contract bytes, permitted an accepted checkpoint
to emit additional effect commands, replayed growing runs in quadratic time,
and accepted unbounded, ambiguous CLI input. v0alpha1 also recorded an
event-supplied policy label without pinning evaluator identity.

The repository now closes the local integrity, availability, parser,
packaging, authority-profile, restart, and cross-language gaps found in this
audit. v0alpha2 binds profile, policy reference, and policy digest in the
contract; the GitHub software-delivery profile authenticates collector
envelopes and derives claims; the public corpus includes a five-day source run;
the Temporal adapter survives a worker restart against a real local server; and
the Python reducer agrees with the TypeScript corpus.

The local MCP alpha adds a bounded stdio integration for the temporal
substrate. Its default model role exposes four read-only tools, including a
proposal preview that compiles request-scoped handles and exact source spans
without changing durable state. A separate operator role adds three mutation
tools. Admitting a preview requires its exact candidate digest plus an explicit
authority, policy reference, and policy digest. Every persisted event is
covered by a content-bound admission record in the stored audit envelope.

The server persists canonical runs across process restarts, uses whole-run
digest compare-and-swap for appends, replays corrections at explicit knowledge
cuts, and verifies receipts before returning them. Run discovery is paginated;
malformed protocol input terminates with a failure status; and a local MCP
pilot exports a restart-spanning artifact for separate offline verification.
Package and release paths reproduce and inspect exact archive bytes, include
the full production dependency graph in the SBOM, and distinguish npm
publication from a later successful workflow retry.

This is still an engineering alpha, not an independently proven production
protocol. The Temporal.io adapter and Python checkpoint reducer are
maintained in this repository. The external project represented by the public
archive did not adopt Timeline. The alpha.2 package includes the Draft v0alpha3
temporal reference implementation alongside v0alpha1 and v0alpha2 checkpoint
compatibility APIs. External operation, an independently maintained temporal
implementation, a public composed restart-and-correction pilot, and RFC
completion remain blockers to a production protocol claim. Both preregistered
frontier-model gates returned `kill`: the lower-level state comparison did not
beat structured extraction, and the deployment-shaped proposal interface failed its
semantic assertion and end-to-end thresholds. Neither result supports a
standalone model-memory accuracy claim or automatic admission of model output.

v0alpha3 adds explicit temporal axes, scenario contexts, points, proper
intervals, digest-referenced coordinate and difference assertions, historical
knowledge cuts, typed queries, and proof receipts. This is a bounded temporal
reasoner for discrete axes. It does not parse civil time, establish independent
interoperability, or satisfy the production protocol gate.

This audit treats "production ready" as two separate gates:

1. **Production-safe alpha implementation:** untrusted input is bounded,
   replay is linear, state is bound to exact contract bytes, effect eligibility
   cannot be duplicated accidentally, errors are stable, artifacts are
   inspectable, and release automation fails closed.
2. **Production protocol claim:** an external organization operates a runtime,
   an independently maintained implementation verifies the same runs, and
   release governance is independently exercised.

The current repository satisfies the first gate for local alpha use. The second
requires external adopters and independently exercised governance and remains
an explicit blocker until observed.

## Temporal-first v0alpha3 addendum

v0alpha3 is evaluated as an experimental subsystem under Draft RFC 0009. Its
local gate requires:

- strict schema and runtime validation;
- deterministic, resource-bounded state projection;
- correct Simple Temporal Network consistency and tight-bound results;
- complete point and interval relation cases;
- independently verified schedules, paths, and negative cycles;
- explicit knowledge-cut and context-isolation regressions;
- locale and time-zone independence;
- installed-package and CLI smoke tests; and
- unchanged v0alpha1 and v0alpha2 fixtures.

It is not production-ready until a second implementation agrees on semantic
results and verifies supported receipts, an external operator runs a real
temporal workflow, RFC governance completes, and security review covers model
extraction, proof substitution, graph exhaustion, and temporal-data privacy.
Any production model integration must validate its own proposal boundary; the
published lower-level result does not establish a general model benefit.

## Evidence Reviewed

- All specification, RFC, schema, conformance, scenario, governance, package,
  source, test, script, and workflow files through tagged alpha.2 source commit
  `23116b220a24debe83f7aad3bd8b85a945c655cf`, plus the post-release record,
  validators, public-state verifier, and workflow hardening in this audit
  revision.
- Local baseline `pnpm verify`.
- npm production dependency audit: no known vulnerabilities on 2026-07-26.
- npm release `@covenant-org/timeline@0.0.0-alpha.2` published from
  `timeline-v0.0.0-alpha.2` on 2026-07-26 using the protected-environment token
  fallback. The release has npm provenance and GitHub build and SBOM
  attestations; the public package passed clean-install CLI and API smoke tests.
- The alpha.2 release record binds workflow run `30223008125`, attempt `3`,
  artifact `8638028013`, source commit
  `23116b220a24debe83f7aad3bd8b85a945c655cf`, registry SHA-1
  `84a46f571e44c50d7869788046b4ffd76f1b3ecc`, and tarball SHA-256
  `8158da1b49f350056192306e84bf50cbfa3ab21b5848e063b6b4b87da05e9c94`.
  The npm and GitHub tarballs matched byte for byte. `next` pointed to alpha.2
  while `latest` remained alpha.1.
- Twelve release-evidence tests cover source, workflow, artifact,
  attestation, credential-cleanup, checksum, SBOM, duplicate-key, and unknown
  field substitution.
- The public-state verifier, using GitHub CLI 2.88.1, cryptographically verified
  the exact attempt-3 build, SBOM, and npm provenance bundles. Their certificates
  and statements matched the source, tag, workflow, invocation, package bytes,
  and downloaded SBOM.
- The same verifier confirmed the remote annotated tag, passed npm
  registry-signature verification, and completed a clean installed-package
  temporal proof from a path containing spaces.
- v0alpha1 and v0alpha2 traceability and conformance: 41 standalone documents,
  7 portable runs, 5 canonical byte fixtures, 18 schemas, and four
  locale/time-zone replay environments.
- TypeScript reference tests: 112 unit, conformance, and resilience tests with
  83.30% statements, 75.12% branches, 95.81% functions, and 84.03% lines.
- Temporal adapter: three handler tests plus one integration test using a real
  local Temporal server, two workers, one workflow history, a process boundary,
  and final receipt verification.
- Python cross-check: 17 v0alpha2 documents, two conformance runs, and the
  public archive agree with the pinned TypeScript result.
- GitHub authority profile: four JSON Schemas and one Ed25519-signed public
  archive pass schema, signature, payload, policy, freshness, and revocation
  verification.
- Installed-tarball smoke, deterministic SPDX SBOM, reproducible tarball bytes,
  actionlint, and no known full dependency audit findings.
- GitHub control-plane audit on 2026-07-26:
  - `main` initially had no branch protection, repository ruleset, or
    environment;
  - `main` now requires a pull request, the seven observed CI and CodeQL checks
    from the GitHub Actions app, an up-to-date branch, and resolved
    conversations; the rule applies to administrators and blocks force pushes
    and deletion;
  - the active `Protect timeline release tags` ruleset prevents updates and
    deletion of `timeline-v*` and `timeline-mcp-v*` tags without a bypass
    actor;
  - Dependabot security updates, secret scanning, and push protection were
    enabled during this audit;
  - immutable Actions SHA enforcement was enabled during this audit;
  - the `npm` environment permits only `timeline-v*` and `timeline-mcp-v*` tags
    and contains no npm token secret, but it has no required reviewer;
  - trusted publisher linkage remains unconfigured; alpha.2 used a short-lived
    scoped token fallback, after which the environment secret was removed, the
    token was revoked, and an authentication check confirmed it no longer
    works; these credential-state facts are recorded as operator observations
    because they cannot be corroborated from public release state;
  - secret validity checks and non-provider-pattern scanning remained
    unavailable or disabled.
- Hardened replay benchmark on Node.js 24.14.0, Darwin arm64:
  - 50,000 events: 316.35, 325.36, and 346.56 ms.
  - median: 325.36 ms.
- M3 Covenant adapter and offline run evidence recorded in conformance fixtures
  and merged integration history.
- Public M4 archive: Temporal TypeScript SDK pull request 2219 spanned 426,092
  source seconds, crossed separate local collector processes, and replayed to
  state digest
  `sha256:3f5a7478eb134cedbc2a1074cf07bc1b37629d684d0c9960f469368bee361f27`.
- Experimental v0alpha3 full local verification on 2026-07-26:
  - 166 prototype tests and four restart-adapter tests passed;
  - 53 conformance documents, eight runs, five canonical fixtures, 25 schemas,
    six locale/time-zone replays, and five temporal queries passed;
  - the stored bounds conclusion passed both schema validation and direct
    certificate verification;
  - prototype coverage measured 83.99% statements, 76.30% branches, 96.39%
    functions, and 85.42% lines; and
  - a 500-point, 499-constraint chain returned bounds `499..998`, verified its
    receipt, and measured a 31.42 ms median on Node.js 24.14.0.
- Local MCP alpha verification on 2026-07-27:
  - 22 store, server, CLI, stdio-limit, restart, correction, and receipt tests
    passed;
  - coverage measured 88.80% statements, 79.16% branches, 96.96% functions,
    and 90.88% lines;
  - the installed archive smoke used the registry-published core package,
    crossed a server restart, replayed the pre-correction and corrected cuts,
    and independently verified both receipts;
  - the archive allowlist rejected extra members, non-regular entries, and more
    than 8 MiB of aggregate member bytes before installation, and the release
    path produced byte-identical archives from two clean builds;
  - the MCP SPDX test covered the complete seven-package production dependency
    graph; and
  - 24 release-evidence tests covered closed record shape, exact artifacts,
    provenance identity, successful and publication workflow attempts,
    credentials, integration pins, and full-graph SBOM substitution.
- Source-first MCP and model-adapter verification on 2026-07-30:
  - the MCP store, server, CLI, stdio, pagination, restart, correction, schema,
    and receipt test suites passed;
  - 16 pilot tests crossed two real stdio server sessions, exercised run
    creation, discovery, direct append, projection, and reasoning, bound the
    transcript and append digest chain to the exported run, reproduced
    historical and corrected conclusions after deleting the input fixture, and
    rejected unsafe, oversized, symlinked, or malformed artifacts and inputs;
  - malformed, duplicate-key, invalid-UTF-8, truncated, and oversized protocol
    input exited nonzero with one sanitized diagnostic;
  - catalog calls read at most eight run files and return a
    generation-bound opaque continuation cursor, while standard MCP discovery
    advertises the complete resource template without a partial run list; and
  - the proposal compiler transformed all 36 public benchmark cuts into
    schema-valid candidate artifacts whose projected state, answers, and proofs
    matched the gold corpus; and
  - all 63 model-evaluation tests passed. The Ollama adapter verifies the
    configured runtime and installed-model digest before inference, checks the
    loaded-model digest afterward, fixes generation settings, and bounds
    model-controlled response values. No Ollama result is committed or
    published.
- Preregistered GPT-5.6 Sol model-interface evaluation on 2026-07-31:
  - all 324 primary and 108 teacher-forced observations completed without an
    operational error or formal retry;
  - Timeline produced 106/108 exact answers, 106/108 exact end-to-end
    artifacts, 0.9574 assertion F1, and 108/108 verified proofs;
  - bounded narrative memory produced 65/108 exact answers and stateless
    full-context structured extraction produced 107/108;
  - the paired Timeline difference against structured extraction was -0.0093
    with case-cluster `p = 0.875`; and
  - the fixed gate returned `kill`. The source-bound
    [release bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-eval-v1-gpt-5.6-sol-2026-07-31)
    contains raw results, scores, diagnostics, gate output, and checksums.
- Preregistered GPT-5.6 Sol deployment-shaped proposal-boundary evaluation on
  2026-08-01:
  - the first operationally valid attempt completed 108 observations with no
    permitted performance rerun;
  - 108/108 responses were schema-valid, 107/108 candidates compiled and
    produced a projected result, and every resulting proof verified;
  - assertion F1 was 0.7692, projected state and end-to-end output were exact
    on 76/108 observations, and final answers were exact on 87/108;
  - the model represented only 2/24 non-exact bounds correctly, while all 141
    gold signal records were selected and no distractor record was selected;
  - the fixed gate returned `kill`; and
  - the source-bound
    [release bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-proposal-v2-attempt-1-2026-08-01)
    contains the preregistration, corpus, raw results, score, gate, ledgers, and
    checksums. A defective acceptable-quote metric is documented but does not
    affect the independently failed assertion, state, or answer thresholds.
- `pnpm audit` and `pnpm audit --prod` reported no known findings on
  2026-07-30. The MCP integration uses the split Model Context Protocol v2
  packages at exact `2.0.0-beta.5` versions; beta API stability remains an
  explicit upgrade risk.

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
      duplicates, comments, and trailing commas, and stop diagnostics after the
      first parse issue to prevent adversarial error amplification.
- [x] **Create a fail-closed release workflow.** Releases need tag/version
      agreement, a clean rebuild, tests, artifact inspection, checksums, SBOM,
      provenance, and a tag-restricted npm environment. The workflow supports
      OIDC when configured and a short-lived protected-environment token
      fallback.
- [x] **Protect `main` and release tags.** `main` now requires the seven observed
      first-party checks and pull-request flow with administrator enforcement;
      force pushes and deletion are disabled. `timeline-v*` and
      `timeline-mcp-v*` tags cannot be updated or deleted under the active
      no-bypass ruleset.
- [x] **Establish registry package authority.**
      `@covenant-org/timeline@0.0.0-alpha.2` was published from the protected
      release tag with npm provenance, GitHub build and SBOM attestations, and
      clean-install verification. A schema-validated release record binds the
      source, component versions, protocol inputs, workflow attempt, registry
      metadata, artifacts, SBOM, and attestations; a separate network verifier
      rechecks the public bytes, remote tag, attestation signatures and
      identities, transparency log, and installed package.

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
- [x] **Contract-bind evaluator identity in a new alpha schema.** v0alpha2
      checkpoints bind `profile`, `policyRef`, and `policyDigest`; evaluation
      events cannot override them, mismatched evidence fails closed, and an
      explicit migration preserves v0alpha1 history.
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
- [x] **Provide a bounded agent integration.** The local stdio MCP server
      exposes four read-only model tools and three operator-only mutation tools.
      Proposal preview resolves request-scoped handles, binds exact source
      spans, and returns a verified candidate without persistence. Admission
      recompiles that candidate, requires its exact digest, and atomically
      records its events with the host's authority and policy decision. The
      server persists canonical runs and admission envelopes with crash-aware
      replacement and writer locks; bounds messages, runs, events, bytes, graph
      work, and proof output; and exposes separate run and audit resources.
      Catalog discovery is paginated, fatal protocol input exits nonzero, and
      the local MCP pilot exports a restart-spanning artifact that a separate
      process verifies offline.
- [x] **Run the frontier-model gates.** The operationally valid GPT-5.6 Sol v1
      run met its absolute thresholds and beat bounded narrative memory, but
      failed the required comparison with stateless full-context structured
      extraction. The deployment-shaped proposal-boundary v2 run then achieved 0.7692
      assertion F1 and 76/108 exact end-to-end states. Both fixed gates returned
      `kill`. Their source-bound raw results and checksums are public. Model
      proposals remain preview-only until a separate operator admits the exact
      candidate.
- [ ] **Obtain independent operation.** The durable adapter and second-language
      reducer are repository-maintained references. Neither is independent
      evidence until another organization operates or maintains one.

## Medium Priority (P2 - Fix Soon After Launch)

- [x] **Define host observability guidance.** Document safe metrics and logs
      without leaking evidence identifiers or payload-derived data.
- [ ] **Define correction and branch semantics.** Alpha supports
      rejected-to-accepted correction only. Accepted decisions need a versioned
      supersession or branch model before mutable workflows can rely on them.
- [x] **Publish and exercise one authority profile.** The GitHub v1 profile
      specifies Ed25519 collector keys, policy and payload digests, freshness,
      revocation, exact required checks, review, merge, and optional deployment
      evidence.
- [x] **Prove one longitudinal restart.** The public archive spans five source
      days and separate local collection processes, and the Temporal integration
      test crosses a worker restart. This proves the mechanism, not external
      adoption.
- [x] **Decide snapshot hydration from measurement.** Full replay at the
      supported 50,000-event maximum measured a 325.36 ms median. Portable
      hydration is deliberately deferred until adopter evidence shows replay is
      an operational constraint.
- [ ] **Exercise rollback.** Verify package deprecation/yank instructions and
      historical run verification against a released artifact.
- [ ] **Complete credentialless publishing.** Exercise OIDC trusted publishing
      and require `npm` environment reviewers. This is preferred supply-chain
      hardening for beta and stable releases; the short-lived token path remains
      acceptable for alpha releases.
- [ ] **Stabilize the MCP SDK dependency.** The server pins the split v2 SDK
      exactly and its current dependency graph audits cleanly, but the selected
      SDK release is still a beta. Re-evaluate the pin when a compatible stable
      v2 release is available.

## Low Priority (P3 - Technical Debt)

- [ ] Add browser-runtime compatibility only if an adopter needs it; the current
      package intentionally targets Node.js.
- [ ] Add richer inspection filters after the stable machine report contract is
      adopted.
- [ ] Add benchmark trend storage once run sizes from real adopters are known.

## Security Assessment

### Assets

- Canonical contract, event, run, state, and artifact bytes.
- The binding between a run, its requirements, its authority policy, and its
  effect template.
- Signed authority envelopes, collector keys, and revocation state.
- Idempotency keys and the host decision to execute a command.
- Evidence payload digests and potentially sensitive producer metadata.
- Package source, release artifacts, checksums, SBOM, and provenance.

### Trust Boundaries

- JSON or JavaScript values entering the package.
- Portable run files entering the CLI.
- Evidence metadata entering a host runtime.
- Profile-specific collector output entering evidence admission.
- Commands leaving the pure reducer for an effect adapter.
- Receipts returning from an effect adapter.
- Local MCP messages and files entering the reference store.
- GitHub Actions publishing to npm.

### Principal Risks

- Same-ID contract substitution can change requirements or effect templates
  unless exact contract bytes are bound.
- A v0alpha1 event can supply any syntactically valid `policyRef`; the released
  version records it without establishing that the named policy exists or was
  enforced.
- A v0alpha2 host can still bypass its profile and fabricate a structurally
  valid evidence record. Profile verification is an admission responsibility,
  not a network call performed by generic replay.
- A collector key compromise remains authoritative until the host loads policy
  bytes that bind a revocation list containing that key.
- Claims are declarative and can be self-asserted unless a host validates
  producer authority and payload integrity.
- The operator MCP role can admit structurally valid but false records. Role
  separation and durable admission records make that decision explicit; they
  do not authenticate the operator, evidence, authority, or policy. A host must
  isolate the operator process and enforce those controls before admission.
- A process with write access to the MCP data directory can replace or delete
  run files. The store refuses symlinks and non-regular entries, while
  canonicalization and digests detect malformed or internally inconsistent
  records; none of these checks defeats a compromised host.
- The reference MCP file store coordinates one local filesystem. Shared network
  filesystems and multiple machines require a different persistence adapter.
- Receipt status and effect digest are declarations unless the host validates
  them against the external system.
- Duplicate JSON keys and unbounded input create ambiguity and denial-of-service
  paths.
- Producer, subject, policy, and evidence identifiers may be operationally
  sensitive even though payload bytes are excluded.
- A compromised release path could replace the verifier used to validate
  historical runs.

Cryptographic evidence verification is intentionally profile-specific. It is
not present in generic v0alpha1 or v0alpha2 replay. No deployment may translate
structural verification into authority unless evidence first passes the
contract-bound profile.

## Performance Assessment

Full replay uses one private mutable accumulator while public single-event
reduction stays immutable. Three 50,000-event runs measured 316.35, 325.36, and
346.56 ms on Node.js 24.14.0, Darwin arm64. Explicit event, checkpoint,
collection, canonical-depth, canonical-node, and CLI-byte limits bound
reference-implementation work.

These are local measurements, not an adopter workload model. The archive store
therefore persists exact contract and event bytes and replays them after
restart; it does not pretend that a process-local projection is a portable
snapshot. Trend storage and snapshot hydration should wait for an independent
host to demonstrate need.

The MCP reference store separately limits a stored envelope to 2,000 events and
4 MiB, limits a directory to 256 runs, and limits incoming protocol messages to
1 MiB. MCP catalog discovery reads at most eight run files per call and
continues with a cursor bound to the current catalog generation. Creating or
deleting a run invalidates that cursor rather than skipping an entry. Every new
event validates the complete candidate run and uses the current whole-run
digest as its compare-and-swap token. An exact same-ID retry is idempotent only
when its admission decision is also identical. The audit digest binds the run
and its complete admission coverage. These limits make local alpha behavior
bounded; they are not throughput claims for a remote or multi-tenant service.

## Observability Assessment

The generic library is correctly free of implicit logging and network calls.
The canonical report and stable findings are useful machine telemetry. Host
metric guidance, privacy-safe cardinality rules, stable CLI input codes, and
explicit structural assurance scope are documented. Repository-owned
collectors and adapters exercised them, but no independent operator has.

Recommended host metrics:

- replay duration and event count;
- validation failures by stable code, never raw payload;
- findings by stable code;
- pending, rejected, unresolved, and failed counts;
- command dispatch and receipt latency outside the core;
- package/spec/profile versions attached to every observation.

## Recommended Architecture Changes

1. Maintain the temporal kernel as an audit and replay component inside
   Covenant or another system with a measured need; do not expand the
   standalone model-memory product under the failed v1 claim.
2. Obtain one externally operated temporal pilot using the checked-in workflow;
   publish the MCP package as a distribution step when registry access is
   available.
3. Add an independently maintained implementation of the temporal RFC before
   any beta interoperability claim.
4. Exercise accepted-decision correction and branch semantics only from a real
   incident; do not invent an untested branch protocol.
5. Add an eligible protected-environment reviewer and npm trusted publishing
   before beta or stable; retain the tested short-lived fallback for alpha.
6. Exercise deprecation and historical verification before declaring rollback
   operational.
7. Add portable snapshot hydration only if independent measurements require it.

## Test Coverage Gaps

- Both preregistered model results are published and negative. No new balanced,
  held-out evaluation has tested a materially different selection-first model
  interface, and no result supports automatic model-authored admission.
- No independently operated temporal pilot.
- No independently maintained temporal implementation.
- No production deployment evidence in the public archive.
- No accepted-decision supersession or branch corpus.
- No external workload measurement beyond the five-day archive's small event
  count.
- No portable snapshot hydration test; intentionally deferred because replay at
  the supported maximum remains subsecond locally.
- OIDC trusted publishing and a required `npm` environment reviewer remain
  unconfigured.
- No public registry or provenance evidence for the MCP package has been
  recorded yet; local package and release checks do not substitute for that
  release evidence.

## Action Plan

1. Preserve v0alpha1 replay and the v0alpha2 migration corpus on every release.
2. Integrate the deterministic kernel where Covenant needs temporal audit or
   replay, and measure the operational value.
3. Complete one external temporal pilot with replayable evidence if an
   independent operator has the same need.
4. Support a separately maintained temporal implementation through the shared
   conformance target.
5. Record real correction incidents before specifying branch semantics.
6. Configure protected-environment review and exercise OIDC before beta or
   stable, without making those external controls an alpha release gate.
7. Exercise package deprecation and historical verification as a rollback
   drill.

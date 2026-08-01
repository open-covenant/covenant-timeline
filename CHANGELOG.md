# Changelog

## Unreleased

### `@covenant-org/timeline` 0.0.0-alpha.3 candidate

#### Added

- Add a checked correction-and-replay example with before, inconsistent
  transition, and after knowledge cuts; content-bound evidence documents; exact
  conclusion fixtures; verifier-checked proofs; and a repository command that
  reproduces the complete artifact.
- Add the model-interface v1 benchmark: 12-case development and deterministic
  paraphrase corpora; primary narrative-memory, structured-extraction, and
  Timeline arms; a secondary direct-answer reference; a one-shot JSONL adapter
  protocol; strict admission and capacity limits; replayable request and
  response artifacts; paired scoring; and adversarial harness tests.
- Add teacher-forced prior-state diagnostics and a preregistered frontier-model
  gate with fixed configuration, absolute and comparative thresholds,
  per-repeat floors, case-clustered exact tests, and a continue-or-kill decision.
- Add deterministic model-proposal compilation with request-scoped handles,
  exact UTF-8 quote provenance, content-addressed ledger candidates, closed JSON
  Schemas, a bounded provider-schema projection from each host snapshot,
  bounded hostile-input validation, complete candidate re-verification, and
  lowering-equivalence coverage across all 36 public benchmark cuts.
- Add the model-proposal boundary benchmark with opaque model inputs,
  request-bound provider schemas, rolling failure continuity, one-shot Ollama
  and OpenAI adapters, clean-source and runtime binding, atomic result
  publication, independent scoring, and an exact 36-cut boundary oracle.
- Add companion trajectory diagnostics that preserve the benchmark score while
  exposing first errors, later rolling observations, degraded prior state, and
  admitted-with-error counts.
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
- Add a credential-free local Ollama benchmark adapter with preflight
  installed-model checks, post-inference loaded-model digest verification,
  fixed generation settings, structured output, bounded provider handling,
  token accounting, and source-bound configuration generation.
- Verify the proposal compiler, complete candidate verifier, source-span
  provenance, and temporal proof from the installed core tarball.

#### Changed

- Preserve the first deployment-shaped proposal-boundary attempt as a public
  `kill` result after it reached 0.7692 assertion F1 and 76/108 exact projected
  states.
- Keep candidate notes undated until a release tag exists, verify onboarding
  copy in the packed README, retain release assets before registry publication,
  and reject unexpected or oversized package members.
- Publish the preregistered GPT-5.6 Sol model-interface result and record its
  `kill` decision after Timeline failed to beat stateless full-context
  structured extraction on answer accuracy. Stop standalone model-memory
  expansion while retaining the deterministic kernel, replay, and proof
  verifier.
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
  evaluation required before any broad efficacy claim.
- Record the alpha.2 token-fallback publication and operator-observed credential
  cleanup without presenting trusted publishing as an alpha release gate.
- Record unsupported OpenAI temperature control as `null` and omit the provider
  parameter instead of claiming a sampling setting the selected model rejects.
- Move artifact upload to its Node.js 24 action and consolidate SBOM
  attestation on the supported GitHub attestation action.
- Bound every model-controlled response collection and free-form string, and
  make exact coordinates, difference direction, current-evidence support,
  independent corroboration, references, sequences, and duplicate checks
  explicit in the Timeline extraction prompt.
- Reject semantically duplicate Timeline claims and benchmark-scale excess in
  the host admission path without renumbering, deduplicating, or repairing model
  output.

#### Security

- Stop strict JSON diagnostics at the first parse issue to prevent adversarial
  error amplification.
- Distinguish local-model output-token exhaustion from other provider failures
  without retaining partial model output.

### `@covenant-org/timeline-mcp` 0.0.0-alpha.1 candidate

#### Added

- Add the local stdio server with restart-safe persistence, correction replay,
  read-only model proposal previews, explicit operator admission, and verified
  temporal conclusions. The package pins `@covenant-org/timeline` alpha.3 and
  validates that registry dependency in an isolated release-candidate install.
- Add seven bounded temporal-state tools, portable run and admission-audit
  resources, explicit knowledge cuts, optimistic concurrency, canonical
  append-only persistence, restart recovery, and a separate reproducible
  release workflow.
- Add a local MCP restart-and-correction pilot that hashes
  retained evidence, chains append digests, exports the complete pilot artifact
  and tool transcript, and verifies historical and corrected conclusions in a
  separate offline process.

#### Changed

- Split the MCP model and operator roles, replace direct model-proposal writes
  with read-only candidate previews and explicit operator admission, and bind
  every persisted event to an auditable authority, policy, and writer identity.
- Load MCP and Timeline runtime version identities from their installed package
  manifests so admission provenance cannot drift from shipped package metadata.
- Describe MCP input semantics in tool discovery, cap each catalog page at
  eight runs, bind cursors to a catalog generation, cap reference-store
  configuration at its advertised ceilings, and make the source checkout a
  complete agent-integration path.

#### Security

- Exit the stdio server with a failure status after malformed or oversized
  protocol input while retaining one sanitized diagnostic.
- Refuse symlinked and non-regular MCP run files without blocking on special
  filesystem entries.

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

# Roadmap

This roadmap follows one product line: a portable temporal reasoning substrate
for AI systems. Dates are planning ranges, not release promises.

M0–M4 established the checkpoint protocol and its adoption evidence. v0alpha1
and v0alpha2 remain immutable compatibility formats. v0alpha3 defines the
temporal product line beginning at M5.

## M0: Narrow the first release

Status: complete

- Define the first Timeline release as a checkpoint-contract verifier, not a
  workflow runtime.
- Make software and long-running agent work the first profile.
- Remove universal scoring and premature financial-domain claims.
- Establish the standalone repository as the portable source of truth.
- Keep Covenant integration behind an adapter boundary.

Exit criteria:

- The README, specification, implementation, and organization overview describe
  the same released product.
- `pnpm demo` produces a useful verified run.
- `pnpm verify` passes.

## M1: Minimal portable checkpoint core

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

- Canonical output agrees across TypeScript and Python and across supported
  platforms.
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

- Covenant pins the M1–M3 Timeline implementation revision from its adapter
  metadata.
- The adapter maps provenance and audit records to payload-free evidence,
  commands to typed capability requests, and typed responses to receipts.
- The pause, resume, review, and release run verifies offline with its state
  digest pinned.

## M4: Checkpoint adoption evidence

Status: implementation complete; independent operation pending

- [x] GitHub software-delivery authority profile covering payload binding,
      collector authentication, freshness, revocation, checks, review, merge,
      and policy identity.
- [ ] Independently operated adapter. A Temporal.io reference adapter passes a
      local-server worker-restart test, but it is maintained in this project.
      The evidence contract is in
      [`docs/adoption-guide.md`](./docs/adoption-guide.md), and the pilot path is
      in [`docs/operator-pilot.md`](./docs/operator-pilot.md).
- [x] Public longitudinal archive spanning five source days, separate collector
      processes, CI, approved review, archive effect, and receipt verification.
- [x] Contract-bound evaluator identity in v0alpha2 with explicit v0alpha1
      migration.
- [x] Atomic portable run archive and storage interface.
- [x] Snapshot hydration rejected after a 325.36 ms median replay at the
      supported 50,000-event maximum.
- [x] Python implementation of the portable v0alpha2 reducer.
- [ ] Correction and branch semantics driven by real operator incidents.

Exit criteria:

- One external project operates the checkpoint protocol without Covenant.
- One authority profile authenticates real evidence.
- One exported run crosses a process restart and remains independently
  verifiable.
- The evaluator policy is contract-bound or absent.
- Both implementations pass the same conformance corpus.
- Upgrade tests preserve historical verification.

Current exit status:

- Policy binding, profile authentication, restartable archive, migration, and
  cross-language criteria pass.
- Independent operation, external adoption, and independent maintenance remain
  open.
- These open adoption items continue in parallel but do not block M5.

## M5: Temporal-first contract and kernel

Status: in progress; RFC Draft and implementation experimental

- Define the v0alpha3 contract, event, query, and conclusion families.
- Add explicit discrete axes and isolated actual, planned, forecast, and
  hypothetical contexts.
- Add dynamically declared points, proper intervals, digest-referenced coordinate
  assertions, and difference constraints.
- Project active state through explicit event-sequence knowledge cuts with
  append-only retraction and supersession.
- Implement a resource-bounded, exact-integer Simple Temporal Network kernel
  for consistency, tight difference bounds, point relations, and Allen interval
  relations.
- Return query-specific semantic results and reasoner-bound proof receipts.
- Expose TypeScript library, CLI, schema, fixture, and model-facing JSON
  surfaces.
- Preserve all v0alpha1 and v0alpha2 bytes and digests.

Exit criteria:

- A model or application can submit portable state and a typed query without
  using a hosted service.
- The result distinguishes resolved, indeterminate, unbounded, and inconsistent
  cases without inventing precision.
- Schedules, paths, relation cases, and negative cycles verify against the
  pinned projection.
- Resource limits fail deterministically.
- The full historical and v0alpha3 conformance suites pass.
- Public docs label v0alpha3 as experimental until RFC governance completes.

## M6: Knowledge time and proof interoperability

Status: planned

- Harden historical knowledge cuts across correction, supersession, and
  retraction.
- Add valid-time facts and explicit completeness semantics without inferring
  absence from silence.
- Add a pinned civil-time normalization profile for calendar-based workflows,
  named time zones, and daylight-saving ambiguity.
- Define proof profiles and independent proof-verification rules.
- Add an independent second implementation and property-generated cases checked
  against a solver oracle.
- Test query-scoped conflicts so unrelated inconsistent components do not
  contaminate otherwise answerable queries.

Exit criteria:

- Later corrections never alter answers at earlier knowledge cuts.
- Every definite result has an independently checkable derivation or witness.
- Underdetermined cases remain indeterminate.
- Implementations agree on canonical semantic results and verify each other's
  supported receipts.
- Results remain stable across locale, time zone, assertion order, restart, and
  supported platforms.

## M7: Model inference bridge

Status: planned

- Add constrained text-to-IR and typed-query interfaces with source-span or
  payload provenance.
- Return bounded temporal-state capsules carrying checked results, unresolved
  alternatives, and repair diagnostics.
- Admit verified temporal conclusions into checkpoint or downstream decision
  profiles.
- Bind decisions and plans to exact state, query, and semantic-result digests.
- Compare direct prompting, chain of thought, and kernel-integrated inference
  across fixed models and evidence.

Exit criteria:

- Held-out evaluation shows a repeatable relative error reduction without
  increasing unsupported definite answers.
- Extraction, admission, solver, and final-answer failures are reported
  separately.
- A downstream consumer rejects conclusions that no longer match the pinned
  temporal state.

## M8: Longitudinal temporal operation

Status: planned

- Run a real workflow across weeks, process restarts, delayed observations,
  corrections, concurrent work, and deadlines.
- Preserve reproducible temporal queries across model changes and context
  compaction.
- Measure temporal errors and manual reconciliation before and after
  integration.
- Recruit an independent model or runtime operator.
- Add obligation or state-transition semantics only when observed workflows
  require them.

Exit criteria:

- An independent operator reproduces every checked temporal conclusion.
- The run demonstrates measured operational value beyond synthetic cases.
- No conclusion substitutes record sequence for occurrence time.
- Exported records remain sufficient after the original runtime is unavailable.

## M9: Model-integrated temporal research

Status: planned

- Integrate the kernel into constrained decoding or another inference stage.
- Train or adapt an open-weight model on temporal IR and proof traces.
- Compare base, prompt-only, tool-integrated, and model-integrated systems on
  frozen hidden tests.
- Measure transfer beyond templates and memorized time-sensitive facts.

Exit criteria:

- Architecture or training genuinely incorporates temporal state into
  inference.
- Inference-integrated and model-native claims remain distinct.
- Any model-native gain persists on held-out structures when the external
  kernel is withheld.
- Results are independently reproducible before the project uses
  “model-native” as a capability claim.

## M10: Interoperable beta

Status: planned

- Complete RFC governance and publish the compatibility policy.
- Stabilize TypeScript and one additional language implementation.
- Complete security, privacy, and resource-exhaustion review.
- Exercise migrations across real package upgrades.
- Establish independent maintenance and release participation.

Exit criteria:

- At least one external model or runtime uses the temporal contract.
- Two independently maintained implementations agree on the conformance
  corpus.
- Real runs have crossed multiple releases and upgrades.
- No critical canonicalization, projection, proof, provenance, or adapter
  authority finding remains unresolved.
- External operators can run and upgrade Timeline without Covenant services.

## Deferred

The following are not beta requirements:

- a distributed runtime;
- a general policy language;
- WASM plugins;
- trading or prediction-market profiles;
- financial authority;
- universal agent reputation;
- engineering simulation standards;
- broad dashboard and operator infrastructure;
- dense-time reasoning, arbitrary disjunctive interval algebra, or dynamic
  controllability; and
- general calendar, recurrence, and cross-axis conversion semantics.

They may return through the expansion gate in [`PROGRAM.md`](./PROGRAM.md).

Medical, scientific, and other high-stakes profiles remain deferred until
independent domain experts own their evidence semantics, privacy boundaries,
and safety evaluation. A domain-neutral temporal kernel does not supply that
authority.

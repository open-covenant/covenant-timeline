# Roadmap

This milestone sequence is the semantic build order. The
[twelve-month program](./PROGRAM.md) adds staffing, overlapping workstreams,
domain rollout gates, governance, security, conformance, adoption, and v1 exit
criteria.

The roadmap is ordered by semantic dependency. Broad integration work starts
only after the portable contract and evidence models are stable enough to avoid
partner-specific behavior leaking into the core.

## M0: Standalone project

Goal: establish Covenant Timeline as an independent open-source project.

- Create the `open-covenant/covenant-timeline` repository.
- Move the incubation package with history preserved.
- Add Apache-2.0 license, governance, contribution, security, and release docs.
- Publish the architecture as an RFC and record accepted decisions.
- Establish neutral project identity and public issue templates.
- Keep Covenant as a reference integration in its own adapter.

Exit criteria:

- Fresh clone builds without the Covenant monorepo.
- No core package imports Covenant code.
- Covenant can pin a version rather than copy source.
- Public claims match implemented behavior.

## M1: Specification and conformance

Goal: make semantics portable before multiplying implementations.

- Version JSON Schemas for contracts, clocks, checkpoints, evidence,
  evaluations, scorecards, runs, and attestations.
- Define canonical JSON serialization and hash construction.
- Specify calendar, logical, external, and event clocks.
- Define missing-evidence and confidence semantics.
- Define checkpoint state transitions and idempotency keys.
- Publish positive and negative conformance fixtures.
- Add schema compatibility and migration rules.

Exit criteria:

- Invalid contracts fail with stable machine-readable errors.
- Equivalent contracts compile to identical canonical plans and hashes.
- Cross-clock comparison fails unless a mapping is declared.
- Fixtures cover leap years, month boundaries, duplicated events, replay, and
  policy substitution.

## M2: Deterministic core

Goal: ship the canonical compiler and evaluator.

- Implement `timeline-core` in Rust.
- Compile contracts into explicit checkpoint plans.
- Implement policy pinning and evaluator registries.
- Implement evidence-set and evaluation-set roots.
- Implement vector scorecards and optional aggregates.
- Implement deterministic run export and verification.
- Build the TypeScript SDK and WASM bindings against the same fixtures.

Exit criteria:

- Rust, TypeScript, and WASM pass one conformance suite.
- Repeated compilation and evaluation are byte-equivalent.
- Aggregate scores can be decomposed into evidence and dimension
  contributions.
- The core performs no implicit I/O or external effects.

## M3: Durable runner

Goal: execute long timelines safely.

- Add SQLite-backed runs, leases, retries, pause, resume, and cancellation.
- Add scheduled and event-triggered checkpoint eligibility.
- Separate dry replay from effectful re-execution.
- Add executor budgets, timeouts, and capability hooks.
- Add content-addressed evidence storage.
- Add deterministic export, import, and branch creation.
- Expose CLI, HTTP, and MCP surfaces.

Exit criteria:

- A run survives process and host restarts.
- Duplicate delivery cannot execute a checkpoint twice.
- Every external effect has an idempotency key and audit record.
- A run can fork from any accepted checkpoint.
- Read-only replay performs no external side effects.

## M4: Software evolution vertical

Goal: prove the project on long-horizon engineering.

- Add Git repository and commit-range clocks.
- Add CI, test, coverage, lint, type-check, dependency, and security
  collectors.
- Add PyDriller-based churn, complexity, maintainability, and process metrics.
- Add OpenHands and SWE-agent executor adapters.
- Add requirement-release and milestone inputs.
- Add regression, volatility, recovery, and sustained-improvement evaluators.
- Import compatible SWE-CI and SWE-EVO tasks without copying their harness
  semantics into the core.
- Ship a reference dashboard for snapshots and trajectories.

Exit criteria:

- A multi-release build runs end to end from contract to verified trajectory.
- Every snapshot links source state, requirements, toolchain, evidence, and
  scorecard.
- The system catches a seeded regression and attributes its first appearance.
- The final score cannot hide a failed intermediate checkpoint.
- Code-volume policies use ranges or ceilings rather than exact padding
  incentives.

## M5: Agent capability and trust

Goal: produce scoped, explainable longitudinal agent scorecards.

- Define capability-scoped subject identifiers.
- Add delivery, policy, budget, dispute, repair, recency, and sample-size
  dimensions.
- Add confidence and evidence-strength models.
- Add explicit scorecard aggregation policies.
- Add credit-limit policies for agent budgets and delegated authority.
- Add challenge, dispute, correction, and score-expiry flows.
- Add privacy-preserving public views that omit sensitive evidence payloads.

Exit criteria:

- No API exposes an unexplained universal agent score.
- Every score names capability, environment, policy, and time window.
- Credit changes are reproducible from the linked policy and evidence.
- Corrected evidence produces a new scorecard without rewriting history.

## M6: Financial operations and market lifecycle

Goal: prove the temporal and evidence model under financial safety constraints.

- Add strict available-at-decision-time replay and simulation.
- Add spot order, execution, settlement, and reconciliation schemas.
- Add venue-specific perpetual margin, funding, oracle, liquidation, and
  deleveraging adapters.
- Add prediction-market rules, amendments, determination, dispute, finality,
  and payout schemas.
- Add hard risk policies independent of scorecards.
- Add scoped, expiring financial mandate recommendations.
- Add simulation, paper, shadow, capped-live, and production environment
  identities.
- Add model-risk, market-risk, accounting, and authority invariant tests.

Exit criteria:

- Replay and backtests reject future evidence.
- Agents cannot change or extend their own authority.
- Every value movement reconciles to an authorization, execution, and receipt.
- Financial examples remain simulated or read-only until independent security
  and risk gates pass.
- No score, profit, or attestation can override a hard limit.

## M7: Covenant reference integration

Goal: make Covenant the strongest real deployment without coupling the core.

- Add Covenant intent and workflow executors.
- Map audit rows, provenance envelopes, capabilities, budgets, memory, and
  settlement receipts into evidence.
- Persist timeline ownership in resumable handoff state.
- Gate effectful checkpoints through Covenant capabilities.
- Sign run and scorecard roots.
- Surface timelines through CLI, HTTP, MCP, TUI, and web.
- Add migration from the incubation package to a pinned standalone release.

Exit criteria:

- Covenant can plan and score a long engineering build through the standalone
  engine.
- Timeline execution remains functional with all on-chain publishers disabled.
- Capability denial blocks effects without corrupting the run.
- Audit and timeline roots can be independently recomputed.

## M8: Integration and attestation adapters

Goal: make timelines useful across Covenant's existing integration surfaces.

- x402 settlement and provider-delivery timelines.
- Hyre cost, reliability, and output scorecards.
- MagicBlock provenance-root and enclave-health timelines.
- Metaplex and ERC-8004 scorecard attestations.
- zauth provider health and settlement telemetry.
- Generic webhook, OpenTelemetry, and signed JSON evidence adapters.
- Adapter certification against contract and evidence conformance suites.

Exit criteria:

- Each adapter can be disabled without changing core results.
- Partner telemetry declares authority, freshness, and confidence.
- Attestations commit to scorecard and evidence roots, not opaque claims.
- No integration can redefine clock ordering or score semantics.

## M9: Distributed operation and v1

Goal: stabilize the protocol for independent operators.

- Multi-worker execution with lease and conflict semantics.
- PostgreSQL and object-store adapters.
- Transparency-log publication and witness verification.
- Signed adapter manifests and evaluator provenance.
- Backward-compatible schema and SDK guarantees.
- Reproducible release artifacts and software bill of materials.
- Public conformance service and compatibility matrix.
- Independent deployment and fork documentation.

Exit criteria:

- Two independent implementations produce identical conformance outputs.
- A third party can fork, run, and verify a timeline without Covenant services.
- v1 schemas have documented compatibility guarantees.
- Security review covers executors, evidence integrity, replay, scoring, and
  publication.

## Immediate build order

1. Extract the package into the standalone repository.
2. Replace the date-only prototype with clock-neutral schemas.
3. Land canonical hashing and conformance fixtures.
4. Implement the Rust compiler and evaluator.
5. Build the software-evolution vertical as the first proof.
6. Integrate the pinned release back into Covenant.
7. Add scoped agent capability and credit scorecards.
8. Prove financial replay, risk, and reconciliation before any live effect.
9. Expand into partner adapters only after the evidence contract is stable.

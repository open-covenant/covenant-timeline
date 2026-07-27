# Project Charter

## Mission

Covenant Timeline gives AI systems portable temporal state and a deterministic,
proof-producing way to reason over events, intervals, uncertainty, and change.
Long-running agents are the first proving ground.

## Project surfaces

The project governs:

- the temporal contract, event, query, and conclusion specifications;
- normative schemas and canonicalization;
- the deterministic reference kernel and proof verifier;
- the conformance corpus and non-normative model-interface benchmark;
- portable SDK and CLI interfaces;
- reference adapters; and
- the frozen v0alpha1 and v0alpha2 checkpoint compatibility formats.

Covenant is the first adopter. It is not a required dependency and does not own
portable protocol semantics.

## Core invariants

Temporal conclusions are derived from pinned state, an explicit knowledge cut,
and a typed query. Ambiguity and contradiction remain visible. Results carry
enough evidence for another conforming implementation to check them.

Model output and referenced evidence are proposals, not truth. Hosts remain
responsible for source authentication, admission authority, and domain policy.
Timeline does not execute external effects.

## Non-goals

Covenant Timeline does not:

- replace workflow engines, databases, event processors, or calendars;
- execute agents, tools, deployments, or transactions;
- infer causality from temporal order;
- define a universal ontology, trust score, or source of truth;
- make security or fitness claims through schema conformance; or
- claim model-native temporal reasoning without controlled model-level
  evidence.

## Bootstrap stage

Open Covenant sponsors and administers the repository during bootstrap. The
project does not yet claim organizational neutrality.

Transition from bootstrap governance requires:

- at least three active maintainers from two organizations;
- one independently maintained conforming implementation;
- six months of visible contribution and decision history; and
- an accepted governance-transition RFC.

Charter changes require an RFC and a fourteen-day final-comment period.

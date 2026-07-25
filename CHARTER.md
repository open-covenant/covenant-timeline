# Project Charter

## Mission

Covenant Timeline makes the evolution of long-running agent and software work
portable, replayable, and independently verifiable.

## Project surfaces

The project governs:

- the temporal contract and event specification;
- normative schemas and canonicalization;
- the conformance corpus;
- the deterministic reference reducer and verifier;
- portable SDK interfaces;
- reference adapters and the software-work profile.

Covenant is the first adopter. It is not a required dependency and does not own
portable protocol semantics.

## Core invariant

The reducer produces state, decisions, findings, and command requests from
pinned inputs. It never performs external effects. Adapters execute separately
authorized commands and return receipts as later events.

## Non-goals

Covenant Timeline does not:

- replace durable workflow engines, databases, or event processors;
- execute agents, tools, deployments, or financial transactions;
- define a universal quality, trust, reputation, or credit score;
- treat signatures, attestations, or model output as proof that a claim is true;
- make security or fitness claims through schema conformance;
- standardize unrelated disciplines before adopters exist.

## Bootstrap stage

Open Covenant sponsors and administers the repository during bootstrap. The
project does not yet claim organizational neutrality.

Transition from bootstrap governance requires:

- at least three active maintainers from two organizations;
- one independently maintained conforming implementation;
- six months of visible contribution and decision history;
- an accepted governance-transition RFC.

Charter changes require an RFC and a fourteen-day final-comment period.

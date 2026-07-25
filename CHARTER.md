# Project Charter

## Mission

Covenant Timeline develops portable, executable, and independently verifiable
temporal contracts for work that unfolds across time.

## Project surfaces

The project governs:

- the language-neutral specification;
- normative schemas and canonicalization;
- the conformance corpus;
- the deterministic reference kernel;
- durable runtime contracts;
- SDK and plugin interfaces;
- governed domain profiles and reference adapters.

Covenant is the first adopter and reference adapter. It is not a required
dependency and does not own protocol semantics.

## Core invariant

The deterministic reducer produces state, findings, decisions, and effect
requests. It never performs external effects. Effectors execute independently
authorized commands and return receipts as later events.

## Non-goals

Covenant Timeline does not:

- replace workflow engines, event processors, exchanges, ledgers, or databases;
- hold funds, select trades, or certify profitability;
- define a universal trust or credit score;
- support human consumer, employment, housing, or insurance credit decisions;
- treat signatures, attestations, or scores as proof that a claim is true;
- make policy, security, regulatory, or fitness claims through conformance.

## Bootstrap stage

The project is sponsored and administratively controlled by the Open Covenant
organization. It does not yet claim vendor or organizational neutrality.

Transition from bootstrap governance requires:

- at least three active maintainers from two organizations;
- an independently maintained conforming implementation outside Covenant;
- six months of visible contribution and decision history;
- an accepted governance-transition RFC.

Charter changes require an RFC and a fourteen-day final-comment period.

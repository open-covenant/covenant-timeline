# Roadmap

Covenant Timeline advances when public evidence resolves a product risk. The
current risks are the model interface, operational value, and protocol
portability.

Release history and completed milestones belong in the
[changelog](./CHANGELOG.md). This document covers the shipped foundation and
the next evidence gates.

## Shipped foundation

- **v0alpha1** is the frozen checkpoint contract for deterministic requirement
  coverage, event replay, commands, and receipts.
- **v0alpha2** adds contract-bound evaluator identity while preserving
  v0alpha1 history.
- **v0alpha3** is the experimental temporal contract defined by
  [Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md). The npm alpha
  includes explicit axes and contexts, points and intervals, bounded
  constraints, historical knowledge cuts, typed queries, a deterministic
  temporal kernel, and independently checkable proof receipts.

The reference implementation, schemas, conformance cases, CLI, model-facing
interface, and compatibility suites are available now. They establish a
working substrate, not adoption or model-quality evidence.

## Current gates

### 1. Model-interface benchmark

The checked-in
[model-interface benchmark v1](./benchmarks/model-interface/v1/README.md) is a
public development and smoke suite. Its 12 visible cases exercise the adapter,
failure accounting, temporal extraction, rolling state, and scorer across
direct text, narrative memory, and Timeline. No external model evaluation has
been run, and no model result has been published.

An external v1 run is useful for validating the harness and exposing immediate
interface failures. It cannot establish a general performance gain because the
corpus, prompts, and expected structures are public and small.

The model gate closes only through a preregistered blinded scale suite that:

- uses opaque case and entity identifiers that do not reveal the tested
  relation or expected answer;
- includes distractor evidence and no-op cuts so the model must decide when
  state should remain unchanged;
- evaluates controlled paraphrase families without exposing held-out wording
  during adapter development;
- spans rolling histories from 20 to 200 cuts;
- fixes context and memory budgets before corpus generation, independently of
  the gold Timeline serialization;
- reserves generation seeds and case variants that are unavailable during
  prompt and adapter development;
- keeps the model, decoding configuration, retry policy, and structured-output
  constraints identical across paired arms;
- counts malformed output, admission failures, and unsupported definite
  answers as failures; and
- reports uncertainty with case-clustered statistical inference so repeated
  cuts from one case are not treated as independent observations.

The preregistration must name the primary outcome, exclusions, stopping rule,
sample size, model configuration, and analysis before results are observed.
Published results must separate extraction, query, admission, kernel, proof,
and final-answer errors and include enough blinded-suite metadata for an
independent reviewer to audit the analysis.

### 2. External temporal pilot

One operator outside the Timeline project must run the experimental temporal
contract in a real long-running-agent workflow. The run must cross a restart
and include delayed evidence, a correction, and a decision where temporal
state changes the outcome or reduces reconciliation work.

The [pilot contract](./docs/temporal-pilot.md) requires a redacted export that
another process can replay and verify. A negative result is acceptable if it
identifies a wrong abstraction or shows that Timeline adds no operational
value.

### 3. Independent implementation

The project is seeking a second implementer of
[Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md). The
[interoperability issue](https://github.com/open-covenant/covenant-timeline/issues/19)
defines the smallest useful scope.

This gate requires an independently maintained implementation that agrees with
the reference implementation on semantic results for the shared corpus and
verifies its supported proof receipts. It is the evidence that Timeline is a
portable contract rather than a TypeScript-specific format.

## Conditional follow-on work

Work after these gates follows observed failures:

- extraction and query errors determine model-interface and repair work;
- pilot friction determines operational features and any calendar or
  civil-time requirements;
- interoperability failures determine specification, proof-profile, and
  conformance changes; and
- real upgrade experience determines migration and compatibility tooling.

Beta requires all three gates, completion of the RFC process for the supported
temporal subset, and security and privacy review of the model, parsing,
resource, provenance, projection, and proof boundaries.

Model-integrated training, new temporal formalisms, calendar profiles, and
high-stakes domain profiles remain research or adopter-led work until evidence
from these gates justifies them.

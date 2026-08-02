# Roadmap

Timeline provides deterministic temporal projection, replay, and proof
verification for long-running systems. Its preregistered model evaluation did
not support a standalone model-memory product. This roadmap now prioritizes
kernel adoption inside Covenant or independent systems, operational value, and
protocol portability.

Release history belongs in the [changelog](./CHANGELOG.md). This document
records the evidence required before the project can make broader claims.
Together, the [public claim ledger](./docs/claim-ledger.md) and
[publication-readiness audit](./docs/production-audit-publication-readiness.md)
distinguish implemented properties from release and adoption evidence.

## Available foundation

The `0.0.0-alpha.2` npm package includes:

- explicit metric and ordinal axes;
- isolated actual, planned, forecast, and hypothetical contexts;
- points, proper intervals, coordinates, bounded constraints, and temporal
  facts;
- correction, supersession, retraction, and historical knowledge cuts;
- consistency, difference-bounds, point-order, and interval-relation queries;
- deterministic conclusions with independently checkable proof receipts; and
- the v0alpha1 and v0alpha2 checkpoint formats as compatibility APIs.

The schemas, conformance corpus, CLI, reference kernel, correction-and-replay
example, model interface, and benchmark artifacts are public. They establish a
working substrate and include a formal negative model result; they do not
establish adoption.

The source tree is preparing `@covenant-org/timeline@0.0.0-alpha.3`, which adds
the proposal compiler, and `@covenant-org/timeline-mcp@0.0.0-alpha.1`, which
pins that core version. Both are release candidates rather than registry
onboarding paths until their publication and installed-artifact checks finish.

The repository also provides deterministic model-proposal compilation with
exact source-span provenance, a request-scoped Structured Outputs schema, and
an atomic local MCP write path. The compiler reproduces the admitted state and
checked result for all 36 cuts in the public corpus. That establishes lowering
equivalence, not model extraction quality.

The
[model-proposal boundary benchmark](./benchmarks/model-proposal-boundary/v2/README.md)
runs the production-shaped proposal interface as a rolling evaluation, retains
every handled benchmark-observation failure, and independently scores
extraction, state, query, answer, and proof outcomes. Its checked oracle proves benchmark
representability; it is not a model result.

## Evidence gates

### 1. Model result: standalone accuracy claim rejected

The checked-in proposal-boundary benchmark is the primary engineering suite for
model extraction. The lower-level
[model-interface benchmark v1](./benchmarks/model-interface/v1/README.md)
compares bounded narrative memory, stateless full-context structured
extraction, and rolling Timeline state. Direct full-context answering remains a
secondary diagnostic. Both suites use stateless adapters and strict replayable
artifacts.

The
[frontier-model preregistration](./benchmarks/model-interface/v1/PREREGISTRATION.md)
fixed one model and configuration, three repeats, a public paraphrase corpus
held out from prompt and schema development, three primary arms, failure
accounting, paired analysis, and a binary continue-or-kill rule before any
held-out inference.

The 2026-07-31 GPT-5.6 Sol run completed 324 primary observations and 108
teacher-forced observations without an operational error. Timeline met every
absolute threshold: 106/108 answers and end-to-end artifacts were exact,
assertion F1 was 0.9574, and all 108 proofs verified. It beat bounded narrative
memory, 106/108 versus 65/108 answers, but not stateless full-context structured
extraction, which scored 107/108. The paired Timeline difference against
structured extraction was -0.0093 with case-cluster `p = 0.875`.

The gate returned `kill`. The
[complete result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-eval-v1-gpt-5.6-sol-2026-07-31)
is bound to the evaluated source commit. Teacher forcing reached 108/108 answer
and end-to-end exactness, with 0.9787 assertion F1 across all cuts. Current-cut
extraction was strong, but rolling Timeline state produced no answer-accuracy
advantage over full-context structured extraction.

The follow-on deployment-shaped v2 gate also returned `kill`. Its 108
GPT-5.6 Sol observations used opaque evidence IDs, irrelevant records, explicit
source spans, request-scoped handles, and the proposal compiler. Assertion F1
was 0.7692, projected-state and end-to-end exactness were 76/108, and answer
exactness was 87/108. The model found every gold signal record but represented
only 2 of 24 non-exact bounds correctly. The
[complete v2 bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-proposal-v2-attempt-1-2026-08-01)
is public. Free-form proposals will not be the default durable-ingestion path,
and the frozen v2 interface will not be tuned or rerun.

### 2. Low-friction agent integration

The separate local stdio MCP server keeps the portable kernel dependency-light
and separates model work from operator authority. The default model role can
list runs, preview an evidence-backed proposal without persistence, project
admitted state, and request a verified conclusion. An explicit operator role
can create runs, append typed events, and admit the exact digest of a previewed
candidate.

Every event write records an authority ID, policy reference, and policy digest
in a content-bound admission envelope. The server requires a data directory,
retains only evidence digests, and makes no network calls. Proposal evidence
text is processed transiently and is not written or returned. Process roles do
not authenticate evidence, operators, or policy bytes; deployments must isolate
the operator surface and enforce those controls externally. The server does not
provide semantic memory search, civil-time normalization, or remote hosting.

[Published successful attempt 1](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-1-2026-08-01)
is retained publicly. It crossed separate host and MCP processes, admitted an
initial proposal and a staged correction under an exact policy digest,
preserved the historical result, and verified three receipts without provider
credentials.

A later maintainer replication terminated during correction after the provider
invocation and was not retried. Its v1 terminal record did not retain the
rejected adapter output. The source implementation tests bounded raw
adapter-stream retention, closed failure classifications, phase-decision
binding, compare-and-swap recovery fencing, and redacted portable receipts. No
later contract can retroactively repair the earlier state. A separate
[credential-preflight exercise](https://github.com/open-covenant/covenant-timeline/releases/tag/failure-receipt-exercise-v2-2026-08-02)
now exercises v2 retention, export, and offline verification. The credential
absence and pre-request exit are maintainer-observed procedural evidence from
the bound adapter control flow, not claims proved by the portable receipt.

[Published successful attempt 2](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-2-2026-08-02)
repeated the complete source-built path from the merged revision and verified
again from a fresh download with an exact runtime match. The project now retains
two completed examples of the composed workflow. Because they use the same
maintainer and staged scenario, with an intervening failed replication, they do
not establish independent operation, live delayed-evidence handling, model
accuracy, or general reliability.

Registry publication remains open for the alpha.1 MCP release candidate. It
does not block source pilots, model evaluation, or independent implementation
work, but registry installation and verification remain launch-post gates.

### 3. Independent temporal pilot

One operator outside the project must run Timeline in a real long-running-agent
workflow. The run must cross a restart, include delayed or corrected evidence,
and contain a decision where explicit temporal state changes the result or
reduces reconciliation work.

The [pilot contract](./docs/temporal-pilot.md) requires a redacted export that
another process can replay and verify. A negative result is useful if it
identifies the wrong abstraction or shows that Timeline adds no operational
value. The checked-in MCP pilot supplies the export and verification
mechanics so the operator can focus on its own evidence and workflow.

### 4. Protocol portability

The project is seeking a second implementer of
[Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md). The
[interoperability issue](https://github.com/open-covenant/covenant-timeline/issues/19)
defines a bounded starting point.

The gate requires an independently maintained implementation that agrees with
the reference implementation on semantic results for the shared corpus and
verifies its supported receipts. This is evidence that Timeline is a portable
contract rather than a TypeScript-specific format.

## Standalone expansion decision

The preregistered gate required a model result that beat both simpler
baselines. That requirement was not met, so the planned 90-day standalone
adoption window will not begin and no standalone beta is scheduled.

The package remains available under Apache-2.0 as a deterministic temporal
kernel and verifier. Work may continue where an integration needs its
auditability, replay, or portable proof contract. An external pilot or second
implementation can still establish operational value or portability, but it
cannot retroactively change the v1 model result.

Reconsidering a standalone model product requires a new, separately
preregistered hypothesis and benchmark. The v1 corpus, thresholds, and decision
will not be retuned or reinterpreted.

## Work justified by evidence

Follow-on work is driven by observed needs:

- the next failed formal attempt must exercise and publish the v2 failure
  receipt without retry;
- Covenant and adopter integrations determine kernel ergonomics;
- integration friction determines MCP ergonomics and storage limits;
- pilot evidence determines calendar, civil-time, and operational features;
- interoperability failures determine specification and conformance changes;
  and
- real upgrade experience determines migration tooling.

No new protocol surface or governance layer is added until one of these needs
requires it. Any future beta proposal must define its product claim, evidence
gate, external pilot, interoperability requirement, and security and privacy
review before implementation begins.

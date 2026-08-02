# Production audit: publication readiness

Date: 2026-08-02

Audit revision: unreleased candidate based on `origin/main`; final source
revision and verification result are recorded when the candidate is frozen.

## Decision

Covenant Timeline is not ready for an engineering-alpha launch post.

The temporal kernel is a well-tested alpha: its parser, projection,
reasoner, proof verifier, resource limits, conformance corpus, package checks,
and release evidence pass the repository's verification suite. The product
surface and external evidence do not justify broader claims about model
understanding, portable interoperability, or independent adoption. One retained
successful artifact supports the narrower claim. A later failed replication
exposed missing rejection-output retention in the v1 formal-attempt record;
that state cannot be repaired retroactively. Publication also remains blocked
on releasing and registry-verifying the exact proposal-aware core and MCP
packages.

This audit uses a narrower release claim:

> Timeline preserves and verifies temporal state across clean process restarts,
> corrections, and explicit historical record cuts.

The formal pilot does not claim recovery from arbitrary process, host, or power
loss. Its local publication protocol coordinates cooperative single-host
writers; it is not a distributed-filesystem guarantee.

Any claim that Timeline improves a model's temporal accuracy requires a new
comparative result. The existing preregistered model-interface gate returned
`kill` because Timeline did not beat stateless full-context structured
extraction.

## Release gates

| Gate                                 | Status            | Evidence or remaining requirement                                                                                                                                                                |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Installable proposal-aware core      | Blocked           | A new core alpha containing the proposal compiler, verified from an empty directory                                                                                                              |
| Installable MCP surface              | Blocked           | Registry-only install against the released core, restart/correction/proposal smoke, and release evidence                                                                                         |
| Production proposal boundary         | Failed            | The preregistered v2 gate returned `kill`; free-form model proposals cannot be the default ingestion path                                                                                        |
| Retained composed-workflow artifact  | Demonstrated once | [Published successful attempt 1](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-1-2026-08-01); a later replication failed during correction            |
| Failed-attempt evidence retention    | Source tested     | Unreleased v2 source retains bounded adapter output, closed rejection codes, phase-decision binding, compare-and-swap recovery-fence state, and a redacted receipt; public exercise remains open |
| Independent operation                | Open              | A qualifying external operator owns evidence, admission, persistence, and workflow execution                                                                                                     |
| Cross-language temporal verification | Partial           | A repository-maintained Python profile verifies consistency and bounds receipts; relation cases and independent maintenance remain open                                                          |

## P0 findings

### The published packages do not form the advertised product

`@covenant-org/timeline@0.0.0-alpha.2` predates the model-proposal compiler.
The source release candidate for `@covenant-org/timeline@0.0.0-alpha.3`
contains that compiler. The prepared
`@covenant-org/timeline-mcp@0.0.0-alpha.1` package pins alpha.3, and the local
packed-artifact test passes with those candidate bytes. The registry-only test
remains blocked because alpha.3 has not been published.

The release candidate must publish the core containing the compiler before the
MCP package. Both packages must then pass clean registry installation and
installed-artifact tests. npm publication is intentionally deferred; source
readiness does not make the registry surface available.

### The production model boundary failed its live gate

The first operationally valid v2 attempt completed 108 GPT-5.6 Sol
observations against the frozen corpus and returned `kill`. Response schemas
were valid on 108/108 observations, 107/108 proposals compiled and produced a
projected result, and every resulting proof verified. The semantic boundary did
not pass: assertion F1 was 0.7692, projected state and end-to-end results were
exact on 76/108 observations, and answers were exact on 87/108.

The failure is concentrated and consequential. The model selected every gold
signal record and no distractor record, but represented only 2 of 24 non-exact
bounds correctly. It repeatedly collapsed lower bounds, upper bounds, and
ranges into exact coordinates. Revision mistakes then propagated into later
record cuts. The model can operate the schema and select query intent; it
cannot reliably author the temporal state the kernel is asked to preserve.

The frozen acceptable-quote metric also exposed a benchmark defect. The prompt
asked for the smallest supporting substring, while the oracle generally
accepted one complete sentence. Seventy-five otherwise matching supports were
rejected only for using a shorter valid substring. That makes the reported
0.1958 support F1 unsuitable as a standalone grounding-quality estimate. It
does not change the decision: the independently scored assertion, state, and
answer thresholds all failed by wide margins.

The complete ledger, configuration, corpus, raw results, score, gate, and
checksums are retained in the
[public result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-proposal-v2-attempt-1-2026-08-01).
The v2 interface will not be tuned or rerun against that corpus.

Free-form model proposals must therefore be treated as untrusted candidates,
not admitted memory. The default model-facing surface must be read-only with
respect to durable state. A separate host or operator may preview, review, and
admit an exact candidate under an explicit authority and policy record.

### The composed workflow is retained

[Published successful attempt 1](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-1-2026-08-01)
completed against Covenant's public release chronology. Two separate host
processes and two distinct MCP child processes admitted an initial GPT-5.6 Sol
proposal, recovered the exact run prefix, admitted a correction proposal, and
reproduced both the historical and corrected conclusions. The artifact contains
two provider reservations, two synchronized phase-result bundles, four
admission records, and three verified receipts. The corrected
readiness-minus-publication result changed from 513,698 ms to 360,698 ms while
the earlier record cut preserved the original result.

The published archive matches its SHA-256 sidecar and GitHub asset digest. A
fresh extraction from a clean checkout at the recorded source revision returned
`verified: true` without credentials. The rebuilt checkout reported
`runtimeMatched: false`; the retained operator report records
`runtimeMatched: true`. Portable receipt verification does not require exact
operator-runtime reproduction.

The run is maintainer-operated and deliberately stages already-public
historical evidence. It is not independent adoption, a live observation of
delayed evidence, or a model-accuracy result.

### A later replication failed without retaining its rejected output

A later maintainer replication completed its initial phase but terminated
during correction after the provider invocation. It was not retried or exported
as a successful artifact. Its v1 terminal failure entry binds the invocation and
request, but not the rejected adapter output or a content-bound rejection
record. The retained state cannot establish from its own bytes why the
correction failed.

This does not invalidate published successful attempt 1. It prevents the public
artifact from being presented as evidence of repeatability and leaves
failed-attempt demonstration open for a future run. The current v2 source
retains bounded raw output before parsing, binds a closed rejection code and
the observed MCP state into the terminal ledger entry, and exports a redacted
portable receipt. It cannot retroactively repair the missing v1 output.

The current candidate also emits runtime identity v2. That identity requires
the complete versioned file inventory and every formal application dependency,
scans the same source buffers it hashes, resolves application packages only
from the selected runtime root, and measures the external parser before and
after use. The verifier retains a separate runtime v1 baseline for the
published attempt-1 artifact instead of silently changing v1 semantics.

### Independent adoption cannot be self-issued

A maintainer-operated run can demonstrate the product path but cannot count as
independent adoption. A qualifying external operator must own the evidence,
admission decision, persistence, and workflow and publish a redacted artifact
with a concrete operational outcome. Open issues and copied fixtures are not
adoption evidence.

### Portability remains a design property

The v0alpha3 schemas, canonical digests, conformance corpus, and proof receipts
are designed for implementation in other languages. A repository-maintained
Python profile now projects explicit record cuts and verifies consistency
schedules, negative cycles, and tight difference-bound paths. It does not
implement point- or interval-relation cases, and it is not independently
maintained. Public copy may claim a demonstrated cross-language bounds profile,
but not a second conforming implementation or independent interoperability.

## P1 findings

- Ordinary onboarding must use one exact core version and one exact MCP
  version, not a mix of registry packages and source-only features.
- A clean-machine command must leave behind the complete portable artifact it
  verifies.
- The release shadow audit should be mirrored by a content-addressed public-run
  manifest and continuously reverified.
- Calendar and time-zone normalization remains a host profile. Software
  delivery examples must either use exact UTC instants or identify the
  normalization policy and time-zone database version.
- Every proposed public claim must map to evidence in
  [`claim-ledger.md`](./claim-ledger.md).

## Accepted alpha boundaries

These are not blockers for an honest engineering-alpha release:

- trusted publishing, while the documented short-lived scoped-token fallback
  remains available and provenance is emitted;
- RFC finalization and expanded governance;
- snapshot hydration while bounded replay remains operationally acceptable;
- recurrence, disjunction, dynamic controllability, and calendar arithmetic;
  and
- independent adoption, provided the post reports it as an open goal rather
  than achieved evidence.

## Publication threshold

An engineering-alpha post is supportable only when all of these are true:

Items 3 and 4 pass. Item 5 is satisfied as a one-artifact existence gate, not as
evidence of repeatability. Item 6 is implemented in source but remains open as
public evidence from a formal v2 attempt. Item 7 remains a constraint on the
final post. Items 1 and 2 remain blocked on the deferred npm publication and
registry-only verification.

1. A new user can install the exact core and MCP versions from npm in an empty
   directory.
2. The registry-installed path reproduces persistence, restart, correction,
   historical replay, and stored-receipt verification.
3. The model-facing MCP surface cannot persist a proposal without a separate
   operator admission step bound to an exact candidate, authority, and policy.
4. The failed proposal-boundary result remains public with complete raw
   artifacts and checksums.
5. A public maintainer-operated run combines allowlisted public evidence
   normalized by the maintainer, explicit host admission, separate process
   phases, a staged correction, historical replay, and network-independent
   verification.
6. A future failed formal attempt demonstrates the v2 path by durably binding
   rejected adapter output and a stable rejection reason before its terminal
   ledger entry, without enabling a provider retry, then publishes its redacted
   receipt.
7. The post reports both negative model gates and does not claim a
   model-accuracy advantage, independent adoption, or independent
   cross-language conformance.

Independent operation and a second implementation remain the next adoption
and protocol milestones after that post.

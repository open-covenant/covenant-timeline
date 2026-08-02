# Production audit: publication readiness

Date: 2026-08-02

Audited implementation revision:
`4e1deaa0b2f7fc36a07de9bbdb795080bb8c60ae`. Protected CI passed at
`842f68219c0443db0d862f43f1adf957bc5afa83`. Formal pilot attempt 2 ran from
the merged source revision `a4879897fcaa754ab0df928db5c98f2df25e7cb3`.

## Verification

`pnpm verify` passed from a clean checkout at the implementation revision. The
run included 90 formal workflow and recovery tests, the model-interface and
model-proposal suites, schema and conformance checks, release and release
evidence validation, lint, type checking, package coverage, SBOM generation,
and installed-artifact checks for both the core and MCP packages. Both the full
and production-only pnpm audits reported no known vulnerabilities at the high
severity threshold. The tracked and untracked source tree also passed the
secret, private-identifier, and absolute-user-path scan.

The protected matrix passed on Ubuntu with Node.js 22 and 24, macOS with
Node.js 22, Windows with Node.js 22, and Python 3.13, together with CodeQL,
Socket, and supply-chain checks. Formal pilot attempt 2 then completed from a
clean detached checkout of merged `main`. Its GitHub archive was downloaded,
checksum-validated, extracted, and verified without provider credentials with
an exact runtime match. The downloaded artifact passed the same credential and
private-path scan.

## Decision

Covenant Timeline is ready for a narrowly scoped engineering-alpha post about
the published temporal kernel and the source-built operator workflow. It is not
ready for a registry-centered MCP product launch or a claim that Timeline makes
models understand time.

The temporal kernel is a well-tested alpha: its parser, projection,
reasoner, proof verifier, resource limits, conformance corpus, package checks,
and release evidence pass the repository's verification suite. The installable
`@covenant-org/timeline@0.0.0-alpha.2` package contains that kernel. The
proposal-aware alpha.3 candidate and MCP server remain source-only while npm
publication is deferred, so the post must not present either one as a registry
install.

Two public successful artifacts support the narrower workflow claim. One
intervening replication failed during correction and did not retain enough v1
evidence to diagnose its rejected output. That state cannot be repaired
retroactively. The successful executions and the failure are all part of the
record; they do not establish a reliability rate.

This audit uses a narrower post claim:

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

| Gate                                 | Status                  | Evidence or remaining requirement                                                                                                                                                                                                                                             |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installable temporal core            | Passed                  | `@covenant-org/timeline@0.0.0-alpha.2` contains the v0alpha3 kernel and passes installed-package proof verification                                                                                                                                                           |
| Installable proposal-aware core      | Deferred                | The alpha.3 candidate passes local packed-artifact checks; npm publication and registry verification remain open                                                                                                                                                              |
| Installable MCP surface              | Deferred                | The alpha.1 candidate passes local packed-artifact checks against alpha.3; npm publication and registry-only restart/correction/proposal verification remain open                                                                                                             |
| Production proposal boundary         | Failed; admission gated | The preregistered v2 gate returned `kill`; model proposals are read-only previews until a separate operator admits exact bytes                                                                                                                                                |
| Retained composed-workflow artifact  | Demonstrated twice      | [Attempt 1](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-1-2026-08-01) and [attempt 2](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-2-2026-08-02); one intervening replication failed |
| Failed-attempt evidence retention    | Source tested           | v2 source retains bounded adapter output, closed rejection codes, phase-decision binding, compare-and-swap recovery-fence state, and a redacted receipt; no public v2 failure has exercised it                                                                                |
| Independent operation                | Open                    | A qualifying external operator owns evidence, admission, persistence, and workflow execution                                                                                                                                                                                  |
| Cross-language temporal verification | Partial                 | A repository-maintained Python profile verifies consistency and bounds receipts; relation cases and independent maintenance remain open                                                                                                                                       |

## P0 findings

### Proposal-aware registry onboarding remains deferred

`@covenant-org/timeline@0.0.0-alpha.2` predates the model-proposal compiler.
The source release candidate for `@covenant-org/timeline@0.0.0-alpha.3`
contains that compiler. The prepared
`@covenant-org/timeline-mcp@0.0.0-alpha.1` package pins alpha.3, and the local
packed-artifact test passes with those candidate bytes. The registry-only test
remains blocked because alpha.3 has not been published.

The release candidate must publish the core containing the compiler before the
MCP package. Both packages must then pass clean registry installation and
installed-artifact tests. npm publication is intentionally deferred; source
readiness does not make the registry surface available. This blocks a
registry-centered product launch, but it does not block a technical alpha post
that leads with the published alpha.2 kernel and labels the proposal compiler
and MCP workflow as source-built.

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

### The composed workflow completed twice

[Published successful attempt 1](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-1-2026-08-01)
and
[published successful attempt 2](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-2-2026-08-02)
completed against Covenant's public release chronology. In each execution, two
separate host processes and two distinct MCP child processes admitted an
initial GPT-5.6 Sol proposal, recovered the exact run prefix, admitted a
correction proposal, and reproduced both the historical and corrected
conclusions. Each artifact contains two provider reservations, two synchronized
phase-result bundles, four admission records, and three verified receipts. The
readiness-minus-publication result changed from 513,698 ms to 360,698 ms while
the earlier record cut preserved the original result.

Attempt 1's published archive matches its SHA-256 sidecar and GitHub asset
digest. A fresh extraction from a clean checkout at the recorded source
revision returned `verified: true` without credentials. That rebuilt checkout
reported `runtimeMatched: false`; the retained operator report records
`runtimeMatched: true`. Portable receipt verification does not require exact
operator-runtime reproduction.

Attempt 2 ran from merged source revision
`a4879897fcaa754ab0df928db5c98f2df25e7cb3`. Its archive SHA-256 is
`129bc141e18e500c62415ee41a4fa7448d29d6128c416f98603108ff4487afb6`,
matching both the sidecar and GitHub asset digest. A fresh GitHub download
verified without credentials with `runtimeMatched: true` under the exact
source-built runtime and passed the credential and private-path scan.

Both runs are maintainer-operated and deliberately stage already-public
historical evidence. They are not independent adoption, live observations of
delayed evidence, evidence-authenticity results, or model-accuracy results.

### An intervening replication failed without retaining its rejected output

Between the two published successes, a maintainer replication completed its
initial phase but terminated during correction after the provider invocation.
It was not retried or exported as a successful artifact. Its v1 terminal
failure entry binds the invocation and request, but not the rejected adapter
output or a content-bound rejection record. The retained state cannot establish
from its own bytes why the correction failed.

This does not invalidate either successful artifact. It does prevent the three
executions from being presented as a reliability estimate. The current v2
source retains bounded raw output before parsing, binds a closed rejection code
and the observed MCP state into the terminal ledger entry, and exports a
redacted portable receipt. It cannot retroactively repair the missing v1 output.
A naturally occurring future failure should be exported and published under
that contract; deliberately forcing a provider failure is not a publication
gate.

The current candidate also emits runtime identity v2. That identity requires
the complete versioned file inventory and every formal application dependency,
scans the same source buffers it hashes, resolves application packages only
from the selected runtime root, and measures the external parser before and
after use. The verifier retains a separate runtime v1 baseline for the
published attempt-1 artifact instead of silently changing v1 semantics.
Successful attempt 2 exercised runtime identity v2 and reproduced an exact
runtime match after the release archive was downloaded again.

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

These are not blockers for an honest engineering-alpha post:

- trusted publishing, while the documented short-lived scoped-token fallback
  remains available and provenance is emitted;
- RFC finalization and expanded governance;
- snapshot hydration while bounded replay remains operationally acceptable;
- recurrence, disjunction, dynamic controllability, and calendar arithmetic;
- source-only proposal-aware core and MCP candidates, provided the post names
  the published alpha.2 kernel as the npm entry point and gives source build
  instructions for the remaining workflow;
- the absence of a public v2 failed-attempt receipt until a v2 failure occurs
  naturally; and
- independent adoption, provided the post reports it as an open goal rather
  than achieved evidence.

## Publication threshold

The engineering-alpha post threshold is met with the following scope:

1. A new user can install the published alpha.2 temporal kernel, run the
   correction example, and verify its proof receipt.
2. The model-facing MCP surface cannot persist a proposal without a separate
   operator admission step bound to an exact candidate, authority, and policy.
3. Both failed model gates remain public with complete artifacts and fixed
   decisions.
4. Two public maintainer-operated runs combine allowlisted public evidence
   normalized by the maintainer, explicit host admission, separate process
   phases, a staged correction, historical replay, and network-independent
   verification. The intervening failed replication is reported with them.
5. The post identifies alpha.3 and the MCP package as source-only and does not
   give npm installation commands for unpublished versions.
6. The post does not claim a model-accuracy advantage, automatic semantic
   admission, evidence truth, live delayed-evidence operation, independent
   adoption, general reliability, or independent cross-language conformance.

A registry-centered MCP launch remains blocked until all of these are true:

1. The exact proposal-aware core and MCP versions are published to npm.
2. An empty directory can install only those registry versions and reproduce
   persistence, restart, correction, historical replay, proposal preview and
   admission, and stored-receipt verification.
3. The release evidence binds the registry bytes, source tags, SBOMs, and
   provenance for both packages.

Independent operation and a second implementation remain the next adoption
and protocol milestones after that post.

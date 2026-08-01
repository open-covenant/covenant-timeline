# Production audit: post readiness

Date: 2026-08-01

## Decision

Covenant Timeline is not ready for a thesis-style public launch post.

The temporal kernel is a well-tested alpha: its parser, projection,
reasoner, proof verifier, resource limits, conformance corpus, package checks,
and release evidence pass the repository's verification suite. The product
surface and external evidence do not yet justify broader claims about model
understanding, portable interoperability, or independent adoption.

This audit uses a narrower release claim:

> Timeline preserves and verifies temporal state across restarts, corrections,
> and explicit historical record cuts.

Any claim that Timeline improves a model's temporal accuracy requires a new
comparative result. The existing preregistered model-interface gate returned
`kill` because Timeline did not beat stateless full-context structured
extraction.

## Release gates

| Gate                                 | Status  | Required evidence                                                                                                                                          |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installable temporal kernel          | Blocked | A new core alpha containing the proposal compiler, verified from an empty directory                                                                        |
| Installable MCP surface              | Blocked | Registry-only install against the released core, restart/correction/proposal smoke, and release evidence                                                   |
| Production proposal boundary         | Blocked | Preregistered live frontier-model result over a frozen noisy corpus with explicit grounding scores                                                         |
| Composed real workflow               | Blocked | One retained maintainer-operated artifact combining real evidence, model proposals, restart, correction, historical replay, and offline proof verification |
| Independent operation                | Open    | A qualifying external operator owns evidence, admission, persistence, and workflow execution                                                               |
| Cross-language temporal verification | Partial | A repository-maintained Python profile verifies consistency and bounds receipts; relation cases and independent maintenance remain open                    |

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

### The production model boundary has no live result

The proposal compiler, generated request-scoped schema, candidate verifier,
formal runner, replay scorer, and frozen v2 suite are implemented and tested.
The suite includes multiple records per cut, irrelevant and misleading
records, constraints, revisions, retractions, context traps, interval
relations, and explicit acceptable support spans. Its source, runtime,
configuration, corpus, supports, prompt, repeat count, retry rule, and gate are
bound in a retained attempt ledger.

Those checked fixtures establish benchmark representability and scoring
behavior, not live model reliability. The missing evidence is an operationally
valid frontier-model run over the frozen v2 suite with its complete attempt
ledger, results, score, gate, and checksums retained publicly.

Proof verification in this benchmark establishes that the deterministic kernel
issued a valid receipt for the compiled state and query. It does not establish
that the model selected the correct state. Extraction, projected-state, query,
answer, and grounding metrics must be reported separately.

### The strongest demonstrations are still disjoint

The repository has separate evidence for a real frontier model, an MCP restart
and correction fixture, a public GitHub run, and Covenant's real release shadow
audit. No retained artifact currently combines real evidence, real model
proposals, separate process phases, delayed correction, historical replay, and
offline verification.

The smallest credible composed run uses Covenant's public release chronology:
first admit the provisional release timestamp, exit, restart, admit the delayed
authoritative publication timestamp and revision, then reproduce the original
and corrected conclusions without a model or network connection.

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

## Posting threshold

An engineering-alpha post is supportable only when all of these are true:

1. A new user can install the exact core and MCP versions from npm in an empty
   directory.
2. The registry-installed path reproduces persistence, restart, correction,
   historical replay, and stored-receipt verification.
3. A preregistered live result measures the production proposal boundary and
   publishes complete raw artifacts and checksums.
4. A public maintainer-operated run combines real evidence, model proposals,
   separate process phases, delayed correction, and network-independent
   verification.
5. The post reports the negative comparative benchmark and does not claim a
   model-accuracy advantage, independent adoption, or independent
   cross-language conformance.

Independent operation and a second implementation remain the next adoption
and protocol milestones after that post.

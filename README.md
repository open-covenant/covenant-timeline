# Covenant Timeline

[![CI](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/open-covenant/covenant-timeline)](./LICENSE)

**Verifiable temporal state for long-running agents.**

A release agent records that security review finished before deployment. Later
evidence shows that record was wrong: the review finished after deployment.
Timeline preserves the original and corrected views, recomputes what follows
from each one, and returns proof receipts that another process can check.

```sh
npm install --save-exact @covenant-org/timeline@0.0.0-alpha.2
```

The optional local MCP integration is currently built from source. Records
enter its durable state only after a host admission decision. A model may
inspect admitted state and preview a proposed change, but the default
model-facing surface cannot write to the record.

[Run the correction demo](#see-a-correction-survive-replay) ·
[Connect an agent to the source-built MCP server](#connect-an-agent-to-the-source-built-mcp-server) ·
[Run the local restart-and-correction pilot](./examples/mcp-agent-pilot) ·
[Inspect the latest public real-model pilot](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-2-2026-08-02) ·
[Use the library](#use-the-temporal-api) ·
[Integrate a model](./docs/model-interface.md) ·
[Review model results](./docs/model-evaluation.md) ·
[Review supported claims](./docs/claim-ledger.md)

## See a correction survive replay

The checked-in example uses one elapsed-time axis and three admitted
assertions:

```text
review.v1 = 100
deploy.v1 = 200
review.v2 = 300
retract review.v1
```

The same question—`review-finished - deployed`—is evaluated at three selected
knowledge cuts:

| Records visible through | Result         | Meaning                                   | Proof sources            |
| ----------------------- | -------------- | ----------------------------------------- | ------------------------ |
| Event 3                 | `[-100, -100]` | Review finished 100 seconds before deploy | `review.v1`, `deploy.v1` |
| Event 4                 | `inconsistent` | Initial and corrected records conflict    | `review.v1`, `review.v2` |
| Event 5                 | `[100, 100]`   | Review finished 100 seconds after deploy  | `review.v2`, `deploy.v1` |

At event 4 the correction is present while the original assertion is still
active, so the state is inconsistent. Event 5 retracts the original and restores
a bounded answer.

This is the exact corrected conclusion committed in
[`conclusions/after.json`](./examples/correction-replay/conclusions/after.json):

<!-- correction-conclusion:start -->

```json
{
  "schema": "covenant.timeline.conclusion.v0alpha3",
  "queryId": "query.review-minus-deploy",
  "result": {
    "type": "difference.bounds",
    "status": "bounded",
    "minimum": 100,
    "maximum": 100
  },
  "receipt": {
    "reasoner": "covenant.timeline.stn.v0alpha1",
    "stateDigest": "sha256:5bef7e47e6d7a7b78900ade5c272732afe1a0a2fa453080d90cdeb0fb788c279",
    "queryDigest": "sha256:210a43a6c1088484beffe5ed2b9fdd40b428cd45a285f7d0060795bc49b1e7e7",
    "semanticResultDigest": "sha256:d4392f613ebd9c015f0707453bebf85b17e86787ed6433c23342701087284176",
    "proof": {
      "kind": "bounds",
      "lowerEdges": [
        {
          "sourceId": "review.v2",
          "fromNodeId": "review-finished",
          "toNodeId": "@origin:utc-seconds",
          "maximum": -300
        },
        {
          "sourceId": "deploy.v1",
          "fromNodeId": "@origin:utc-seconds",
          "toNodeId": "deployed",
          "maximum": 200
        }
      ],
      "upperEdges": [
        {
          "sourceId": "deploy.v1",
          "fromNodeId": "deployed",
          "toNodeId": "@origin:utc-seconds",
          "maximum": -200
        },
        {
          "sourceId": "review.v2",
          "fromNodeId": "@origin:utc-seconds",
          "toNodeId": "review-finished",
          "maximum": 300
        }
      ]
    }
  }
}
```

<!-- correction-conclusion:end -->

The earlier conclusion remains replayable from the same run at event 3. Both
receipts pass verification against their projected state and query. From a
source checkout:

```sh
pnpm install --frozen-lockfile
pnpm temporal:correction-demo
```

Explore the
[`run`](./examples/correction-replay/run.json),
[`evidence`](./examples/correction-replay/evidence),
[`queries`](./examples/correction-replay/queries), and
[`conclusions`](./examples/correction-replay/conclusions).

## What Timeline gives an agent

- **Portable temporal state across sessions.** Plans, observations, forecasts,
  and hypothetical alternatives use explicit axes and isolated contexts.
- **Corrections without rewritten history.** Retractions and supersession
  change current state while earlier knowledge cuts remain replayable.
- **Honest uncertainty.** Bounded answers stay bounded; the kernel reports
  alternatives and contradictions instead of inventing precision.
- **Portable verification.** Conclusions bind the projected state, query,
  semantic result, reasoner profile, and proof material by content digest.

Timeline is designed first for agent runs that cross sessions and must absorb
late or corrected evidence without losing the state that informed earlier
decisions.

## Connect an agent to the source-built MCP server

The local MCP server keeps typed temporal state durable across agent sessions.
Its default role is read-only: an agent can list runs, preview a model proposal,
project admitted state, and request a verified conclusion. Creating a run or
admitting records requires a separately launched operator role.

`@covenant-org/timeline-mcp@0.0.0-alpha.1` is not yet published. Build it from
a checkout:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Before connecting an agent, produce a complete correction-and-replay artifact:

```sh
pnpm mcp:demo > timeline-demo.json
```

The output contains the evidence digests, exact admission policy, portable run,
complete admission audit, and verified conclusions from before and after the
late correction. The command writes the run to disk and reads it through a new
store instance before reasoning. Repeating it produces identical canonical
JSON.

Add the model role to an MCP client using absolute paths:

```json
{
  "mcpServers": {
    "covenant-timeline": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/covenant-timeline/packages/mcp-server/dist/cli.js",
        "--data-dir",
        "/absolute/path/to/private/timeline-data"
      ]
    }
  }
}
```

The default command starts the `model` role. Run the operator surface only in a
host-controlled process:

```sh
node packages/mcp-server/dist/cli.js \
  --data-dir /absolute/path/to/private/timeline-data \
  --role operator
```

Proposal preview is non-mutating. It returns the exact candidate events, source
span provenance, a candidate digest, a verified conclusion, and the explicit
marker `persistence: "not-admitted"`. Admission
recompiles the proposal against the same run prefix and requires that digest,
plus an authority ID, policy reference, and policy digest. The stored audit
envelope binds every event to its admission record. It records the host's
decision; it does not authenticate the evidence or decide whether the proposal
is true. Admission results distinguish new writes, exact retries, and empty
candidates without collapsing them into a boolean.

Evidence payloads remain outside the durable store. Source text is used
transiently to locate exact quotes and is not echoed in the response. The server
uses local stdio and makes no network requests.

See the
[Timeline MCP server guide](./packages/mcp-server/README.md)
for the tool contract, persistence model, recovery procedure, limits, and
operational boundary.

The [local restart-and-correction pilot](./examples/mcp-agent-pilot) drives operator
admission, recovery, projection, and reasoning across a restart. It exports the
evidence, portable run, queries, conclusions, environment, and an exact call
transcript containing the admission records and audit digests, then verifies
the artifact in a separate offline process.

[Two retained successful pilot artifacts](./docs/real-model-pilot.md) applied
that path to staged public release evidence. Each records separate host and MCP
processes, preserves the original 513,698 ms result at its historical record
cut, admits a correction, and verifies the corrected 360,698 ms result without
provider credentials. Process provenance and model execution are
maintainer-attested. The
[latest artifact](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-2-2026-08-02)
is bound to the merged source revision and verifies from a fresh download.

These are two maintainer-operated executions of the same staged scenario. An
intervening replication failed during correction, and its retained v1 state did
not include the rejected adapter output. The completed runs demonstrate the
composed path twice. They do not establish independent adoption, live
delayed-evidence handling, evidence authenticity, model accuracy, or general
reliability.

## Use the temporal API

Timeline requires Node.js 22 or 24. The published
`@covenant-org/timeline@0.0.0-alpha.2` package contains the temporal API shown
here:

```ts
import {
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "@covenant-org/timeline";

const run = parseRunDocumentV0Alpha3(runInput);
const query = parseQueryV0Alpha3(queryInput, run);
const conclusion = reasonTemporalQueryV0Alpha3(run, query);

if (!verifyTemporalConclusionV0Alpha3(run, query, conclusion)) {
  throw new Error("temporal proof verification failed");
}
```

`runInput` and `queryInput` are decoded v0alpha3 JSON documents. The library
separates parsing, reasoning, and verification so a verifier does not need to
trust the process that produced the conclusion.

The CLI exposes the same reasoner:

```sh
npm exec --package=@covenant-org/timeline@0.0.0-alpha.2 -- \
  timeline reason temporal-run.json temporal-query.json --json
```

[`@covenant-org/timeline@0.0.0-alpha.2`](https://www.npmjs.com/package/@covenant-org/timeline/v/0.0.0-alpha.2)
is the recommended entry point. The package also retains the v0alpha1 and
v0alpha2 checkpoint APIs for compatibility; they are not separate onboarding
paths.

## How it works

```text
source evidence
      │
      ▼
host supplies typed records, or a model previews a candidate
      │
      ▼
host authenticates evidence, reviews the candidate, and admits exact bytes
      │
      ▼
Timeline projects state at the requested knowledge cut
      │
      ▼
deterministic reasoner returns result + proof receipt
      │
      ▼
another process verifies the conclusion
```

When a model is used, it works with host-issued request handles rather than
mapped ledger identifiers, evidence digests, sequence numbers, or raw
knowledge-cut indices. Hosts should make those handles opaque and disclose only
the scope needed for one request. The proposal compiler resolves those handles,
hashes exact evidence bytes, checks unique quote locations, derives the ledger
mechanics, and rejects the whole proposal on any error. A generated provider
schema pins the request ID and available handles without embedding source text
or expected answers.

Compilation produces a preview, not an admission. A host-controlled operator
must recompile and admit the exact candidate under an explicit authority and
policy record. Neither compilation nor receipt verification authenticates the
evidence.

The [model interface](./docs/model-interface.md) and
[proposal format](./docs/model-proposal.md) define this loop. The
[model-proposal boundary benchmark](./benchmarks/model-proposal-boundary/v2/README.md)
tests the proposal interface exposed by the MCP integration. The lower-level
[model-interface benchmark](./benchmarks/model-interface/v1/README.md) measures
extraction, admission, query selection, and final answers separately across
bounded narrative memory, stateless structured extraction, and
Timeline-backed state. Direct full-context answers remain available as a
secondary reference. Its low-level Timeline arm keeps raw ledger authorship
visible as a research diagnostic, not a production write path. Reference
adapters support a digest-verified local Ollama model or the OpenAI Responses
API. Both evaluate provider output without retries or repair.

## Temporal model

| Primitive          | Purpose                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| Axis               | Declares discrete metric or ordinal time with an explicit origin and unit |
| Context            | Separates actual, planned, forecast, and hypothetical worlds              |
| Point and interval | Represents occurrences, boundaries, and proper intervals                  |
| Assertion          | Adds evidence-bound coordinates, constraints, or temporal facts           |
| Knowledge cut      | Projects the records visible through a selected event                     |
| Query              | Requests consistency, bounds, point order, or interval relations          |
| Conclusion         | Returns a content-bound result and proof receipt                          |

The reference kernel uses exact integer arithmetic and a resource-bounded
Simple Temporal Network solver. It supports consistency, tight difference
bounds, before/equal/after point relations, and all 13 Allen interval base
relations.

## How Timeline fits

- **Event sourcing records change; Timeline checks temporal conclusions.**
  Timeline can consume append-only records, but it is not an event store. It
  adds typed temporal semantics, historical knowledge cuts, constraint
  reasoning, and portable proof receipts. See
  [Fowler's event-sourcing description](https://martinfowler.com/eaaDev/EventSourcing.html).
- **Bitemporal databases manage temporal data; Timeline produces portable
  derivations.** Systems such as XTDB index valid time and system time.
  Timeline does not provide storage or a general database query engine; it can
  reason over admitted records exported from one. See
  [XTDB's time model](https://docs.xtdb.com/about/time-in-xtdb.html).
- **The constraint mathematics is established.** The reference reasoner uses
  the Simple Temporal Problem formalism introduced by Dechter, Meiri, and
  Pearl. Timeline's contribution is the surrounding record, projection,
  canonical identity, bounded execution, and proof contract—not a new temporal
  algebra. See the
  [original 1991 paper](<https://doi.org/10.1016/0004-3702(91)90006-6>).
- **Temporal.io runs durable workflows; Timeline reasons over temporal
  records.** A workflow may store Timeline records and invoke its kernel, but
  Timeline does not schedule activities or resume them after failure. The
  current
  [Temporal.io adapter](./packages/temporal-adapter)
  demonstrates restart-safe intake for the v0alpha2 checkpoint compatibility
  API.

## Trust and operational boundaries

A verified receipt establishes that a result follows from the admitted records
under the identified reasoner profile. It does not establish that the source
evidence was authentic, that a model extracted it correctly, or that the host
should have admitted it.

The kernel currently operates on declared integer axes. Applications using
calendar dates or named time zones must normalize them before admission under
an explicit calendar, time-zone database version, and gap/fold ambiguity
policy, while retaining the original source and its digest. Timeline does not
yet ship this normalization profile. See
[RFC 9557](https://www.rfc-editor.org/rfc/rfc9557.html) and the
[IANA Time Zone Database](https://www.iana.org/time-zones).

The kernel does not provide evidence storage, workflow execution, admission
authority, capability enforcement, or an operational audit service.
Disjunctive temporal constraints, dynamic controllability, recurrence, and
completeness-based absence queries remain outside the current alpha.

Before production use, review the
[operations guide](./docs/operations.md),
[threat model](./docs/threat-model.md), and
[production audit](./docs/production-audit-timeline.md).

## Model evaluation

Two preregistered GPT-5.6 Sol evaluations tested whether model-generated
temporal records were reliable enough to admit and whether Timeline improved
answer accuracy.

The v1 comparison completed 432 requests. Timeline returned 106/108 exact
answers, bounded narrative memory returned 65/108, and stateless full-context
structured extraction returned 107/108. The evaluation failed its acceptance
criteria because Timeline did not beat the simpler structured pipeline.

The v2 proposal-interface evaluation completed 108 observations. All 108
responses were schema-valid and 107 candidates compiled, but assertion F1 was
0.7692 and only 76/108 projected states were exact. The model found the relevant
evidence yet represented only 2 of 24 non-exact bounds correctly. It
also failed its acceptance criteria.

These results do not support claims that Timeline makes a frontier model more
accurate than structured extraction or that free-form model output is safe to
admit automatically. The MCP server therefore treats model proposals as
untrusted previews, requires explicit host admission, and leaves deterministic
projection, reasoning, replay, and proof verification to the kernel.

The [methodology](./docs/model-evaluation.md),
[v1 result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-eval-v1-gpt-5.6-sol-2026-07-31),
and
[v2 result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-proposal-v2-attempt-1-2026-08-01)
are public. The proposal compiler and MCP integration remain available from
source until their packages are published. The
[temporal pilot](./docs/temporal-pilot.md) defines the evidence required from an
external operator.

Timeline is also seeking a second implementer for the bounded RFC 0009
conformance target in
[issue #19](https://github.com/open-covenant/covenant-timeline/issues/19).

## Relationship to Covenant

Timeline is an independent Apache-2.0 component. It provides the portable
temporal contract, reference kernel, and verifier.

[Covenant](https://github.com/open-covenant/covenant) is a runtime for teams
that also need evidence authority, durable execution, scoped capabilities,
continuity, provenance, and audit. Covenant can admit records into Timeline and
use verified temporal conclusions in runtime policy; Timeline does not require
Covenant.

## Release and repository

v0alpha3 is a Draft contract and may change between alpha releases. No second
conforming implementation has yet been demonstrated.

The published `@covenant-org/timeline@0.0.0-alpha.2` package contains the Draft
v0alpha3 temporal kernel. The `@covenant-org/timeline@0.0.0-alpha.3` core and
`@covenant-org/timeline-mcp@0.0.0-alpha.1` candidates are available from source.
The [public claim ledger](./docs/claim-ledger.md) maps each supported claim to
its evidence.

The
[GitHub prerelease](https://github.com/open-covenant/covenant-timeline/releases/tag/timeline-v0.0.0-alpha.2)
includes the package tarball, checksum, and SPDX SBOM. The
[release record](./releases/timeline-v0.0.0-alpha.2.json)
binds source, protocol inputs, artifacts, registry metadata, and attestations.

| Area              | Entry point                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Start             | [Getting started](./docs/getting-started.md)                                                                                            |
| Model integration | [Model interface](./docs/model-interface.md), [model evaluation](./docs/model-evaluation.md)                                            |
| Agent integration | [Local MCP server](./packages/mcp-server/README.md)                                                                                     |
| Contract          | [Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md), [`schemas/v0alpha3`](./schemas/v0alpha3)                                 |
| Conformance       | [`conformance/v0alpha3`](./conformance/v0alpha3), [second implementation](https://github.com/open-covenant/covenant-timeline/issues/19) |
| Operations        | [Operations guide](./docs/operations.md), [security](./SECURITY.md)                                                                     |

```sh
pnpm install --frozen-lockfile
pnpm verify
```

The repository is Apache-2.0 licensed. Contributions are covered by
[CONTRIBUTING.md](./CONTRIBUTING.md).

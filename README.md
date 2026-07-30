# Covenant Timeline

[![CI](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/open-covenant/covenant-timeline)](./LICENSE)

**Verifiable temporal state for long-running agents.**

A release agent records that security review finished before deployment. New
evidence later reverses that order. Timeline preserves both historical views,
recomputes what follows from the corrected record, and returns a proof receipt
that another process can check.

```sh
npm install --save-exact @covenant-org/timeline@0.0.0-alpha.2
```

The published `0.0.0-alpha.2` package contains the temporal kernel. The model
proposal API and benchmark are currently available from a source checkout; see
[Integrate a language model](./docs/model-interface.md#use-the-proposal-compiler).

[Run the correction demo](#see-a-correction-survive-replay) ·
[Connect an MCP agent](#give-an-mcp-agent-temporal-memory) ·
[Run a source-first agent pilot](./examples/mcp-agent-pilot) ·
[Use the library](#use-the-temporal-api) ·
[Integrate a model](./docs/model-interface.md) ·
[Evaluate the model boundary](./docs/model-evaluation.md)

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

The transition failure is explicit. Event 5 retracts the superseded assertion
and restores a bounded answer.

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

- **Temporal state across sessions.** Plans, observations, forecasts, and
  hypothetical alternatives use explicit axes and isolated contexts.
- **Corrections without rewritten history.** Retractions and supersession
  change current state while earlier knowledge cuts remain replayable.
- **Honest uncertainty.** Bounded answers stay bounded; the kernel reports
  alternatives and contradictions instead of inventing precision.
- **Portable verification.** Conclusions bind the projected state, query,
  semantic result, reasoner profile, and proof material by content digest.

Timeline is designed first for agent runs that cross sessions and must absorb
late or corrected evidence without losing the state that informed earlier
decisions.

## Give an MCP agent temporal memory

The local MCP server keeps typed temporal state durable across agent sessions.
Build it once from a source checkout:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Then add the built server to an MCP client using absolute paths:

```json
{
  "mcpServers": {
    "covenant-timeline": {
      "command": "node",
      "args": [
        "/absolute/path/to/covenant-timeline/packages/mcp-server/dist/cli.js",
        "--data-dir",
        "/absolute/path/to/private/timeline-data"
      ]
    }
  }
}
```

The server lets an agent create and recover runs, compile and atomically apply
evidence-backed model proposals, append exact typed records, project state at a
knowledge cut, and request verified temporal conclusions. It also exports the
complete portable run required for independent receipt verification.

Direct MCP writes are structurally validated but unauthenticated. Evidence
payloads remain outside the durable store. The proposal tool accepts source
text transiently, returns digest-and-span provenance without echoing the text,
and commits the complete compiled batch or nothing. Prefix-bound optimistic
concurrency makes an event-equivalent retry idempotent, including after later
events have been appended. The process exposes no network transport.

See the
[Timeline MCP server guide](./packages/mcp-server/README.md)
for the tool contract, persistence model, recovery procedure, limits, and
production boundary.

The
[source-first pilot starter](./examples/mcp-agent-pilot)
drives the create, recovery, append, projection, and reasoning workflow across a
server restart. It exports the evidence, run, queries, conclusions, environment,
and exact call transcript, then verifies the artifact in a separate offline
process.

## Use the temporal API

Timeline requires Node.js 22 or 24. The `0.0.0-alpha.2` package contains the
temporal API shown here:

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
npx timeline reason temporal-run.json temporal-query.json --json
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
model proposes claims, revisions, query intent, and exact quotes
      │
      ▼
Timeline compiles deterministic records + source-span provenance
      │
      ▼
host authenticates evidence and admits records
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

Models work with host-issued request handles rather than mapped ledger
identifiers, evidence digests, sequence numbers, or raw knowledge-cut indices.
Hosts should make those handles opaque and disclose only the scope needed for
one request. The proposal compiler
resolves those handles, hashes exact evidence bytes, checks unique quote
locations, derives the ledger mechanics, and rejects the whole proposal on any
error. A generated provider schema pins the request ID and the handles available
for that request without embedding source text or expected answers. A separate
verifier recompiles against the same host inputs and compares the complete
candidate artifact. Neither operation authenticates evidence or admits a claim.

The [model interface](./docs/model-interface.md) and
[complete proposal artifact](./docs/model-proposal.md) define this loop. The
[model-proposal boundary benchmark](./benchmarks/model-proposal-boundary/v1/README.md)
measures the production extraction boundary directly. The lower-level
[model-interface benchmark](./benchmarks/model-interface/v1/README.md) measures
extraction, admission, query selection, and final answers separately across
bounded narrative memory, stateless structured extraction, and
Timeline-backed state. Direct full-context answers remain available as a
secondary reference.
Its low-level Timeline arm keeps raw ledger authorship visible as a research
diagnostic; production integrations should use the proposal compiler. Reference
adapters support a digest-verified local Ollama model or the OpenAI Responses
API, and neither repairs model output.

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

Timeline also does not provide evidence storage, workflow execution, admission
authority, capability enforcement, or operational audit. Disjunctive temporal
constraints, dynamic controllability, recurrence, and completeness-based
absence queries remain outside the current alpha.

Before production use, review the
[operations guide](./docs/operations.md),
[threat model](./docs/threat-model.md), and
[production audit](./docs/production-audit-timeline.md).

## Proving the model boundary

The repository includes deterministic model-interface and proposal-boundary
benchmarks, a digest-verified local Ollama adapter, and a stateless OpenAI
Responses adapter. They measure whether a model can turn evidence into typed
temporal state and verified conclusions across rolling knowledge cuts. No
frontier-model result has been published.

The first decision gate is
[preregistered](./benchmarks/model-interface/v1/PREREGISTRATION.md): one fixed
frontier model, three repeats, and a public paraphrase corpus held out from
prompt and schema development. Timeline must clear high assertion and
end-to-end accuracy thresholds and beat both bounded narrative memory and
stateless full-context structured extraction. Teacher-forced prior state
separates current-cut extraction failures from continuity failures. The suite
is intentionally small: it can kill the standalone model-memory thesis, but a
pass would justify broader blinded evaluation rather than prove general
temporal intelligence. See [Model evaluation](./docs/model-evaluation.md) and
the [roadmap](./ROADMAP.md).

The second gate is one independent long-running-agent pilot that crosses a
restart, admits delayed or corrected evidence, and publishes a redacted run
another process can reproduce. The
[temporal pilot](./docs/temporal-pilot.md) defines the minimum evidence.

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

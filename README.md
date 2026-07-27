# Covenant Timeline

[![CI](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/open-covenant/covenant-timeline/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/open-covenant/covenant-timeline)](./LICENSE)

**Verifiable temporal memory for long-running agents.**

A release agent records that security review finished before deployment. New
evidence later reverses that order. Timeline preserves both historical views,
recomputes what follows from the corrected record, and returns a proof receipt
that another process can check.

```sh
npx --yes @covenant-org/timeline-mcp@0.0.0-alpha.1 --demo
```

[Run the correction demo](#replay-an-agent-run-after-a-correction) ·
[Connect an MCP agent](#give-an-mcp-agent-temporal-memory) ·
[Use the library](#use-the-temporal-api) ·
[Integrate a model](./docs/model-interface.md) ·
[Evaluate the model boundary](./docs/model-evaluation.md)

## Replay an agent run after a correction

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

These are selected fields from the exact corrected conclusion committed in
[`conclusions/after.json`](./examples/correction-replay/conclusions/after.json):

```json
{
  "result": {
    "type": "difference.bounds",
    "status": "bounded",
    "minimum": 100,
    "maximum": 100
  },
  "receipt": {
    "reasoner": "covenant.timeline.stn.v0alpha1",
    "stateDigest": "sha256:5bef7e47e6d7a7b78900ade5c272732afe1a0a2fa453080d90cdeb0fb788c279",
    "proof": {
      "kind": "bounds"
    }
  }
}
```

<details>
<summary>View the complete verifier-checked conclusion</summary>

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

</details>

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

## Give an MCP agent temporal memory

`@covenant-org/timeline-mcp` runs as a local stdio server and keeps typed
temporal state durable across agent sessions. Add it to an MCP client:

```json
{
  "mcpServers": {
    "covenant-timeline": {
      "command": "npx",
      "args": [
        "--yes",
        "@covenant-org/timeline-mcp@0.0.0-alpha.1",
        "--data-dir",
        "/path/to/private/timeline-data"
      ]
    }
  }
}
```

This config exposes Timeline's tools; it does not ingest transcripts or traces
automatically. The reference server admits every structurally valid record
submitted over its MCP connection. Hosts must control server access and apply
evidence and admission policy outside the server.

The server lets an agent create and recover runs, append typed records, project
state at an exact knowledge cut, and request verified temporal conclusions. It
also exports the complete portable run required for independent receipt
verification.

Direct MCP writes are structurally validated but unauthenticated. Evidence
payloads remain outside the server, and every append requires the current
whole-run digest for optimistic concurrency. The process exposes no network
transport.

See the
[`@covenant-org/timeline-mcp` guide](./packages/mcp-server/README.md)
for the tool contract, persistence model, recovery procedure, limits, and
production boundary.

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
model or application proposes typed records
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

The model-facing boundary is deliberate. A model can extract dates,
dependencies, corrections, and queries, but its output remains a proposal.
The host decides which evidence and assertions are admissible. Timeline reasons
only over accepted records.

The [model interface](./docs/model-interface.md) defines this loop. The
[model-interface benchmark](./benchmarks/model-interface/v1/README.md) measures
extraction, admission, query selection, and final answers separately across
direct text, narrative memory, and Timeline-backed state.

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

## Why not event sourcing, a temporal database, or Temporal.io?

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

## Evidence status

The repository includes a public 12-case development suite and a stateless
OpenAI Responses reference adapter. No external model result has been
published, so Timeline does not yet claim an accuracy improvement over
narrative memory. The
[model evaluation protocol](./docs/model-evaluation.md) defines the benchmark
required to make that claim.

The project is seeking one
[independent long-running-agent pilot](./docs/temporal-pilot.md) and a
[second RFC 0009 implementation](https://github.com/open-covenant/covenant-timeline/issues/19).
The [roadmap](./ROADMAP.md) defines the evidence gates and the 90-day adoption
review.

## Relationship to Covenant

Timeline is an independent Apache-2.0 component. It provides the portable
temporal contract, reference kernel, and verifier.

Teams that also need evidence authority, admission policy, durable execution,
scoped capabilities, continuity, provenance, and audit can pair Timeline with
[Covenant](https://github.com/open-covenant/covenant). Other hosts can provide
those boundaries; Timeline does not require Covenant.

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
| Agent integration | [`@covenant-org/timeline-mcp`](./packages/mcp-server/README.md)                                                                         |
| Contract          | [Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md), [`schemas/v0alpha3`](./schemas/v0alpha3)                                 |
| Conformance       | [`conformance/v0alpha3`](./conformance/v0alpha3), [second implementation](https://github.com/open-covenant/covenant-timeline/issues/19) |
| Operations        | [Operations guide](./docs/operations.md), [security](./SECURITY.md)                                                                     |

```sh
pnpm install --frozen-lockfile
pnpm verify
```

The repository is Apache-2.0 licensed. Contributions are covered by
[CONTRIBUTING.md](./CONTRIBUTING.md).

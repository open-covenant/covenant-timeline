# `@covenant-org/timeline`

**Verifiable temporal state for long-running agents.**

A release agent records that security review finished before deployment. Later
evidence shows that record was wrong: the review finished after deployment.
Timeline preserves the original and corrected views, recomputes what follows
from each one, and returns proof receipts that another process can check.

## Install the published kernel

```sh
npm install --save-exact @covenant-org/timeline@0.0.0-alpha.2
```

The package supports Node.js 22 and 24.
`@covenant-org/timeline@0.0.0-alpha.3`, including the model-proposal compiler
documented below, is currently available from a source checkout. Run `pnpm
verify` before integrating that workspace build.

## Correction and replay

The repository's checked-in example admits three coordinates and one
retraction:

```text
review.v1 = 100
deploy.v1 = 200
review.v2 = 300
retract review.v1
```

The query `review-finished - deployed` returns `-100` seconds at the earlier
knowledge cut and `+100` seconds after the correction. Both conclusions remain
replayable and carry state-bound proof receipts. At the transition cut, both
coordinates are active and the state is inconsistent until the earlier
assertion is retracted.

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

The
[complete run and conclusions](https://github.com/open-covenant/covenant-timeline/tree/main/examples/correction-replay)
include the evidence documents and all three queries and conclusions. To
execute the verifier-checked demo:

```sh
git clone https://github.com/open-covenant/covenant-timeline.git
cd covenant-timeline
corepack enable
pnpm install --frozen-lockfile
pnpm temporal:correction-demo
```

## Temporal API

```js
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

`runInput` and `queryInput` are decoded v0alpha3 JSON documents. The API keeps
parsing, reasoning, and verification separate so the verifier does not need to
trust the process that produced a conclusion.

Timeline represents points, proper intervals, coordinates, bounded
constraints, and temporal facts on declared discrete axes. Isolated contexts
separate actual, planned, forecast, and hypothetical state. Knowledge cuts
reconstruct earlier state across later correction, supersession, and
retraction.

The reference kernel supports:

- consistency;
- tight difference bounds;
- before, equal, and after point relations;
- all 13 Allen interval base relations; and
- schedules, bound paths, relation cases, and negative-cycle proofs.

The solver uses exact integer arithmetic and explicit resource limits.

## Preview model proposals from source

The source candidate `@covenant-org/timeline@0.0.0-alpha.3` includes the bounded
proposal compiler used by the MCP server. It is not part of the published
`@covenant-org/timeline@0.0.0-alpha.2` package installed above. From a built
repository checkout, a host gives a model only request-scoped handles and exact
evidence text. Timeline verifies the cited spans, derives the ledger events and
query, and can recompile the complete candidate before admission:

```js
import {
  compileTemporalModelProposalV1,
  verifyTemporalModelProposalCandidateV1,
} from "./packages/prototype/dist/index.js";

const candidate = compileTemporalModelProposalV1(proposal, host);

if (!verifyTemporalModelProposalCandidateV1(candidate, proposal, host)) {
  throw new Error("temporal proposal verification failed");
}
```

Compilation establishes deterministic lowering and source-span provenance. It
does not authenticate the evidence, establish that a quote entails a claim, or
authorize the candidate for durable admission.

The preregistered evaluation of this proposal shape failed its acceptance
criteria: assertion F1 was 0.7692 and only 76/108 projected states were exact.
Treat provider output as an untrusted preview. Do not admit it automatically.
The
[result and raw bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-proposal-v2-attempt-1-2026-08-01)
are public.

## CLI

The published `@covenant-org/timeline@0.0.0-alpha.2` package provides temporal
reasoning:

```sh
npm exec --package=@covenant-org/timeline@0.0.0-alpha.2 -- \
  timeline reason temporal-run.json temporal-query.json --json
npm exec --package=@covenant-org/timeline@0.0.0-alpha.2 -- timeline --version
```

The source candidate `@covenant-org/timeline@0.0.0-alpha.3` adds stored-receipt
verification:

```sh
pnpm timeline verify-conclusion \
  temporal-run.json temporal-query.json temporal-conclusion.json --json
```

`verify-conclusion` checks a stored receipt without invoking the reasoner. Input
is strict JSON, duplicate keys are rejected, and each file is limited to 16 MiB.
Add `--json` for canonical JSON output.

## Status and scope

The source candidate `@covenant-org/timeline@0.0.0-alpha.3` includes the Draft
v0alpha3 temporal API and model-proposal compiler, and retains the v0alpha1 and
v0alpha2 checkpoint APIs for compatibility. Their
[adoption guide](https://github.com/open-covenant/covenant-timeline/blob/main/docs/adoption-guide.md)
documents the legacy integration path.

The kernel operates on declared integer axes. Applications using civil dates
or named time zones must normalize them before admission under an explicit
calendar, time-zone database version, and gap/fold ambiguity policy. Timeline
does not yet ship this normalization profile.

Timeline does not provide evidence storage, workflow execution, admission
authority, or capability enforcement. No second conforming v0alpha3
implementation has yet been demonstrated.

See the
[repository README](https://github.com/open-covenant/covenant-timeline#readme)
for the exact correction receipt, architecture boundaries, benchmark,
conformance evidence, and operating guidance.

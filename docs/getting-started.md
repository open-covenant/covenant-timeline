# Getting started

Timeline requires Node.js 22 or 24.

```sh
npm install --save-exact @covenant-org/timeline@0.0.0-alpha.2
```

## Run a temporal query

Pass a v0alpha3 run and query to the CLI:

```sh
npx timeline reason temporal-run.json temporal-query.json --json
```

The conclusion contains canonical state and query identities, the semantic
result, and a proof receipt. v0alpha3 remains a Draft API while RFC 0009 is
under review.

## Use the library

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

`runInput` and `queryInput` are decoded v0alpha3 JSON documents. The host
authenticates source evidence and decides which model- or application-generated
records to admit. Timeline reasons only over those admitted records.

## Replay the correction example

The checked-in example first records a security review 100 seconds before
deployment, then admits a correction that places it 100 seconds after
deployment. Both historical conclusions remain replayable and
verifier-checked.

```sh
git clone https://github.com/open-covenant/covenant-timeline.git
cd covenant-timeline
corepack enable
pnpm install --frozen-lockfile
pnpm temporal:correction-demo
```

See the
[`evidence`](../examples/correction-replay/evidence),
[`run`](../examples/correction-replay/run.json),
[`queries`](../examples/correction-replay/queries), and
[`conclusions`](../examples/correction-replay/conclusions).

The conformance corpus provides additional bounds, consistency, point-order,
and interval-relation queries:

```sh
pnpm timeline reason \
  conformance/v0alpha3/runs/software-release.json \
  conformance/v0alpha3/queries/interval-relations.json \
  --json
```

See [Model interface](./model-interface.md) for the complete extraction,
admission, reasoning, verification, and response loop.

## Checkpoint compatibility

The package retains v0alpha1 and v0alpha2 checkpoint APIs for existing
integrations. Their
[adoption guide](./adoption-guide.md)
documents validation, authority, persistence, restart, command, and receipt
requirements.

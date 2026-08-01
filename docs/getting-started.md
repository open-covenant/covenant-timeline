# Getting started

Timeline requires Node.js 22 or 24.

Choose the integration surface that matches the host:

- build the local MCP server from source when an MCP-capable agent needs
  temporal state across sessions; or
- use `@covenant-org/timeline` when an application owns persistence,
  admission, and the model loop directly.

## Connect an agent to the source-built MCP server

`@covenant-org/timeline-mcp@0.0.0-alpha.1` is not yet published to npm. Build
the server from this repository:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Configure the client with absolute paths:

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

Use the absolute path reported by `node -p process.execPath`; GUI-launched MCP
clients may not inherit the shell's `PATH`. The server uses local stdio, makes
no network requests, and persists canonical append-only runs under the selected
data directory.

The default role is read-only. It can list runs, preview an untrusted model
proposal, project admitted state, and reason, but it cannot create, append, or
admit records. A host that owns admission starts a separate operator process by
adding `"--role", "operator"` to the arguments. The operator surface requires
every write to identify an authority, policy reference, and policy digest, and
persists those decisions in the audit resource. Keep that process isolated
from the model-facing client.

See the [MCP server guide](../packages/mcp-server/README.md) for both roles,
the portable run and admission-audit resources, restart semantics, and
operating limits.

To exercise direct-event persistence and replay before connecting an agent, run
the [local restart-and-correction pilot](../examples/mcp-agent-pilot). It stops
and restarts the server before admitting the correction, exports the pilot
artifact, and invokes an offline verifier in a separate process.

## Install the published library

```sh
npm install --save-exact @covenant-org/timeline@0.0.0-alpha.2
```

The published `@covenant-org/timeline@0.0.0-alpha.2` package contains the Draft
v0alpha3 temporal kernel. The source candidate
`@covenant-org/timeline@0.0.0-alpha.3` adds the proposal compiler and
stored-conclusion CLI; build the repository to evaluate those surfaces.

## Run a temporal query

Pass a v0alpha3 run and query to the CLI:

```sh
npm exec --package=@covenant-org/timeline@0.0.0-alpha.2 -- \
  timeline reason temporal-run.json temporal-query.json --json
```

The conclusion contains canonical state and query identities, the semantic
result, and a proof receipt. The v0alpha3 contract remains Draft while RFC 0009
is under review.

The source candidate `@covenant-org/timeline@0.0.0-alpha.3` can store that
conclusion and verify it later without asking the reasoner to produce another
answer:

```sh
pnpm timeline verify-conclusion \
  temporal-run.json \
  temporal-query.json \
  temporal-conclusion.json \
  --json
```

The verifier reconstructs the projected constraint graph, checks the state,
query, and semantic-result digests, and validates the supplied certificate.

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

The [public claim ledger](./claim-ledger.md) records what current artifacts
support.

## Checkpoint compatibility

The package retains v0alpha1 and v0alpha2 checkpoint APIs for existing
integrations. Their
[adoption guide](./adoption-guide.md)
documents validation, authority, persistence, restart, command, and receipt
requirements.

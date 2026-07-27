# Covenant Timeline MCP

**Durable, verifiable temporal state for long-running agents.**

An agent can record plans and observations, stop, restart, absorb a correction,
and ask the same temporal question at an earlier or later knowledge cut.
Timeline returns a deterministic conclusion with a proof receipt that another
process can verify.

## Connect

Requires Node.js 22 or 24. Add the server to any MCP client that supports local
stdio servers:

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

Use an absolute path on a dedicated local filesystem and restrict the directory
to the account running the MCP client. Once started, the server exposes only
stdio and makes no network requests.

## Agent workflow

The server provides five tools:

| Tool                     | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `timeline_create_run`    | Create an append-only run from an exact v0alpha3 contract               |
| `timeline_list_runs`     | Recover bounded run metadata and digests after a restart                |
| `timeline_append_event`  | Append one typed event under optimistic concurrency                     |
| `timeline_project_state` | Project admitted state at an explicit knowledge cut                     |
| `timeline_reason`        | Answer an exact temporal query and return a verified conclusion receipt |

Portable run documents are available as MCP resources at
`timeline://run/{runId}`. A verifier can read that resource and check a
conclusion with `verifyTemporalConclusionV0Alpha3` from
`@covenant-org/timeline`.

`recordedThrough` is always explicit. A non-negative integer selects that event
prefix; `null` selects the empty prefix. The server does not substitute a
mutable “latest” cut.

## Admission boundary

Direct MCP writes are structurally validated and classified as unauthenticated.
The server:

- assigns event schema and sequence values;
- validates the complete candidate run before committing it;
- retains SHA-256 evidence references, not evidence payloads; and
- reasons only over the typed records it has been given.

It does not authenticate evidence, decide whether a model extracted a record
correctly, parse civil time, perform semantic memory search, or grant authority.
A verified receipt proves derivation from admitted records, not that those
records describe reality.

Normalize dates, calendars, and named time zones before admission under an
explicit application policy. Keep the original source, extraction provenance,
and evidence bytes outside this server.

## Persistence

The reference store uses canonical JSON, whole-run digests, exclusive writer
locks, optimistic concurrency, and same-directory atomic replacement. Default
limits are 256 runs, 2,000 events per run, 4 MiB per stored run, and 1 MiB per
incoming MCP message.

Every append requires the current `runDigest`. If a response is lost, reload
the run and retry the same event ID and content; exact retries are idempotent.
An `indeterminate` error means a write may have committed and must be checked
before another event is proposed.

The store never removes a lock based on age. After an unclean exit, verify that
no writer is active before removing a stale lock. The reference implementation
is intended for a dedicated local filesystem, not a shared NFS or SMB volume.
On Windows, protect the data directory with a user-private ACL.

An unclean exit before replacement can leave a hidden `.tmp` file. After
confirming that no server process is using the directory, operators may remove
those temporary files; committed runs are the canonical `.json` files.

## Programmatic use

```ts
import {
  createTimelineMcpServer,
  FileMcpRunStore,
} from "@covenant-org/timeline-mcp";

const store = new FileMcpRunStore("/path/to/private/timeline-data");
const server = createTimelineMcpServer(store);
```

Connect the returned server with an MCP transport. The packaged
`timeline-mcp` binary uses stdio.

## Status

This package is an alpha reference integration for the Draft v0alpha3 temporal
contract. It is not a remote or multi-tenant service. Review the repository
[operations guide](https://github.com/open-covenant/covenant-timeline/blob/main/docs/operations.md)
and
[threat model](https://github.com/open-covenant/covenant-timeline/blob/main/docs/threat-model.md)
before production use.

Apache-2.0. See the
[Covenant Timeline repository](https://github.com/open-covenant/covenant-timeline)
for the temporal contract, correction-and-replay demo, conformance corpus, and
independent verification API.

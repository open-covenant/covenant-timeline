# Covenant Timeline MCP

**Durable, verifiable temporal state for long-running agents.**

An agent can record plans and observations, stop, restart, absorb a correction,
and ask the same temporal question at an earlier or later knowledge cut.
Timeline returns a deterministic conclusion with a proof receipt that another
process can verify.

## Connect

Requires Node.js 22 or 24. Build the repository once:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Add the built server to any MCP client that supports local stdio servers:

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

Use an absolute path on a dedicated local filesystem and restrict the directory
to the account running the MCP client. Once started, the server exposes only
stdio and makes no network requests.

## Agent workflow

The server provides six tools:

| Tool                            | Purpose                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `timeline_create_run`           | Create an append-only run from an exact v0alpha3 contract                       |
| `timeline_list_runs`            | Page through run metadata and recover digests after a restart                   |
| `timeline_append_event`         | Append one typed event under optimistic concurrency                             |
| `timeline_apply_model_proposal` | Compile a model proposal and atomically append its complete candidate event set |
| `timeline_project_state`        | Project admitted state at an explicit knowledge cut                             |
| `timeline_reason`               | Answer an exact temporal query and return a verified conclusion receipt         |

Portable run documents are available through the advertised MCP resource
template `timeline://run/{runId}`. Discover run IDs with
`timeline_list_runs`, then read the corresponding resource. A verifier can
check its conclusions with `verifyTemporalConclusionV0Alpha3` from
`@covenant-org/timeline`.

Run discovery returns at most eight entries. Continue with `nextCursor` until it
is `null`. Creating or deleting a run invalidates existing cursors; restart
discovery from the first page after a stale-cursor error. The resource template
does not publish a partial dynamic resource list: the custom list tool is the
single complete discovery path.

`recordedThrough` is always explicit. A non-negative integer selects that event
prefix; `null` selects the empty prefix. The server does not substitute a
mutable “latest” cut.

Tool discovery describes the contract, event, concurrency, and query fields
needed to construct a valid call. In particular, event drafts omit `schema` and
`sequence`, every new event carries the latest `runDigest`, and
`difference.bounds` returns bounds for `toPointId - fromPointId`.

### Apply model output without model-authored ledger mechanics

`timeline_apply_model_proposal` accepts a small semantic proposal:
coordinates, difference constraints, corrections, retractions, and one query
intent. The caller supplies bounded catalogs that map proposal handles to
declarations in the selected run prefix. Timeline derives contexts, assertion
IDs, event IDs, sequences, evidence digests, and the final query.

Every proposed change cites an evidence handle and an exact quote. The quote
must occur exactly once in current evidence text. The response identifies the
evidence digest, quote digest, and UTF-8 byte range, but does not return the
quote or evidence text. The canonical run retains only evidence digests.

The quote check establishes a reproducible source location. It does not
establish that the quote entails the assertion, that the evidence is authentic,
or that its producer has authority. Catalogs and evidence supplied through MCP
remain unauthenticated input, and the response retains the server's
`structural-only` and `unverified` admission classification.

Proposal writes bind both `expectedRevision` and `expectedRunDigest`. The
complete candidate event set is validated and written in one atomic
replacement. If a response is lost, resend the proposal, catalogs, evidence,
revision, and digest. The server reconstructs that append-only prefix and
recognizes an event-equivalent committed batch, even when later events have
since been added.

The returned query is fully formed and pins its record cut. Pass it unchanged
to `timeline_reason` to receive a verified conclusion and proof receipt.

The repository includes a
[source-first pilot starter](../../examples/mcp-agent-pilot)
that exercises creation, append, discovery, projection, and reasoning across a
restart, then exports a complete artifact for offline verification.

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
and evidence bytes outside this server. Model-proposal evidence text is used
only while handling the tool call and is not written to the Timeline data
directory or included in the response. MCP clients and transports may retain
their own request logs; configure them for the sensitivity of the source data.

## Persistence

The reference store uses canonical JSON, whole-run digests, exclusive writer
locks, optimistic concurrency, and same-directory atomic replacement. Limits
are 256 runs, 2,000 events per run, 4 MiB per stored run, eight entries per
discovery call, and 1 MiB per incoming MCP message. A model proposal may
contain at most eight changes, eight supports per change, 32 evidence entries,
128 reference handles, 128 assertion handles, and 32 prior-cut handles.
Evidence text is limited to 64 KiB per entry and 256 KiB in total; quotes are
limited to 4 KiB. The proposal itself is limited to 512 KiB, 2,048 JSON values,
and 12 nesting levels. Text limits are enforced on UTF-8 bytes. Programmatic
store options may lower the run and byte ceilings but cannot raise them.

Each new event requires the current `runDigest`. If a response is lost, reload
the run and retry the same event ID and content; exact retries are idempotent
even when their supplied digest is stale. An `indeterminate` error means a
write may have committed and must be checked before another event is proposed.
Compiled batches additionally carry their base revision. If every candidate
event already occupies the exact bound prefix, the write is a no-op, including
when later events exist. An incomplete match, changed order, changed content,
or identifier collision fails as a conflict rather than being repaired or
merged.

The store retains the candidate events, not the proposal, query, or source-span
receipts. On a no-op, returned provenance describes the current compilation and
must not be treated as historical admission provenance for the existing batch.

The store never removes a lock based on age. After an unclean exit, verify that
no writer is active before removing a stale lock. The reference implementation
is intended for a dedicated local filesystem, not a shared NFS or SMB volume.
On Windows, protect the data directory with a user-private ACL.

An unclean exit before replacement can leave a hidden `.tmp` file. After
confirming that no server process is using the directory, operators may remove
those temporary files; committed runs are the canonical `.json` files. Reads
reject symbolic links, FIFOs, devices, and other non-regular entries.

## Programmatic use

From a source checkout:

```ts
import {
  createTimelineMcpServer,
  FileMcpRunStore,
} from "@covenant-org/timeline-mcp";

const store = new FileMcpRunStore("/path/to/private/timeline-data");
const server = createTimelineMcpServer(store);
```

Connect the returned server with an MCP transport. The built `timeline-mcp`
binary uses stdio. Until registry distribution is available, import the server
from a pinned source checkout.

## Status

The MCP server is an alpha reference integration for the Draft v0alpha3
temporal contract. It is not a remote or multi-tenant service. Review the
[operations guide](https://github.com/open-covenant/covenant-timeline/blob/main/docs/operations.md)
and
[threat model](https://github.com/open-covenant/covenant-timeline/blob/main/docs/threat-model.md)
before production use.

Apache-2.0. See the
[Covenant Timeline repository](https://github.com/open-covenant/covenant-timeline)
for the temporal contract, correction-and-replay demo, conformance corpus, and
independent verification API.

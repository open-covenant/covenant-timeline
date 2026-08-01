# Covenant Timeline MCP

**Replayable temporal state with verifiable proof receipts.**

The server persists plans, observations, and corrections only after an operator
admits them. Its model-facing role can inspect that state, reconstruct an
earlier record cut, answer an exact temporal question, and return a proof receipt
that another process can verify.

The MCP server separates model work from operator authority. Its default role is
read-only: a model can inspect admitted state, reason over it, and preview a
typed proposal, but it cannot create or change a run. An operator starts a
separate server role to admit exact records under an explicit authority and
policy digest.

## Build from source

`@covenant-org/timeline-mcp@0.0.0-alpha.1` is not yet published. Use Node.js 22
or 24 and build it from a source checkout:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Use absolute paths in your MCP client configuration. This starts the read-only
model role:

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

Run the operator surface only in a host-controlled process:

```sh
node packages/mcp-server/dist/cli.js \
  --data-dir /absolute/path/to/private/timeline-data \
  --role operator
```

`--role` accepts only `model` or `operator`. There is no implicit write access.
The server uses stdio and makes no network requests.

## Roles and tools

The model role is the default and exposes four read-only tools:

| Tool                              | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `timeline_list_runs`              | Page through run metadata and recover exact prefixes after a restart    |
| `timeline_preview_model_proposal` | Compile a typed proposal and verify its conclusion without writing      |
| `timeline_project_state`          | Project admitted state at an explicit knowledge cut                     |
| `timeline_reason`                 | Answer an exact temporal query and return a verified conclusion receipt |

The operator role also exposes three mutation tools:

| Tool                            | Purpose                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| `timeline_create_run`           | Create an empty run from an exact v0alpha3 contract                   |
| `timeline_append_event`         | Append one typed event with an explicit admission decision            |
| `timeline_admit_model_proposal` | Recompile and atomically admit the candidate identified by its digest |

The MCP schemas define the accepted contract, event, query, concurrency,
proposal, and admission fields. Event drafts omit `schema` and `sequence`; the
server assigns both. Every new write binds the current run prefix by digest.

## Preview and admission

`timeline_preview_model_proposal` accepts semantic changes—coordinates,
difference constraints, corrections, and retractions—plus one query intent.
The caller supplies bounded catalogs mapping model-facing handles to declarations
in an exact run prefix.

Each proposed change cites an evidence handle and an exact quote. Timeline
requires one exact occurrence, then returns content digests and UTF-8 byte
ranges. Evidence text is used only during the call. It is not written to the
Timeline data directory or returned in the response.

Preview returns:

- the exact candidate events, query, and provenance;
- a digest of the complete canonical candidate;
- a conclusion derived from the candidate run; and
- a verified proof receipt.

Every preview also returns `persistence: "not-admitted"`, so it cannot be
mistaken for durable state.

The preregistered GPT-5.6 Sol evaluation of this proposal shape failed its
acceptance criteria: assertion F1 was 0.7692 and projected state was exact on
76/108 observations. Preview is a review surface, not evidence that free-form
model output is safe to admit automatically. The
[complete result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-proposal-v2-attempt-1-2026-08-01)
is public.

Preview never changes the run. To accept it, the operator sends proposal inputs
that compile to the same candidate digest to
`timeline_admit_model_proposal`, with:

```json
{
  "authorityId": "release-operator",
  "policyRef": "policy:software-delivery/v1",
  "policyDigest": "sha256:<digest-of-the-exact-policy-bytes>"
}
```

The server recompiles from the bound prefix and requires the resulting candidate
digest to match the value supplied by the operator. Any change that alters the
candidate fails admission. The server does not retain preview sessions, so the
operator must obtain and retain that digest from a preview or an equivalent
trusted compilation. The entire candidate batch and its admission record are
then committed atomically. Direct event appends require the same admission
fields and persist one admission record per event.

Admission reports one closed status: `admitted` for a new atomic write,
`already-admitted` for an exact idempotent retry, or `empty-candidate` when
there are no events to persist. The output schema cross-validates that status
against the returned events, admission record, and resulting revision.

The exported file store has no raw compiled-batch admission path. The operator
server passes it an immutable artifact carrying the candidate, computed
candidate and proposal digests, exact event batch, and bound run prefix, plus a
runtime-checked permit that is not exported from the package entry point. A
missing or forged permit fails before input parsing or filesystem access. This
keeps those fields bound inside the package; it does not authenticate an
operating-system user or grant process authority.

The admission decision belongs to the host. Timeline records and binds that
decision; it does not infer authority or decide whether evidence is trustworthy.

## Resources and verification

Two bounded resource templates are advertised:

- `timeline://run/{runId}` returns the canonical portable v0alpha3 run used to
  verify conclusions.
- `timeline://audit/{runId}` returns the stored envelope with every admission
  record, its writer software profile, and its content binding. The envelope's
  `lastWriter` records the software profile used for the most recent successful
  persistence. On a non-empty run it must match the final admission's writer.
  Neither field authenticates an operator or identifies a server instance.

Discover run IDs with `timeline_list_runs`. The metadata `runDigest` covers the
portable run. `auditDigest` covers the full stored envelope, including admission
records. Verify reasoning receipts with `verifyTemporalConclusionV0Alpha3` from
`@covenant-org/timeline`.

Run discovery returns at most eight entries. Continue with `nextCursor` until it
is `null`. Creating a run invalidates existing cursors; restart discovery after
a stale-cursor error. Dynamic resources are not enumerated separately—the list
tool is the complete discovery path.

`recordedThrough` is always explicit. A non-negative integer selects that event
and every earlier event. `null` selects the empty prefix.

## Trust boundary

A verified receipt proves that a conclusion follows from the records admitted
to the selected prefix. It does not prove that source evidence was true, that a
model extracted it correctly, or that the named authority was entitled to act.

The host remains responsible for:

- authenticating evidence and operators;
- defining and retaining exact admission-policy bytes;
- reviewing model proposals before admission;
- normalizing calendars, dates, and named time zones to contract coordinates;
- retaining original evidence and sensitive source text outside Timeline; and
- controlling filesystem and process access to the operator role.

MCP clients and transports may log requests containing evidence text. Configure
them for the sensitivity of the source data.

## Persistence

The local reference store uses canonical JSON, whole-run and whole-envelope
digests, exclusive writer locks, optimistic concurrency, and same-directory
atomic replacement. A persisted envelope contains the portable run and a
complete, contiguous admission record for every event. Corrupt, missing,
overlapping, or digest-invalid admission coverage is rejected on read.

Each admission record stores the Timeline package, reasoner, and MCP package
versions used for that write, and its `recordDigest` covers that software
profile. Later writes retain the original profile on every existing admission.
The envelope's `lastWriter` is current-write metadata, not operator identity,
process identity, or historical provenance for the complete run.

Limits are 256 runs, 2,000 events per run, 4 MiB per stored envelope, eight
entries per discovery call, and 1 MiB per incoming MCP message. A model proposal
may contain at most eight changes, eight supports per change, 32 evidence
entries, 128 reference handles, 128 assertion handles, and 32 prior-cut handles.
Evidence is limited to 64 KiB per entry and 256 KiB in total; each quote is
limited to 4 KiB. The proposal limit is 512 KiB, 2,048 JSON values, and 12
nesting levels. Text limits are enforced on UTF-8 bytes.

Exact direct-event and proposal-batch retries are idempotent only when their
admission decision is also identical. A changed event, candidate, ordering,
authority, policy reference, or policy digest fails as a conflict. An exact
retry returns the original admission record, including its writer identity,
without persisting or changing `lastWriter`. An `indeterminate` error means a
write may have committed; reload the run and audit envelope before retrying.

Use a dedicated local filesystem, not NFS or SMB. Restrict the data directory to
the account running the server. The store never removes locks based on age. After
an unclean exit, confirm no writer is active before removing a stale lock or a
hidden `.tmp` file. Reads reject symbolic links and non-regular entries.

Store schema `covenant.timeline.mcp-run.v0alpha2` is incompatible with earlier
alpha store files. No automatic migration is provided.

## Programmatic use

```ts
import {
  createTimelineMcpServer,
  FileMcpRunStore,
} from "@covenant-org/timeline-mcp";

const store = new FileMcpRunStore("/path/to/private/timeline-data");
const modelServer = createTimelineMcpServer(store);
```

Connect the returned server to an MCP transport. In a separately controlled
operator process, pass `{ role: "operator" }` to `createTimelineMcpServer`.
The `timeline-mcp` executable uses stdio.

## Status

This is an alpha, single-host reference integration for the Draft v0alpha3
temporal contract. It is not a remote or multi-tenant authorization service.
Review the
[operations guide](https://github.com/open-covenant/covenant-timeline/blob/main/docs/operations.md)
and
[threat model](https://github.com/open-covenant/covenant-timeline/blob/main/docs/threat-model.md)
before operational use.

Apache-2.0. See the
[Covenant Timeline repository](https://github.com/open-covenant/covenant-timeline)
for the contract, correction-and-replay example, conformance corpus, and proof
verifier.

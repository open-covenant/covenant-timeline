# Production Operations

## Deployment Boundary

The core package is a pure Node.js library and CLI. It opens no port, owns no
database, starts no background task, and executes no command.

`@covenant-org/timeline-mcp` is an optional long-running local stdio process. It
opens no port and makes no network request, but it owns canonical run files in
an explicit data directory while the MCP client is connected. It is a
single-host reference store, not a remote or multi-tenant service.

Production authorization and effect dispatch always belong to the adopter
runtime.

## Required Pins

Record these values with every run and operational event:

- Timeline package and source revision;
- MCP server package and store-envelope version when used;
- contract and event-stream digests;
- schema and conformance revision;
- adopter profile and independently pinned policy bytes or digest;
- host runtime and adapter version.

Never load policy or an effect template from ambient mutable configuration after
a run begins.

Core v0alpha1 does not prove that `policyRef` identifies the policy actually
used. Hosts must bind policy bytes or a versioned policy digest in their own
profile and treat Timeline's field as an unverified audit label.

v0alpha2 pins profile and policy identity in checkpoint contract bytes. Profile
verification must still resolve the policy bytes, authenticate the producer,
enforce freshness and revocation, and bind the resulting proof before recording
evidence.

## Safe Metrics

Use bounded labels:

- replay duration bucket and event-count bucket;
- validation failure category;
- finding code;
- pending, rejected, unresolved, and failed totals;
- command dispatch and receipt latency status;
- package, schema, and profile versions.

Do not use run, subject, evidence, producer, command, receipt, or policy IDs as
metric labels. They create high cardinality and may disclose relationships.

## Logging

Log stable codes, counts, pinned versions, and digests. Treat complete reports
as potentially sensitive. Never log evidence payloads, model-proposal source
text or quotes, credentials, signature material, or raw external-system
responses by default.

Do not treat evidence or quote digests as confidential substitutes for source
text. Low-entropy source material can be dictionary-tested, so restrict and
redact digests and byte spans according to the source's sensitivity.

## Limits

The reference implementation defaults are exported as
`DEFAULT_TIMELINE_LIMITS`:

- 50,000 events per run;
- 10,000 checkpoints;
- 1,000 requirements or evidence claims per local collection;
- 10,000 evidence references per evaluation;
- canonical JSON depth 128;
- 1,000,000 canonical JSON nodes;
- CLI input 16 MiB.

These are availability controls, not protocol maxima. Adopters should lower
them to match their workload and isolate expensive verification from request
threads.

The MCP server applies lower defaults:

- 256 locally stored runs;
- 2,000 events and 4 MiB per stored run;
- eight run-discovery entries per list call;
- 1 MiB per incoming MCP message;
- 32 axes and contexts;
- 512 points, 256 intervals, and 1,024 assertions;
- 4,096 solver edges and 2,000,000 operations per request.

The model-proposal tool lowers these limits again:

- eight changes and eight supports per change;
- 32 evidence entries, 64 KiB per entry, and 256 KiB in total;
- 4 KiB per exact quote;
- 128 reference handles and 128 assertion handles;
- 32 historical knowledge-cut handles; and
- 512 KiB, 2,048 JSON values, and 12 nesting levels per proposal.

Evidence and quote limits are enforced on UTF-8 bytes by the compiler. The MCP
schema also bounds collections and strings for tool discovery.

The core proposal compiler accepts at most 32 changes, eight supports per
change, 1,310,720 encoded proposal bytes, 4,096 JSON values, and 12 nesting
levels. Option overrides can only lower exported defaults. Validation returns
at most 64 bounded, control-character-escaped issues. Consumers receiving a
candidate across a process boundary should retain the exact proposal and host
inputs and call `verifyTemporalModelProposalCandidateV1`; JSON Schema
validation alone does not establish artifact integrity.

The MCP limits are enforced independently from the broader core defaults.
Continue catalog discovery with the returned opaque cursor and restart from the
first page if a catalog mutation makes that cursor stale. Standard MCP
discovery advertises the `timeline://run/{runId}` resource template but does not
return a partial dynamic resource list. Discover every run ID through
`timeline_list_runs`, then read the resource directly. Protocol frames that are
malformed or exceed the message limit terminate the stdio server with a nonzero
status so a supervisor can distinguish failure from a clean stop.

## Dispatch and Recovery

Persist the event and resulting state before dispatching a newly emitted
command. Persist the idempotency key in the effector's consistency boundary.
After a timeout, record `indeterminate` unless the external system can prove
success or failure.

On restart:

1. load the exact contract and complete accepted event stream;
2. replay without an adapter;
3. compare the pinned state digest;
4. reconcile unresolved commands through the external system's idempotency
   lookup;
5. append a receipt only after the result is known.

Do not dispatch commands merely because replay reconstructs them.

`RunState` is not a persistence or hydration format. Its exact-contract and
receipt-identity bindings include private in-process metadata that is lost by
serialization, object spreading, or reconstruction. Persist the contract and
accepted event stream. `FileRunArchiveStore` provides an atomic reference
implementation. A snapshot may cache replay output, but neither alpha schema
uses projected state for continuation.

The file store bounds reads and writes to 64 MiB by default; set `maxBytes`
explicitly when a reviewed workload needs another ceiling. Writers use an
exclusive `.lock` file containing only a schema, process ID, and creation time.
After an unclean process exit, confirm that no writer with that process ID is
active before removing a stale lock. Never automate lock removal by age alone.

### MCP persistence and recovery

Give the MCP server a dedicated absolute data-directory path on a local
filesystem. On POSIX, the server creates its directory and files with owner-only
modes; an existing parent or data directory must already have suitable access
controls. On Windows, configure a user-private ACL. Do not place the reference
store on NFS, SMB, or another shared filesystem.

Each direct event requires the current whole-run digest. A model-proposal batch
requires the exact base revision and whole-run digest. The server reconstructs
and verifies that prefix, compiles against it, validates the complete candidate
run, writes canonical bytes to a private temporary file, syncs it, and
atomically replaces the stored envelope under an exclusive lock.

An exact same-ID event retry is idempotent even if its supplied digest is stale.
A proposal retry is idempotent when the same candidate event bytes already
occupy the bound prefix, including after later events have been appended. An
incomplete prefix match, changed order or content, or competing identifier
fails with a conflict rather than being merged or repaired.

The MCP store does not retain proposal, query, or quote-span metadata. When
`applied` is `false`, the returned proposal digest, query, and provenance
describe the current compilation. They are not evidence of which proposal or
source span originally produced the event-equivalent stored batch.

Proposal evidence text and quotes are processed transiently. They are not
written to the Timeline data directory or returned by the tool. Retain the
evidence bytes and returned digest-and-span provenance in an appropriately
protected external store.

After `timeline.mcp.store.indeterminate`, reload the run before retrying because
the write may have committed. After an unclean exit, verify that no writer is
active before removing either a run lock or `.catalog.lock`; the server never
steals locks based on age. A crash before replacement can also leave a hidden
`.tmp` file. Once every writer is stopped, that uncommitted temporary file may
be removed.

Back up the canonical `.json` files only while the server is stopped or through
a filesystem snapshot that preserves point-in-time consistency. A restored
file is accepted only if its canonical envelope, run identity, revision, and
whole-run digest all verify. Store reads reject symbolic links, FIFOs, devices,
and other non-regular entries rather than following or blocking on them.

## Incident Response

- Stop dispatch while preserving read-only replay.
- Record affected package, contract, profile, policy, and run digests.
- Determine whether the defect changes historical verification or only host
  execution.
- If semantics change, release a new version and migration guidance; never
  silently rewrite fixtures or event streams.
- Deprecate a vulnerable npm version and publish an advisory. Do not overwrite a
  tag or artifact.

## Release Verification

Public-state verification requires GitHub CLI 2.88 or newer. The verifier
downloads the recorded public bundles and runs `gh attestation verify` without
using ambient GitHub authentication.

For a release tag:

1. confirm `timeline-v<package-version>` points to reviewed `main`;
2. verify the tag-restricted `npm` environment and require reviewer approval for
   beta and stable releases;
3. verify the workflow built identical tarballs twice;
4. run `pnpm release:evidence:check` to bind the release record to the local tag,
   source, components, protocol inputs, and migration;
5. run `pnpm release:verify-published -- <release-record>` to compare npm and
   GitHub bytes, checksums, SPDX SBOM, cryptographically verified attestations,
   the current remote tag, workflow identity, and registry metadata;
6. retain the machine-readable release record and rollback or deprecation
   instructions.

The MCP package uses independent tags named
`timeline-mcp-v<mcp-package-version>`. Its workflow runs the full repository
verification, builds the MCP tarball twice, checks installed stdio restart and
proof behavior, emits a separate checksum and SPDX SBOM, creates GitHub build
and SBOM attestations, and publishes with npm provenance.

An alpha release may use the documented short-lived token fallback. Record the
authentication path, remove the environment secret after the run, revoke the
token, and confirm that it no longer authenticates. Beta and stable releases
require trusted publishing and an eligible environment reviewer.

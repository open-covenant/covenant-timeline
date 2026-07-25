# Production Operations

## Deployment Boundary

The package is a pure Node.js library and CLI. It opens no port, owns no
database, starts no background task, and executes no command. Production
availability, persistence, authorization, and effect dispatch belong to the
adopter runtime.

## Required Pins

Record these values with every run and operational event:

- Timeline package and source revision;
- contract and event-stream digests;
- schema and conformance revision;
- adopter profile and policy reference;
- host runtime and adapter version.

Never load policy or an effect template from ambient mutable configuration after
a run begins.

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
as potentially sensitive. Never log evidence payloads, credentials, signature
material, or raw external-system responses by default.

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

For a release tag:

1. confirm `timeline-v<package-version>` points to reviewed `main`;
2. require the protected `npm` environment approval;
3. verify the workflow built identical tarballs twice;
4. verify checksum, SPDX SBOM, GitHub attestation, and npm provenance;
5. install the tarball in an empty consumer and run `timeline --version`;
6. retain rollback or deprecation instructions.

Registry scope ownership, trusted publisher linkage, environment reviewers, and
tag protection are external controls and must be inspected in their respective
administration surfaces.

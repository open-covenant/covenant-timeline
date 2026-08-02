# Run a maintainer-operated real-model MCP pilot

This procedure combines the repository's model-proposal boundary, local MCP store,
restart recovery, correction semantics, and credential-free proof verification
in one historical staged evidence-disclosure replay over public Covenant release
evidence.

It is maintainer-operated. It is not independent adoption, a second
implementation, or evidence that Timeline improves model accuracy over the
structured-extraction baseline.

It is not a live observation of evidence arriving over time. The maintainer
deliberately discloses already-public historical fields in two phases to exercise
the restart and correction path. Model execution, external evidence
authenticity, and process restart provenance are maintainer-attested. The
driver records each MCP child PID, a fresh launch ID, and the exact executable
and server-script digests, but those observations are not cryptographic process
attestation.

## Scenario

The first process records GitHub's release creation time as an explicitly
provisional publication proxy and the readiness timestamp for the exact tagged
commit. A model proposes both coordinates and the query. The host checks the
proposal against the normalized integer values and exact supporting quotes
before admission. The proposal is untrusted: the MCP server first returns a
verified, non-mutating preview, and the host admits the exact candidate only
after the scenario validator accepts it.

The process exits. A second host invocation starts a new MCP server and a new
one-shot model adapter, recovers the exact run prefix, supplies GitHub's later
authoritative publication timestamp, and requires the model to supersede the
provisional assertion. The same temporal question is evaluated at the original
and corrected knowledge cuts.

The checked input contains only allowlisted public fields. The MCP run retains
SHA-256 evidence references and source-span receipts, not evidence text. The
export keeps the public evidence in a separate directory and redacts it from
the recorded model request.

## Published successful attempt 1

Published successful attempt 1 completed on 2026-08-01 and is retained in the
[GitHub prerelease](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-1-2026-08-01).

| Field                        | Result                                                                      |
| ---------------------------- | --------------------------------------------------------------------------- |
| Source                       | `3fb0ce3249a028e52a5ae7fa25fd9ebbad229c8c`                                  |
| Recorded model configuration | GPT-5.6 Sol through the OpenAI Responses API; execution maintainer-attested |
| Reservations and bundles     | 2 provider reservations, 2 synchronized phase-result bundles                |
| Admission                    | 4 content-bound admission records                                           |
| Results                      | 513,698 ms historical; 360,698 ms corrected                                 |
| Retained verification        | `verified: true`; 3 receipts; exact operator runtime matched                |
| Archive SHA-256              | `cb246e732553dc069e17d614fbbd7352dc77bcd5693b7d6cd8ba902bf55c0b2e`          |

The published archive matches its SHA-256 sidecar and GitHub asset digest. A
fresh extraction verified successfully without credentials from a clean
checkout at the recorded source revision. That rebuilt checkout reported
`runtimeMatched: false`, while the retained operator verification reports
`runtimeMatched: true`; portable receipt verification does not require exact
operator-runtime reproduction.

The maintainer's prepublication scan reported no exact API-key bytes,
credential patterns, personal identifiers, or absolute home paths.

This attempt demonstrates the composed source-built workflow. It remains a
maintainer-attested historical staged replay, not independent adoption or a live
observation of evidence arriving over time.

## Intervening failed replication

An intervening maintainer replication completed its initial phase but terminated
during correction after the provider invocation. It was not retried and was not
exported as a successful artifact. The v1 terminal failure entry retained the
invocation and request binding, but not the rejected adapter output or a
content-bound rejection record. The retained state therefore cannot establish
from its own bytes why the correction failed.

This failure does not invalidate published successful attempt 1. Before attempt
2, the public evidence demonstrated one completed workflow, not repeatability or
reliable model proposal generation. The current v2 failure-retention contract
cannot retroactively repair the missing evidence in that earlier state.

## Published successful attempt 2

Published successful attempt 2 completed on 2026-08-02 and is retained in the
[GitHub prerelease](https://github.com/open-covenant/covenant-timeline/releases/tag/real-model-pilot-attempt-2-2026-08-02).

| Field                        | Result                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Source                       | `a4879897fcaa754ab0df928db5c98f2df25e7cb3`                                    |
| Recorded model configuration | GPT-5.6 Sol through the OpenAI Responses API; execution maintainer-attested   |
| Model configuration digest   | `sha256:b598dc7078558efded514cbea3dd7eaaa6f583a4145d8a5cfe850285ee7b6f65`     |
| Reservations and bundles     | 2 provider reservations, 2 synchronized phase-result bundles                  |
| Admission                    | 4 content-bound admission records                                             |
| Results                      | 513,698 ms historical; 360,698 ms corrected                                   |
| Retained verification        | `verified: true`; 3 receipts; `runtimeMatched: true`                          |
| Runtime identity             | v2; `sha256:9438bd64a0dda445dc09026fe631f3715d8959dded22ea8806d90e7ce50f0297` |
| Archive SHA-256              | `a138a38662a551d6190371ed67577fb91382e19cf935d6cc7173308843b84231`            |

The successful artifact and attempt ledger retain their v1 schemas; the bound
operator runtime uses runtime identity v2. The archive matches its SHA-256
sidecar and GitHub asset digest. Its owner, group, and modification-time
metadata are normalized. A fresh download, checksum verification, and
extraction verified successfully without provider credentials from the
recorded source revision, including an exact runtime match. The published 25
files also passed exact API-key, credential-pattern, personal-identifier, and
absolute-home-path scans.

The archive was initially published with SHA-256
`129bc141e18e500c62415ee41a4fa7448d29d6128c416f98603108ff4487afb6`.
It was replaced after its tar headers were found to contain local owner and
group names. All 25 extracted file payloads remained byte-identical under a
stable top-level directory; the replacement changed only the archive container
and normalized metadata.

The attempt-2 release uses a lightweight tag and a mutable prerelease surface.
Its evidence claim is pinned to the full source commit and current archive
digest; it is not a signed or immutable-release claim.

Attempts 1 and 2 demonstrate the composed source-built workflow twice. Both
were run by the same maintainer against the same staged historical scenario,
and an intervening replication failed during correction. This is not evidence
of independent operation, live delayed-evidence handling, model accuracy, or
general reliability.

## Published failure-receipt exercise

The
[failure-receipt exercise](https://github.com/open-covenant/covenant-timeline/releases/tag/failure-receipt-exercise-v2-2026-08-02)
ran on 2026-08-02 from the merged runtime v3 source. It invoked the exact
source-bound OpenAI adapter with `OPENAI_API_KEY` explicitly absent, as observed
by the maintainer. Under the bound adapter control flow, that condition rejects
the invocation before the provider-request path.

| Field                                 | Result                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| Source                                | `f65e1e73010285f1c0119ded92c72c5bce7e9ead`                                    |
| Invocation condition                  | Provider credential absent; maintainer-observed                               |
| Failure                               | `adapter-output` / `adapter.error-envelope`                                   |
| Runtime identity                      | v3; `sha256:a2722370908de44f2bec63c02314150a7820ba6fa7e9f630505843eed8d33652` |
| Portable verification                 | `verified: true`; raw adapter streams committed but undisclosed               |
| Archive SHA-256                       | `2cc39aeac313d4894f2840f94163b06a957f43e145eeb4471d010acba9334711`            |
| Provider requests and model inference | None; maintainer-observed and supported by bound control flow                 |

The annotated tag resolves to the recorded source revision. Two separate
maintainer archive builds were byte-identical. The archive uses normalized
owner, group, mode, timestamp, path, and gzip metadata. Its five files passed
the exporter, fresh-download checksum, credential and private-path scan, and
offline verifier.

The portable verifier checks the source and runtime bindings, input and policy
digests, attempt trajectory, closed failure classification, and raw-stream
commitments. Because the raw streams are not disclosed, it does not reconstruct
the credential-preflight detail from those bytes. The missing credential and
absence of a provider request are procedural evidence supported by the bound
adapter control flow. This exercise demonstrates the failure-retention path;
it is not evidence of provider-failure behavior, model execution, or workflow
reliability.

## Formal run

Use a clean committed checkout. Generate a source-bound OpenAI proposal
configuration outside the repository:

```sh
node scripts/create-openai-model-eval-config.mjs \
  --benchmark model-proposal-boundary-v1 \
  --model gpt-5.6-sol \
  --reasoning-effort high \
  --verbosity low \
  --max-output-tokens 16384 \
  --output /tmp/timeline-real-model-config.json
```

Pass the API credential only through `OPENAI_API_KEY`. Do not put it in the
configuration, state directory, artifact, or command line.

The formal path requires absolute paths to the running Node executable and the
adapter in this checkout. Run the two phases as separate commands, replacing
the placeholders below with those paths:

```sh
node scripts/mcp-real-model-pilot-bootstrap.mjs start \
  --input examples/mcp-real-model-pilot \
  --state /tmp/timeline-real-model-state \
  --config /tmp/timeline-real-model-config.json \
  -- /absolute/path/to/node /absolute/path/to/covenant-timeline/scripts/openai-responses-model-eval-adapter.mjs

node scripts/mcp-real-model-pilot-bootstrap.mjs resume \
  --input examples/mcp-real-model-pilot \
  --state /tmp/timeline-real-model-state \
  --config /tmp/timeline-real-model-config.json \
  --out /tmp/timeline-real-model-artifact \
  -- /absolute/path/to/node /absolute/path/to/covenant-timeline/scripts/openai-responses-model-eval-adapter.mjs
```

The formal path rejects a dirty checkout, a model configuration bound to a
different source revision, and any adapter other than the source-bound OpenAI
Responses adapter. The bootstrap and runtime measurer are trusted code. Before
importing the pilot, they record the Node executable, compiled core and MCP
server JavaScript, pilot and verifier scripts, resolved workspace targets, and
the transitive runtime package closure. The external parser package is hashed
before its exact entry point is loaded, then hashed again after the source scan.
The complete identity is checked again after the phase implementation loads.
Start, resume, export, and retained operator verification require those bytes
and resolution edges to remain unchanged.

Each phase writes and synchronizes an exclusive attempt-ledger entry before it
invokes the model adapter. A provider response that later fails validation is a
failed formal attempt, not a retry opportunity. A handled failure adds a
terminal failure entry. Before parsing or validation, the driver stores the
adapter exit status, signal, and bounded raw stdout and stderr as base64 with
byte counts and SHA-256 digests. Spawn errors are reduced to a closed code; host
and adapter error messages are not persisted as diagnostic fields. After a
proposal passes semantic validation and non-mutating preview, the driver writes
a proposal-ready receipt before admission can begin. A rejected phase stores a
private, canonical failure bundle that binds the capture, optional
proposal-ready receipt, exact verified or observed MCP state, and a closed
failure stage and code. The v2 terminal entry binds both the capture and
failure-bundle digests. Successful attempt ledgers and their verifier remain on
the published v1 surface.

Every ledger sequence has one exclusive filesystem slot. Before model admission,
the driver also installs an immutable phase decision bound to the captured
proposal. Recovery first observes MCP state through the read-only model role.
If admission already won, it completes post-admission verification without
another provider or admission call. If the base state remains unchanged,
recovery reconstructs the proposal-ready receipt by parsing the retained raw
response and running the same read-only preview. It does not call the provider
again. Only after that receipt is durable does recovery append a deterministic
fence event with an exact run-digest compare and swap. The fence and model
admission cannot both win: a successful fence closes the phase as interrupted,
while a successful candidate admission is recovered from its exact state.
Unexpected valid state is quarantined as divergent. A reconstruction or
preview error remains resumable because another live process may still own the
original admission; it is not converted into terminal evidence without a
durable phase decision.

If a synchronized result, failure bundle, or raw adapter capture already exists,
`resume` validates those bytes and completes the missing ledger entry without
invoking the provider or admitting another model proposal. Deterministic
post-admission verification failures become terminal evidence bound to the
admitted state. Failed attempts cannot produce a successful artifact. Their raw
adapter output remains only in the private state directory; command output
reports the stage and code, not raw diagnostic text. Preserve every failed or
interrupted state directory as part of the attempt record.

Export a self-contained redacted failed-attempt receipt, then verify it without
credentials or network access. The export path must not exist. Publication uses
an adjacent recoverable claim, reserves the destination with exclusive
directory creation, and never replaces an existing directory or link. An
incomplete marker makes a partial install unverifiable and lets a later process
recover recognized stale publication state without deleting unknown files.

The formal driver supports controlled interruption and clean process restart on
one host. It does not guarantee recovery after host or power loss, or after a
crash while the local store lock is held. Publication claims coordinate
cooperative writers; they are not a portable atomic no-replace primitive
against adversarial directory races or a distributed-filesystem protocol.

```sh
node scripts/mcp-real-model-pilot-failure-export.mjs \
  /tmp/timeline-real-model-state \
  /tmp/timeline-real-model-failed-attempt

node scripts/mcp-real-model-pilot-failure-verify.mjs \
  /tmp/timeline-real-model-failed-attempt
```

The portable receipt includes the mixed v1-prefix/v2-terminal ledger, redacted
request, runtime and policy bindings, MCP state, and raw-stream lengths and
digests. It omits raw stdout and stderr. The verifier therefore proves the
receipt structure, trajectory, and commitments, but does not replay parse
failures from undisclosed bytes. Full byte-level diagnosis requires the private
state directory.

`resume` exports the artifact and starts a third process. The credential-free
verifier performs no network requests. It reconstructs both complete model
requests from the redacted records and retained public evidence, regenerates
both request-bound schemas, recompiles and verifies both candidates, checks
preview/admit equality and MCP append prefixes, validates every admission
record in the exported v0alpha2 audit envelope, reproduces every conclusion,
and verifies every proof receipt. It also validates the recorded runtime
manifest and reports whether the verifier's local runtime is an exact match.
Artifact publication uses an exclusive attempt-bound claim and installs a
staging tree for cooperative single-host writers. If the process exits after
installation but before the parent directory is synchronized, a later `resume`
accepts the existing output only after the credential-free verifier proves that
it belongs to the same completed attempt.

Re-run it directly:

```sh
node scripts/mcp-real-model-pilot-verify-bootstrap.mjs \
  /tmp/timeline-real-model-artifact
```

Portable verification does not require another machine to use the operator's
Node binary, platform, architecture, or compiled byte-for-byte build. To test
exact runtime reproduction as well as the portable artifact and receipts, add
`--require-runtime-match`.

## Admission boundary

The model never selects event IDs, assertion IDs, evidence digests, ledger
sequences, or raw knowledge-cut indices. Its exact coordinate values must equal
the scenario's host-normalized evidence fields, each support must quote the
expected tagged commit and integer coordinate, and the correction must
supersede the active provisional publication assertion. Any mismatch rejects
the complete proposal before the MCP write.

Both MCP processes run in the explicit `operator` role. One canonical
maintainer-operated policy covers the host-defined declarations and both model
proposal batches. Every write records the neutral authority identifier, stable
policy reference, and SHA-256 digest of the exact policy bytes. Previewing a
proposal never writes state. Admission recompiles the same inputs, requires the
previewed candidate digest, and records the proposal and candidate digests.

This narrow semantic check and admission decision are specific to the release
scenario. The generic MCP server does not authenticate GitHub, establish source
truth, or decide which model claims deserve authority.

## Artifact

The export contains:

```text
artifact.json
README.md
admission-policy.json
attempt-ledger.json
audit.json
pilot-input.json
run.json
prompt.md
model-config.json
evidence-manifest.json
evidence/
model-calls/
phase-results/
queries/
conclusions/
verification.json
content-manifest.json
```

Each model-call record retains the exact model configuration, complete output
schema, untrusted proposal, exact adapter response text, usage, request and
response digests, catalog mappings, verified preview, host admission result,
and a request view in which evidence text and prompt text are replaced by
digests and byte lengths. The separate verifier restores those bytes from the
artifact before checking the original request digest.

`admission-policy.json` contains the exact canonical policy bytes bound to each
write. `audit.json` is the canonical `timeline://audit/{runId}` envelope. It
binds the portable run to the complete ordered admission record, including
every run prefix, event batch, authority, policy, candidate, proposal, and
admission-record digest.

`attempt-ledger.json` contains the five-record successful trajectory: attempt
opened, initial provider invocation reserved, initial phase completed,
correction provider invocation reserved, and correction phase completed. Every
record binds the previous digest. The opening record binds the input, model
configuration, admission policy, source revision, and runtime. Each phase binds
the host invocation, observed MCP child invocation, request, response,
proposal, candidate, synchronized phase-result bundle, and resulting run
prefix. `phase-results/` retains the two validated bundles used to recover and
export the successful attempt. Failed attempts and interrupted attempts without
a complete bundle remain in the operator state directory and cannot be
exported as successful artifacts.

The top-level runtime identity records the executable and Node runtime fields,
the exact compiled and script bytes, content digests for every resolved runtime
package, and stable logical resolution edges. Absolute checkout and package
store paths are never recorded. This closes the gap left by Git status:
compiled `dist` directories and installed dependencies are not identified by a
clean source revision alone. The operator's start, resume, export, and retained
verification report require an exact match. A verifier on another supported
machine validates the recorded runtime digest, checks the portable artifact and
every receipt, and reports `runtimeMatched: false` when its local runtime
differs.

The package closure follows declared dependencies and hashes their package
trees. Runtime identity v3 freezes the current formal file and
application-dependency inventory. Its TypeScript parser package is measured
before it is loaded and measured again after the source scan; the captured
source bytes, rather than a second filesystem read, are scanned. Runtime v2
remains valid for published attempt 2, and runtime v1 remains valid for attempt
1 under its 49-file, eight-root baseline. The source scanner is an integrity
guard for the supported loading forms, not an adversarial module loader or
sandbox. The closure does not claim to discover arbitrary dynamic code, native
resources, or operating-system resources outside the recorded package trees.

`content-manifest.json` binds every primary artifact file by byte length and
SHA-256 digest. It excludes itself and the derived `verification.json` report to
avoid a checksum cycle. The verifier rejects every other unlisted file and
reproduces a retained verification report when one is present.

The public evidence is normalized by the maintainer host. The artifact proves
what follows from those admitted records and that the retained proposal bytes
compile to the admitted events. The maintainer attests that those proposal bytes
came from the recorded model calls. Distinct host and driver-observed MCP child
identities support the process-restart record, but do not cryptographically
prove process execution. The artifact does not independently authenticate
GitHub's observations or qualify as an external operator pilot.

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
Responses adapter. A built-in-only bootstrap records the Node executable,
compiled core and MCP server JavaScript, pilot and verifier scripts, resolved
workspace targets, and the manifest-derived transitive runtime package closure
before importing the pilot. It rechecks that identity after loading the phase
implementation. Start, resume, export, and retained operator verification
require those bytes and resolution edges to remain unchanged.

Each phase writes and synchronizes an exclusive attempt-ledger entry before it
invokes the model adapter. A provider response that later fails validation is a
failed formal attempt, not a retry opportunity. A handled failure adds a
terminal failure entry. Every ledger sequence has one exclusive filesystem slot,
so a recovering process that completes a phase and the original process's
failure path cannot record contradictory outcomes. A crash leaves the provider
reservation in place.
If the validated phase-result bundle was already synchronized, `resume`
revalidates it and records the missing completion without invoking the provider
again. Without that complete bundle, the phase cannot continue and a later run
must use a new state directory. Preserve every failed or interrupted state
directory as part of the attempt record.

`resume` exports the artifact and starts a third process. The credential-free
verifier performs no network requests. It reconstructs both complete model
requests from the redacted records and retained public evidence, regenerates
both request-bound schemas, recompiles and verifies both candidates, checks
preview/admit equality and MCP append prefixes, validates every admission
record in the exported v0alpha2 audit envelope, reproduces every conclusion,
and verifies every proof receipt. It also validates the recorded runtime
manifest and reports whether the verifier's local runtime is an exact match.
Artifact publication uses an exclusive attempt-bound claim and an atomically
installed staging tree. If the process exits after installation but before the
parent directory is synchronized, a later `resume` accepts the existing output
only after the credential-free verifier proves that it belongs to the same
completed attempt.

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
trees. It does not discover undeclared dynamic loads or native and operating
system resources outside those trees. The built-in-only bootstrap is the
measurement trust anchor; its own bytes are included in the fixed runtime
manifest.

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

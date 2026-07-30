# Evaluate a model integration

The model-interface benchmark compares one model under three temporal
interfaces: cumulative full-context text, rolling narrative memory, and rolling
Covenant Timeline state with deterministic reasoning.

Version 1 is a public 12-case development and smoke suite. No external model
result has been published. Use it to validate an adapter and find interface
failures, not to claim broad temporal reasoning performance. The
[benchmark protocol](../benchmarks/model-interface/v1/README.md) is canonical;
the larger held-out evaluation gate is tracked in the
[roadmap](../ROADMAP.md).

## Adapter contract

The benchmark makes no network request. A vendor-specific adapter owns
authentication and model invocation. For each observation, the runner:

1. starts a fresh adapter subprocess;
2. writes exactly one strict JSON request line to standard input;
3. accepts exactly one strict JSON response line from standard output; and
4. closes the process before starting the next observation.

The fresh process removes adapter-process state across cuts, arms, cases, and
repeats. The adapter must also create an independent inference request without
a persistent provider conversation, thread, session identifier, or hidden
prior messages. Subprocess startup is included in `latencyMs`. Diagnostics
belong on standard error. The adapter must echo the exact `requestId` and
present the complete `prompt` and `input` to the configured model without
semantic repair or case-specific guidance.

Pass credentials through the adapter environment. Do not put keys, tokens,
private endpoints, or organization identifiers in configuration, results, or
diagnostics.

Successful model output uses the immutable
`covenant.timeline.model-eval.response.v1` envelope. Adapter and provider
failures use the separate
`covenant.timeline.model-eval.adapter-error.v1` envelope so failure reporting
does not widen the published success protocol.

## Ollama local adapter

The repository includes an adapter for an Ollama daemon at
`127.0.0.1:11434`. The adapter sends no credentials, accepts no endpoint
override, rejects redirects and cloud-model identifiers, performs no retry, and
makes one independent `/api/chat` request per observation. Inference uses the
arm-specific JSON Schema, disables streaming, and fixes the thinking setting,
temperature, seed, top-p, context length, and output-token limit from the
recorded run configuration. Thinking is `false` by default; models such as
GPT-OSS that require a level use a recorded `low`, `medium`, or `high` value.

A loopback endpoint alone does not guarantee local inference: a signed-in
Ollama daemon can route cloud models. A conforming local run uses a daemon
started with cloud features disabled. Stop any existing daemon on the benchmark
port, then start a dedicated process in another terminal:

```sh
OLLAMA_NO_CLOUD=1 ollama serve
```

PowerShell:

```powershell
$env:OLLAMA_NO_CLOUD = "1"
ollama serve
```

The adapter rejects known cloud-model names, but the daemon-wide no-cloud
setting is an operator requirement because the local API does not expose it for
verification.

Before inference, the adapter reads `/api/version` and `/api/tags`. The exact
runtime version and installed model's complete SHA-256 digest must match the
recorded configuration. The chat request keeps the model loaded for five
minutes; after inference, the adapter reads `/api/ps` and requires the running
model's digest to match. A version, tag, or loaded-model mismatch fails the run.
Use a dedicated daemon and do not pull, copy, or delete models during an
evaluation. Prompt and generated token counts are copied into the result.
Ollama does not provide monetary accounting for local inference, so `costUsd`
is `null`.

Choose and install a local Ollama model, then inspect the runtime and inventory:

```sh
ollama pull <model>
curl --fail --silent http://127.0.0.1:11434/api/version
curl --fail --silent http://127.0.0.1:11434/api/tags
```

Create the source-, runtime-, and model-bound configuration outside the
checkout:

```sh
node scripts/create-ollama-model-eval-config.mjs \
  --model <exact-installed-name> \
  --digest sha256:<digest-returned-by-api-tags> \
  --runtime-version <version-returned-by-api-version> \
  --output /tmp/covenant-timeline-ollama.json
```

Add `--thinking low`, `medium`, or `high` for a model that does not accept
`false`.

Run the three-request Timeline smoke before a complete evaluation:

```sh
node scripts/run-model-interface-eval.mjs \
  --config /tmp/covenant-timeline-ollama.json \
  --output /tmp/covenant-timeline-ollama-smoke.jsonl \
  --repeats 1 \
  --case correction.shipment-arrival \
  --arm timeline \
  --timeout-ms 120000 \
  -- node scripts/ollama-model-eval-adapter.mjs
node scripts/score-model-interface-eval.mjs \
  --results /tmp/covenant-timeline-ollama-smoke.jsonl
```

On Windows, replace the `/tmp/...` paths with an absolute path outside the
checkout and use PowerShell backticks for multiline commands.

No Ollama model result is committed. The adapter tests use a bounded mock
provider and establish protocol behavior, not model quality.

## OpenAI Responses default-endpoint adapter

The repository includes a reference adapter at
`scripts/openai-responses-model-eval-adapter.mjs`. It makes one independent
request per observation. The benchmark prompt is sent unchanged as
`instructions`; one user message contains the canonical JSON encoding of:

```json
{
  "requestId": "request-0087",
  "input": {}
}
```

This gives the model the correlation value it must return without exposing the
case family, expected result, traits, repeat number, run configuration, or
configuration digest. Evidence records retain their protocol-level cut indices.
The request sets `store: false`, disables background execution, supplies no
tools or conversation identifier, rejects redirects, and performs no retry. It
omits the deprecated truncation parameter, whose API default rejects inputs
that exceed the model context window. An arm-specific Structured Outputs schema
constrains the provider response; the benchmark validator remains authoritative
and does not repair model output.

The adapter accepts only `OPENAI_API_KEY` from the environment. It always calls
`https://api.openai.com/v1/responses` and accepts no base-URL, organization, or
project override. Configuration must use the same exact model identifier in
`model.id` and `model.revision`, and the returned `response.model` must match.
For a publishable run, choose a provider-documented immutable snapshot rather
than a moving alias. Because the adapter cannot apply a sampling seed, it
requires `generation.seed: null`. It accepts `maxOutputTokens` from 16 through
1,000,000 and rejects fine-tuned model IDs because the response schemas use
keywords that OpenAI does not support for fine-tuned Structured Outputs.

Rate limits, transient provider failures, transport failures, incomplete
responses, refusals, and invalid provider output become bounded,
observation-scoped error envelopes. Those observations remain in the result
file and every applicable denominator. Invalid configuration, missing
credentials, authentication and authorization failures, missing models, and
model-revision mismatches are run-scoped and abort the run before a result line
is recorded. Provider response bodies and refusal text are not copied into the
artifact or diagnostics. The stored `responseText` is the exact adapter
protocol line, not the raw OpenAI response body.

The implementation follows OpenAI's
[Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
and
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
contracts.

## Configure a run

Create a strict JSON configuration:

```json
{
  "schema": "covenant.timeline.model-eval.config.v1",
  "id": "example-model-deterministic",
  "benchmarkRevision": "full-git-source-commit",
  "adapter": {
    "id": "example-adapter",
    "version": "adapter-source-revision"
  },
  "model": {
    "provider": "provider-or-local-runtime",
    "id": "exact-model-identifier",
    "revision": "exact-provider-revision"
  },
  "generation": {
    "temperature": 0,
    "seed": 42,
    "maxOutputTokens": 4096,
    "parameters": {
      "topP": 1,
      "structuredOutput": true
    }
  }
}
```

Record every effective inference setting. Use `null` when the provider does not
support a seed and an explicit revision string when it does not disclose a
model revision. The runner binds the configuration, corpus, and prompt bytes to
the result metadata and every adapter request. The adapter must use the request
configuration to select the declared model and generation settings. Credentials
come from its environment and are rejected in the recorded configuration. The
runner also records the Timeline version, Git source state, Node.js version,
platform, and architecture. It rejects a configuration whose
`benchmarkRevision` does not resolve to the checked-out source revision. A
publishable run uses the full commit object ID; resolvable Git refs remain
accepted for compatibility with earlier development configurations.

For the OpenAI adapter, generate the run configuration outside the checkout.
The generator copies the
[`openai-responses.example.json`](../benchmarks/model-interface/v1/configs/openai-responses.example.json)
template, injects the exact source commit, and keeps `model.id` and
`model.revision` identical. Pass `--model <snapshot>` when your OpenAI project
requires another provider-documented snapshot.

## Run and score

From a clean clone, use Node.js 22 or 24 and pnpm 10:

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/create-openai-model-eval-config.mjs \
  --output /tmp/covenant-timeline-openai.json
```

Set `OPENAI_API_KEY` in the adapter environment. Do not put it in the run
configuration. Start with one case, one arm, and one repeat:

```sh
node scripts/run-model-interface-eval.mjs \
  --config /tmp/covenant-timeline-openai.json \
  --output /tmp/covenant-timeline-openai-smoke.jsonl \
  --repeats 1 \
  --case correction.shipment-arrival \
  --arm timeline \
  --timeout-ms 120000 \
  -- node scripts/openai-responses-model-eval-adapter.mjs
node scripts/score-model-interface-eval.mjs \
  --results /tmp/covenant-timeline-openai-smoke.jsonl
```

The smoke makes three provider requests, one for each knowledge cut. Inspect
every failure before starting the complete public v1 run. The complete command
makes 324 requests: 12 cases, three arms, three cuts, and three repeats. Check
provider cost and rate limits first, then use a fresh output path:

```sh
node scripts/run-model-interface-eval.mjs \
  --config /tmp/covenant-timeline-openai.json \
  --output /tmp/covenant-timeline-openai-full.jsonl \
  --repeats 3 \
  --timeout-ms 120000 \
  -- node scripts/openai-responses-model-eval-adapter.mjs
node scripts/score-model-interface-eval.mjs \
  --results /tmp/covenant-timeline-openai-full.jsonl
```

The command after `--` is executed directly, without shell expansion. Keep the
configuration and results outside the checkout. The generator and runner refuse
in-checkout outputs, and neither replaces an existing file by default. Use fresh
paths for subsequent attempts; do not combine favorable observations from
different attempts.

On Windows PowerShell, use the system temporary directory:

```powershell
$runRoot = [IO.Path]::GetTempPath()
$config = Join-Path $runRoot "covenant-timeline-openai.json"
$smoke = Join-Path $runRoot "covenant-timeline-openai-smoke.jsonl"
$full = Join-Path $runRoot "covenant-timeline-openai-full.jsonl"

pnpm install --frozen-lockfile
pnpm build
node scripts/create-openai-model-eval-config.mjs --output $config
node scripts/run-model-interface-eval.mjs `
  --config $config `
  --output $smoke `
  --repeats 1 `
  --case correction.shipment-arrival `
  --arm timeline `
  --timeout-ms 120000 `
  -- node scripts/openai-responses-model-eval-adapter.mjs
node scripts/score-model-interface-eval.mjs --results $smoke
```

After inspecting the smoke result and checking cost and rate limits, run the
complete suite:

```powershell
node scripts/run-model-interface-eval.mjs `
  --config $config `
  --output $full `
  --repeats 3 `
  --timeout-ms 120000 `
  -- node scripts/openai-responses-model-eval-adapter.mjs
node scripts/score-model-interface-eval.mjs --results $full
```

## What the model receives

Every arm receives the controlled entity dictionary, temporal contract, trusted
`setupEvents`, question, and evidence. The request `caseId` is opaque; corpus
IDs, family names, traits, expected results, gold events, and gold queries
remain evaluator-side.

- `direct` receives all evidence available through the current cut. Every cut
  is independent.
- `narrative-memory` receives only evidence introduced at the current cut and
  the last valid memory string.
- `timeline` receives only evidence introduced at the current cut, the
  previously admitted `priorRun`, completed `knowledgeCuts`, and
  `stateBudgetBytes`.

Both rolling arms use a fixed 4096-byte UTF-8 continuity cap, independent of
gold state size. Narrative memory is an opaque model-written string; the
harness enforces its schema and byte length rather than a prose style. Invalid
or over-budget memory is rejected and the last valid value is retained.
Timeline meters the canonical model-generated events carried in `priorRun`,
excluding trusted `setupEvents`, plus `knowledgeCuts`. Static contract, entity,
and setup data are unmetered for both arms. Rejected events are not carried
forward.

Timeline deltas may cite only evidence introduced at the current cut and may not
declare points or intervals. The host appends accepted events exactly as
returned, validates the run and query, computes the conclusion, and verifies its
proof with the public v0alpha3 API.

## Results and metrics

The runner writes one newline-delimited
`covenant.timeline.model-eval.result.v1` record per observation, including
observation-scoped failures. Run-scoped setup failures abort before publishing
the output target. Each record stores canonical `requestText` and its digest,
the exact adapter `responseText` line and its digest, structured outputs,
state-byte metadata, wall-clock latency, and optional provider usage.
`inputTokens`, `outputTokens`, and `costUsd` may each be `null` when
unavailable.
Records conform to
[`result.schema.json`](../benchmarks/model-interface/v1/result.schema.json).

The scorer reconstructs the request from the corpus, prompt, opaque case ID,
budget, and prior rolling results, then verifies its canonical bytes and digest.
It also recomputes the response digest, reparses the stored response, and checks
that its answer, memory, usage, events, and query reproduce the structured
record. Corpus and prompt digests, coverage, Timeline state, kernel conclusions,
and proofs are verified in the same pass.
The aggregate output conforms to the benchmark
[`score.schema.json`](../benchmarks/model-interface/v1/score.schema.json).

Lead reports with paired answer-accuracy `timelineVsNarrativeMemory` and
`timelineVsDirect` win/loss/tie counts, then report:

- `answerExactRate`, `unsupportedDefiniteRate`, `contradictionPrecision`,
  `contradictionRecall`, `falseInconsistencyRate`, `correctionAccuracy`, and
  `historicalReconstructionAccuracy`;
- Timeline `admissionRate`, representation-exact assertion precision, recall,
  and F1, `projectedStateExactRate`, `queryExactRate`,
  `proofVerificationRate`, and `endToEndExactRate`; and
- latency, provider token counts, and cost separately from correctness.

Representation-exact assertion metrics compare the chosen typed event encoding
after alpha-renaming model-owned IDs. `projectedStateExactRate` compares the
normalized active assertions, evidence references, and temporal consequences
of candidate and gold state. `endToEndExactRate` additionally requires the
answer, query, admission, and proof to match. Query exactness maps raw
`recordedThrough` sequences to benchmark knowledge-cut ordinals before
comparison. Publish paired answer accuracy and Timeline end-to-end extraction
together.

Invalid, timed-out, malformed, rejected, and missing responses remain in the
applicable denominators. Three repeats with the same seed are stability checks,
not independent statistical samples. The runner rotates the configured arm
order by case and repeat so a fixed provider slowdown or rate-limit boundary
does not always penalize the same arm.

## Publication boundary

Publish the raw result JSONL, scorer output, run configuration, corpus and prompt
digests, adapter revision, source revision, package version, and exact scoring
command together. Disclose provider retries, caching, moderation, structured
output, and truncation behavior.

Publishable results require `sourceDirty: false` and independent provider
requests with no persistent conversation or session state. Commit the runner,
scorer, corpus, prompts, and adapter before evaluation. Dirty-source results are
development artifacts.

The runner stages results beside the target and publishes only after all
observations finish and the repository source, built Timeline kernel, benchmark
scripts, and directly named adapter files still match their starting bytes. An
incomplete run handled by the runner, or an integrity-failed run, leaves no
output target or partial artifact. A forced process termination may leave the
hidden staging file for forensic cleanup. If atomic publication alone fails
after those checks pass, the error reports the retained, validated `.partial`
artifact. External adapters that load dependencies outside those files must pin
and disclose that dependency closure separately.

A run containing transport, rate-limit, or other operational provider errors is
an adapter or capacity diagnostic, not model-performance evidence. Preserve it,
fix the operational condition, and rerun the complete preregistered selection.
Do not omit failed observations or splice successful observations across runs.

The reference adapter does not set `prompt_cache_key` or request a service
tier, and it cannot disable ordinary provider-side caching or account-level
controls. Disclose those provider conditions with a published run. It records
provider-reported input and output token totals, but not cached-token,
reasoning-token, or raw response metadata.

The visible 12-case suite is not held out after adapter development. It does not
establish open-domain extraction, civil time, time zones, calendar recurrence,
causality, source authority, domain transfer, production safety, or clinical or
regulatory fitness. Use the [independent temporal pilot](./temporal-pilot.md)
for workflow evidence and the roadmap scale gate for any broader model claim.

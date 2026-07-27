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

## Configure a run

Create a strict JSON configuration:

```json
{
  "schema": "covenant.timeline.model-eval.config.v1",
  "id": "example-model-deterministic",
  "benchmarkRevision": "source-commit-or-release",
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
platform, and architecture.

## Run and score

Build the repository, then place the adapter command after `--`:

```sh
pnpm build
node scripts/run-model-interface-eval.mjs \
  --config run-config.json \
  --output results.jsonl \
  --repeats 3 \
  --timeout-ms 120000 \
  -- node path/to/adapter.mjs
```

The command is executed directly, without shell expansion. Use a one-case smoke
run while integrating:

```sh
node scripts/run-model-interface-eval.mjs \
  --config run-config.json \
  --output smoke.jsonl \
  --repeats 1 \
  --case correction.shipment-arrival \
  --arm timeline \
  -- node path/to/adapter.mjs
```

Score the complete result file:

```sh
node scripts/score-model-interface-eval.mjs \
  --results results.jsonl
```

Use a fresh output path for each run. Do not combine favorable observations
from different attempts.

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
failures. Each record stores canonical `requestText` and its digest, the exact
adapter `responseText` line and its digest, structured outputs, state-byte
metadata, wall-clock latency, and optional provider usage. `inputTokens`,
`outputTokens`, and `costUsd` may each be `null` when unavailable.
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
not independent statistical samples.

## Publication boundary

Publish the raw result JSONL, scorer output, run configuration, corpus and prompt
digests, adapter revision, source revision, package version, and exact scoring
command together. Disclose provider retries, caching, moderation, structured
output, and truncation behavior.

Publishable results require `sourceDirty: false` and independent provider
requests with no persistent conversation or session state. Commit the runner,
scorer, corpus, prompts, and adapter before evaluation. Dirty-source results are
development artifacts.

The visible 12-case suite is not held out after adapter development. It does not
establish open-domain extraction, civil time, time zones, calendar recurrence,
causality, source authority, domain transfer, production safety, or clinical or
regulatory fitness. Use the [independent temporal pilot](./temporal-pilot.md)
for workflow evidence and the roadmap scale gate for any broader model claim.

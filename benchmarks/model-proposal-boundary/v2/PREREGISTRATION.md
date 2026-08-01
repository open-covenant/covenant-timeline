# Model-proposal reliability gate v2

This document fixes the evaluation before any provider request is made. The
gate tests one claim: a frontier model can reliably produce compiler-valid,
source-grounded temporal proposals for a host-declared workflow vocabulary.

It does not test whether Timeline improves answer accuracy over another memory
system. It does not establish evidence authenticity, admission authority,
calendar interpretation, entity discovery, or independent adoption.

## Frozen evaluation

- Proposal protocol: `covenant.timeline.model-proposal.v1`
- Model: `gpt-5.6-sol`
- Model identity: exact provider model ID and run timestamp; no dated provider
  snapshot is available
- Adapter: `openai-responses` version `1`
- Reasoning effort: `high`
- Temperature: omitted (`null` in the configuration)
- Maximum output tokens: `16384`
- Structured output: enabled
- Output verbosity: `low`
- Repeats: three
- Timeout: 120,000 milliseconds per observation
- Cases: 12
- Cuts per case: three
- Provider requests: 108
- Corpus digest:
  `sha256:a0055e7b5aa701819a7ca422e6915cc9c622bb04ed2214b1cf8d2606152fdeb4`
- Acceptable-support digest:
  `sha256:69fb8a40f7ac4429d5e83da287d15f6e27a7a5e8f062821786744b9a78d8fa39`
- Prompt digest:
  `sha256:34809fd6d1ba493c0b5d9da1f4e809d4a030cb38307207e9954685ceadd08e9b`

The v2 corpus preserves the six semantic families used by the earlier
engineering suite but changes the values, questions, and evidence surface.
Every temporal claim is placed in its own evidence record. Every cut also
contains a realistic administrative record and a rejected temporal change
request. Evidence IDs are opaque and record order does not distinguish claims
from distractors. The suite includes coordinates, difference
constraints, confirmations, corrections, retractions, contradictions,
historical cuts, context traps, and interval relations.

The corpus and acceptable spans were frozen before any v2 model response was
requested or inspected. They are a new robustness surface, not an independent
private test set and not evidence of broad domain generalization.

## Grounding

Each gold assertion or retraction has one evidence record and one or more
explicitly acceptable quotes in
[`acceptable-supports.json`](./acceptable-supports.json). A support is correct
only when its evidence ID and quote match that set. Selecting the right
evidence record while quoting a distractor or a larger non-accepted span does
not pass grounding.

Grounding is matched per typed change. A support is accepted only when the
change's target, bounds, and revision match a gold change and its evidence ID
and quote match that change's frozen support slot. Swapping otherwise valid
supports between two changes fails both slots. Grounding precision counts
accepted slots over all proposed supports. Grounding recall counts accepted
slots over the frozen expected support slots. Duplicating a support cannot
increase recall.

## Aggregate thresholds

The gate returns `continue` only if every check passes:

| Metric                             | Threshold                                     |
| ---------------------------------- | --------------------------------------------- |
| Coverage                           | exactly 108 observations, no coverage defects |
| Response-schema validity           | at least 106/108                              |
| Compiler validity                  | at least 106/108                              |
| Candidate verification             | at least 106/108                              |
| Applied candidates                 | at least 106/108                              |
| Representation assertion precision | at least 0.97                                 |
| Representation assertion recall    | at least 0.95                                 |
| Representation assertion F1        | at least 0.96                                 |
| Projected-state exactness          | at least 103/108                              |
| Query exactness                    | at least 106/108                              |
| Answer exactness                   | at least 103/108                              |
| End-to-end exactness               | at least 103/108                              |
| Proof verification                 | every applied candidate                       |
| Acceptable-support precision       | at least 0.98                                 |
| Acceptable-support recall          | at least 0.95                                 |
| Acceptable-support F1              | at least 0.96                                 |

Each repeat must independently reach assertion F1 of at least 0.92,
end-to-end exactness of at least 32/36, and acceptable-support F1 of at least
0.92. Repeats are stability checks, not independent samples.

## Attempts and decisions

The attempt ledger is initialized before inference and binds the frozen source,
runtime, configuration, corpus, supports, and prompt. Each permitted attempt is
registered in that retained ledger before its first provider request. The
formal runner atomically changes that entry from `pending` to `claimed` before
its first provider request. The claim binds a fresh artifact UUID, the UTC
start time, and a digest of the canonical output path. Every result carries
those bindings alongside the request-scoped output schema, request, and
response. The gate requires the result's embedded claim to match the retained
ledger, along with the repository's frozen inputs, official OpenAI adapter,
full case order, exact configuration, and current clean source state.

Provider transport failures, HTTP 429 responses, and HTTP 5xx responses make
an attempt operationally inconclusive. The retained ledger then permits one new
complete attempt with the same frozen bindings. It closes after the first
operationally valid attempt or after two inconclusive attempts. Against the
retained ledger, the formal CLI claims a prepared UUID once, refuses a different
output, and rejects replay. An interruption after claim fails closed: start
again with a newly initialized and, where required, externally timestamped
ledger. Refusals, timeouts, truncation, malformed output, incorrect proposals,
and compiler rejection are model-interface failures and do not authorize a
rerun. Publication must retain the initialized ledger with the benchmark
evidence.

The manifest is operator-attested, not a cryptographic execution log. An
operator with local filesystem control can restore earlier state, copy files,
or make provider calls outside the formal runner. External timestamping can
prove that specific prepared bytes existed before a stated time; it cannot
prove the absence of undisclosed calls or cherry-picking. The claimed path
digest identifies the runner's authorized destination. It remains embedded in
the portable result and ledger after the artifacts are copied, and verification
compares those bindings rather than the verifier's current local path.

- `continue`: every aggregate and repeat threshold passes.
- `kill`: an operationally valid attempt fails any threshold.
- `inconclusive`: an allowed provider infrastructure failure prevents a valid
  decision.

A `continue` result supports only the frozen proposal-interface reliability
claim. It cannot be reported as superiority over narrative memory, structured
extraction, or another temporal system.

## Commands

Use a clean checkout and write configuration and results outside it:

```sh
node scripts/create-openai-model-eval-config.mjs \
  --benchmark model-proposal-boundary-v1 \
  --model gpt-5.6-sol \
  --reasoning-effort high \
  --verbosity low \
  --max-output-tokens 16384 \
  --output /tmp/covenant-timeline-proposal-v2.json

node scripts/evaluate-model-proposal-boundary-v2.mjs \
  --init-ledger \
  --config /tmp/covenant-timeline-proposal-v2.json \
  --ledger /tmp/covenant-timeline-proposal-v2-ledger.json

node scripts/evaluate-model-proposal-boundary-v2.mjs \
  --prepare-attempt \
  --ledger /tmp/covenant-timeline-proposal-v2-ledger.json \
  --output /tmp/covenant-timeline-proposal-v2-attempt.json

node scripts/run-model-proposal-boundary-v2.mjs \
  --ledger /tmp/covenant-timeline-proposal-v2-ledger.json \
  --config /tmp/covenant-timeline-proposal-v2.json \
  --cases benchmarks/model-proposal-boundary/v2/cases.jsonl \
  --output /tmp/covenant-timeline-proposal-v2-results.jsonl \
  --repeats 3 \
  --timeout-ms 120000 \
  -- node scripts/openai-responses-model-eval-adapter.mjs

node scripts/evaluate-model-proposal-boundary-v2.mjs \
  --results /tmp/covenant-timeline-proposal-v2-results.jsonl \
  --ledger /tmp/covenant-timeline-proposal-v2-ledger.json \
  --output /tmp/covenant-timeline-proposal-v2-gate.json
```

If the gate is inconclusive, repeat the prepare, formal-run, and evaluate
commands with `attempt-2`, `results-2`, and `gate-2` output paths. The ledger
rejects a second attempt for every other outcome and rejects a third attempt.
It is a retained local manifest, not an external timestamping service; publish
its initialized digest before inference when independent proof of
preregistration is required. The prepared-attempt artifact is the externally
timestampable pre-inference snapshot. The runner's atomic claim is retained in
the ledger before the first model call.

`OPENAI_API_KEY` must be present only in the adapter environment. It must not
appear in the configuration or result artifacts.

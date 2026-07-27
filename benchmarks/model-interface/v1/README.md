# Model-interface benchmark v1

This benchmark tests whether a language model can maintain and use temporal
state more reliably with Covenant Timeline than with text alone. It runs the
same model and decoding configuration against three interfaces:

- full-context direct answering;
- rolling bounded text memory (`narrative-memory`); and
- rolling typed Timeline state with deterministic reasoning.

The comparison is end to end. In the Timeline arm, an incorrect or invalid
model-generated assertion is a failure even when the kernel behaves correctly.
No output is repaired by a person or by the harness.

Version 1 is a public development and smoke suite. It has no published external
model result and is not evidence that Timeline improves a model. A performance
claim requires a larger held-out evaluation plus published run configuration,
raw JSONL results, scores, and enough provider metadata to reproduce the run.
The scale gate is tracked in the project [roadmap](../../../ROADMAP.md).

## Scope

The public v1 corpus contains 12 cases, with three knowledge cuts per case. Two
cases cover each family:

- `bounded-indeterminate`;
- `planned-actual-isolation`;
- `delayed-observation-historical-cuts`;
- `correction-supersession-retraction`;
- `contradictions`; and
- `interval-relations`.

Cases use controlled entity identifiers and integer relative axes. The suite
measures temporal extraction and reasoning without making named-entity
recognition, calendar parsing, time-zone databases, or civil-time conversion
part of the result.

Each line of [`cases.jsonl`](./cases.jsonl) is one
`covenant.timeline.model-eval.case.v1` object:

| Field         | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `id`          | Stable case identifier                                                  |
| `family`      | Temporal capability evaluated by the case                               |
| `entities`    | Controlled identifier-to-label dictionary supplied to every arm         |
| `contract`    | v0alpha3 temporal contract                                              |
| `setupEvents` | Trusted point and interval declarations supplied by the evaluator       |
| `evidence`    | Source text, knowledge cut, and SHA-256 digest of its exact UTF-8 bytes |
| `cuts`        | Three questions with expected results and Timeline extraction targets   |

Every cut contains:

- `index`, the zero-based knowledge cut in the benchmark scenario;
- `traits`, the metric selectors exercised at that cut;
- `question`, the natural-language question presented to the model;
- `expectedResult`, the canonical v0alpha3 semantic answer;
- `goldQuery`, the expected v0alpha3 typed query; and
- `goldEvents`, the assertion-event delta supported by evidence at that cut.

The benchmark cut is a scenario step from zero through two. It is not the
v0alpha3 event sequence. The scorer maps each query's `recordedThrough` sequence
to a benchmark knowledge-cut ordinal before comparing queries.

`setupEvents` remove entity declaration from the extraction target and are
supplied to every arm. The model still has to emit every coordinate, constraint,
correction, supersession, or retraction required by the source material. Each
gold assertion references the digest of the evidence bytes that support it.
The corpus `id`, `family`, `expectedResult`, `goldQuery`, `goldEvents`, and cut
traits remain evaluator metadata. The request uses the contract's opaque case ID
and does not expose family or semantic labels to the model.

## Paired arms

All three arms use the same case order, repeat count, model identity, decoding
configuration, controlled entity dictionary, contract, trusted setup events,
questions, and evidence text.

The checked-in prompts are evaluation inputs:

- [`prompts/direct.md`](./prompts/direct.md)
- [`prompts/narrative-memory.md`](./prompts/narrative-memory.md)
- [`prompts/timeline.md`](./prompts/timeline.md)

An adapter receives the complete applicable prompt in every request. Changing
a prompt creates a different benchmark revision and must not be mixed into an
existing result file.

### Direct

Each cut is an independent request. The adapter receives trusted setup events
and all evidence through that cut, then returns:

```json
{
  "schema": "covenant.timeline.model-eval.response.v1",
  "requestId": "request-0001",
  "answer": {
    "type": "point.relations",
    "status": "resolved",
    "possible": ["before"]
  }
}
```

The model receives no answer or memory from an earlier cut. This is the
full-context text baseline, not a continuity mechanism.

### Narrative memory

Cuts run in order. Every request includes trusted setup events. The first
request has no prior memory. Later requests contain only evidence introduced at
the current cut and the last valid memory string:

```json
{
  "schema": "covenant.timeline.model-eval.response.v1",
  "requestId": "request-0014",
  "answer": {
    "type": "difference.bounds",
    "status": "bounded",
    "minimum": 4,
    "maximum": 7
  },
  "memory": "Review began between step 4 and step 7."
}
```

The request supplies `memoryBudgetBytes`, fixed at 4096 UTF-8 bytes for every
cut. The budget is independent of the gold answer and has the same numeric cap
as the Timeline arm. An over-budget or otherwise invalid update is rejected
rather than truncated; the next cut receives the last valid memory.

The harness treats `memory` as an opaque model-written string and enforces its
schema and byte length. It does not classify prose or prohibit compact
structured notation inside that string. Published results should disclose the
memory strategy used by the adapter and model.

This byte budget is deterministic and provider-neutral. It does not claim that
equal serialized bytes imply equal tokenizer cost. Token usage is reported
separately when the adapter provides it.

### Timeline

Cuts run in order. The adapter receives trusted setup events, only evidence
introduced at the current cut, `priorRun`, the host-recorded sequence for each
completed knowledge cut, and `stateBudgetBytes`. `priorRun` contains the
contract, trusted setup events, and every previously admitted model event. The
adapter returns a v0alpha3 event delta and one v0alpha3 query:

```json
{
  "schema": "covenant.timeline.model-eval.response.v1",
  "requestId": "request-0087",
  "events": [
    {
      "schema": "covenant.timeline.event.v0alpha3",
      "id": "assert.approval.minimum.v1",
      "sequence": 3,
      "type": "coordinate.asserted",
      "assertion": {
        "id": "coordinate.approval.minimum.v1",
        "contextId": "actual",
        "pointId": "approval",
        "coordinate": {
          "minimum": 16
        },
        "evidenceRefs": [
          "sha256:c307c100830e38d55467f31113997861a374032e41195f41ce5f7b5740b53d0b"
        ]
      }
    }
  ],
  "query": {
    "schema": "covenant.timeline.query.v0alpha3",
    "id": "query.bounds.deploy-window.1",
    "contextId": "actual",
    "recordedThrough": 3,
    "type": "difference.bounds",
    "fromPointId": "window-open",
    "toPointId": "approval"
  }
}
```

This is the gold-compatible shape for the second cut of
`bounds.deploy-window`. An evaluated adapter must produce the shape from the
request rather than reading gold fields.

The host assigns neither IDs nor event sequences. The response must append
cleanly to `priorRun` as emitted. The harness then executes the public v0alpha3
API:

```ts
const run = parseRunDocumentV0Alpha3({
  schema: "covenant.timeline.run.v0alpha3",
  contract: priorRun.contract,
  events: [...priorRun.events, ...response.events],
});
const query = parseQueryV0Alpha3(response.query, run);
const conclusion = reasonTemporalQueryV0Alpha3(run, query);
const verified = verifyTemporalConclusionV0Alpha3(run, query, conclusion);
```

`parseRunDocumentV0Alpha3` enforces contiguous zero-based event sequences,
earlier-record references, context and axis isolation, compatible
supersession, and v0alpha3 document shape. `parseQueryV0Alpha3` validates the
query against the selected run and knowledge cut. The answer scored for this
arm is `conclusion.result`, not an answer written by the model.

The generic v0alpha3 parser validates the form of an evidence digest; it does
not authenticate source authority or prove that the referenced text supports
the assertion. The benchmark adds two admission rules: a model delta may not
declare points or intervals, and each `evidenceRefs` entry must match evidence
introduced at the current cut. Every corpus digest must match the exact UTF-8
evidence text. An unknown, stale, or mismatched digest is an admission failure.
The canonical UTF-8 size of the model-generated events carried in the candidate
`priorRun`, excluding trusted `setupEvents`, plus `knowledgeCuts` must remain
within the fixed 4096-byte `stateBudgetBytes`. Static contract, entity, and
setup data are unmetered for both rolling arms. An over-budget candidate is
rejected and not carried forward. Extraction scoring separately compares
proposed events with the gold assertions. Production admission still requires
a domain-owned authority policy.

## Standard semantic answer

Direct and narrative-memory responses use the same
`TemporalSemanticResultV0Alpha3` shape returned by the kernel:

| Query type            | Required answer fields                               |
| --------------------- | ---------------------------------------------------- |
| `context.consistency` | `type`, `status: consistent \| inconsistent`         |
| `difference.bounds`   | `type`, `status`, `minimum`, `maximum`               |
| `point.relations`     | `type`, `status`, ordered `possible` relations       |
| `interval.relations`  | `type`, `status`, ordered `possible` Allen relations |

Answers are scored by canonical semantic equality. Numeric bounds must be safe
integers or `null` as required by the v0alpha3 result variant. An
`indeterminate` answer must retain every possible relation. Prose, estimates,
and extra object fields are invalid.

## Adapter protocol

Each observation starts a fresh adapter subprocess. The runner writes exactly
one UTF-8 JSON request line to standard input and accepts exactly one UTF-8 JSON
response line from standard output. The response must repeat the exact
`requestId`; any additional standard-output line is a protocol failure.
Diagnostics belong on standard error. The runner closes standard input after
the exchange and terminates an adapter that does not exit.

This process boundary removes adapter-process state between cuts, arms, cases,
and repeats. The adapter must also issue an independent inference request
without a persistent provider conversation, thread, or session identifier and
without hidden prior messages. A remote runtime that carries conversational
state across requests invalidates the comparison. Reported latency starts
before the subprocess is created, so process startup is included in every
observation.

Each request has this envelope:

```json
{
  "schema": "covenant.timeline.model-eval.request.v1",
  "requestId": "request-0087",
  "benchmark": "model-interface-v1",
  "config": {
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
        "topP": 1
      }
    }
  },
  "configDigest": "sha256:2b131888b1add4aa03ba3fc0ddbceb822822fecfdea4703ef3b1de832af68cae",
  "caseId": "case-07",
  "arm": "timeline",
  "repeat": 0,
  "cut": 1,
  "prompt": "Complete benchmark prompt...",
  "input": {
    "entities": {},
    "contract": {},
    "setupEvents": [],
    "question": "What can be concluded?",
    "evidence": [],
    "priorRun": {},
    "knowledgeCuts": [
      {
        "cut": 0,
        "recordedThrough": 3
      }
    ],
    "stateBudgetBytes": 4096
  }
}
```

`config` is the exact non-secret run configuration and `configDigest` binds its
canonical bytes. The adapter must use these fields to select the declared model
and apply the declared generation settings. Credentials must come from the
adapter environment and must not appear in the configuration. `caseId` is the
contract's opaque identifier. Corpus IDs, family names, traits, and expected
semantics remain evaluator-side. `input` always includes
`entities`, `contract`, `setupEvents`, `question`, and `evidence`. Arm-specific
fields are:

| Arm                | Evidence supplied                      | Additional input                                |
| ------------------ | -------------------------------------- | ----------------------------------------------- |
| `direct`           | All evidence through the current cut   | none                                            |
| `narrative-memory` | Evidence introduced at the current cut | `memory`, `memoryBudgetBytes`                   |
| `timeline`         | Evidence introduced at the current cut | `priorRun`, `knowledgeCuts`, `stateBudgetBytes` |

`knowledgeCuts` contains one entry for each completed cut and binds that cut to
the final sequence admitted by the host. It lets the model express a historical
query without reconstructing benchmark boundaries from event names.

The adapter must present both `prompt` and `input` to the model. `config` and
`configDigest` control the inference call and are not model-visible scenario
data. The adapter may map the prompt and input to provider message roles, but it
must preserve them without paraphrasing, dropping fields, or adding
case-specific guidance. The mapping must remain fixed across the run and be
disclosed with a published adapter.

The response envelope contains `schema`, `requestId`, the arm-specific fields
shown above, and optional usage:

```json
{
  "usage": {
    "inputTokens": 1200,
    "outputTokens": 180,
    "costUsd": null
  }
}
```

Each usage field is a bounded non-negative value or `null` when the provider
does not report it. Per-observation token counts are capped at 1 billion, cost
at USD 1 million, and wall-clock latency at 1 million milliseconds so malformed
artifacts cannot overflow aggregate scores. Token counts and cost are
provider-reported observations, not normalized measurements. The runner records
wall-clock latency independently.

Input and output use strict JSON: one object per line, no duplicate keys,
comments, trailing data, non-finite numbers, or Markdown fences. The runner
does not retry, extract JSON from prose, synthesize missing fields, renumber
events, repair identifiers, or replace an invalid answer with a gold value.
Timeouts, adapter exit, malformed JSON, schema violations, over-budget memory,
invalid Timeline documents, query rejection, reasoning errors, and proof
verification failure remain visible in the result artifact.

`requestId` is an opaque correlation value. Adapters must echo it exactly and
must not infer benchmark behavior from its contents.

## Running an adapter

Create a run configuration as described in
[Model evaluation](../../../docs/model-evaluation.md), then run:

```sh
node scripts/run-model-interface-eval.mjs \
  --config run-config.json \
  --output results.jsonl \
  --repeats 3 \
  --timeout-ms 120000 \
  -- ./adapter
```

Useful filters:

```sh
node scripts/run-model-interface-eval.mjs \
  --config run-config.json \
  --output timeline-results.jsonl \
  --case correction.shipment-arrival \
  --arm timeline \
  -- ./adapter
```

The command after `--` is executed directly, without a shell. Keep credentials
inside the adapter environment and exclude them from configuration, results,
and diagnostics.

With a fixed seed, repeated observations are stability checks for provider or
runtime nondeterminism. They are not independent statistical samples and must
not be reported as such.

## Failure accounting

Every requested case, arm, repeat, and cut produces one
`covenant.timeline.model-eval.result.v1` line. A failure is never omitted from
the denominator. Aggregate scorer output conforms to
[`score.schema.json`](./score.schema.json).

The result distinguishes:

- adapter and protocol failure;
- invalid direct or narrative semantic output;
- Timeline event or run admission failure;
- Timeline query validation failure;
- kernel failure;
- proof-verification failure; and
- a valid but incorrect semantic result.

For rolling arms, invalid state is not silently repaired. An invalid or
over-budget narrative update is discarded while the last valid memory remains
available. Invalid or over-budget Timeline events are not admitted to
`priorRun`. Later cuts continue from the last valid carried state, exposing the
downstream cost of an earlier model-interface failure.

Common answer score fields are `answerExactRate`, `unsupportedDefiniteRate`,
`contradictionPrecision`, `contradictionRecall`, `falseInconsistencyRate`,
`correctionAccuracy`, and `historicalReconstructionAccuracy`. Paired fields
`timelineVsNarrativeMemory` and `timelineVsDirect` report answer-accuracy win,
loss, and tie counts for the same case, repeat, and cut.

Timeline diagnostics are `admissionRate`,
`representationExactAssertionPrecision`,
`representationExactAssertionRecall`, `representationExactAssertionF1`,
`projectedStateExactRate`, `queryExactRate`, `proofVerificationRate`, and
`endToEndExactRate`. A Timeline observation is end-to-end exact only when its
answer, admitted normalized state, query, and verified proof all match the gold
semantics. Answer-only paired results and Timeline end-to-end extraction must
be reported together.
Operational observations are `latencyMs`, `inputTokens`, `outputTokens`, and
`costUsd`; they are reported separately and never substituted for correctness.

The Timeline prompt permits the model to choose event, assertion, and query
IDs. Representation-exact assertion comparison alpha-renames those model-owned
IDs while preserving their reference graph. It does not normalize point,
interval, context, axis, evidence, bound, or event-order values.
`projectedStateExactRate` compares normalized active coordinate, constraint,
fact, and evidence-reference atoms plus their temporal consequences. Combined
and split lower/upper bounds normalize to the same atoms. Event sequences
remain admission-strict. Query exactness ignores the freely chosen query ID and
maps `recordedThrough` to the corresponding benchmark knowledge-cut ordinal
before comparison.

Each reported rate contains its numerator, denominator, and value:

| Metric                                                  | Definition                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `answerExactRate`                                       | Successful answers canonically equal to the gold result, divided by all observations                                       |
| `unsupportedDefiniteRate`                               | Eligible answers that invent a bound or collapse supported ambiguity, divided by `unsupported-definite-risk` cuts          |
| `contradictionPrecision`                                | Correct inconsistent answers divided by inconsistent answers on `contradiction` cuts                                       |
| `contradictionRecall`                                   | Correct inconsistent answers divided by gold-inconsistent `contradiction` cuts                                             |
| `falseInconsistencyRate`                                | Incorrect inconsistent answers divided by gold-non-inconsistent observations                                               |
| `correctionAccuracy`                                    | Exact successful answers divided by `correction` cuts                                                                      |
| `historicalReconstructionAccuracy`                      | Correct historical answers that reproduce the first-cut answer, divided by `historical` cuts                               |
| `admissionRate`                                         | Timeline deltas admitted without repair, divided by all Timeline observations                                              |
| `representationExactAssertionPrecision` / recall / `F1` | Alpha-renamed structural assertion matches against the chosen gold event encoding                                          |
| `projectedStateExactRate`                               | Admitted candidate states with the same normalized active assertions and temporal consequences as gold                     |
| `queryExactRate`                                        | Structurally exact queries at the same normalized knowledge cut, divided by all Timeline observations                      |
| `proofVerificationRate`                                 | Verified Timeline conclusions divided by all Timeline observations                                                         |
| `endToEndExactRate`                                     | Timeline observations with exact answer, normalized state, query, and verified proof, divided by all Timeline observations |

Missing, timed-out, malformed, and rejected responses remain in applicable
denominators. Representation-exact assertion F1 is the harmonic mean of its
precision and recall. Latency reports count, mean, nearest-rank p50, and
nearest-rank p95; token and cost fields report observed count, total, and mean.

Results must be reported by case family as well as in aggregate. Parse and
admission failures must remain visible. A smoke run or a result selected from
multiple attempts does not support a performance claim.

## Reproducibility record

A publishable run retains:

- the raw `cases.jsonl`, prompt files, and their SHA-256 digests;
- the Timeline package version and source commit;
- the runner and scorer source commit;
- the adapter source revision;
- provider and exact model identifier;
- decoding parameters, seed support, and provider API revision;
- repeat count, timeout, case and arm filters, and case order;
- runtime, operating system, and architecture;
- the complete raw result JSONL, its stored canonical requests, exact response
  lines, and their digests, plus scorer output; and
- any provider-side retry, caching, moderation, or truncation behavior.

Use a fresh output path for each run. Do not merge successful responses from
different configurations under one run identifier. Models and hosted inference
systems change; a dated result with pinned inputs is evidence about that run,
not a permanent model ranking.

A publishable run must record `sourceDirty: false`. Commit the runner, scorer,
corpus, prompts, and adapter before evaluation; a dirty source revision is
suitable only for local development. The runner caps each request at 256 KiB
and the complete JSONL artifact at 128 MiB so the scorer can consume every
artifact it produces.

For every observation, the result retains canonical `requestText` with its
digest and the exact UTF-8 `responseText` line with its digest. The scorer
reconstructs and verifies the opaque case ID, prompt, corpus inputs, budgets,
and rolling continuity from prior results before checking the request bytes. It
then validates the stored response envelope and checks that the answer, memory,
usage, events, and query reproduce the structured result fields. This detects
artifact drift; it is not a provider-side attestation.

## Interpretation

The suite is deliberately small and public. It can reveal interface failures
and justify the roadmap's scale gate, but it cannot establish broad temporal
intelligence, production safety, domain transfer, or clinical or regulatory
fitness. There is no external model result for v1 yet.

A Timeline win can come from typed extraction, preserved state, deterministic
inference, or their interaction. The diagnostic metrics separate these stages;
the aggregate score alone does not. A Timeline loss is equally actionable:
invalid typed output, missed corrections, or a memory-cost disadvantage should
be reported without excluding the affected cases.

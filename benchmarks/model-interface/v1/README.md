# Model-interface benchmark v1

This benchmark tests whether a language model can maintain and use temporal
state more reliably with Covenant Timeline than with text alone. It runs the
same model and decoding configuration against three interfaces:

- rolling bounded text memory (`narrative-memory`);
- stateless full-context typed extraction (`structured-extraction`); and
- rolling typed Timeline state with deterministic reasoning.

Full-context direct answering remains available as a secondary reference but is
not part of the preregistered frontier comparison.

The comparison is end to end. In the Timeline arm, an incorrect or invalid
model-generated assertion is a failure even when the kernel behaves correctly.
No output is repaired by a person or by the harness.

Version 1 includes a public development corpus and a separately materialized
paraphrase corpus held out from prompt and schema development. It has no
published frontier-model result and is not evidence that Timeline improves a
model. The [frontier-model gate](./PREREGISTRATION.md) fixes the model,
configuration, primary arms, thresholds, and stopping rule before the first
formal run.

## Scope

Both [`cases.jsonl`](./cases.jsonl) and
[`heldout-cases.jsonl`](./heldout-cases.jsonl) contain 12 cases, with three
knowledge cuts per case. Two cases cover each family:

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

Each line is one `covenant.timeline.model-eval.case.v1` object:

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

The held-out corpus is a deterministic semantic paraphrase of the development
corpus. [`paraphrases.json`](./paraphrases.json) contains the human-authored
evidence and question rewrites.
[`materialize-model-interface-heldout.mjs`](../../../scripts/materialize-model-interface-heldout.mjs)
recomputes exact evidence digests, rewrites every gold evidence reference, and
emits canonical JSONL. Tests require byte-identical materialization and run
every held-out gold trajectory through the kernel. The corpus is public for
reproducibility; “held out” means it was not used to tune the prompts or output
schemas before the preregistered evaluation, not that its text remains secret.

## Primary arms

All three arms use the same case order, repeat count, model identity, decoding
configuration, controlled entity dictionary, contract, trusted setup events,
questions, and evidence text.

The checked-in prompts are evaluation inputs:

- [`prompts/direct.md`](./prompts/direct.md)
- [`prompts/narrative-memory.md`](./prompts/narrative-memory.md)
- [`prompts/structured-extraction.md`](./prompts/structured-extraction.md)
- [`prompts/timeline.md`](./prompts/timeline.md)

An adapter receives the complete applicable prompt in every request. Changing
a prompt creates a different benchmark revision and must not be mixed into an
existing result file.

### Direct reference

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

### Structured extraction

Each cut is independent. The model receives all evidence available through that
cut and emits the complete typed assertion history plus a typed query. No prior
model response, ledger, narrative memory, or host-generated knowledge-cut map
is supplied. The host builds an ephemeral run, validates the model output,
executes the same deterministic reasoner used by Timeline, and verifies the
proof.

This is the control for structured output plus a solver. It deliberately uses
the same event and query shapes as Timeline so the paired comparison isolates
the value of rolling temporal state. A Timeline advantage cannot be attributed
only to JSON schema enforcement or deterministic reasoning. Structured
extraction may cite any evidence visible at the current cut; Timeline deltas may
cite only newly introduced evidence.

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
cleanly to `priorRun` as emitted. Both the provider schema and the harness cap a
response at eight events and cap each evidence or supersession reference list
at eight entries. The public corpus requires at most three events and one
reference per list; admission still enforces the 4096-byte rolling-state budget.
The harness then executes the public v0alpha3 API:

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
the assertion. The benchmark also rejects point or interval declarations,
semantic duplicate claims within one delta, responses above the benchmark
collection caps, and any `evidenceRefs` entry that does not match evidence
introduced at the current cut. Duplicate detection ignores model-owned event
and assertion IDs and sequence values while preserving claim, evidence, and
supersession semantics. Every corpus digest must match the exact UTF-8 evidence
text. An unknown, stale, or mismatched digest is an admission failure.
The canonical UTF-8 size of the model-generated events carried in the candidate
`priorRun`, excluding trusted `setupEvents`, plus `knowledgeCuts` must remain
within the fixed 4096-byte `stateBudgetBytes`. Static contract, entity, and
setup data are unmetered for both rolling arms. An over-budget candidate is
rejected and not carried forward. Extraction scoring separately compares
proposed events with the gold assertions. Production admission still requires
a domain-owned authority policy.

### Teacher-forced prior state

`--prior-state teacher-forced` runs the Timeline arm alone. Before each cut, the
harness reconstructs the exact gold state and knowledge-cut map through the
previous cut. It withholds the current gold events, query, and answer, evaluates
the current model delta normally, and discards that delta before the next
request. This separates current-cut extraction failures from failures
propagated through rolling model state.

Teacher-forced scores are marked `diagnosticOnly: true`. The scorer reports
`teacherForcedPriorCuts` for cuts one and two; cut zero has no prior state and
is excluded from that aggregate. Teacher forcing cannot satisfy the primary
continuation gate.

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

| Arm                     | Evidence supplied                      | Additional input                                |
| ----------------------- | -------------------------------------- | ----------------------------------------------- |
| `direct`                | All evidence through the current cut   | none                                            |
| `narrative-memory`      | Evidence introduced at the current cut | `memory`, `memoryBudgetBytes`                   |
| `structured-extraction` | All evidence through the current cut   | `stateBudgetBytes`                              |
| `timeline`              | Evidence introduced at the current cut | `priorRun`, `knowledgeCuts`, `stateBudgetBytes` |

`knowledgeCuts` contains one entry for each completed cut and binds that cut to
the final sequence admitted by the host. It lets the model express a historical
query without reconstructing benchmark boundaries from event names.

The adapter must present both `prompt` and `input` to the model. `config` and
`configDigest` control the inference call and are not model-visible scenario
data. The adapter may map the prompt and input to provider message roles, but it
must preserve them without paraphrasing, dropping fields, or adding
case-specific guidance. The mapping must remain fixed across the run and be
disclosed with a published adapter.

The checked-in OpenAI Responses adapter sends `prompt` unchanged as
`instructions` and sends one user message containing the canonical JSON bytes
of `{ "requestId": requestId, "input": input }`. This fixes the path by which
the model receives the correlation value it must return.

The checked-in Ollama adapter sends `prompt` unchanged as the system message
and the same canonical JSON bytes as the only user message. It uses a fixed
loopback endpoint and verifies the exact Ollama runtime version and complete
installed model digest before each independent inference request. After the
response, it checks `/api/ps` to bind the result to the digest of the model
Ollama kept loaded for that request. It rejects cloud-model identifiers. A
conforming local run also starts a dedicated daemon with cloud features
disabled and does not mutate its model inventory during the run.

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

An adapter that reached the provider but could not produce a model response may
return a protocol-level failure:

```json
{
  "schema": "covenant.timeline.model-eval.adapter-error.v1",
  "requestId": "request-0087",
  "error": {
    "code": "provider.http-429",
    "message": "OpenAI Responses API returned HTTP 429",
    "scope": "observation"
  }
}
```

`usage` may be included when the provider reported it. Error codes use bounded
lowercase identifiers and messages are limited to 480 characters.
Observation-scoped errors are stored and counted at the adapter stage.
Run-scoped configuration, credential, authorization, and model-selection
failures abort the run before a result line is recorded. The dedicated
`adapter-error.v1` discriminator leaves the successful `response.v1` envelope
unchanged.

Input and output use strict JSON: one object per line, no duplicate keys,
comments, trailing data, non-finite numbers, or Markdown fences. The runner
does not retry, extract JSON from prose, synthesize missing fields, renumber
events, repair identifiers, or replace an invalid answer with a gold value.
Timeouts, adapter exit, malformed JSON, schema violations, over-budget memory,
invalid Timeline documents, query rejection, reasoning errors, and proof
verification failure remain visible in the result artifact.

`requestId` is an opaque correlation value. Adapters must echo it exactly and
must not infer benchmark behavior from its contents.

## Running the Ollama reference adapter

The
[local-adapter quickstart](../../../docs/model-evaluation.md#ollama-local-adapter)
binds the configuration to the checked-out source, exact installed model digest,
and Ollama runtime version. It begins with the three-request Timeline smoke. The
adapter sends no credentials and uses the raw arm-specific JSON Schema, fixed
generation settings, no conversation state, no redirect, and no retry. Its
mock-provider tests establish the adapter contract; they are not model results.

## Running the OpenAI reference adapter

The canonical
[clean-clone quickstart](../../../docs/model-evaluation.md#run-and-score)
includes POSIX and Windows PowerShell commands. It generates a configuration
bound to the checked-out source, begins with a three-request smoke, scores that
artifact immediately, and places the 324-request complete run behind an
explicit cost and rate-limit check.

The reference adapter reads only `OPENAI_API_KEY`, calls the default OpenAI
Responses endpoint once, rejects redirects, sets `store: false`, uses no tools
or provider conversation, and performs no retry. Its Structured Outputs schemas
cover all public v1 gold response shapes, but the runner remains authoritative
for semantic answers, events, queries, evidence visibility, state budgets, and
proofs. Keep credentials inside the adapter environment and exclude them from
configuration, results, and diagnostics.

The frontier preregistration uses the provider-documented `gpt-5.6-sol` model
ID. OpenAI does not publish a dated snapshot ID for it. A published result must
therefore report the exact model ID and UTC run date and cannot claim
byte-identical model reproducibility.

Repeated observations with the same fixed configuration are stability checks
for provider or runtime nondeterminism. They are not independent statistical
samples and must not be reported as such.

The preregistered run is evaluated with
`scripts/evaluate-model-interface-gate.mjs`. The gate refuses a dirty source,
different corpus, model or generation drift, partial arm selection, a different
repeat count, or a missing or mismatched teacher-forced artifact. It binds both
artifacts to the committed source and official adapter runtime, then checks the
absolute thresholds, per-repeat floors, paired accuracy differences, and exact
12-cluster sign-flip tests fixed in
[`PREREGISTRATION.md`](./PREREGISTRATION.md).

## Failure accounting

Every completed or observation-scoped case, arm, repeat, and cut produces one
`covenant.timeline.model-eval.result.v1` line. Observation failures are never
omitted from the denominator. Run-scoped setup failures abort before publishing
the output target. Aggregate scorer output conforms to
[`score.schema.json`](./score.schema.json).

The optional companion command
`node scripts/diagnose-model-interface-eval.mjs --results <results.jsonl>`
replays the same artifact checks and emits
[`diagnostics.schema.json`](./diagnostics.schema.json). It treats each direct
and structured-extraction observation independently and groups narrative-memory
and Timeline observations into rolling case/repeat trajectories. The artifact
records the first observed error, later recorded observations, exact versus
degraded Timeline prior projected state against gold, and errors recorded after
state admission by stage and code. These fields describe the recorded
trajectory without assigning cause. Raw expected, recorded, exact, degraded,
and error counts are retained.

The result distinguishes:

- adapter and protocol failure;
- invalid direct or narrative semantic output;
- structured event or run admission failure;
- structured query validation failure;
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
`correctionAccuracy`, and `historicalReconstructionAccuracy`. Primary paired
fields `timelineVsNarrativeMemory` and `timelineVsStructuredExtraction` report
answer-accuracy win, loss, and tie counts for the same case, repeat, and cut.
`timelineVsDirect` is retained as a secondary reference.

Typed-state diagnostics for structured extraction and Timeline are
`admissionRate`,
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
IDs while preserving their reference graph. It ignores model-owned event IDs
and sequences while retaining point, interval, context, axis, evidence, and
bound values. Admission separately requires contiguous sequences and
chronological evidence-cut order.
`projectedStateExactRate` compares normalized active coordinate, constraint,
fact, and evidence-reference atoms plus their temporal consequences. Combined
and split lower/upper bounds normalize to the same atoms. Query exactness
ignores the freely chosen query ID and maps `recordedThrough` to the
corresponding benchmark knowledge-cut ordinal before comparison.

Each reported rate contains its numerator, denominator, and value:

| Metric                                                  | Definition                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `answerExactRate`                                       | Successful answers canonically equal to the gold result, divided by all observations                              |
| `unsupportedDefiniteRate`                               | Eligible answers that invent a bound or collapse supported ambiguity, divided by `unsupported-definite-risk` cuts |
| `contradictionPrecision`                                | Correct inconsistent answers divided by inconsistent answers on `contradiction` cuts                              |
| `contradictionRecall`                                   | Correct inconsistent answers divided by gold-inconsistent `contradiction` cuts                                    |
| `falseInconsistencyRate`                                | Incorrect inconsistent answers divided by gold-non-inconsistent observations                                      |
| `correctionAccuracy`                                    | Exact successful answers divided by `correction` cuts                                                             |
| `historicalReconstructionAccuracy`                      | Correct historical answers that reproduce the first-cut answer, divided by `historical` cuts                      |
| `admissionRate`                                         | Structured outputs admitted without repair, divided by all applicable observations                                |
| `representationExactAssertionPrecision` / recall / `F1` | Alpha-renamed structural assertion matches against the chosen gold event encoding                                 |
| `projectedStateExactRate`                               | Admitted candidate states with the same normalized active assertions and temporal consequences as gold            |
| `queryExactRate`                                        | Structurally exact queries at the same normalized knowledge cut, divided by all applicable observations           |
| `proofVerificationRate`                                 | Verified conclusions divided by all applicable observations                                                       |
| `endToEndExactRate`                                     | Applicable observations with exact answer, normalized state, query, and verified proof                            |

Missing, timed-out, malformed, and rejected responses remain in applicable
denominators. Representation-exact assertion F1 is the harmonic mean of its
precision and recall. Latency reports count, mean, nearest-rank p50, and
nearest-rank p95; token and cost fields report observed count, total, and mean.
The runner rotates the configured arm order by case and repeat so a fixed
slowdown or rate-limit boundary does not always penalize the same arm.

Results must be reported by case family as well as in aggregate. Parse and
admission failures must remain visible. A smoke run or a result selected from
multiple attempts does not support a performance claim. A run with operational
provider errors is useful for adapter and capacity diagnosis, but it is not
model-performance evidence; preserve it and rerun the complete preregistered
selection after the operational condition is fixed.

## Reproducibility record

A publishable run retains:

- the selected corpus JSONL, prompt files, and their SHA-256 digests;
- the Timeline package version and source commit;
- the runner and scorer source commit;
- the adapter source revision;
- the attempt ID, UTC start time, source-state digest, and runtime digest;
- provider, exact model identifier, and UTC run date;
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
suitable only for local development. The runner requires the output to be
outside the checkout, stages it beside the target, and publishes it only after
the full run and final integrity checks for repository source, built Timeline
kernel, benchmark scripts, and directly named adapter files succeed. External
adapters must pin and disclose any dependency closure outside those files.
Incomplete runs handled by the runner and integrity failures leave no output
target or partial artifact; forced process termination can leave the hidden
staging file for forensic cleanup. If atomic publication alone fails after
validation, the completed artifact is retained under its reported `.partial`
path. The runner caps each request at 256 KiB and the complete JSONL artifact at
128 MiB so the scorer can consume every artifact it produces.

For every observation, the result retains canonical `requestText` with its
digest and the exact UTF-8 `responseText` line with its digest. The scorer
reconstructs and verifies the opaque case ID, prompt, corpus inputs, budgets,
and rolling continuity from prior results before checking the request bytes. It
then validates the stored response envelope and checks that the answer, memory,
usage, events, and query reproduce the structured result fields. This detects
artifact drift; it is not a provider-side attestation. `responseText` is the
adapter protocol envelope. A provider adapter may parse and canonically encode
model JSON and append mechanically mapped usage, so it is not the provider's
raw HTTP response.

## Interpretation

The suite is deliberately small and public. It can falsify the current
model-memory thesis, but it cannot establish broad temporal intelligence,
production safety, domain transfer, or clinical or regulatory fitness. There is
no frontier-model result for v1 yet.

The structured-extraction arm controls for typed output and deterministic
reasoning. The paired primary result therefore asks whether rolling Timeline
state improves on both bounded narrative memory and re-extraction from the full
record. Teacher-forced diagnostics separate local extraction from propagated
state errors. A failed gate retires the standalone thesis without changing the
kernel's independently tested deterministic properties.

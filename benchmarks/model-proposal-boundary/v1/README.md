# Model-proposal boundary benchmark v1

This benchmark tests whether a language model can turn temporal evidence into a
compiler-valid `TemporalModelProposalV1`. The host supplies opaque handles and a
request-scoped output schema. Covenant Timeline compiles a valid proposal into
candidate events and a candidate query, reasons over the candidate run, and
verifies the resulting proof receipt.

Version 1 is an engineering suite. It defines a reproducible model boundary and
failure accounting for the 12-case, 36-cut public corpus. No model result or
performance claim is published with this contract.

## Scope

The suite reuses
[`model-interface/v1/cases.jsonl`](../../model-interface/v1/cases.jsonl). Its 12
cases have three knowledge cuts each and cover:

- bounded and indeterminate answers;
- planned and actual context isolation;
- delayed observations and historical cuts;
- correction, supersession, and retraction;
- contradictions; and
- interval relations.

This is a single-interface evaluation, not another arm in the model-interface
benchmark. It isolates the production proposal boundary from direct event and
query authorship.

## Observation flow

For each case, cuts run in order:

1. The harness constructs a `TemporalModelProposalHostV1` from the base run,
   current evidence, reference handles, active assertion handles, and completed
   knowledge-cut handles.
2. The harness calls `createTemporalModelProposalOutputSchemaV1(host)`.
3. The canonical JSON text of that exact schema and the SHA-256 digest of its
   UTF-8 bytes are recorded with the observation.
4. The adapter receives [`prompts/proposal.md`](./prompts/proposal.md), the
   request input, and the parsed form of the recorded output schema.
5. The response must validate against that request-scoped schema.
6. The harness calls `compileTemporalModelProposalV1(response, host)`.
7. The candidate must pass
   `verifyTemporalModelProposalCandidateV1(candidate, response, host)`.
8. The harness applies the candidate events to the rolling benchmark run,
   executes the candidate query, and verifies the conclusion proof.

`applied` means that verified candidate events were carried into the next
benchmark cut. It is continuity bookkeeping only. Compiler acceptance does not
authenticate evidence, establish authority, authorize an event, or replace a
production admission policy.

When an observation fails, the next cut receives the last successfully applied
run. The failed proposal is never repaired or silently rewritten.

## Request contract

The model input contains:

- an opaque request ID, outside `input`;
- the natural-language question;
- current evidence records;
- uniformly generated, opaque reference handles with model-visible labels;
- active assertions and completed knowledge cuts from the rolling run; and
- the exact provider output schema generated from the host-owned run and
  catalogs.

The compiler host is not sent to the model. It retains the contract, run,
declarations, ledger identifiers, evidence digests, and handle mappings needed
to compile and verify the response. The output schema constrains the request ID
and every handle or current evidence ID it permits. It contains no evidence
text, quote text, ledger assertion ID, expected bound, or expected answer.

The harness records the schema as `outputSchemaJson`, produced by canonical JSON
serialization, and records `outputSchemaDigest` over those exact UTF-8 bytes.
The parsed schema given to the provider must be byte-equivalent when serialized
canonically. An adapter may not substitute a broader provider schema.

The generated schema is a provider constraint, not the authoritative parser.
The compiler still enforces byte, depth, catalog, quote, range, revision, and
candidate-run rules.

## No gold leakage

The corpus fields `family`, `traits`, `goldEvents`, `goldQuery`, and
`expectedResult` remain evaluator metadata. They are not included in the model
request, prompt interpolation, provider schema, or prior messages.

Reference catalogs are built uniformly from the contract, declared temporal
objects, controlled entity labels, and rolling run. They must not be selected
or named using a gold event, gold query, expected bound, or expected result.
Evidence IDs and handles are opaque stable identifiers. The schema generator
receives the same host later supplied to the compiler and may not inspect
evaluator metadata.

Every adapter request is independent. The adapters send no client-side
conversation, thread, tool state, or prior response across observations.

## Result artifact

Each JSONL observation must conform to
[`result.schema.json`](./result.schema.json). It preserves:

- exact request and response text plus byte digests;
- exact generated output-schema JSON plus its byte digest;
- the parsed proposal when response-schema validation succeeds;
- compiler outcome;
- the complete candidate and candidate-verification outcome;
- whether the candidate was applied to rolling benchmark state;
- the complete conclusion, including its proof receipt;
- proof-verification outcome;
- usage and latency when reported by the provider; and
- one terminal error stage and code when the pipeline does not complete.

`status: "ok"` means the observation reached proof verification. It does not
mean that its proposal, projected state, query, or semantic answer matched gold.
Accuracy is computed separately.

The raw response remains evidence for response-schema and compiler failures.
Invalid output is not omitted from the results file.

Reference adapters add an adapter-controlled `usage` field to the JSONL
response when token counts are available. The runner separates that metadata
before validating and compiling the proposal, then records it in the result
artifact.

Run-scoped corpus, configuration, host-construction, and output-schema
generation failures abort before a result target is published. They cannot be
converted into model errors or a partial score.

## Scores

[`score.schema.json`](./score.schema.json) reports:

- response-schema validity;
- compiler validity;
- candidate verification and continuity application;
- exact assertion precision, recall, and F1 after projection;
- exact projected state;
- exact query intent after compilation;
- exact semantic answer;
- proof verification; and
- end-to-end exactness.

End-to-end exactness requires one observation to pass the response schema,
compile, verify its candidate, match the gold projected state and query, match
the expected semantic result, and produce a verifiable proof.

Rates preserve explicit numerators and denominators. Infrastructure and model
failures remain in the relevant denominators; the scorer does not discard them.
Precision and recall use canonical assertion semantics rather than
model-generated IDs or array order. A compiler failure contributes no true
positive assertions and cannot satisfy projected-state, query, answer, proof,
or end-to-end exactness.

Scores include expected, observed, missing, duplicate, and unexpected
observation counts. Every error is counted by both terminal stage and stable
code. A publishable full-suite score must cover all 12 cases, all three cuts,
and every configured repeat with zero missing, duplicate, or unexpected
observations.

Every binary correctness rate uses all expected observations as its
denominator. Missing, timed-out, malformed, schema-invalid, and
compiler-invalid responses therefore cannot disappear from a downstream rate.
Assertion precision and recall instead use aggregate predicted and gold
assertion counts:

| Metric                                  | Numerator and denominator                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `responseSchemaValidRate`               | Responses valid under the recorded request-scoped schema / expected observations            |
| `compilerValidRate`                     | Proposals accepted by the compiler / expected observations                                  |
| `candidateVerificationRate`             | Candidates that recompile identically / expected observations                               |
| `appliedRate`                           | Candidates carried into rolling benchmark state / expected observations                     |
| `representationExactAssertionPrecision` | Canonically matched proposed assertions / proposed assertions                               |
| `representationExactAssertionRecall`    | Canonically matched proposed assertions / gold assertions                                   |
| `projectedStateExactRate`               | Candidate states equal to normalized gold state / expected observations                     |
| `queryExactRate`                        | Compiled queries equal to gold query intent and record cut / expected observations          |
| `answerExactRate`                       | Semantic results canonically equal to expected results / expected observations              |
| `proofVerificationRate`                 | Conclusions with valid proof receipts / expected observations                               |
| `endToEndExactRate`                     | Observations satisfying every extraction, reasoning, and proof requirement / expected total |

Canonical assertion comparison ignores compiler-generated IDs and array order.
It preserves context, point and interval identity, bounds, evidence references,
supersession or retraction semantics, and record-cut meaning.

## Run and score

Use a clean checkout. Configurations and result artifacts must be written
outside it so source-state binding remains meaningful.

For a local Ollama run, start a dedicated daemon with cloud access disabled,
then create a configuration bound to the checked-out source, runtime, and model
digest:

```sh
node scripts/create-ollama-model-eval-config.mjs \
  --benchmark model-proposal-boundary-v1 \
  --model <exact-installed-name> \
  --digest sha256:<digest-returned-by-api-tags> \
  --runtime-version <version-returned-by-api-version> \
  --output /tmp/covenant-timeline-proposal-ollama.json
node scripts/run-model-proposal-eval.mjs \
  --config /tmp/covenant-timeline-proposal-ollama.json \
  --output /tmp/covenant-timeline-proposal-results.jsonl \
  --repeats 1 \
  --case correction.shipment-arrival \
  --timeout-ms 120000 \
  -- node scripts/ollama-model-eval-adapter.mjs
node scripts/score-model-proposal-eval.mjs \
  --results /tmp/covenant-timeline-proposal-results.jsonl
```

For OpenAI Responses, generate the matching proposal configuration and use the
stateless OpenAI adapter:

```sh
node scripts/create-openai-model-eval-config.mjs \
  --benchmark model-proposal-boundary-v1 \
  --output /tmp/covenant-timeline-proposal-openai.json
node scripts/run-model-proposal-eval.mjs \
  --config /tmp/covenant-timeline-proposal-openai.json \
  --output /tmp/covenant-timeline-proposal-results.jsonl \
  --repeats 1 \
  --case correction.shipment-arrival \
  --timeout-ms 120000 \
  -- node scripts/openai-responses-model-eval-adapter.mjs
```

Remove `--case` to run the complete corpus. The runner processes each case in
cut order, starts a fresh one-shot adapter for every observation, validates
every result before an atomic publication, and carries forward only verified
candidate events. The scorer rejects malformed artifacts and reports missing,
duplicate, and unexpected observations explicitly.

## Boundaries

This benchmark measures model extraction through a deterministic compiler and
reasoner. It does not establish that source evidence is authentic, that a quote
supports a claim semantically, or that a candidate is authorized for durable
use. Those decisions belong to the integrating system.

The public corpus uses controlled identifiers and integer relative axes. It
does not measure named-entity recognition, calendar parsing, time-zone rules,
or civil-time conversion.

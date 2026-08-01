# Production audit: model proposal boundary

Date: 2026-08-01

## Decision

The model proposal compiler is suitable for producing untrusted preview
artifacts. The free-form proposal boundary is not suitable for automatic
admission or durable agent memory. Its preregistered v2 frontier-model gate
returned `kill`, following the earlier comparative model-interface `kill`.

This audit covers:

- request-scoped provider schema generation;
- proposal compilation and candidate verification;
- the 12-case, 36-cut proposal-boundary benchmark;
- Ollama and OpenAI Responses adapters;
- result publication and source/runtime binding; and
- independent replay and scoring.

## Release gates

| Gate                       | Status | Evidence                                                                                                                        |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Host-bound provider schema | Pass   | Request ID, current evidence, compatible references, active assertions, and knowledge cuts are projected from the compiler host |
| Provider grammar bounds    | Pass   | Change, support, catalog, enum, schema-byte, host-byte, depth, and node limits fail closed                                      |
| Compiler authority         | Pass   | Provider-schema acceptance cannot bypass quote, range, catalog, revision, candidate, or run validation                          |
| Candidate integrity        | Pass   | The verifier recompiles against the same proposal and host and compares the complete candidate                                  |
| Gold isolation             | Pass   | The complete adapter request has hidden-value canaries; the 36-cut oracle checks opaque inputs and handles                      |
| Rolling failure continuity | Pass   | Failed cuts advance the knowledge cut without admitting failed candidate events                                                 |
| Artifact integrity         | Pass   | Requests, responses, output schemas, source state, runtime state, corpus, and results are content-bound                         |
| Scoring integrity          | Pass   | The scorer reconstructs trusted schemas and replay state before evaluating stored outcomes                                      |
| Provider compatibility     | Pass   | The frozen schema completed 108 GPT-5.6 Sol observations through the OpenAI Responses adapter                                   |
| Model-quality evidence     | Failed | Assertion F1 was 0.7692 and end-to-end exactness was 76/108; the fixed v2 gate returned `kill`                                  |
| Independent adoption       | Open   | No external operator or second implementation has completed the defined pilot                                                   |

## Resolved findings

- Enum limits are computed from the emitted schema, including repeated enum
  occurrences and large string-enum character totals.
- Projection rejects dangling or cross-context references before provider
  inference.
- Host preflight rejects accessors without executing them and applies explicit
  byte, depth, and node ceilings only to schema generation.
- Model-visible handles are least-privilege and do not expose mapped ledger IDs,
  evidence digests, record sequences, or raw cut indices.
- Assertion precision and recall compare the current extraction delta. Full
  accumulated state is reserved for projected-state exactness.
- Compiler-rejected proposals retain their predicted-assertion denominator and
  cannot preserve precision by failing validation.
- Missing, duplicate, and unexpected observations remain visible and cannot
  improve correctness rates.
- The scorer never compiles an artifact-supplied schema before matching it to a
  regenerated trusted schema.
- The runner and scorer digest the same bounded bytes they parse, preventing
  corpus and result replacement races.
- Runtime identity binds repository JavaScript, built kernel files, adapter
  entrypoint bytes, and adapter arguments.
- Provider request rejection is run-scoped instead of being reported as model
  inaccuracy.
- Adapter-controlled usage metadata is separated before proposal compilation
  and retained in the result artifact.

## Remaining risks

### The failed semantic boundary

The v2 run completed all 108 observations. Schemas were valid on 108/108,
107/108 proposals compiled and applied, every applied proof verified, and raw
query intent was correct on all 108 observations. The model selected every
gold signal record, selected no distractor record, and identified the correct
target and change kind.

It nevertheless corrupted the temporal semantics. Exact coordinates were
correct on 108/108 assertions, while lower bounds were correct on 0/6, upper
bounds on 1/12, and ranges on 1/6. Bounds-operator collapse caused 23 state
failures. Revision overreach and one invalid copied quote caused the remaining
nine, including rolling cascades. Overall assertion F1 was 0.7692,
projected-state and end-to-end exactness were 76/108, and answer exactness was
87/108.

The acceptable-quote scorer is not a reliable grounding-quality measure. It
rejected 75 otherwise matching supports solely because the model returned a
shorter valid substring than the one frozen full-sentence quote, despite the
prompt requesting the smallest supporting span. It also compared
trajectory-dependent assertion handles against static handles. These defects
do not change the decision: the semantic assertion, projected-state, and
answer gates failed independently.

The
[complete result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-proposal-v2-attempt-1-2026-08-01)
preserves the raw output, score, gate, ledger, frozen inputs, and checksums. The
v2 interface and corpus will not be tuned or rerun.

A future model experiment must test a different mechanism. The evidence
supports selection of a flat operator and action vocabulary, with the host
owning candidate generation, identity, revision resolution, and admission. It
does not support another prompt variant around the same generative protocol.

The adoption gate remains one independent long-running-agent pilot that crosses
a restart, admits delayed or corrected evidence, and publishes a redacted run
another process can reproduce. A second RFC 0009 implementation remains the
portability gate.

### Provider coverage

The generated dialect is checked against the documented Structured Outputs
subset and completed the live GPT-5.6 Sol v2 run without response-schema
failure. That establishes compatibility for the recorded model invocation, not
all OpenAI models or future revisions. Local Ollama compatibility must still be
pinned to the runtime and model digest recorded in each result.

Fine-tuned OpenAI models are rejected because their supported schema subset is
narrower. See the
[OpenAI Structured Outputs schema contract](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas).

### Operational backlog

- Add direct regression fixtures for the host byte, depth, and node ceilings.
- Resolve and hash bare custom adapter executables where the command is outside
  the documented Node adapter path.
- Add parent-directory synchronization if benchmark artifacts become
  irreplaceable operational records rather than reproducible evaluation output.
- Publish the compiler only as an untrusted preview API. Model-facing MCP
  clients must not receive admission or direct-append authority by default.

## Acceptance

The final commit must pass `pnpm verify` from a clean checkout. Any public model
result additionally requires:

- exact source, runtime, model, prompt, corpus, configuration, request, response,
  and output-schema identity;
- complete expected observation coverage;
- no run-scoped provider or harness failure;
- independent score reproduction; and
- the raw JSONL artifact retained outside the checkout.

# Production audit: model proposal boundary

Date: 2026-07-30

## Decision

The model proposal boundary is suitable for an engineering alpha. It is not yet
evidence of model quality, independent adoption, or production effectiveness.
No performance claim should be published until the blinded evaluation and
external pilot gates are met.

This audit covers:

- request-scoped provider schema generation;
- proposal compilation and candidate verification;
- the 12-case, 36-cut proposal-boundary benchmark;
- Ollama and OpenAI Responses adapters;
- result publication and source/runtime binding; and
- independent replay and scoring.

## Release gates

| Gate                       | Status  | Evidence                                                                                                                        |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Host-bound provider schema | Pass    | Request ID, current evidence, compatible references, active assertions, and knowledge cuts are projected from the compiler host |
| Provider grammar bounds    | Pass    | Change, support, catalog, enum, schema-byte, host-byte, depth, and node limits fail closed                                      |
| Compiler authority         | Pass    | Provider-schema acceptance cannot bypass quote, range, catalog, revision, candidate, or run validation                          |
| Candidate integrity        | Pass    | The verifier recompiles against the same proposal and host and compares the complete candidate                                  |
| Gold isolation             | Pass    | The complete adapter request has hidden-value canaries; the 36-cut oracle checks opaque inputs and handles                      |
| Rolling failure continuity | Pass    | Failed cuts advance the knowledge cut without admitting failed candidate events                                                 |
| Artifact integrity         | Pass    | Requests, responses, output schemas, source state, runtime state, corpus, and results are content-bound                         |
| Scoring integrity          | Pass    | The scorer reconstructs trusted schemas and replay state before evaluating stored outcomes                                      |
| Provider compatibility     | Partial | A generated schema completed one local Ollama 0.31.2 preflight; OpenAI remains contract-tested but not live-tested              |
| Model-quality evidence     | Open    | No model result is published                                                                                                    |
| Independent adoption       | Open    | No external operator or second implementation has completed the defined pilot                                                   |

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

### Evidence, not implementation

The public corpus is visible and small. It proves representability, replay, and
failure accounting; it cannot establish generalization or a win over narrative
memory. The next evidence gate is a preregistered blinded suite with longer
histories, paraphrases, distractors, fixed budgets, and paired analysis.

The adoption gate remains one independent long-running-agent pilot that crosses
a restart, admits delayed or corrected evidence, and publishes a redacted run
another process can reproduce. A second RFC 0009 implementation remains the
portability gate.

### Provider coverage

The generated dialect is checked against the documented Structured Outputs
subset and the benchmark adapters pass it without repair. Local Ollama
compatibility must still be pinned to the runtime and model digest recorded in
each result. OpenAI compatibility should not be claimed from static contract
tests alone; a live run is required before publishing an OpenAI result.

Fine-tuned OpenAI models are rejected because their supported schema subset is
narrower. See the
[OpenAI Structured Outputs schema contract](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas).

### Operational backlog

- Add direct regression fixtures for the host byte, depth, and node ceilings.
- Resolve and hash bare custom adapter executables where the command is outside
  the documented Node adapter path.
- Add parent-directory synchronization if benchmark artifacts become
  irreplaceable operational records rather than reproducible evaluation output.
- Publish the source proposal API in the next package alpha. Until then, public
  examples use a built repository checkout.

## Acceptance

The final commit must pass `pnpm verify` from a clean checkout. Any public model
result additionally requires:

- exact source, runtime, model, prompt, corpus, configuration, request, response,
  and output-schema identity;
- complete expected observation coverage;
- no run-scoped provider or harness failure;
- independent score reproduction; and
- the raw JSONL artifact retained outside the checkout.

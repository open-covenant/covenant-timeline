# Frontier model gate

This preregistration fixes the decision rule for Covenant Timeline's
frontier-model evaluation before any held-out result is inspected.

## Evaluation

- Model: `gpt-5.6-sol`
- Model identity record: exact provider model ID plus the UTC run date; OpenAI
  does not publish a dated snapshot ID for this model
- Reasoning effort: `high`
- Temperature: `0`
- Maximum output tokens: `16384`
- Structured output: enabled
- Output verbosity: `low`
- Repeats: three
- Primary arms: `timeline`, `narrative-memory`, and
  `structured-extraction`
- Primary corpus: the held-out paraphrase corpus only
- Corpus digest:
  `sha256:efda86ec8f737da4f5d9108233105034ce7360c45123a2accc73f7a5c354d7ef`

The public development corpus is diagnostic and cannot satisfy this gate. The
held-out corpus contains 12 matched semantic cases with three cuts per case.
Three repeats produce 108 observations per arm. Its Timeline extraction target
contains 47 gold assertion deltas per repeat, or 141 in aggregate.
The primary run makes 324 provider requests. The separate teacher-forced
diagnostic makes 108, for 432 requests across an operationally valid attempt.

Model identifier, reasoning effort, prompts, schemas, budgets, timeout, retry
policy, case order, corpus digest, and scoring code must be committed and fixed
before the formal run. There is no early stopping and no case-level rerun.

## Primary thresholds

Timeline passes the absolute gate only if all of these aggregate held-out
thresholds are met:

| Metric                                        | Threshold                          |
| --------------------------------------------- | ---------------------------------- |
| Response-schema validity                      | at least 106/108                   |
| Timeline admission                            | at least 106/108                   |
| Query exactness                               | at least 106/108                   |
| Proof verification                            | at least 106/108                   |
| Representation-exact assertion precision      | at least 0.95                      |
| Representation-exact assertion recall         | at least 0.90, or at least 127/141 |
| Representation-exact assertion F1             | at least 0.92                      |
| Projected-state exactness                     | at least 0.90, or at least 98/108  |
| Answer exactness                              | at least 0.90, or at least 98/108  |
| End-to-end exactness                          | at least 0.85, or at least 92/108  |
| Unsupported definite answers on eligible cuts | zero                               |

Missing, timed-out, refused, malformed, schema-invalid, compiler-invalid,
rejected, query-invalid, reasoning-invalid, and proof-invalid observations
remain incorrect in every applicable denominator. Outputs are never repaired.

## Comparative rule

Timeline must beat both simpler baselines independently. For each comparison,
the paired answer-exactness difference must satisfy:

```text
(Timeline wins - Timeline losses) / 108 >= 0.10
```

This requires at least 11 net wins over `narrative-memory` and at least 11 net
wins over `structured-extraction`.

The difference must also pass a one-sided exact case-cluster sign-flip test at
`p <= 0.05`. For each of the 12 underlying semantic cases, compute the mean
paired answer-exactness difference across its three cuts and three repeats.
Enumerate all `2^12` sign assignments to those 12 case-level differences. The
p-value is the proportion whose mean is greater than or equal to the observed
mean. Zero differences remain in the enumeration. Both baseline comparisons
must pass; no baseline is selected after results are known.

## Stability

Each repeat must independently satisfy:

- assertion precision at least 0.90;
- assertion recall at least 0.85;
- assertion F1 at least 0.875;
- answer exactness at least 31/36;
- end-to-end exactness at least 29/36; and
- a non-negative paired answer-exactness difference against each baseline.

Repeats are stability checks, not independent statistical samples.

## Teacher-forced diagnostic

The teacher-forced condition supplies the exact gold prior state at cuts one
and two while withholding the current-cut gold assertions, query, and answer.
Cut zero has no prior state. Across three repeats the full diagnostic makes 108
requests; cuts one and two contain 72 diagnostic observations and 72 gold
current-cut assertion deltas.

Teacher-forced results are diagnostic only. They cannot replace rolling
results, enter the primary aggregate, satisfy a failed threshold, or change the
decision rule. A teacher-forced assertion F1 below 0.90 identifies a
current-cut extraction failure. A passing teacher-forced result with a failing
rolling result identifies continuity or error propagation as the likely
failure boundary.

## Operational attempts

A formal attempt must have complete coverage with zero missing, duplicate, or
unexpected observations. Provider transport errors, HTTP 429 responses, and
HTTP 5xx responses make an attempt operationally invalid. The artifact is
retained, but its model scores are not used.

At most one complete rerun is permitted after an operationally invalid
attempt. The configuration must remain identical. The first complete attempt
without those infrastructure errors is authoritative. Refusals, truncation,
invalid model output, and timeouts are model-interface failures and do not
authorize a rerun. If neither of the two permitted attempts is operationally
valid, the evaluation is inconclusive and no model-performance claim is made.

## Decision

After an operationally valid run, the decision is binary:

- **Continue** only if every absolute, comparative, and per-repeat threshold
  passes.
- **Kill** the standalone model-memory thesis if any threshold fails. Fold the
  deterministic temporal kernel into Covenant and stop presenting Timeline as
  a validated standalone model-native product.

A failed model gate does not invalidate the kernel's deterministic replay,
reasoning, or proof-verification properties.

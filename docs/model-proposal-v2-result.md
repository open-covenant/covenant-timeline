# Model-proposal boundary v2 result

The preregistered GPT-5.6 Sol evaluation returned **kill** on 2026-08-01.
Free-form model proposals are not reliable enough to enter durable temporal
state without a separate admission decision.

## Result

The first operationally valid attempt completed 108 observations: 12 cases,
three record cuts, and three repeats.

| Metric                    |                     Result |                    Gate |
| ------------------------- | -------------------------: | ----------------------: |
| Response-schema validity  |                    108/108 |        at least 106/108 |
| Compiler validity         |                    107/108 |        at least 106/108 |
| Candidate application     |                    107/108 |        at least 106/108 |
| Assertion precision       |                     0.7586 |           at least 0.97 |
| Assertion recall          |                     0.7801 |           at least 0.95 |
| Assertion F1              |                     0.7692 |           at least 0.96 |
| Projected-state exactness |                     76/108 |        at least 103/108 |
| Query exactness           |                    107/108 |        at least 106/108 |
| Answer exactness          |                     87/108 |        at least 103/108 |
| End-to-end exactness      |                     76/108 |        at least 103/108 |
| Proof verification        | 107/107 applied candidates | every applied candidate |

Every repeat failed its assertion and end-to-end stability floors. The attempt
was operationally valid, so the frozen gate permits no performance rerun.

The
[complete result bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-proposal-v2-attempt-1-2026-08-01)
contains the preregistration, corpus, support oracle, configuration, raw JSONL,
score, gate, initialized and final attempt ledgers, run record, and checksums.
It is bound to source commit
`fcdc4bcf5554bea58c754685aae11ed1e61853a3`.

## Failure analysis

The model consistently found the relevant evidence. It selected all 141 gold
signal records, never selected a distractor record, and chose the correct
temporal target and change kind. Query intent was also correct in the one row
that failed compilation, making raw query selection 108/108.

The failure was semantic classification:

| Gold bounds operator | Correct |
| -------------------- | ------: |
| Exact                | 108/108 |
| Lower bound          |     0/6 |
| Upper bound          |    1/12 |
| Closed range         |     1/6 |

The model collapsed 22 non-exact bounds into exact coordinates. Those errors
caused 23 projected-state failures, including three later failures inherited
through rolling state. A repeated revision error caused six more state
failures: a newly recorded conflicting coordinate was treated as a replacement
instead of remaining active alongside the earlier value. One case-sensitive
quote error caused one compilation failure and two downstream failures.

The 32 end-to-end failures reconcile to those three causes:

| Cause                    | Direct failures | Cascaded failures | Total |
| ------------------------ | --------------: | ----------------: | ----: |
| Bounds-operator collapse |              20 |                 3 |    23 |
| Incorrect replacement    |               3 |                 3 |     6 |
| Invalid copied quote     |               1 |                 2 |     3 |

Eleven observations returned the expected answer from the wrong projected
state. That is why the gate required state equality instead of accepting answer
accuracy alone.

## Grounding metric defect

The gate's reported support F1 was 0.1958, but that number should not be used as
a general grounding estimate. The prompt required the smallest supporting
substring, while the frozen oracle generally accepted one complete sentence.
Of 145 proposed supports, 104 matched the static gold claim and evidence record
and 103 contained a valid verbatim substring. Only 28 received credit; 75 were
rejected solely because the shorter valid quote did not equal the oracle's one
full-sentence string.

The scorer also compared request-local, trajectory-dependent assertion handles
against static gold handles. It could reject a correct correction after the
model trajectory diverged and, conversely, credit a wrong retraction whose
positional handle happened to match the static artifact.

These defects do not change the decision. Corrected grounding would converge
toward the semantic assertion result, which remained far below the gate, and
the projected-state and answer thresholds failed independently.

## Product consequence

The MCP boundary now separates three operations:

1. a model may propose and preview an untrusted candidate;
2. Timeline may compile, reason over, and verify that candidate without
   changing durable state; and
3. a separate host or operator may admit the exact candidate under an explicit
   authority and policy record.

The v2 generative protocol remains available for reproducibility, but it will
not be presented as the default ingestion path or tuned against its frozen
corpus.

Any future model experiment must test a materially different interface. The
observed evidence supports a flat selection protocol in which a model chooses
an operator such as `eq`, `gte`, `lte`, or `range` and an action such as
`append`, `replace-active`, or `withdraw-active`, while the host owns identity,
revision resolution, candidate generation, and admission. That hypothesis
requires a new balanced, held-out preregistration and strong simpler baselines.

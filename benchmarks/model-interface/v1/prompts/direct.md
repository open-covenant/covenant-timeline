You are answering one temporal benchmark request from the complete textual
record available at a knowledge cut.

Use only `input.entities`, `input.contract`, `input.setupEvents`,
`input.evidence`, and `input.question`. `setupEvents` contains trusted point and
interval declarations. The evidence array contains every source record
available through this cut. Do not assume missing events occurred, estimate an
unknown bound, merge scenario contexts, or preserve a claim that later evidence
corrects or withdraws.

Return exactly one JSON object with this envelope:

```json
{
  "schema": "covenant.timeline.model-eval.response.v1",
  "requestId": "<the request requestId>",
  "answer": {}
}
```

`answer` must be one of these semantic result shapes:

```json
{"type":"context.consistency","status":"consistent"}
{"type":"context.consistency","status":"inconsistent"}
{"type":"difference.bounds","status":"bounded","minimum":0,"maximum":0}
{"type":"difference.bounds","status":"partially-bounded","minimum":null,"maximum":0}
{"type":"difference.bounds","status":"unbounded","minimum":null,"maximum":null}
{"type":"difference.bounds","status":"inconsistent","minimum":null,"maximum":null}
{"type":"point.relations","status":"resolved","possible":["before"]}
{"type":"interval.relations","status":"indeterminate","possible":["before","meets"]}
```

For difference bounds, use safe integers for known bounds and `null` for an
unknown side. `bounded` means both sides are known, `partially-bounded` means
exactly one side is known, and `unbounded` means neither side is known.

For relation answers, use `resolved` only when exactly one relation is
possible, `indeterminate` when more than one is possible, and `inconsistent`
with an empty `possible` array when the active assertions cannot all hold.
Order point relations as `before`, `equal`, `after`. Order Allen interval
relations as `before`, `meets`, `overlaps`, `starts`, `during`, `finishes`,
`equal`, `finished-by`, `contains`, `started-by`, `overlapped-by`, `met-by`,
`after`, omitting impossible relations.

Treat `actual`, `planned`, `forecast`, and `hypothetical` contexts as separate
records. A value in one context does not fill an unknown value in another.
Apply corrections, supersessions, withdrawals, and revocations before
answering. A delayed record changes later knowledge but does not change what
was available at an earlier record cut.

Output strict JSON only. Do not add prose, Markdown fences, estimates,
explanations, or extra fields.

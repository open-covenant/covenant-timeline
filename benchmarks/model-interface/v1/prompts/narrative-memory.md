You are maintaining a bounded memory string for a temporal benchmark while
answering one question at each knowledge cut.

Use only `input.entities`, `input.contract`, `input.setupEvents`, the current
`input.evidence`, `input.memory`, and `input.question`. `setupEvents` contains
trusted point and interval declarations. The memory is the only scenario
information carried from earlier cuts. If it is empty, you have no earlier
evidence record. Do not assume missing events occurred, estimate an unknown
bound, merge scenario contexts, or preserve a claim that current evidence
corrects or withdraws.

Return exactly one JSON object with this envelope:

```json
{
  "schema": "covenant.timeline.model-eval.response.v1",
  "requestId": "<the request requestId>",
  "answer": {},
  "memory": "<updated memory>"
}
```

`answer` must use one of the semantic result shapes below:

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

Update `memory` to preserve the temporal facts needed at later cuts. Distinguish
actual, planned, forecast, and hypothetical contexts; unknown and one-sided
bounds; active and withdrawn claims; and what was known at each record cut.
When evidence corrects a claim, retain enough history to answer an explicitly
historical question without treating the corrected claim as currently active.

The memory is a model-written text string. You may organize it as prose or
compact structured notation. Its UTF-8 byte length must not exceed the fixed
`input.memoryBudgetBytes` value. The harness rejects rather than truncates an
invalid or over-budget update and retains the last valid memory for the next
cut.

Output strict JSON only. Do not add prose outside the object, Markdown fences,
estimates, explanations, or extra fields.

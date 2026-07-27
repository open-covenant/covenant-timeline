You are extracting temporal state and a query for Covenant Timeline v0alpha3.
The host, not you, will run the deterministic reasoner.

Use only `input.entities`, `input.contract`, `input.setupEvents`, the current
`input.evidence`, `input.priorRun`, `input.knowledgeCuts`,
`input.stateBudgetBytes`, and `input.question`. `setupEvents` contains the
trusted point and interval declarations already present in `priorRun.events`;
do not emit declarations. `priorRun.events` also contains every model event
admitted at earlier cuts. `knowledgeCuts` maps each completed benchmark cut to
the final admitted event sequence at that cut. Emit only the event delta
supported by evidence introduced at the current cut. Do not repeat earlier
assertions, cite evidence from an earlier cut, invent evidence, estimate unknown
bounds, or merge scenario contexts.

Return exactly one JSON object with this envelope:

```json
{
  "schema": "covenant.timeline.model-eval.response.v1",
  "requestId": "<the request requestId>",
  "events": [],
  "query": {}
}
```

Every event must have schema `covenant.timeline.event.v0alpha3`. Its sequence
must start at `input.priorRun.events.length` and increment contiguously. Use
valid, stable lowercase identifiers. Event, assertion, and query IDs may be
chosen freely, but references to those IDs must be exact and internally
consistent. Use the point, interval, context, and axis IDs supplied by the
contract and entity dictionary exactly. The `sequence: 0` values in the shape
examples below are placeholders; calculate every emitted sequence from the
length of `priorRun.events`.

An exact or bounded point coordinate uses:

```json
{
  "schema": "covenant.timeline.event.v0alpha3",
  "id": "assert.example.v1",
  "sequence": 0,
  "type": "coordinate.asserted",
  "assertion": {
    "id": "coordinate.example.v1",
    "contextId": "actual",
    "pointId": "example",
    "coordinate": {
      "minimum": 0,
      "maximum": 0
    },
    "evidenceRefs": ["sha256:<current evidence digest>"]
  }
}
```

Use only `minimum` for “no earlier than” and only `maximum` for “no later
than.” A duration or difference between two points uses:

```json
{
  "schema": "covenant.timeline.event.v0alpha3",
  "id": "assert.duration.v1",
  "sequence": 0,
  "type": "constraint.asserted",
  "assertion": {
    "id": "constraint.duration.v1",
    "contextId": "actual",
    "constraint": {
      "fromPointId": "start",
      "toPointId": "end",
      "minimum": 1,
      "maximum": 3
    },
    "evidenceRefs": ["sha256:<current evidence digest>"]
  }
}
```

When current evidence explicitly replaces a prior assertion, emit a new
assertion of the same kind and context with `supersedes` naming the prior
assertion ID. When it only withdraws or revokes a prior assertion, emit:

```json
{
  "schema": "covenant.timeline.event.v0alpha3",
  "id": "retract.example.v1",
  "sequence": 0,
  "type": "assertion.retracted",
  "assertionId": "coordinate.example.v1",
  "evidenceRefs": ["sha256:<current evidence digest>"]
}
```

Each `evidenceRefs` value must be a digest supplied with evidence visible in
the current request. The canonical model-generated events in the candidate
`priorRun`, excluding trusted `setupEvents`, plus updated `knowledgeCuts` must
fit within `input.stateBudgetBytes`; keep model-owned identifiers concise. Lack
of a time is not an assertion. Independent, conflicting records remain
independent unless the evidence explicitly corrects, supersedes, withdraws, or
revokes one.

`query` must use schema `covenant.timeline.query.v0alpha3` and one of these
shapes:

```json
{"schema":"covenant.timeline.query.v0alpha3","id":"query.example","contextId":"actual","recordedThrough":0,"type":"context.consistency"}
{"schema":"covenant.timeline.query.v0alpha3","id":"query.example","contextId":"actual","recordedThrough":0,"type":"difference.bounds","fromPointId":"start","toPointId":"end"}
{"schema":"covenant.timeline.query.v0alpha3","id":"query.example","contextId":"actual","recordedThrough":0,"type":"point.relations","leftPointId":"left","rightPointId":"right"}
{"schema":"covenant.timeline.query.v0alpha3","id":"query.example","contextId":"actual","recordedThrough":0,"type":"interval.relations","leftIntervalId":"left","rightIntervalId":"right"}
```

For a current-cut question, `recordedThrough` is the final sequence after
appending `events`. For an explicitly historical question, use the final event
sequence recorded for the requested earlier cut in `input.knowledgeCuts`, even
though the run contains later events. Select the context and operation asked by
the question.

Do not return a semantic answer; the host derives it from the admitted run and
query. Output strict JSON only, without prose, Markdown fences, or extra
fields.

You are extracting a complete temporal record and query from all source text
available at one knowledge cut. The host, not you, will run the deterministic
reasoner. Nothing from an earlier model response is carried into this request.

Use only `input.entities`, `input.contract`, `input.setupEvents`,
`input.evidence`, `input.stateBudgetBytes`, and `input.question`.
`setupEvents` contains trusted point and interval declarations; do not emit
declarations. The evidence array contains every source record available through
the current cut and identifies the cut at which each record became available.

Return exactly one JSON object with this envelope:

```json
{
  "schema": "covenant.timeline.model-eval.response.v1",
  "requestId": "<the request requestId>",
  "events": [],
  "query": {}
}
```

Reconstruct the complete assertion history supported by the supplied evidence,
in evidence-cut order. Emit every supported coordinate, constraint, correction,
supersession, and retraction needed to represent that history. Do not emit
derived coordinates, declarations, estimates, or duplicate claims.

Map evidence literally:

- “at offset N” is exact: emit both `minimum: N` and `maximum: N`;
- “no earlier than N” emits only `minimum: N`;
- “no later than N” emits only `maximum: N`;
- a stated duration or difference is a constraint between existing points; and
- absent timing information is not an assertion.

Every event must have schema `covenant.timeline.event.v0alpha3`. Its sequence
must start at `input.setupEvents.length` and increment contiguously. Use valid,
stable lowercase identifiers. Use only point, interval, context, and axis IDs
supplied by the contract, entity dictionary, and setup events.

An exact or bounded coordinate has this shape:

```json
{
  "schema": "covenant.timeline.event.v0alpha3",
  "id": "assert.example.v1",
  "sequence": 0,
  "type": "coordinate.asserted",
  "assertion": {
    "id": "coordinate.example.v1",
    "contextId": "actual",
    "pointId": "milestone",
    "coordinate": {
      "minimum": 0,
      "maximum": 0
    },
    "evidenceRefs": ["sha256:<supporting evidence digest>"]
  }
}
```

A duration or difference has this shape:

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
    "evidenceRefs": ["sha256:<supporting evidence digest>"]
  }
}
```

When later evidence explicitly replaces an earlier assertion, emit the new
assertion with `supersedes` naming the earlier model-owned assertion ID. When
later evidence only withdraws or revokes an assertion, emit:

```json
{
  "schema": "covenant.timeline.event.v0alpha3",
  "id": "retract.example.v1",
  "sequence": 0,
  "type": "assertion.retracted",
  "assertionId": "coordinate.example.v1",
  "evidenceRefs": ["sha256:<withdrawal evidence digest>"]
}
```

Each evidence reference must match a digest supplied in `input.evidence`.
Independent conflicting records remain independent unless a source explicitly
corrects, supersedes, withdraws, or revokes one. The canonical event array must
fit within `input.stateBudgetBytes`; keep model-owned identifiers concise.

`query` must use schema `covenant.timeline.query.v0alpha3` and one of:

```json
{"schema":"covenant.timeline.query.v0alpha3","id":"query.example","contextId":"actual","recordedThrough":0,"type":"context.consistency"}
{"schema":"covenant.timeline.query.v0alpha3","id":"query.example","contextId":"actual","recordedThrough":0,"type":"difference.bounds","fromPointId":"start","toPointId":"end"}
{"schema":"covenant.timeline.query.v0alpha3","id":"query.example","contextId":"actual","recordedThrough":0,"type":"point.relations","leftPointId":"left","rightPointId":"right"}
{"schema":"covenant.timeline.query.v0alpha3","id":"query.example","contextId":"actual","recordedThrough":0,"type":"interval.relations","leftIntervalId":"left","rightIntervalId":"right"}
```

For a current-cut question, `recordedThrough` is the final emitted event
sequence, or the final setup sequence if no assertions are emitted. For a
historical question, use the final sequence of the assertion history supported
by records through the requested evidence cut.

Before returning, verify that event and assertion IDs are unique, sequences are
contiguous, every reference resolves, every assertion cites supporting
evidence, corrections target the replaced assertion, and the query operation
and point order match the question.

Do not return a semantic answer. Output strict JSON only, without prose,
Markdown fences, or extra fields.

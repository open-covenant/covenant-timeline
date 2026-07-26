# Model interface

This guide describes the experimental v0alpha3 interface between a language
model and Covenant Timeline's deterministic temporal kernel.

The model extracts meaning. Timeline checks temporal consequences. Neither
operation authenticates the source.

```text
source material
      │
      ▼
model proposes temporal events
      │
      ▼
host validates evidence and admits records
      │
      ▼
model submits one typed query
      │
      ▼
Timeline returns a canonical result and proof receipt
      │
      ▼
model answers from the checked result
```

## What the model may propose

The model-facing vocabulary is deliberately small:

- a temporal axis and scenario context;
- points and digest-referenced exact or bounded coordinate assertions;
- proper intervals made from two points;
- lower and upper difference constraints;
- opaque facts with validity, observation, and assertion references;
- supersession or retraction of an earlier assertion; and
- one typed query at an explicit knowledge cut.

The host is responsible for retaining source spans and evidence bytes, checking
that each declared SHA-256 digest matches those bytes, authenticating authority,
and deciding which proposals enter the run. Model output is not evidence merely
because it validates.

## Query operations

The first kernel supports:

| Operation             | Answer                                                       |
| --------------------- | ------------------------------------------------------------ |
| `context.consistency` | whether the selected context has a feasible schedule         |
| `difference.bounds`   | tight lower and upper bounds for `to - from`                 |
| `point.relations`     | possible relations from `before`, `equal`, and `after`       |
| `interval.relations`  | possible relations from the 13 Allen interval base relations |

Each query carries `recordedThrough`. `null` means the empty event prefix; an
integer includes events through that sequence. There is no ambient “now” or
implicit latest cut.

## TypeScript loop

From this repository:

```ts
import {
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "@covenant-org/timeline";

const run = parseRunDocumentV0Alpha3(runInput);
const query = parseQueryV0Alpha3(queryInput, run);
const conclusion = reasonTemporalQueryV0Alpha3(run, query);

if (!verifyTemporalConclusionV0Alpha3(run, query, conclusion)) {
  throw new Error("temporal proof verification failed");
}
```

The returned conclusion binds:

- the canonical semantic result;
- projected-state, query, and result digests;
- the reasoner profile; and
- a schedule, ordered bound paths, exhaustive relation cases, or an ordered
  negative cycle.

The model should consume `result` as the checked temporal answer. The receipt is
for verification, audit, and continuity across model calls.

## Response policy

A model integration should follow these rules:

1. Do not turn an `indeterminate` relation into a definite relation.
2. Do not turn an unbounded side into an estimated numeric bound.
3. Do not infer causality, authority, or domain truth from temporal precedence.
4. Do not treat absence as non-occurrence without a separate completeness
   profile.
5. Treat arithmetic overflow as no answer. It means a required finite result or
   exhaustive witness cannot be represented safely, not that the omitted case
   is impossible.
6. Do not merge `actual`, `planned`, `forecast`, or `hypothetical` contexts.
7. Preserve the conclusion digests when passing temporal state between calls.
8. Surface extraction or admission failures instead of silently deleting the
   disputed assertion.

## Evaluation boundary

Measure failures separately:

- **extraction:** the model represented the source incorrectly;
- **admission:** references, evidence, context, axis, or record order were
  invalid;
- **reasoning:** the kernel or proof verifier returned an incorrect result;
- **response:** the model contradicted or overstated the checked result.

This separation is required to tell whether Timeline improves temporal
reasoning rather than merely changing the prompt.

Using this API as a tool is tool-integrated temporal reasoning. Calling it
inside a constrained generation loop is inference-integrated temporal
reasoning. Neither warrants a claim that temporal reasoning is native to model
weights.

# Compile model output into temporal candidates

On Thursday, a release agent receives a corrected deployment log: deployment
began 5,400 seconds after security review, not 3,600 seconds as previously
recorded. The model identifies the correction. The host retains control of the
ledger.

The published `0.0.0-alpha.2` package contains the temporal kernel. The proposal
compiler is currently a source API. Run the example from a built repository
checkout.

The host gives the model opaque handles for the relevant relationship,
existing assertion, evidence document, and knowledge cut. The model returns a
small proposal:

<!-- model-proposal-input:start -->

```json
{
  "schema": "covenant.timeline.model-proposal.v1",
  "requestId": "release-correction-17",
  "changes": [
    {
      "type": "constraint",
      "differenceHandle": "review-to-deploy",
      "bounds": {
        "type": "exact",
        "value": 5400
      },
      "supports": [
        {
          "evidenceId": "correction-log",
          "quote": "Deployment began 5,400 seconds after the security review finished."
        }
      ],
      "revision": {
        "type": "supersede",
        "assertionHandle": "current-review-to-deploy"
      }
    }
  ],
  "query": {
    "type": "difference",
    "targetHandle": "review-to-deploy",
    "knowledgeCut": {
      "type": "current"
    }
  }
}
```

<!-- model-proposal-input:end -->

The host compiles that untrusted output against its current run and catalogs:

```js
import {
  compileTemporalModelProposalV1,
  createTemporalModelProposalOutputSchemaV1,
  verifyTemporalModelProposalCandidateV1,
} from "./packages/prototype/dist/index.js";

const proposalHost = {
  run,
  expectedRequestId: "release-correction-17",
  evidenceCatalog: [
    {
      id: "correction-log",
      status: "current",
      text: "Correction received Thursday. Deployment began 5,400 seconds after the security review finished.",
    },
  ],
  referenceCatalog: [
    {
      type: "difference",
      handle: "review-to-deploy",
      fromPointId: "review-start",
      toPointId: "deploy-start",
    },
  ],
  assertionCatalog: [
    {
      handle: "current-review-to-deploy",
      assertionId: "constraint.deploy-delay.v2",
    },
  ],
};

const outputSchema = createTemporalModelProposalOutputSchemaV1(proposalHost);
// Give outputSchema to the provider before compiling its response.
const candidate = compileTemporalModelProposalV1(proposal, proposalHost);
if (
  !verifyTemporalModelProposalCandidateV1(candidate, proposal, proposalHost)
) {
  throw new Error("candidate verification failed");
}
```

The benchmark adapters append an adapter-controlled `usage` field to their
JSONL response when token counts are available. Remove that metadata before
passing the proposal to the compiler. The benchmark runner performs this
normalization and preserves usage separately in the result artifact.

`outputSchema` is a direct schema for the proposal shown above. Use it as
Ollama's `format` value:

```js
const ollamaRequest = {
  model,
  messages,
  stream: false,
  format: outputSchema,
};
```

For supported non-fine-tuned OpenAI Responses models, place it inside the
strict JSON Schema format:

```js
const openAIFormat = {
  type: "json_schema",
  name: "covenant_timeline_model_proposal_v1",
  strict: true,
  schema: outputSchema,
};
```

The projection pins the exact request ID, includes current evidence IDs, groups
reference handles by operation, includes active assertion and knowledge-cut
handles, and removes unavailable variants. Catalog order and evidence contents
do not affect its bytes. It does not derive mapped ledger identifiers or embed
source text, source digests, quotes, numeric answers, or an expected change
count. Caller-issued handles and evidence IDs are included verbatim, so hosts
must make them opaque and limit them to the current request.

Compilation produces a deterministic candidate event, query, and provenance
record:

<!-- model-proposal-candidate:start -->

```json
{
  "schema": "covenant.timeline.model-proposal-candidate.v1",
  "requestId": "release-correction-17",
  "baseRunDigest": "sha256:e9193696663726d4ddbac07a14e9a5869b872b25f9702c5ca8a38f165e431a92",
  "proposalDigest": "sha256:6027c04f7a56df1c30396b29143ae98dda67d69ad0a09debd94edd886c25ceb6",
  "candidateEvents": [
    {
      "schema": "covenant.timeline.event.v0alpha3",
      "sequence": 17,
      "type": "constraint.asserted",
      "assertion": {
        "id": "constraint-assertion-c712a94170b8601ba2adfbbbed3725c7eee9b274857a6e11465a014c43ea21c6",
        "contextId": "actual",
        "constraint": {
          "fromPointId": "review-start",
          "toPointId": "deploy-start",
          "minimum": 5400,
          "maximum": 5400
        },
        "evidenceRefs": [
          "sha256:4a9055e245216c3a868dd4503f8b2ba219a8ab5588fc69cb77ab8c3619efedc3"
        ],
        "supersedes": ["constraint.deploy-delay.v2"]
      },
      "id": "event-bc4af597a3bb84caa75b725360f015235bcf465b7318104f89df67f2412c78db"
    }
  ],
  "candidateQuery": {
    "schema": "covenant.timeline.query.v0alpha3",
    "type": "difference.bounds",
    "contextId": "actual",
    "recordedThrough": 17,
    "fromPointId": "review-start",
    "toPointId": "deploy-start",
    "id": "query-6ad363614d2b61fae4e57506c56c49ece8dd63e8dc1e3d9a8dd51e0a027dd846"
  },
  "provenance": [
    {
      "candidateEventId": "event-bc4af597a3bb84caa75b725360f015235bcf465b7318104f89df67f2412c78db",
      "evidenceRefs": [
        "sha256:4a9055e245216c3a868dd4503f8b2ba219a8ab5588fc69cb77ab8c3619efedc3"
      ],
      "supports": [
        {
          "evidenceId": "correction-log",
          "evidenceRef": "sha256:4a9055e245216c3a868dd4503f8b2ba219a8ab5588fc69cb77ab8c3619efedc3",
          "quoteDigest": "sha256:66d5b682ff1705ee71de4230e6ffe7b3d400920031d8f0f8a14950505d8bb689",
          "utf8EndByte": 96,
          "utf8StartByte": 30
        }
      ]
    }
  ]
}
```

<!-- model-proposal-candidate:end -->

This artifact is generated from the checked-in
[software release run](../conformance/v0alpha3/runs/software-release.json).
The proposal test recompiles it and compares the documentation with the actual
output.

## Responsibility at the model boundary

| Model supplies                              | Host supplies                                                   | Compiler derives                                       |
| ------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| Catalog handles, never ledger identifiers   | Base run, request ID, context and reference catalogs            | Context, point and interval identifiers                |
| Exact, lower, upper, or closed-range bounds | Current evidence text and evidence status                       | Full-evidence digests and exact UTF-8 quote spans      |
| Exact source quotes and evidence handles    | Existing assertion handles and historical knowledge-cut handles | Event sequence, event IDs, and assertion IDs           |
| Explicit keep, supersede, or retract intent | Authentication, admission policy, and append authority          | v0alpha3 events and a knowledge-cut-bound query        |
| Consistency, difference, or relation intent | Resource-limit overrides, when stricter limits are required     | Proposal, run, quote, and candidate content identities |

Models never choose sequence numbers, event IDs, assertion IDs, context IDs, or
evidence digests. They can only refer to handles the host exposed for that
request. The compiler rejects unknown, stale, incompatible, or inactive
references.

## Provenance without overclaiming

Each support receipt binds three things:

- `evidenceRef` is the SHA-256 digest of the host's exact UTF-8 evidence text;
- `quoteDigest` is the SHA-256 digest of the exact quoted UTF-8 bytes; and
- `utf8StartByte` and `utf8EndByte` locate that quote in the evidence, using a
  start-inclusive, end-exclusive range.

The quote must occur exactly once in current evidence. The candidate carries
the quote digest and byte range rather than duplicating source text.

This binds the proposed support to one location in the supplied evidence. It
does not prove that the quote entails the temporal claim, that the evidence is
authentic or true, or that the model interpreted it correctly. Those remain
host admission decisions.

## Compilation guarantees

Compilation is deterministic and fail-closed:

- the response must carry the host's exact request ID;
- every object has a closed shape and every identifier is bounded;
- each bound is a safe integer, and closed ranges must be ordered;
- every support resolves to current evidence and a unique exact quote;
- handles must resolve to compatible declarations in one context and axis;
- superseded and retracted assertions must already exist and remain active;
- same-batch references are unavailable;
- byte-equivalent duplicate events are rejected;
- candidate events receive contiguous sequences and content-addressed IDs;
- the candidate run and query pass the v0alpha3 parsers; and
- any error rejects the entire proposal without partial output or repair.

Distinct claims about the same target are preserved when their event content
differs. Timeline can represent conflicting evidence; admission policy decides
whether those candidates enter the run.

## Compile first, admit separately

`compileTemporalModelProposalV1` does not mutate the run, append an event,
execute the query, authenticate evidence, or authorize a claim. It only returns
a candidate.

A production host should:

1. authenticate and classify evidence before placing it in the catalog;
2. compile the model response;
3. review the candidate under an explicit admission policy;
4. append accepted events through its own durable write path; and
5. reason over the admitted run and verify the resulting proof receipt.

The request ID correlates one model response with one host-issued request. It
is not an authorization token.

## Default limits

| Input                         | Default limit |
| ----------------------------- | ------------: |
| Changes per proposal          |            32 |
| Supports per change           |             8 |
| Evidence catalog entries      |           256 |
| Bytes per evidence document   |        65,536 |
| Total evidence bytes          |     1,048,576 |
| Bytes per quote               |         4,096 |
| Reference catalog entries     |         1,024 |
| Assertion catalog entries     |         1,024 |
| Knowledge-cut catalog entries |           256 |
| Encoded proposal bytes        |     1,310,720 |
| Proposal JSON values          |         4,096 |
| Proposal nesting levels       |            12 |
| Identifier length             |           128 |

Identifiers use lowercase letters, digits, `.`, `_`, `:`, `/`, and `-`, and
must begin with a lowercase letter or digit. Numeric bounds use JavaScript safe
integers.

The [proposal schema](../schemas/model-proposal/v1/proposal.schema.json) is
the complete normative structural schema.
`createTemporalModelProposalOutputSchemaV1` derives a smaller provider schema
from the exact host snapshot used for compilation. Provider grammar expansion
is capped at eight changes, four supports per change, 512 catalog values, 1,000
enum entries in the emitted schema, 15,000 characters in any string enum above
250 values, and 65,536 schema bytes. Projection also rejects hosts above 64 MiB,
1.1 million JSON values, or 128 nesting levels. Larger requests fail instead of
truncating their visible catalogs. Every exposed context, point, difference,
and relation must resolve to compatible declarations before provider inference.

The provider projection deliberately omits numeric minima and maxima and quote
length bounds. Large repetitions of those constraints can overwhelm local
grammar compilers. The proposal compiler still enforces safe integers, UTF-8
quote limits, catalog resolution, range ordering, proposal bytes and depth, and
candidate construction. A provider accepting the schema is not evidence that
its output is safe to admit.

Supersession choices are grouped by assertion kind to keep provider grammars
bounded. The compiler still requires the selected assertion to match the
change's context and target; a category-valid but incompatible choice rejects
the complete proposal.

The
[candidate schema](../schemas/model-proposal/v1/candidate.schema.json) validates
the artifact's portable structure. It is not an integrity check.
`verifyTemporalModelProposalCandidateV1` recompiles the proposal against the
same host inputs and compares the complete artifact, including run and proposal
digests, event identities, query identity, evidence references, quote spans,
and provenance relationships.

## Corpus conformance

The proposal test also lowers all 36 knowledge cuts in the checked-in
model-interface corpus from their gold assertions and queries. Each compiled
candidate must conform to the public candidate schema, reproduce the gold
projected state and query result, and yield a verifiable proof receipt.

This is a compiler conformance oracle, not a model-quality result. It shows that
the proposal surface can represent and deterministically lower the corpus's
known-good temporal operations. It does not measure whether a model can infer
those operations from source evidence.

Run the schema, documentation, and corpus checks with:

```sh
pnpm model-proposal:test
```

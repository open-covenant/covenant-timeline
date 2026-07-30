# Integrate a language model

A release agent reads a corrected log: deployment began 5,400 seconds after
security review, not 3,600 seconds as previously recorded. The model identifies
the correction and cites the source. Timeline turns that proposal into
deterministic ledger candidates, while the host retains control of evidence and
admission.

```text
source evidence + host catalogs
              │
              ▼
model proposes claims, revisions, query intent, and exact quotes
              │
              ▼
Timeline resolves handles and compiles events + provenance
              │
              ▼
host authenticates evidence and admits the candidate batch
              │
              ▼
Timeline returns a canonical result + verifiable receipt
```

## Use the proposal compiler

The production model boundary is
`covenant.timeline.model-proposal.v1`. Models work with request-scoped handles
instead of mapped ledger identifiers, digests, sequence numbers, or raw
knowledge-cut indices. The host is responsible for issuing opaque,
least-privilege handles; caller-provided handle and evidence-ID strings are
visible to the provider.

The published `0.0.0-alpha.2` package contains the temporal kernel. The proposal
compiler is currently a source API. Build the checkout you deploy:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

```ts
import {
  compileTemporalModelProposalV1,
  createTemporalModelProposalOutputSchemaV1,
} from "./packages/prototype/dist/index.js";

const proposalHost = {
  run,
  expectedRequestId,
  evidenceCatalog,
  referenceCatalog,
  assertionCatalog,
  knowledgeCutCatalog,
};
const outputSchema = createTemporalModelProposalOutputSchemaV1(proposalHost);
// Send outputSchema with the evidence and question through the provider SDK.
const candidate = compileTemporalModelProposalV1(
  proposalFromProvider,
  proposalHost,
);
```

The generated schema pins the request ID and enumerates only current evidence
and compatible handle categories from that request. The reference adapters
pass it directly as Ollama's `format` value or, for supported non-fine-tuned
models, as the `schema` inside an OpenAI strict `json_schema` response format.
The provider still produces `covenant.timeline.model-proposal.v1`; no
adapter-specific proposal shape or repair step sits between provider and
compiler.

The compiler:

- requires the model to echo the host-issued request ID;
- resolves every model handle against a bounded host catalog;
- hashes the exact UTF-8 evidence bytes;
- locates every quoted span exactly once;
- derives contexts, identifiers, event order, and query orientation;
- validates the complete candidate run and query; and
- rejects the whole proposal on any error.

The result contains content-addressed candidate events, a pinned query, and
provenance receipts with evidence and quote digests plus UTF-8 byte ranges. It
does not contain source text, mutate the run, or admit a claim.

See [Compile model output into temporal candidates](./model-proposal.md) for a
complete correction proposal, generated candidate artifact, JSON Schemas,
limits, and responsibility boundaries.

## Admit candidates deliberately

Successful compilation establishes structure and source location. It does not
establish that:

- the source is authentic or true;
- the quote entails the proposed claim;
- the model interpreted the source correctly; or
- the caller has authority to change the run.

The host must retain source bytes, authenticate evidence, apply domain policy,
and decide whether the complete candidate batch enters the durable run.
Timeline's local MCP server can compile and atomically persist a proposal, but
its built-in admission mode remains explicitly unauthenticated and
structural-only.

## Reason and verify

After admission, the deterministic API separates reasoning from verification:

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

The model should consume `conclusion.result` as the checked temporal answer.
The receipt binds the projected state, query, semantic result, reasoner
profile, and proof material for verification and replay.

The reference kernel supports:

| Operation             | Answer                                                       |
| --------------------- | ------------------------------------------------------------ |
| `context.consistency` | whether the selected context has a feasible schedule         |
| `difference.bounds`   | tight lower and upper bounds for `to - from`                 |
| `point.relations`     | possible relations from `before`, `equal`, and `after`       |
| `interval.relations`  | possible relations from the 13 Allen interval base relations |

Every query carries an explicit `recordedThrough` knowledge cut. A current
proposal resolves to the final sequence in its candidate batch; a historical
intent resolves through a host-provided cut handle.

## Response policy

A model integration should preserve the kernel's result:

1. Do not turn an `indeterminate` relation into a definite relation.
2. Do not turn an unbounded side into an estimated numeric bound.
3. Do not infer causality, authority, or domain truth from temporal precedence.
4. Do not treat absence as non-occurrence without a separate completeness
   policy.
5. Treat arithmetic overflow as no answer.
6. Do not merge actual, planned, forecast, or hypothetical contexts.
7. Preserve conclusion digests when temporal state crosses model calls.
8. Surface extraction and admission failures instead of silently deleting a
   disputed assertion.

## Measure each failure boundary

Evaluate model integrations in separate stages:

- **extraction:** the proposed claim does not match the source;
- **support:** the evidence handle or exact quote cannot be resolved;
- **compilation:** references, revisions, bounds, or query intent are invalid;
- **admission:** authority or domain policy rejects the candidate;
- **reasoning:** the kernel or verifier returns an incorrect result; and
- **response:** the model contradicts or overstates the checked result.

The public [model-interface v1 benchmark](./model-evaluation.md) compares
bounded narrative memory, stateless full-context structured extraction, and
rolling Timeline state. Direct full-context answering remains a secondary
reference. The Timeline arm deliberately asks the model to author raw
v0alpha3 events, making ledger bookkeeping failures visible. Production
integrations should use the proposal compiler; results from the two boundaries
are not interchangeable.

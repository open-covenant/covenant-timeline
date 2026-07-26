# `@covenant-org/timeline`

Portable, proof-carrying temporal reasoning for AI systems.

An agent schedules a release after a security review. New evidence later shows
that the review finished after deployment. Timeline reconstructs what the agent
could conclude before and after the correction and verifies both conclusions
without rewriting history.

The `0.0.0-alpha.2` preview includes the Draft v0alpha3 temporal API,
deterministic checkpoint compatibility, and the Timeline CLI.

## Install

```sh
npm install --save-exact @covenant-org/timeline@0.0.0-alpha.2
npx timeline --version
```

The package supports Node.js 22 and 24.

Timeline is seeking an independent implementation of Draft RFC 0009. See
[issue #19](https://github.com/open-covenant/covenant-timeline/issues/19) for a
bounded starting point and conformance target.

## Temporal reasoning

The following sketch assumes `runInput` and `queryInput` are decoded v0alpha3
JSON documents:

```js
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

Draft v0alpha3 represents points, proper intervals, coordinates, constraints,
and facts on explicit discrete axes. Isolated contexts keep actual, planned,
forecast, and hypothetical state separate. Knowledge cuts reconstruct earlier
state across later correction, supersession, and retraction.

### How model output becomes checked state

Models extract temporal assertions and queries from source material. The host
validates their shape, authenticates the evidence, and applies authority policy.
Schema-valid model output can still omit or misstate the source; Timeline
reasons only over the records the host accepts.

The
[model interface](https://github.com/open-covenant/covenant-timeline/blob/main/docs/model-interface.md)
defines the extraction, admission, reasoning, verification, and response loop.

The reference kernel supports:

- context consistency;
- tight difference bounds;
- before, equal, and after point relations;
- all 13 Allen interval base relations; and
- schedules, bound paths, relation cases, and negative-cycle proofs.

The solver uses exact integer arithmetic internally. Explicit inputs, finite
results, and schedule witnesses must fit the JavaScript safe-integer range.
Resource limits bound events, graph size, proof size, and kernel operations.

## Checkpoint compatibility

```js
import {
  evaluateRunDocument,
  validateRunDocument,
} from "@covenant-org/timeline";

const issues = validateRunDocument(run);
if (issues.length > 0) throw new Error(JSON.stringify(issues));

const report = evaluateRunDocument(run);
console.log(report.verification);
```

| Surface            | Guarantee                                                                |
| ------------------ | ------------------------------------------------------------------------ |
| Contract and run   | Strict shape validation, ordered replay, and stable findings             |
| Checkpoint outcome | Deterministic requirement coverage from admitted evidence                |
| Commands           | Typed effect requests joined to receipts; no in-process dispatch         |
| Evidence authority | Supplied by the adopting system or an explicit authority profile         |
| Continuation       | Replay from the exact contract and event stream after a process boundary |

v0alpha1 records evaluator policy metadata. v0alpha2 adds contract-bound
authority profiles and policy digests.

Replay is pure. Commands are effect requests, and the package never executes an
adapter. `FileRunArchiveStore` persists the portable contract and event stream
with byte limits and concurrent-writer protection.

## CLI

```sh
npx timeline validate run.json
npx timeline replay run.json
npx timeline inspect run.json
npx timeline verify run.json
npx timeline reason temporal-run.json temporal-query.json
cat run.json | npx timeline verify -
npx timeline --version
```

Add `--json` for canonical JSON output. Input is strict JSON, duplicate keys are
rejected, and the CLI reads at most 16 MiB per file.

## Release status

| Surface  | Distribution | Status                         |
| -------- | ------------ | ------------------------------ |
| v0alpha3 | npm alpha    | Draft temporal implementation  |
| v0alpha2 | npm alpha    | Contract-bound policy identity |
| v0alpha1 | npm alpha    | Checkpoint compatibility       |

Alpha schemas and APIs may change between releases. v0alpha3 currently covers
discrete temporal constraints; it does not parse civil timestamps or named time
zones. Applications must map those values to integer axes under a pinned
calendar, time-zone database, and ambiguity policy. No shared normalization
profile ships yet. Recurrence, completeness-based absence queries, and a second
conforming implementation also remain open.

See the
[repository README](https://github.com/open-covenant/covenant-timeline#readme)
for conformance evidence, operating guidance, and the independent
implementation call.

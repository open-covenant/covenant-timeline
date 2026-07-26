# `@covenant-org/timeline`

Portable checkpoint verification for long-running software and agent work.

The npm alpha provides deterministic checkpoint contracts, validation, replay,
inspection, and CLI workflows. The repository also contains the Draft v0alpha3
temporal reasoning API.

## Install

```sh
npm install @covenant-org/timeline@0.0.0-alpha.1
```

The package supports Node.js 22 and 24.

## Checkpoint verification

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

Replay is pure. Commands in the report are effect requests; the package never
executes an adapter. This keeps verification separate from external effects.

### Verification boundary

| Surface            | Guarantee                                                                |
| ------------------ | ------------------------------------------------------------------------ |
| Contract and run   | Strict shape validation, ordered replay, and stable findings             |
| Checkpoint outcome | Deterministic requirement coverage from admitted evidence                |
| Commands           | Typed effect requests joined to receipts; no in-process dispatch         |
| Evidence authority | Supplied by the adopting system or an explicit authority profile         |
| Continuation       | Replay from the exact contract and event stream after a process boundary |

The published alpha verifies requirement coverage from admitted evidence; the
deploying application authenticates the evidence and policy. Repository
v0alpha2 adds contract-bound authority profiles and policy digests.

`FileRunArchiveStore` persists the contract and event stream atomically with
byte limits and concurrent-writer protection. `RunState` is an in-process
projection; restart recovery replays the portable archive.

## Temporal reasoning preview

Draft v0alpha3 models points, intervals, coordinates, constraints, and facts on
explicit discrete axes. Knowledge cuts reconstruct the assertions visible at
any record position, so later corrections, supersessions, and retractions do
not change earlier answers.

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

The reference kernel supports consistency, tight difference bounds, three point
relations, and all 13 Allen interval base relations. It returns canonical
semantic results with schedules, ordered proof paths, exhaustive relation
cases, or ordered negative cycles.

The solver uses exact integer arithmetic internally. Explicit inputs, finite
results, and schedule witnesses must fit the JavaScript safe-integer range; a
required unrepresentable result or exhaustive witness fails closed instead of
wrapping or silently excluding a possible relation.

Points are coordinate-free identities. Exact or bounded coordinates,
constraints, facts, and retractions are separate assertions carrying SHA-256
references to evidence bytes. Deployments provide evidence storage,
authentication, authority, and admission policy.

The current profile covers discrete temporal constraints. Civil-time
normalization, calendar arithmetic, recurrence, completeness-based absence
queries, and training-time model integration remain future work.

## CLI

```sh
timeline validate run.json
timeline replay run.json
timeline inspect run.json
timeline verify run.json
timeline reason temporal-run.json temporal-query.json
cat run.json | timeline verify -
timeline --version
```

Add `--json` for canonical JSON output. `verify` exits non-zero when checkpoints
are pending or rejected, commands are unresolved or failed, or findings exist.
`reason` returns a v0alpha3 temporal conclusion and proof receipt. Input is
strict JSON, duplicate keys are rejected, and the CLI reads at most 16 MiB per
file.

## Release channels

| Surface  | Distribution      | Status                         |
| -------- | ----------------- | ------------------------------ |
| v0alpha1 | npm package       | Published alpha                |
| v0alpha2 | repository source | Contract-bound policy identity |
| v0alpha3 | repository source | Draft temporal implementation  |

Alpha schemas and APIs may change between releases. See the
[repository README](https://github.com/open-covenant/covenant-timeline#readme)
for the current roadmap, assurance evidence, and adoption guidance.

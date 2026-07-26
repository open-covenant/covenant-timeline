# `@covenant-org/timeline`

Experimental temporal reasoning and deterministic checkpoint compatibility for
long-running software and agent work.

## Install a released version

```sh
npm install @covenant-org/timeline@next
```

The package supports Node.js 22 and 24.

The published `0.0.0-alpha.1` package contains the v0alpha1 checkpoint
verifier. v0alpha2 checkpoint policy binding and the temporal-first v0alpha3
implementation are currently source-only and are not part of that release.

## Library

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
executes an adapter.

`report.verification.scope` is `structural`. Evidence and effect authority are
external and must be verified by the adopter before production dispatch.
`policyRef` is an evaluator-supplied label in v0alpha1; the package records it
but does not resolve, authenticate, or compare it with the contract.
Machine output reports `evaluation: "requirement-coverage"`,
`policyAuthority: "external"`, and
`policyBinding: "unverified-event-label"`.

v0alpha2 checkpoints pin `profile`, `policyRef`, and `policyDigest`. Evaluation
events contain no policy override, evidence must carry the same binding, and
machine output reports `policyAuthority: "contract"` and
`policyBinding: "contract-digest"`. The GitHub profile exports a separate proof
verifier for evidence admission.

`RunState` is an in-process projection, not a portable continuation snapshot.
After a process boundary, replay the exact contract and complete event stream.
`FileRunArchiveStore` persists that portable source atomically without treating
projected state as a hydration format. It bounds archive bytes and fails closed
on concurrent writers; see the production operations guide for stale-lock
recovery.

## Experimental temporal source

v0alpha3 represents modeled time on explicit discrete axes. Event sequence is
only the record-time knowledge order.

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

The first kernel supports consistency, tight difference bounds, three point
relations, and all 13 Allen interval base relations. It returns canonical
semantic results with schedules, ordered proof paths, exhaustive relation
cases, or ordered negative cycles.

The solver uses exact integer arithmetic internally. Explicit inputs, finite
results, and schedule witnesses must fit the JavaScript safe-integer range; a
required unrepresentable result or exhaustive witness fails closed instead of
wrapping or silently excluding a possible relation.

Points are coordinate-free identities. Exact or bounded coordinates,
constraints, facts, and retractions are separate assertions carrying SHA-256
references to evidence bytes, so observations can be corrected at later
knowledge cuts without rewriting history. The host still authenticates those
bytes and their authority.

This is an experimental Draft-RFC surface. It does not authenticate
model-extracted assertions, provide civil-time or calendar semantics, infer
causality, or make temporal reasoning native to model weights.

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

The package is alpha software. Object schemas and APIs may change between alpha
releases.

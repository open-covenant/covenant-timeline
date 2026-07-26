# `@covenant-org/timeline`

Deterministic checkpoint-contract replay and verification for long-running
software and agent work.

## Install a released version

```sh
npm install @covenant-org/timeline@next
```

The package supports Node.js 22 and 24.

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

## CLI

```sh
timeline validate run.json
timeline replay run.json
timeline inspect run.json
timeline verify run.json
cat run.json | timeline verify -
timeline --version
```

Add `--json` for canonical JSON output. `verify` exits non-zero when checkpoints
are pending or rejected, commands are unresolved or failed, or findings exist.
Input is strict JSON, duplicate keys are rejected, and the CLI reads at most
16 MiB.

The package is alpha software. Object schemas and APIs may change between alpha
releases.

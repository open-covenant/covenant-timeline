# Getting started

Requirements:

- Node.js 22 or 24
- pnpm 10

Install and verify the repository:

```sh
pnpm install --frozen-lockfile
pnpm demo
```

The demo replays a complete software-release run, checks its receipt, and exits
successfully only when the run structurally verifies.

## Use the CLI

The repository includes successful, rejected, incomplete, corrected, and
malformed run fixtures:

```sh
pnpm timeline validate conformance/v0alpha1/runs/successful.json
pnpm timeline replay conformance/v0alpha1/runs/successful.json
pnpm timeline inspect conformance/v0alpha1/runs/corrected.json
pnpm timeline verify conformance/v0alpha1/runs/rejected.json
cat conformance/v0alpha1/runs/successful.json | pnpm timeline verify -
pnpm timeline --version
```

Human-readable output is the default. Add `--json` for canonical output with
the contract, event-stream, and replay-state SHA-256 identities.

## Embed the verifier

```js
import {
  evaluateRunDocument,
  validateRunDocument,
} from "@covenant-org/timeline";

const issues = validateRunDocument(run);
if (issues.length > 0) {
  console.error(issues);
  process.exit(1);
}

const report = evaluateRunDocument(run);
console.log(report.stateDigest, report.verification);
```

An adopter executes newly emitted commands outside Timeline and appends the
result as a later receipt event. Replaying the exported run never calls that
adapter. `verification.ok` establishes structural completeness only; evidence
authority, evaluator policy, and external effect truth remain adopter
responsibilities.

Core v0alpha1 records `policyRef` from a checkpoint-evaluation event. It does
not load that policy, verify its identity, or compare it with the contract.

Persist the contract and accepted event stream as the source of truth.
`RunState` contains private in-process binding metadata and cannot be spread,
serialized, or reconstructed for incremental continuation. After restart,
replay the exact contract and complete event stream.

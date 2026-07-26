# `@covenant-org/timeline`

Deterministic temporal-contract replay and verification for long-running
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

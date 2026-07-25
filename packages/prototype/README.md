# `@covenant-org/timeline`

Deterministic temporal-contract replay and verification for long-running
software and agent work.

## Install

```sh
npm install @covenant-org/timeline
```

The package requires Node.js 22 or later.

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

## CLI

```sh
timeline validate run.json
timeline replay run.json
timeline inspect run.json
timeline verify run.json
```

Add `--json` for canonical JSON output. `verify` exits non-zero when checkpoints
are pending or rejected, commands are unresolved or failed, or findings exist.

The package is pre-alpha. Object schemas and APIs may change between alpha
releases.

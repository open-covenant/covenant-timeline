# Core v0alpha1 conformance

The bootstrap corpus is stored in [`cases.json`](./cases.json). Each case names
the requirements it exercises, a target schema, the input document, optional
semantic checks, and the expected validity or stable error code.

Run:

```sh
pnpm conformance:check
```

The harness also replays successful, rejected, incomplete, corrected, and
malformed runs and pins their state digests. RFC 8785 fixtures are checked by
the TypeScript implementation during `pnpm conformance:check` and independently
by Python during `pnpm conformance:cross-check`.

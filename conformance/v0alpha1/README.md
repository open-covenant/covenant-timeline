# Core v0alpha1 conformance

The bootstrap corpus is stored in [`cases.json`](./cases.json). Each case names
the requirements it exercises, a target schema, the input document, optional
semantic checks, and the expected validity or stable error code.

Run:

```sh
pnpm conformance:check
```

This initial harness validates structural and selected cross-object semantics.
It is not yet the full byte-level compiler, reducer, replay, or cross-language
suite described by the program.

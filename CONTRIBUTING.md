# Contributing

## Before starting

Read the [charter](./CHARTER.md), [draft specification](./spec/v0alpha1/),
and [RFC process](./rfcs/README.md). Open an issue before implementing a
non-trivial protocol or architecture change.

## Development

Requirements:

- Node.js 22 or later;
- pnpm 10.31.

```sh
pnpm install --frozen-lockfile
pnpm verify
```

CI runs the same verification entrypoint. Keep one intent per pull request and
include exact validation results.

## Change requirements

- Public behavior and schema changes need a compatibility classification.
- Normative semantics, cryptography, scoring, effect boundaries, financial
  authority, schemas, plugin ABI, storage compatibility, releases, and
  governance require an RFC.
- Mechanically testable normative requirements need conformance cases.
- Failure paths, replay, duplicate delivery, and determinism require tests when
  applicable.
- Documentation and the changelog move with public behavior.

Do not include live credentials, market accounts, private evidence, personal
identifiers, secrets, or production financial operations in tests or fixtures.

Agent-assisted contributions are judged by their output. AI attribution,
tool-attribution trailers, and `Co-Authored-By` trailers are not required.
Signed-off commits are not required during bootstrap.

## Contribution terms

Unless stated otherwise, contributions are accepted under the Apache License
2.0 on an inbound-equals-outbound basis.

Security reports must use the private process in [SECURITY.md](./SECURITY.md).
Do not open public vulnerability issues.

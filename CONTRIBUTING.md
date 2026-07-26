# Contributing

## High-value contributions

Current priorities are:

- an independent implementation of
  [Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md);
- semantic and proof conformance cases;
- model-to-IR extraction evaluation and failure analysis;
- the [civil-time normalization profile](https://github.com/open-covenant/covenant-timeline/issues/20);
  and
- real long-running-agent pilots with late evidence, corrections, and restarts.

The
[second-implementation issue](https://github.com/open-covenant/covenant-timeline/issues/19)
defines the smallest useful interoperability contribution.

Open an issue before a non-trivial protocol or architecture change. The
[charter](./CHARTER.md) and [RFC process](./rfcs/README.md) apply when a change
affects normative semantics, compatibility, security, or governance.

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
- Normative semantics, cryptography, effect boundaries, and changes to schemas,
  compatibility policy, release policy, or governance require an RFC.
- Mechanically testable normative requirements need conformance cases.
- Failure paths, replay, duplicate delivery, and determinism require tests when
  applicable.
- Documentation and the changelog move with public behavior.

Do not include live credentials, private evidence, personal identifiers, or
secrets in tests or fixtures.

Contributions are judged by their output. Commit messages must not include AI
tool attribution or `Co-Authored-By` trailers. Signed-off commits are not
required during bootstrap.

## Contribution terms

Unless stated otherwise, contributions are accepted under the Apache License
2.0 on an inbound-equals-outbound basis.

Security reports must use the private process in [SECURITY.md](./SECURITY.md).
Do not open public vulnerability issues.

# Contributing

## High-value contributions

Current priorities are:

- adapter validation runs and failure cases for the public
  [model-interface v1 smoke benchmark](./benchmarks/model-interface/v1/README.md),
  plus independent review of the blinded scale protocol in the
  [roadmap](./ROADMAP.md);
- one externally operated
  [long-running-agent pilot](./docs/temporal-pilot.md); and
- an independent implementation of
  [Draft RFC 0009](./rfcs/0009-temporal-reasoning-substrate.md).

The
[second-implementation issue](https://github.com/open-covenant/covenant-timeline/issues/19)
defines the smallest useful interoperability contribution. The project is
actively seeking a maintainer outside the TypeScript reference codebase to own
it.

Open an issue before a non-trivial protocol or architecture change. The
[charter](./CHARTER.md) and [RFC process](./rfcs/README.md) apply when a change
affects normative semantics, compatibility, security, or governance.

## Model-interface benchmark

The checked-in v1 suite is a public development and smoke benchmark with no
published model result. Its cases, prompts, adapters, scorers, and result
submissions are non-normative evaluation artifacts. They use ordinary
pull-request review and do not require an RFC unless they also change protocol
semantics, schemas, compatibility, or a security boundary.

A benchmark contribution must:

- pin the model, configuration, prompts, Timeline package or commit, and input
  corpus;
- preserve raw parse and admission failures;
- report paired results by task family rather than only an aggregate;
- separate extraction, query, solver, and final-answer errors; and
- include the command needed to reproduce scoring.

Do not tune cases against unpublished result sets or present a smoke run as
evidence of a general gain.

## Development

Requirements:

- Node.js 22 or 24;
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

Contributions are judged by their output. Commit messages must not contain
generated-by attribution or `Co-Authored-By` trailers. Signed-off commits are
not required during bootstrap.

## Contribution terms

Unless stated otherwise, contributions are accepted under the Apache License
2.0 on an inbound-equals-outbound basis.

Security reports must use the private process in [SECURITY.md](./SECURITY.md).
Do not open public vulnerability issues.

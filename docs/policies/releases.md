# Release Policy

## Channels

- `0.0.x`: bootstrap snapshots without compatibility promises;
- `0.y.z-alpha.N`, `beta.N`, and `rc.N`: public previews with stated maturity;
- `1.0.0`: adoption-gated by [PROGRAM.md](../../PROGRAM.md), not calendar-gated.

Components are independently versioned and bound by one release manifest. The
manifest records the source commit, component versions, specification, schemas,
conformance suite, artifacts, checksums, SBOMs, build workflow, compatibility
matrix, known issues, and migrations.

Releases are built from protected tags pointing to `main`. A stable release
requires:

- a clean tree and all required checks;
- package dry runs and artifact inspection;
- reproducibility comparison;
- two distinct approvals;
- rollback or yank instructions;
- no unresolved critical security finding;
- signed checksums, SPDX SBOMs, and provenance attestations.

Single-maintainer bootstrap may publish `0.0.x` previews but cannot publish a
stable release. Published tags and artifacts are not overwritten. Registry
authentication must be short-lived: OIDC trusted publishing is preferred, and
a protected-environment token is an allowed fallback.

Release provenance links source and build. It is not a security endorsement.

The package workflow uses tags named `timeline-v<package-version>`, builds the
tarball twice, compares the exact bytes, generates a SHA-256 checksum and SPDX
SBOM, creates GitHub artifact attestations, and publishes from the protected
`npm` environment. [npm uses a configured OIDC trusted publisher before
falling back to a token](https://docs.npmjs.com/trusted-publishers/).

The bootstrap `0.0.0-alpha.1` package established ownership of the
`@covenant-org` release path with a one-time token. That token and its GitHub
environment secret were removed after the release. Before any later publish,
administrators must verify:

- trusted publisher linkage to `open-covenant/covenant-timeline`,
  `release.yml`, and the `npm` environment, or a short-lived granular
  `NPM_TOKEN`;
- required reviewers on the `npm` environment;
- tag protection for `timeline-v*`;
- token fallback, when used, is limited to `@covenant-org/timeline`, permits
  publish with 2FA bypass, has the shortest practical expiration, exists only
  in the protected environment, and is revoked after the run.

Workflow presence is not evidence that these external controls are configured.
Trusted publishing remains the preferred end state, not a prerequisite for a
release.

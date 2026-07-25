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
stable release. Published tags and artifacts are not overwritten. Registries
use short-lived trusted publishing rather than long-lived tokens.

Release provenance links source and build. It is not a security endorsement.

The package workflow uses tags named `timeline-v<package-version>`, builds the
tarball twice, compares the exact bytes, generates a SHA-256 checksum and SPDX
SBOM, creates GitHub artifact attestations, and publishes through npm trusted
publishing from the approval-protected `npm` environment.

Before the first publish, administrators must verify:

- ownership of the `@covenant-org` npm scope;
- trusted publisher linkage to `open-covenant/covenant-timeline`,
  `release.yml`, and the `npm` environment;
- required reviewers on the `npm` environment;
- tag protection for `timeline-v*`;
- traditional npm automation tokens are disabled after OIDC succeeds.

Workflow presence is not evidence that these external controls are configured.

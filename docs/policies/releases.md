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

The commit receiving a release tag must also update the repository README and
getting-started guide to the package version that tag publishes. Candidate
wording remains accurate before publication, but it must not be frozen into an
immutable release tag. The core and MCP release checks enforce this transition
independently so the core can publish before the MCP package it unlocks.

Single-maintainer bootstrap may publish `0.0.x` previews but cannot publish a
stable release. Published tags and artifacts are not overwritten. Registry
authentication must be short-lived. Alpha releases may use a
protected-environment token fallback; beta and stable releases require OIDC
trusted publishing.

Release provenance links source and build. It is not a security endorsement.

The package workflow uses tags named `timeline-v<package-version>`, builds the
tarball twice, compares the exact bytes, generates a SHA-256 checksum and SPDX
SBOM, creates GitHub artifact attestations, and publishes from the protected
`npm` environment. The workflow can use
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) when it is
configured or a short-lived token fallback when it is not.

The MCP integration is independently versioned as
`@covenant-org/timeline-mcp` and uses
`timeline-mcp-v<mcp-package-version>` tags. Its release workflow applies the
same reproducible-build, checksum, SPDX SBOM, attestation, provenance,
protected-environment, and authentication requirements. It also runs an
installed-package stdio smoke that crosses a process restart and independently
verifies correction receipts before publication.

The `0.0.0-alpha.2` publish used a short-lived granular token fallback because
trusted publisher linkage was not configured. The workflow produced npm
provenance and GitHub build and SBOM attestations. After the run, the GitHub
environment secret was removed, the token was revoked, and an authentication
check confirmed it no longer works.

The
[alpha.2 release record](../../releases/timeline-v0.0.0-alpha.2.json) binds the
annotated source tag, component manifests, specifications, schemas, conformance
paths, migration, workflow attempt, registry metadata, release assets, SBOM,
and attestation subjects. `pnpm release:evidence:check` validates that record
against the local Git history without network access.
`pnpm release:verify-published -- releases/timeline-v0.0.0-alpha.2.json`
separately checks the current npm and GitHub state, downloads and hashes both
tarballs and every release asset, verifies the current remote annotated tag,
cryptographically verifies npm provenance and the recorded GitHub build and
SBOM bundles, requires the attested SBOM to equal the downloaded document, and
runs npm signature checks plus a clean installed-package smoke test. It requires
GitHub CLI 2.88 or newer; recorded public bundles are verified without ambient
GitHub authentication. A valid record alone is not proof that remote bytes were
fetched.

Credential cleanup fields in the record are operator observations, not public
registry proof. Their timestamp and observation methods are explicit. The
public-state verifier reports that boundary and does not claim to recheck a
revoked credential.

GitHub Actions artifacts have finite retention. The verifier checks their
recorded workflow association when metadata remains available, but durable
historical verification uses the GitHub release assets, recorded bundle hashes,
registry bytes, and attestations rather than requiring the transient Actions
archive to remain downloadable.

Before each publish, administrators must verify:

- trusted publisher linkage to `open-covenant/covenant-timeline`,
  `release.yml`, and the `npm` environment, or a short-lived granular
  `NPM_TOKEN`;
- tag protection for the component pattern (`timeline-v*` for the core package
  or `timeline-mcp-v*` for the MCP package);
- token fallback, when used, is limited to `@covenant-org/timeline`, permits
  publish with 2FA bypass, has the shortest practical expiration, exists only
  in the protected environment, and is revoked after the run.

For an MCP release, the token scope is
`@covenant-org/timeline-mcp` instead.

Workflow presence is not evidence that these external controls are configured.
Trusted publishing and a required `npm` environment reviewer remain
unconfigured. They are required hardening before beta or stable, not
prerequisites for an alpha release.

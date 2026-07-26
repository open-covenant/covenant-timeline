# GitHub software-delivery authority profile v1

Profile identifier: `github.software-delivery.v1`

This profile turns a normalized GitHub pull-request snapshot into v0alpha2
evidence. A policy pins:

- repository and GitHub REST API version;
- authorized Ed25519 collector keys;
- maximum proof age and clock skew;
- exact required check names;
- minimum approvals and final GitHub review decision;
- required deployment environments;
- the revocation-list digest.

A conforming collector fetches the pull request, current head checks, reviews,
merge identity, and any policy-required deployments over GitHub's versioned
API. It deduplicates approvals by GitHub's stable reviewer ID before removing
actor identity and free-form text, canonicalizing the remaining payload, and
signing the envelope. The public-run collector requires no deployment
environment and therefore records an empty deployment set.

Verification checks the policy digest, revocation snapshot, payload digest,
signature, freshness, source timestamp ordering, repository, head SHA, check
conclusions, final review decision, merge identity, and deployments. Claims are
derived only after these checks.

The profile supports GitHub webhook HMAC verification as an ingestion option.
API snapshots are assertions by the pinned collector key; GitHub does not sign
REST responses. Consumers must decide whether that collector is an acceptable
authority.

GitHub artifact attestations should be added as a separate artifact-provenance
claim when release bytes exist. Listing an attestation is insufficient; its
signature, timestamp, and signer identity must be verified.

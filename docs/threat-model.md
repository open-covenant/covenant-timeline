# Threat Model

## Security Objective

Covenant Timeline must deterministically validate and replay a bounded portable
run without executing effects, changing pinned policy, or implying authority
that was not independently established.

## Assets

- Contract, event, state, and report integrity.
- Exact binding between a run and its contract.
- Command uniqueness and idempotency keys.
- Evidence payload and effect digests.
- Historical verification under pinned semantics.
- Package artifacts, checksums, SBOM, and provenance.

## Trust Boundaries

```text
untrusted JSON ──► strict parser ──► validator ──► pure reducer
                                                        │
verified structure ◄──────── report ◄───────────────────┘
                                                        │ command request
                                                        ▼
                                             adopter authorization
                                                        │
                                                        ▼
                                                external effector
```

The parser, validators, and reducer are part of this repository. Evidence
retrieval, signature and freshness policy, command authorization, external
execution, durable storage, and receipt verification belong to the adopter.

## Attacker Capabilities

Assume an attacker can:

- provide arbitrary files and JavaScript values;
- choose valid-looking identifiers, claims, digests, and producer names;
- duplicate keys, events, evidence, evaluations, and receipts;
- reorder, omit, truncate, or enlarge event streams;
- reuse a contract ID with different bytes;
- replay old evidence or self-assert claims;
- crash or delay an external effect after a command is dispatched;
- observe reports and operational logs available to the adopter;
- compromise a dependency or release credential.

The core does not defend against an attacker who can modify the installed
package and its verified provenance together, control the adopter's authority
policy, or compromise the host process.

## Abuse Paths and Mitigations

| Abuse path                       | Mitigation                                                      | Residual responsibility                                                       |
| -------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Same-ID contract substitution    | State pins canonical contract digest                            | Host persists the original contract bytes                                     |
| Duplicate effect eligibility     | Accepted checkpoint is final in one run                         | Host dispatches only newly emitted commands                                   |
| Replay executes an effect        | Core has no adapter or network entrypoint                       | Host separates replay from dispatch                                           |
| Duplicate or ambiguous JSON keys | Strict parser rejects duplicates, comments, and trailing commas | Non-CLI hosts use `parseJson` or equivalent                                   |
| Oversized input or deep values   | CLI byte limit and canonical depth/node limits                  | Host sets tighter deployment limits when needed                               |
| Prototype-name identifiers       | Own-property membership checks                                  | None                                                                          |
| Forged evidence claims           | Verification scope says authority is external                   | Profile verifies payload digest, signature, freshness, and producer authority |
| Forged effect receipt            | Receipt is only a structural declaration                        | Adapter verifies the external system result                                   |
| Sensitive identifiers in logs    | Core performs no implicit logging                               | Host uses low-cardinality codes and redacts IDs                               |
| Compromised registry token       | Trusted publishing uses short-lived OIDC                        | npm scope, environment, and tag protection must be configured                 |
| Artifact replacement             | Reproducible tarball, checksum, SBOM, GitHub and npm provenance | Consumer verifies provenance and pins versions                                |

## Privacy

Portable runs intentionally exclude evidence payload bytes, but subject,
producer, policy, claim, and evidence identifiers can still reveal sensitive
relationships. Public artifacts must use neutral or synthetic identifiers.
Hosts should encrypt run archives at rest, limit access by tenant, and avoid
putting identifiers into metric labels.

Deletion of a payload does not remove its digest or metadata from an append-only
run. Adopters must define retention and erasure behavior before using Timeline
with regulated or personal data.

## Required Adopter Controls

Before any command can affect production, the adopter must:

1. authenticate the event writer;
2. pin exact contract, schema, package, profile, and policy versions;
3. verify evidence payload bytes against `payloadDigest`;
4. verify producer signature, authority, freshness, revocation, and scope;
5. authorize the command independently of structural checkpoint acceptance;
6. persist the command idempotency key before dispatch;
7. verify the returned effect and receipt digest;
8. append the receipt atomically or reconcile an indeterminate dispatch;
9. record privacy-safe metrics and retain the portable event stream.

## Out of Scope

- Universal evidence authority.
- Key discovery or revocation.
- Confidential payload storage.
- Distributed consensus.
- Exactly-once effects across external systems.
- Recovery from a fully compromised host.

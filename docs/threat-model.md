# Threat Model

## Security Objective

Covenant Timeline must deterministically validate and replay a bounded portable
run, and reason over admitted temporal constraints, without executing effects
or implying policy, evidence, domain truth, or causality that was not
independently established.

## Assets

- Contract, event, state, and report integrity.
- Exact binding between a run and its contract.
- Accurate representation of v0alpha1 labels and v0alpha2 policy bindings.
- Command uniqueness and idempotency keys.
- Evidence payload and effect digests.
- Historical verification under pinned semantics.
- Temporal axis, context, knowledge-cut, query, result, and proof integrity.
- Isolation between actual, planned, forecast, and hypothetical contexts.
- Package artifacts, checksums, SBOM, and provenance.

## Trust Boundaries

```text
untrusted JSON ──► strict parser ──► validator ──► projector / reasoner
                                                        │
checked result + proof ◄────────────────────────────────┘

legacy checkpoint event ──► pure reducer ──► command request
                                                   │
                                                   ▼
                                        adopter authorization
                                                   │
                                                   ▼
                                           external effector

local MCP client ──► stdio tool schema ──► canonical run store ──► core
```

The parser, validators, and reducer are part of this repository. Evidence
retrieval, signature and freshness policy, command authorization, external
execution, and receipt verification belong to the adopter. Durable storage
also belongs to the adopter unless it explicitly selects the local MCP
reference store.

## Attacker Capabilities

Assume an attacker can:

- provide arbitrary files and JavaScript values;
- choose valid-looking identifiers, claims, digests, and producer names;
- duplicate keys, events, evidence, evaluations, and receipts;
- reorder, omit, truncate, or enlarge event streams;
- inject unsafe coordinates, contradictory constraints, false contexts, stale
  observations, and malicious proof receipts;
- construct dense graphs, long revision chains, or relation queries intended to
  exhaust memory, arithmetic, or operation budgets;
- call every locally configured MCP tool, submit false but structurally valid
  records, retry writes, race writers, or crash the MCP process;
- read, replace, truncate, or rename files when the attacker already has access
  to the MCP data directory;
- reuse a contract ID with different bytes;
- replay old evidence or self-assert claims;
- crash or delay an external effect after a command is dispatched;
- observe reports and operational logs available to the adopter;
- compromise a dependency or release credential.

The core does not defend against an attacker who can modify the installed
package and its verified provenance together, control the adopter's authority
policy, or compromise the host process.

## Abuse Paths and Mitigations

| Abuse path                        | Mitigation                                                                | Residual responsibility                                                                        |
| --------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Same-ID contract substitution     | State pins canonical contract digest                                      | Host persists the original contract bytes                                                      |
| Misleading policy label           | v0alpha2 pins profile and policy digest in contract bytes                 | Profile resolves and authenticates actual policy bytes                                         |
| Duplicate effect eligibility      | Accepted checkpoint is final in one run                                   | Host dispatches only newly emitted commands                                                    |
| Replay executes an effect         | Core has no adapter or network entrypoint                                 | Host separates replay from dispatch                                                            |
| Duplicate or ambiguous JSON keys  | Strict parser rejects duplicates, comments, and trailing commas           | Non-CLI hosts use `parseJson` or equivalent                                                    |
| Oversized input or deep values    | CLI and MCP message limits plus canonical depth/node limits               | Host sets tighter deployment limits when needed                                                |
| Prototype-name identifiers        | Own-property membership checks                                            | None                                                                                           |
| Forged evidence claims            | Profile proof digest and contract policy binding                          | Profile verifies payload digest, signature, freshness, and producer authority                  |
| Forged effect receipt             | Receipt is only a structural declaration                                  | Adapter verifies the external system result                                                    |
| Temporal proof substitution       | Receipt binds state, query, result, and reasoner digests                  | Consumer verifies the supplied certificate before use                                          |
| Scenario confusion                | Contexts are isolated in projection and query evaluation                  | Host labels and admits model-extracted contexts correctly                                      |
| Hindsight leakage                 | Every query pins an explicit event-prefix knowledge cut                   | Host does not add later source content to an earlier extraction                                |
| Chronology presented as causality | Core exposes temporal relations only                                      | Model and domain policy do not infer causal authority from order                               |
| Constraint-graph exhaustion       | Node, edge, event, proof, and operation limits fail closed                | Host sets lower tenant-specific byte and compute limits                                        |
| Integer precision loss            | Coordinates, bounds, and closure arithmetic require safe integers         | Profiles normalize external clocks without floating-point coercion                             |
| False temporal assertions         | Assertions retain evidence content digests; generic core claims no truth  | Host retains bytes, checks digests, authenticates sources, and preserves extraction provenance |
| Untrusted model writes            | MCP labels direct writes as structural-only and unauthenticated           | Host authenticates sources and controls which client may use the server                        |
| Concurrent or repeated appends    | Whole-run CAS, exclusive locks, complete-run validation, idempotent IDs   | Client reloads after conflict and never changes content under an event ID                      |
| Crash during MCP persistence      | Synced temporary file and same-directory atomic replacement               | Client reloads after an indeterminate result; operator resolves stale locks                    |
| MCP store tampering               | Canonical envelope, run identity, revision, and digest fail closed        | Protect, back up, and monitor the data directory                                               |
| Run-ID path traversal             | Store filenames are SHA-256 identities, not caller-controlled paths       | Use a dedicated local filesystem directory                                                     |
| Accidental remote MCP exposure    | Packaged server exposes stdio only                                        | Do not wrap it in a network transport without authentication and tenant isolation              |
| Sensitive identifiers in logs     | Core performs no implicit logging                                         | Host uses low-cardinality codes and redacts IDs                                                |
| Compromised registry token        | Scoped short-lived fallback, protected environment, post-run revocation   | OIDC trusted publisher and required environment reviewer remain unconfigured                   |
| Artifact replacement              | Reproducible tarball, checksum, SBOM, npm provenance, GitHub attestations | Consumer verifies provenance and pins versions                                                 |

Alpha releases may use the documented short-lived token fallback with
post-release secret removal, token revocation, and failed reauthentication.
Beta and stable releases require trusted publishing and environment review.
Release verification covers npm provenance and GitHub build and SBOM
attestations separately. The public-state verifier delegates Sigstore
certificate-chain, identity, signature, and transparency-log verification to
GitHub CLI 2.88 or newer. It delegates npm registry-signature and publish
attestation verification to `npm audit signatures`, then independently binds
the decoded statements to the recorded package bytes, source, tag, workflow,
and invocation. Those tools and their trust roots are part of the verifier's
trusted computing base.

## Privacy

Portable runs intentionally exclude evidence payload bytes, but subject,
producer, policy, claim, and evidence identifiers can still reveal sensitive
relationships. Public artifacts must use neutral or synthetic identifiers.
Hosts should encrypt run archives at rest, limit access by tenant, and avoid
putting identifiers into metric labels.

Temporal coordinates, intervals, observation histories, scenarios, and
corrections can reveal schedules, behavior, research activity, or health
information even when proposition payloads are opaque. Hosts must minimize
granularity and retention as well as redact names.

Deletion of a payload does not remove its digest or metadata from an append-only
run. Adopters must define retention and erasure behavior before using Timeline
with regulated or personal data.

The MCP store writes run metadata and temporal coordinates as plaintext. Its
owner-only POSIX modes are not encryption, and Windows mode flags are not ACLs.
Use a private directory, operating-system access controls, and storage
encryption appropriate to the data classification.

## Required Adopter Controls

Before any command can affect production, the adopter must:

1. authenticate the event writer;
2. pin exact contract, schema, package, profile, and policy bytes or digests;
3. verify evidence payload bytes against `payloadDigest`;
4. verify producer signature, authority, freshness, revocation, and scope;
5. authorize the command independently of structural checkpoint acceptance;
6. persist the command idempotency key before dispatch;
7. verify the returned effect and receipt digest;
8. append the receipt atomically or reconcile an indeterminate dispatch;
9. record privacy-safe metrics and retain the portable event stream.

Before a temporal conclusion can affect a production decision, the adopter must
also:

1. authenticate or explicitly classify every admitted temporal assertion;
2. retain its evidence or extraction provenance;
3. pin context, axis, origin, unit, and knowledge cut;
4. validate the conclusion digests and proof receipt;
5. reject unsupported, excessive, inconsistent, or indeterminate inputs rather
   than inventing a definite answer; and
6. apply independent domain policy before a temporal result grants authority.

When using the MCP server, the adopter must also:

1. grant tool access only to the intended local client;
2. place the data directory on a dedicated local filesystem with private
   permissions or ACLs;
3. treat direct writes as unverified proposals until an external admission
   policy authenticates their provenance;
4. preserve the current run digest for optimistic concurrency;
5. reload after conflict or indeterminate errors; and
6. verify that no writer is active before manually removing a stale lock.

## Out of Scope

- Universal evidence authority.
- Key discovery or revocation.
- Confidential payload storage.
- Remote or multi-tenant MCP service operation.
- Distributed consensus.
- Exactly-once effects across external systems.
- Recovery from a fully compromised host.

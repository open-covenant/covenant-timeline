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
- inject unsafe coordinates, contradictory constraints, false contexts, stale
  observations, and malicious proof receipts;
- construct dense graphs, long revision chains, or relation queries intended to
  exhaust memory, arithmetic, or operation budgets;
- reuse a contract ID with different bytes;
- replay old evidence or self-assert claims;
- crash or delay an external effect after a command is dispatched;
- observe reports and operational logs available to the adopter;
- compromise a dependency or release credential.

The core does not defend against an attacker who can modify the installed
package and its verified provenance together, control the adopter's authority
policy, or compromise the host process.

## Abuse Paths and Mitigations

| Abuse path                        | Mitigation                                                               | Residual responsibility                                                                        |
| --------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Same-ID contract substitution     | State pins canonical contract digest                                     | Host persists the original contract bytes                                                      |
| Misleading policy label           | v0alpha2 pins profile and policy digest in contract bytes                | Profile resolves and authenticates actual policy bytes                                         |
| Duplicate effect eligibility      | Accepted checkpoint is final in one run                                  | Host dispatches only newly emitted commands                                                    |
| Replay executes an effect         | Core has no adapter or network entrypoint                                | Host separates replay from dispatch                                                            |
| Duplicate or ambiguous JSON keys  | Strict parser rejects duplicates, comments, and trailing commas          | Non-CLI hosts use `parseJson` or equivalent                                                    |
| Oversized input or deep values    | CLI byte limit and canonical depth/node limits                           | Host sets tighter deployment limits when needed                                                |
| Prototype-name identifiers        | Own-property membership checks                                           | None                                                                                           |
| Forged evidence claims            | Profile proof digest and contract policy binding                         | Profile verifies payload digest, signature, freshness, and producer authority                  |
| Forged effect receipt             | Receipt is only a structural declaration                                 | Adapter verifies the external system result                                                    |
| Temporal proof substitution       | Receipt binds state, query, result, and reasoner digests                 | Consumer verifies the supplied certificate before use                                          |
| Scenario confusion                | Contexts are isolated in projection and query evaluation                 | Host labels and admits model-extracted contexts correctly                                      |
| Hindsight leakage                 | Every query pins an explicit event-prefix knowledge cut                  | Host does not add later source content to an earlier extraction                                |
| Chronology presented as causality | Core exposes temporal relations only                                     | Model and domain policy do not infer causal authority from order                               |
| Constraint-graph exhaustion       | Node, edge, event, proof, and operation limits fail closed               | Host sets lower tenant-specific byte and compute limits                                        |
| Integer precision loss            | Coordinates, bounds, and closure arithmetic require safe integers        | Profiles normalize external clocks without floating-point coercion                             |
| False temporal assertions         | Assertions retain evidence content digests; generic core claims no truth | Host retains bytes, checks digests, authenticates sources, and preserves extraction provenance |
| Sensitive identifiers in logs     | Core performs no implicit logging                                        | Host uses low-cardinality codes and redacts IDs                                                |
| Compromised registry token        | Trusted publishing uses short-lived OIDC                                 | npm scope, environment, and tag protection must be configured                                  |
| Artifact replacement              | Reproducible tarball, checksum, SBOM, GitHub and npm provenance          | Consumer verifies provenance and pins versions                                                 |

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

## Out of Scope

- Universal evidence authority.
- Key discovery or revocation.
- Confidential payload storage.
- Distributed consensus.
- Exactly-once effects across external systems.
- Recovery from a fully compromised host.

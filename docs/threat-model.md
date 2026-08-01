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
- MCP admission writer provenance and last-persistence metadata.

## Trust Boundaries

```text
untrusted JSON ──► strict parser ──► validator ──► projector / reasoner
                                                        │
checked result + proof ◄────────────────────────────────┘

caller catalogs ──► request-scoped output schema ──► model proposal
       │                                                │
       └────────────────► proposal compiler ◄────────────┘
                                   │
                 transient evidence text + exact quotes
                                   │
                                   ▼
                     candidate + preview conclusion
                                   │
                         operator admission policy
                                   │
                                   ▼
                    events + bound admission record

legacy checkpoint event ──► pure reducer ──► command request
                                                   │
                                                   ▼
                                        adopter authorization
                                                   │
                                                   ▼
                                           external effector

model MCP client ──► read/preview tools ──► core
operator process ──► admitted write tools ──► canonical run + audit store
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
- supply false catalog mappings, ambiguous or unsupported quotes, stale
  evidence, oversized source text, and cross-request model responses;
- construct dense graphs, long revision chains, or relation queries intended to
  exhaust memory, arithmetic, or operation budgets;
- call every tool exposed to its local MCP role, submit false but structurally
  valid records if it reaches an operator process, retry writes, race writers,
  or crash the MCP process;
- relabel an admission writer or envelope `lastWriter` when it can replace
  store bytes;
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

| Abuse path                        | Mitigation                                                                                                                                                                                                                              | Residual responsibility                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Same-ID contract substitution     | State pins canonical contract digest                                                                                                                                                                                                    | Host persists the original contract bytes                                                                                                  |
| Misleading policy label           | v0alpha2 pins profile and policy digest in contract bytes                                                                                                                                                                               | Profile resolves and authenticates actual policy bytes                                                                                     |
| Duplicate effect eligibility      | Accepted checkpoint is final in one run                                                                                                                                                                                                 | Host dispatches only newly emitted commands                                                                                                |
| Replay executes an effect         | Core has no adapter or network entrypoint                                                                                                                                                                                               | Host separates replay from dispatch                                                                                                        |
| Duplicate or ambiguous JSON keys  | Strict parser stops at the first duplicate or syntax error                                                                                                                                                                              | Non-CLI hosts use `parseJson` or equivalent                                                                                                |
| Oversized input or deep values    | CLI and MCP message limits plus canonical depth/node limits                                                                                                                                                                             | Host sets tighter deployment limits when needed                                                                                            |
| Prototype-name identifiers        | Own-property membership checks                                                                                                                                                                                                          | None                                                                                                                                       |
| Forged evidence claims            | Profile proof digest and contract policy binding                                                                                                                                                                                        | Profile verifies payload digest, signature, freshness, and producer authority                                                              |
| Forged effect receipt             | Receipt is only a structural declaration                                                                                                                                                                                                | Adapter verifies the external system result                                                                                                |
| Temporal proof substitution       | Receipt binds state, query, result, and reasoner digests                                                                                                                                                                                | Consumer verifies the supplied certificate before use                                                                                      |
| Scenario confusion                | Contexts are isolated in projection and query evaluation                                                                                                                                                                                | Host labels and admits model-extracted contexts correctly                                                                                  |
| Hindsight leakage                 | Every query pins an explicit event-prefix knowledge cut                                                                                                                                                                                 | Host does not add later source content to an earlier extraction                                                                            |
| Chronology presented as causality | Core exposes temporal relations only                                                                                                                                                                                                    | Model and domain policy do not infer causal authority from order                                                                           |
| Constraint-graph exhaustion       | Node, edge, event, proof, and operation limits fail closed                                                                                                                                                                              | Host sets lower tenant-specific byte and compute limits                                                                                    |
| Integer precision loss            | Coordinates, bounds, and closure arithmetic require safe integers                                                                                                                                                                       | Profiles normalize external clocks without floating-point coercion                                                                         |
| False temporal assertions         | Assertions retain evidence content digests; generic core claims no truth                                                                                                                                                                | Host retains bytes, checks digests, authenticates sources, and preserves extraction provenance                                             |
| Untrusted model writes            | Default model role has no mutation tools; preview compiles and verifies without persistence; operator admission requires an exact candidate digest and policy identity                                                                  | Host isolates the operator process, authenticates sources, checks entailment, and owns admission policy                                    |
| Provider schema bypass            | Request-scoped schema pins correlation and exposed handles; compiler independently revalidates the untrusted response                                                                                                                   | Adapter records refusal or malformed output and never silently falls back to free-form text                                                |
| Provider grammar exhaustion       | The schema generator caps changes, supports, host size, emitted enum values and characters, and encoded bytes; the benchmark binds its exact output                                                                                     | Direct adapter callers use the generator; hosts narrow catalogs or divide work across requests                                             |
| Sensitive model handles           | Projection does not derive mapped ledger IDs or include evidence contents                                                                                                                                                               | Host issues opaque, least-privilege handles and evidence IDs for each request                                                              |
| Candidate artifact substitution   | Candidate verifier recompiles against the proposal, base run, and host catalogs; the operator server seals the recomputed candidate, digests, events, and exact prefix behind a non-exported runtime permit before file-store admission | Consumer retains the preview, digest, proposal, and host inputs; the permit is an in-package integrity control, not process authentication |
| Proposal source-text disclosure   | Compiler candidates and MCP outputs contain digests and byte spans, not source text or quotes                                                                                                                                           | Client, transport, and host logs must protect the tool input and external evidence store                                                   |
| Catalog scan amplification        | MCP discovery reads at most eight run files; cursors bind a catalog generation                                                                                                                                                          | Programmatic store callers restart pagination when a catalog change invalidates the cursor                                                 |
| Concurrent or repeated appends    | Whole-run CAS, prefix-bound revision and digest checks, exact admission identity, exclusive locks, atomic event-plus-admission writes, and idempotent IDs                                                                               | Client reloads after conflict and never changes content or policy under an event ID                                                        |
| Crash during MCP persistence      | Synced temporary file and same-directory atomic replacement                                                                                                                                                                             | Client reloads after an indeterminate result; operator resolves stale locks                                                                |
| Admission writer relabeling       | Each record digest covers its writer; later writes preserve earlier records; `lastWriter` is scoped to the latest persistence and must match the final admission writer                                                                 | Pin the complete audit digest and verify package provenance; writer identities are not signatures                                          |
| MCP store tampering               | Store rejects special files and requires canonical envelope identity, run digest, complete admission coverage, digest-bound admission writers, and valid record digests                                                                 | Protect, back up, monitor, and independently pin the complete audit digest                                                                 |
| Run-ID path traversal             | Store filenames are SHA-256 identities, not caller-controlled paths                                                                                                                                                                     | Use a dedicated local filesystem directory                                                                                                 |
| Accidental remote MCP exposure    | Packaged server exposes stdio only                                                                                                                                                                                                      | Do not wrap it in a network transport without authentication and tenant isolation                                                          |
| Sensitive identifiers in logs     | Core performs no implicit logging                                                                                                                                                                                                       | Host uses low-cardinality codes and redacts IDs                                                                                            |
| Compromised registry token        | Scoped short-lived fallback, protected environment, post-run revocation                                                                                                                                                                 | OIDC trusted publisher and required environment reviewer remain unconfigured                                                               |
| Artifact replacement              | Reproducible tarball, checksum, SBOM, npm provenance, GitHub attestations                                                                                                                                                               | Consumer verifies provenance and pins versions                                                                                             |

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

Evidence and quote digests are identifiers, not encryption. Low-entropy quotes
and evidence can be dictionary-tested; treat `evidenceRef`, `quoteDigest`, and
byte spans as sensitive metadata even when source text is absent.

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

The model-proposal preview and admission tools receive evidence text and exact
quotes through the MCP request even though they do not store or return them.
MCP clients, process supervisors, terminal capture, and transport wrappers may
log request bodies. Disable body logging or redact these fields before using
sensitive evidence.

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

1. expose the default model role to agents and isolate the explicit operator
   role behind a host-controlled stdio boundary;
2. place the data directory on a dedicated local filesystem with private
   permissions or ACLs;
3. retain and verify the exact policy bytes named by each admission record;
4. verify the package provenance named by each admission writer software
   profile, and treat envelope `lastWriter` only as software metadata for the
   latest successful persistence—not operator or process identity;
5. retain evidence bytes and digest-and-span provenance outside the MCP store;
6. preserve the current run, candidate, and audit digests for optimistic
   concurrency and audit pinning;
7. reload after conflict or indeterminate errors; and
8. verify that no writer is active before manually removing a stale lock.

## Out of Scope

- Universal evidence authority.
- Key discovery or revocation.
- Confidential payload storage.
- Remote or multi-tenant MCP service operation.
- Distributed consensus.
- Exactly-once effects across external systems.
- Recovery from a fully compromised host.

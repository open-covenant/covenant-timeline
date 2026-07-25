# Security Policy

## Supported versions

| Surface                 | Bootstrap support                               |
| ----------------------- | ----------------------------------------------- |
| `main`                  | Reports accepted; not a production release      |
| Latest `0.x` prerelease | Best effort                                     |
| Earlier `0.x`           | Unsupported unless an advisory states otherwise |
| `1.x`                   | Not released                                    |

## Reporting

Use
[GitHub private vulnerability reporting](https://github.com/open-covenant/covenant-timeline/security/advisories/new).
Do not open a public issue.

Include the affected version or commit, impact, realistic attacker outcome,
minimal reproduction, and suggested mitigation when available.

The target is acknowledgement within three business days and initial triage
within ten business days. These are targets, not guarantees. Coordinated
disclosure timing is agreed with the reporter.

## Scope

- canonicalization, hashes, and identifiers;
- contract and schema parsing;
- replay determinism;
- event and evidence integrity;
- command idempotency and effect boundaries;
- SDK and adapter trust boundaries;
- release and dependency supply chain.

No bounty exists unless separately announced. Preview releases are not approved
for production authorization decisions. An evidence digest establishes byte
identity, not correctness.

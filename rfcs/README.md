# RFC Process

RFC states:

```text
Draft -> Review -> Final Comment Period -> Accepted
                              \-> Rejected
Draft or Review -> Withdrawn
Accepted -> Superseded
```

An RFC starts with an issue and becomes `NNNN-short-name.md`. Review lasts at
least seven days. Normative core, security, cryptography, governance, and effect
boundary proposals require a fourteen-day final-comment period.

Acceptance requires two maintainer approvals when two eligible maintainers
exist. Security and cryptography proposals also require an eligible reviewer.

During single-maintainer bootstrap, self-acceptance requires a
`bootstrap-single-maintainer` disclosure and public rationale. It cannot freeze
a stable v1 rule.

A normative rule is not stable until the reference implementation and an
independent implementation pass its conformance cases.

Required sections are defined by [the template](./0000-template.md).

Implemented bootstrap decisions:

- [RFC 0007: State binding and checkpoint finalization](./0007-state-binding-and-finalization.md)
- [RFC 0008: Contract-bound policy identity](./0008-contract-bound-policy.md)

Active proposals:

- [RFC 0009: Temporal reasoning substrate](./0009-temporal-reasoning-substrate.md)

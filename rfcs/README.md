# RFC Process

RFC states:

```text
Draft -> Review -> Final Comment Period -> Accepted
                              \-> Rejected
Draft or Review -> Withdrawn
Accepted -> Superseded
```

An RFC starts with an issue and becomes `NNNN-short-name.md`. Review lasts at
least seven days. Normative core, security, cryptography, governance, and
financial-authority proposals require a fourteen-day final-comment period.

Acceptance requires two maintainer approvals when two eligible maintainers
exist. Security, cryptography, and financial-authority proposals also require
an eligible domain reviewer.

During single-maintainer bootstrap, self-acceptance requires a
`bootstrap-single-maintainer` disclosure and public rationale. It cannot freeze
a stable v1 rule.

A normative rule is not stable until the reference implementation and an
independent implementation pass its conformance cases.

Required sections are defined by [the template](./0000-template.md).

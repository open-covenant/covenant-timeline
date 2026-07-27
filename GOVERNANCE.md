# Governance

## Bootstrap stage

Open Covenant administers the repository and appoints maintainers during
bootstrap. The project does not present this arrangement as neutral multi-party
governance.

Normative decisions, rejected alternatives, and material dissent are recorded
publicly.

## Roles

- **Contributor:** proposes or implements changes.
- **Reviewer:** performs sustained technical review in an identified area.
- **Maintainer:** merges changes and stewards protocol quality.
- **Release steward:** prepares and verifies releases.
- **Security responder:** handles private reports and coordinated disclosure.

Appointments, removals, employment conflicts, material sponsorship, and
funding that could affect decisions are disclosed publicly.

## Decisions

Routine implementation, documentation, benchmark, fixture, and adapter changes
use normal pull-request review.

An RFC is required for normative semantics, schemas, canonicalization,
cryptography, effect boundaries, compatibility policy, release policy, or
governance. Security and cryptography RFCs require an eligible reviewer before
acceptance. Emergency private fixes are permitted, followed by an advisory or
retrospective decision record after disclosure.

An author cannot be the sole approver of a normative, security, release,
cryptographic, or effect-boundary change once a second eligible reviewer
exists. Self-approved normative changes remain provisional until a second
eligible maintainer reviews them.

## Governance transition

The transition conditions are defined in the [project charter](./CHARTER.md).
Once they are satisfied, participating maintainers and implementers may propose
a neutral decision-making body through an RFC. Its membership and voting rules
should reflect the contributors who exist at that time rather than a committee
designed in advance.

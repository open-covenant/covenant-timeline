# Governance

## Current stage

Covenant Timeline is in bootstrap governance. Open Covenant controls repository
administration and appoints the initial maintainers. Normative decisions,
rejected alternatives, and material dissent are recorded publicly.

## Roles

- **Contributor:** proposes or implements changes.
- **Reviewer:** performs sustained technical review in an identified area.
- **Maintainer:** merges changes and stewards protocol quality.
- **Release steward:** prepares and verifies releases.
- **Security responder:** handles private reports and coordinated disclosure.
- **Technical Steering Committee:** inactive until the charter transition gate.

An author cannot be the sole approver of normative, security, release,
cryptographic, or effect-boundary changes once a second eligible reviewer
exists. During single-maintainer bootstrap, self-approval must be disclosed and
cannot freeze a stable rule.

Appointments, removals, employment conflicts, material sponsorship, and funding
that could affect decisions are disclosed publicly.

## Decisions

Routine implementation changes require maintainer review. Normative semantics,
schemas, canonicalization, cryptography, effect boundaries, compatibility,
releases, and governance require an RFC.

Security and cryptography RFCs also require an eligible reviewer before
acceptance. Emergency private fixes are permitted, followed by an advisory or
retrospective decision record after disclosure.

## Steering transition

After the charter thresholds are satisfied, an accepted RFC may activate a
Technical Steering Committee. It must have an odd number of at least three
members, no organization may hold more than half the seats, and each member has
one vote. Normal decisions use a simple majority; charter and governance
changes require two thirds.

Maintainers may move to emeritus status after six months without implementation,
review, release, governance, or incident-response work, following public notice.

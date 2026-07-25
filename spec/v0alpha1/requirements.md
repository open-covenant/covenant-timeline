# Requirements

This table is the traceability index for mechanically testable requirements.
Each row is defined here once and linked to conformance cases.

| ID             | Requirement                                                                                             | Mechanical | Cases                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| CTL-CORE-001   | Every normative object identifies its schema and version.                                               | yes        | schema.valid-calendar-contract,schema.invalid-version                   |
| CTL-CORE-002   | Unknown semantic fields are rejected outside the extension namespace.                                   | yes        | schema.unknown-core-field                                               |
| CTL-TIME-001   | Every clock has a typed kind, coordinate definition, authority, ordering, and finality policy.          | yes        | schema.valid-calendar-contract,schema.valid-logical-contract            |
| CTL-TIME-002   | Cross-clock comparison requires a declared mapping or arbiter.                                          | yes        | semantic.cross-clock-unmapped,semantic.cross-clock-mapped               |
| CTL-TIME-003   | Observations distinguish occurrence, observation, record, and effective time.                           | yes        | schema.valid-event,schema.event-missing-observed-time                   |
| CTL-EVENT-001  | Accepted events are append-only and content-addressed.                                                  | yes        | schema.valid-event                                                      |
| CTL-EVENT-002  | Each event declares its stream sequence and expected prior version.                                     | yes        | schema.event-missing-sequence                                           |
| CTL-EVENT-003  | Corrections reference prior events instead of replacing them.                                           | yes        | schema.valid-correction                                                 |
| CTL-REPLAY-001 | Replay of pinned inputs is deterministic.                                                               | yes        | canonical.object-key-order                                              |
| CTL-REPLAY-002 | Replay cannot authorize execution of external effects.                                                  | yes        | semantic.replay-command-disabled                                        |
| CTL-EFFECT-001 | Every command has a stable idempotency key.                                                             | yes        | schema.valid-command,schema.command-missing-idempotency                 |
| CTL-EVID-001   | Evidence identifies its subject, claim, payload digest, producer, and time coverage.                    | yes        | schema.valid-evidence,schema.evidence-missing-digest                    |
| CTL-SCORE-001  | A scorecard retains scope, dimensions, evidence, confidence, policy, and window.                        | yes        | schema.valid-scorecard,schema.scorecard-unscoped                        |
| CTL-AUTH-001   | A scorecard cannot grant authority; authority is a separate decision.                                   | yes        | semantic.score-is-not-authority                                         |
| CTL-NUM-001    | Normative financial quantities use integers or normalized decimal strings with explicit scale and unit. | yes        | schema.valid-quantity,schema.invalid-floating-quantity                  |
| CTL-EXT-001    | Unknown required extensions fail; optional extensions remain identifiable.                              | yes        | semantic.unknown-required-extension,semantic.unknown-optional-extension |
| CTL-BRANCH-001 | A branch identifies its ancestor and divergence.                                                        | yes        | schema.valid-branch,schema.branch-missing-parent                        |

# Requirements

This table is the traceability index for mechanically tested bootstrap
requirements.

| ID               | Requirement                                                                                | Mechanical | Cases                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------- |
| CTL-CORE-001     | Every portable contract and event identifies its schema version.                           | yes        | schema.valid-contract,schema.invalid-version                                          |
| CTL-CORE-002     | Unknown semantic fields fail outside the extension namespace.                              | yes        | schema.unknown-core-field                                                             |
| CTL-RUN-001      | A portable run pins a run ID, contract, and ordered event stream.                          | yes        | schema.valid-run,schema.run-missing-id                                                |
| CTL-CONTRACT-001 | A contract has at least one uniquely named checkpoint with explicit evidence requirements. | yes        | schema.empty-checkpoints,semantic.duplicate-checkpoint                                |
| CTL-EVENT-001    | Every event has a non-negative stream sequence.                                            | yes        | schema.valid-evidence-event,schema.event-missing-sequence                             |
| CTL-EVID-001     | Evidence identifies claims, payload digest, kind, and producer.                            | yes        | schema.valid-evidence,schema.evidence-missing-digest,schema.evidence-empty-claims     |
| CTL-DECISION-001 | A checkpoint decision retains outcome, policy, evidence, and missing requirements.         | yes        | schema.valid-decision,schema.decision-missing-policy                                  |
| CTL-EFFECT-001   | Every command has a stable idempotency key and replay-forbidden policy.                    | yes        | schema.valid-command,schema.command-missing-idempotency,schema.command-replay-allowed |
| CTL-RECEIPT-001  | A receipt identifies its command, status, and effect digest.                               | yes        | schema.valid-receipt,schema.receipt-missing-command                                   |
| CTL-REPLAY-001   | Bootstrap canonical output is stable for the supported JSON subset.                        | yes        | canonical.object-key-order                                                            |
| CTL-EXT-001      | Unknown required extensions fail; optional extensions remain identifiable.                 | yes        | semantic.unknown-required-extension,semantic.unknown-optional-extension               |

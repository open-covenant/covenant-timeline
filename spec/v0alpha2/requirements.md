# Requirements

| ID                 | Requirement                                                                     | Mechanical | Cases                                                                                 |
| ------------------ | ------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| CTL2-CORE-001      | Every v0alpha2 portable object identifies its schema version.                   | yes        | schema.valid-contract,schema.valid-run                                                |
| CTL2-CORE-002      | Unknown semantic fields fail outside the extension namespace.                   | yes        | schema.unknown-core-field,schema.evaluation-policy-forbidden                          |
| CTL2-CONTRACT-001  | Every checkpoint pins a profile, policy reference, and policy digest.           | yes        | schema.valid-contract,schema.contract-missing-policy,schema.contract-bad-digest       |
| CTL2-EVID-001      | Evidence binds claims and payload bytes to a profile proof and policy identity. | yes        | schema.valid-evidence,schema.evidence-missing-authority,schema.evidence-missing-proof |
| CTL2-EVENT-001     | Evaluation events contain no evaluator-supplied policy field.                   | yes        | schema.valid-evaluation-event,schema.evaluation-policy-forbidden                      |
| CTL2-DECISION-001  | Decisions retain the contract policy binding.                                   | yes        | schema.valid-decision,schema.decision-missing-policy                                  |
| CTL2-RUN-001       | A run pins a run ID, contract, and ordered event stream.                        | yes        | schema.valid-run,schema.run-missing-id                                                |
| CTL2-EFFECT-001    | Commands and receipts retain idempotency and effect-digest contracts.           | yes        | schema.valid-command,schema.valid-receipt                                             |
| CTL2-REPLAY-001    | Evidence with a different policy binding cannot satisfy a checkpoint.           | no         |                                                                                       |
| CTL2-MIGRATION-001 | v0alpha1 migration requires explicit non-conflicting checkpoint bindings.       | no         |                                                                                       |
| CTL2-COMPAT-001    | Released v0alpha1 fixtures retain their original validation and state digests.  | no         |                                                                                       |

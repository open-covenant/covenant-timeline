# Policy binding and authority

The contract bytes are the authority for evaluator and policy identity.

For each referenced evidence item, the reducer compares `profile`, `policyRef`,
and `policyDigest` against the checkpoint policy binding. A mismatch fails
closed with `timeline.evidence.policy_mismatch`; the checkpoint remains pending.

The core does not resolve or execute policy artifacts. A conforming authority
profile MUST:

1. resolve the pinned policy artifact and verify its digest;
2. authenticate the evidence producer;
3. bind claims to payload bytes;
4. enforce freshness and revocation rules;
5. emit a proof artifact whose digest is recorded with the evidence.

The core comparison prevents policy substitution during replay. The profile
proof establishes whether the evidence was legitimately produced under that
policy.

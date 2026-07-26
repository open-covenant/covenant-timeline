# Object model

A v0alpha2 contract contains a subject and one or more checkpoints. Each
checkpoint MUST contain:

- an identifier;
- one or more required claim identifiers;
- a policy binding with `profile`, `policyRef`, and `policyDigest`;
- optionally, an effect command template.

Evidence MUST identify its payload, producer, claims, and authority. Its
authority repeats the checkpoint policy binding and adds `proofDigest`, which
binds the external profile-verification proof.

Evaluation events identify only a checkpoint and evidence references. They MUST
NOT supply or override policy identity. A decision copies the policy binding
from the contract.

Commands remain declarations. Replay never dispatches effects.

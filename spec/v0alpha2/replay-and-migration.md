# Replay and migration

v0alpha2 replay is deterministic and effect-free. Sequence numbers remain the
only normative core clock.

v0alpha1 documents remain valid only under v0alpha1 semantics. Implementations
MUST NOT reinterpret their event-supplied `policyRef` as a contract binding.

Migration requires an explicit policy binding for every checkpoint. Every
historical evaluation label MUST match the selected `policyRef`. Evidence used
by checkpoints with different bindings cannot be migrated automatically.
Unreferenced evidence requires an explicit fallback binding.

Migration creates new v0alpha2 bytes and new digests. It does not alter the
source document or upgrade legacy evidence authenticity.

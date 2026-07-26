# Independent adoption guide

This guide defines the evidence needed to count an M4 adoption. Copying the
reference adapter or replaying a fixture is useful integration work, but it is
not independent operation.

Start with the bounded [independent operator pilot](./operator-pilot.md). The
pilot is intentionally small; the evidence requirements below remain the gate
for counting an adoption.

## Integration path

1. Pin a released package or an exact repository commit.
2. Create a v0alpha2 contract whose checkpoints bind a profile, policy
   reference, and policy digest.
3. Authenticate evidence through the bound profile before recording an
   `evidence.recorded` event. Do not accept caller-supplied claim strings as
   proof.
4. Persist the canonical contract and complete ordered event stream. Treat
   projected `RunState` objects as process-local.
5. Rebuild state from the contract and events after a process restart.
6. Dispatch each emitted command at most once using its idempotency key, then
   record the external result as a receipt event.
7. Export the portable run and verify it in a clean environment.

The Temporal reference adapter demonstrates the restart mechanics. The GitHub
profile demonstrates signed evidence admission. Neither replaces an adopter's
own authority, storage, effect, and operations review.

## Required adoption evidence

An adoption counts toward M4 only when all of the following are public or
available to maintainers for verification:

- the external project and exact integration revision;
- the Timeline package version or commit pin;
- the authority profile and immutable policy bytes;
- a redacted portable run with its expected state digest;
- evidence that one run crossed a real process restart;
- the independent command that verifies the exported run;
- the operator responsible for evidence admission and effect dispatch;
- any corrections, incidents, or replay-performance measurements observed.

The operator must be organizationally independent of the Covenant Timeline
repository. A source project appearing in an archive does not imply that the
source project adopted or endorsed Timeline.

## Verification commands

From a clean Timeline checkout:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm timeline verify path/to/redacted-run.json --json
```

If an implementation disagrees with the conformance corpus, use the
conformance-failure issue template and include the fixture ID, exact bytes,
expected digest, actual digest, and implementation revision.

Do not attach secrets, webhook bodies, private repository metadata, payload
bytes, or live credentials to an adoption report.

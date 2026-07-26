# Checkpoint compatibility operator pilot

Covenant Timeline is seeking one independent maintainer or team to operate a
small, real run outside the Open Covenant organization. The pilot is one
workflow, one checkpoint, one process restart, and one low-risk effect. It is
not a request to replace an existing workflow runtime.

## Smallest qualifying pilot

The operator brings:

- an external repository and an existing software or agent workflow;
- a durable runtime, job system, or process that can be restarted;
- one checkpoint backed by authenticated evidence;
- one low-risk effect, such as writing a release archive, and its receipt;
- an exportable run that can be redacted and independently verified.

Timeline maintainers provide:

- a contract and policy review before the run;
- help adapting the GitHub profile or defining a narrow operator-owned profile;
- conformance and replay debugging;
- verification of the exported run and state digest;
- integration patches when the external operator retains review and control.

The external operator must own the evidence-admission key, policy bytes,
persistence, effect dispatch, and actual run. Maintainer implementation help
does not invalidate the pilot; an Open Covenant-operated demo does.

## Runtime paths

| Existing host                       | Pilot path                                                                |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Temporal                            | Adapt the reference workflow and replace its fixture with the real run.   |
| Restate, DBOS, or another runtime   | Persist ordered events, call the v0alpha2 reducer, and export the run.    |
| A service without a workflow engine | Use the atomic archive store and prove recovery across a process restart. |

Pin `@covenant-org/timeline@0.0.0-alpha.2` or an exact Timeline commit. Do not
depend on a moving branch or mutable distribution tag.

## Pilot sequence

1. [Open an operator-pilot issue](https://github.com/open-covenant/covenant-timeline/issues/new?template=operator_pilot.yml)
   with the external repository, host runtime, and proposed checkpoint.
2. Agree on the exact Timeline pin, authority profile, policy bytes, evidence
   freshness, and low-risk effect.
3. Run long enough to cross a real process restart. Rebuild projected state
   from the exact contract and complete event stream.
4. Export a redacted portable run. Keep private payloads, credentials, webhook
   bodies, signing keys, and sensitive repository metadata out of the archive.
5. Verify the archive in a clean checkout and submit the
   [independent-adoption report](https://github.com/open-covenant/covenant-timeline/issues/new?template=independent_adoption.yml).

## Success

The pilot succeeds when an operator outside Open Covenant can reproduce the
final state digest, explain evidence admission and effect dispatch, and restart
without a process-local snapshot. The adopter does not need to be a workflow
vendor, use Covenant, or deploy a high-risk effect.

Replaying a repository fixture, running the public archive unchanged, or
listing an external project as the source of evidence does not count as
independent operation.

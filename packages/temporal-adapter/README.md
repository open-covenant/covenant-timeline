# `@covenant-org/timeline-temporal`

Temporal adapter for durable Covenant Timeline event intake.

The workflow stores the portable v0alpha2 event stream in Temporal history,
accepts ordered events through signals, exposes event count through a query, and
invokes the Timeline reducer as an activity when finalized. Replay remains
effect-free.

The integration test starts a real local Temporal server, records evidence with
one worker, shuts that worker down, starts a second worker, appends evaluation
and receipt events, and verifies the final state.

This is a maintained reference adapter in the Timeline repository. It is not
evidence that Temporal Technologies operates or endorses Covenant Timeline.

# Ordering

Core v0alpha1 uses the event stream sequence as its only normative clock.

Every event MUST carry a non-negative sequence (`CTL-EVENT-001`). The first
event has sequence `0`. Each subsequent event increments the prior sequence by
one. Gaps, duplicates, and reordering fail before reduction.

Occurrence time, collection time, record time, and calendar checkpoint
coordinates may be carried by evidence payloads or future extensions. They do
not affect Core v0alpha1 decisions unless a later specification defines their
mapping and comparison rules.

This restriction is deliberate. A broader clock model will be added only after
real adopters demonstrate ordering requirements that cannot be represented by
the stream sequence.

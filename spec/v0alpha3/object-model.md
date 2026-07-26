# Object model

## Contract

A `covenant.timeline.contract.v0alpha3` object binds a subject to one or more
temporal axes and one or more isolated contexts.

An axis has:

- a unique `id`;
- `kind`, either `metric` or `ordinal`;
- a non-empty `unit`; and
- an opaque `origin` reference.

Explicit coordinates and bounds are safe integers. Metric coordinates are
elapsed ticks in the declared unit. Ordinal coordinates are ordered domain
steps. Calendar normalization and civil-time rules are outside the generic
kernel and require a pinned profile before conversion to an integer axis.

A context has a unique `id` and one of four modes: `actual`, `planned`,
`forecast`, or `hypothetical`. Contexts are isolated. The kernel MUST NOT allow
a constraint in one context to affect a conclusion in another.

## Run and events

A `covenant.timeline.run.v0alpha3` object contains the exact contract and an
append-only event array. Event `sequence` starts at zero, is contiguous, and
defines record order only.

The event variants are:

- `point.declared`;
- `interval.declared`;
- `coordinate.asserted`;
- `constraint.asserted`;
- `fact.asserted`; and
- `assertion.retracted`.

IDs for declared temporal entities and assertions are unique for the life of a
run. References resolve only to earlier records. Event IDs are unique in their
own namespace.

A point belongs to one context and one axis. It does not contain an intrinsic
coordinate.

A coordinate assertion constrains one earlier point against its axis origin
with an inclusive minimum, maximum, or both. Keeping coordinates in assertions
makes observations and estimates digest-referenced, retractable, supersedable, and
visible at historical knowledge cuts.

An interval belongs to one context and references a start and end point in that
same context and on the same axis. It is proper:

```text
end - start >= 1
```

Zero-duration temporal entities are represented as points.

A constraint assertion states at least one inclusive bound:

```text
minimum <= to - from <= maximum
```

Both points MUST exist in the assertion's context and on one axis. Coordinate,
constraint, and fact assertions carry one or more lowercase SHA-256 content
digests and may supersede earlier assertions of the same kind and context. A
coordinate assertion may supersede only an assertion about the same point. The
digest binds evidence bytes; source authority is an external admission concern.

A fact assertion binds an opaque proposition reference and evidence content
digests to a context. It may reference a valid interval, observation point, and
assertion point. The generic kernel preserves facts and their revision history;
it does not infer domain truth from them.

A retraction targets an earlier coordinate, constraint, or fact assertion and
carries one or more evidence digests. Supersession and retraction change active
projection, not historical bytes. Targets MUST precede the revising event.

Supersession is persistent: once a later admitted assertion suppresses an
earlier assertion, retracting or superseding the replacement does not restore
the stale assertion. A producer restores a claim by appending a new assertion.

## Knowledge cuts

Every query pins `recordedThrough`.

- `null` selects the empty event prefix.
- A non-negative integer `N` selects the prefix through event sequence `N`,
  inclusive.

There is no implicit `latest` value. A caller querying the complete current run
records the final admitted sequence explicitly. This prevents the same query
bytes from silently changing meaning as the run grows.

The cut describes record time: which declarations and assertions had been
admitted. It does not establish when a domain fact was true.

## Queries

A `covenant.timeline.query.v0alpha3` object selects one context, one knowledge
cut, and one operation:

- `context.consistency`;
- `difference.bounds`;
- `point.relations`; or
- `interval.relations`.

Difference bounds return the tightest derivable inclusive lower and upper
bounds, with `null` for an unbounded side.

Point relation queries enumerate possible base relations from `before`,
`equal`, and `after`.

Interval relation queries enumerate possible Allen base relations:
`before`, `meets`, `overlaps`, `starts`, `during`, `finishes`, `equal`, and
their inverses.

## Conclusions

A `covenant.timeline.conclusion.v0alpha3` object contains:

- the query ID;
- a query-specific semantic result;
- a reasoner identifier;
- digests of projected state, query, and semantic result; and
- a proof receipt.

Canonical semantic results are portable across conforming implementations.
Proof receipts are deterministic only within their declared reasoner profile.
Another implementation MUST be able to verify the receipt without trusting
hidden model reasoning or prose.

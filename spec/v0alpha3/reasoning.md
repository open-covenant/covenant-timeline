# Projection and reasoning

## Active projection

Projection is a pure function of exact contract bytes, one event prefix, and
one context:

```text
(contract, event prefix, context) -> active temporal state
```

It admits declarations in sequence order, applies valid supersession and
retraction records, and retains active coordinates, constraints, and facts. A
superseded or retracted assertion remains part of history but cannot constrain
the projected state. Supersession remains effective even if its replacement is
later inactive; stale assertions never reactivate implicitly.

The state digest preimage is the canonical contract, selected context ID,
explicit cut, and that context's admitted prefix events, including inactive,
superseded, and retracted history. Events belonging only to another context are
excluded, while the global cut value remains bound. This preserves provenance
between distinct histories that happen to produce the same active graph. The
digest MUST NOT depend on locale, wall clock, object insertion order, or process
identity.

## Simple temporal network

The initial reasoner compiles a projected context to a simple temporal network.
For points `x` and `y`, an upper difference bound:

```text
y - x <= b
```

becomes a directed weighted edge `x -> y` with weight `b`. A lower bound:

```text
y - x >= a
```

becomes `y -> x` with weight `-a`.

Active coordinate assertions compile against a synthetic origin point for their
axis. Their assertion IDs identify the resulting proof edges.
Every interval declaration adds its properness constraint. Stable synthetic
source IDs identify these system constraints in receipts.

Proof identifiers use this reserved namespace:

- a declared point node is its point ID;
- an axis-origin node is `@origin:<axis-id>`;
- a coordinate or difference-constraint edge source is its assertion ID;
- an interval-properness edge source is `@interval:<interval-id>`; and
- an edge introduced while testing one relation case is
  `@query:<query-id>:<relation>:<zero-based-atomic-constraint-index>`.

Portable identifiers cannot start with `@`, so declared IDs cannot collide with
this namespace. Both directed edges compiled from one atomic equality use the
same source ID.

The kernel reasons over mathematical integers with exact internal arithmetic.
Portable input values, finite semantic results, and schedule witnesses MUST fit
the safe-integer range. The range is a representation boundary, not an implicit
bound on every unconstrained variable. The implementation MUST fail rather than
return a wrapped or imprecise result when a required result or exhaustive proof
witness cannot be represented safely.

A negative cycle means the evaluated component is inconsistent. Consistency
queries evaluate the full selected context. Bounds and relation queries evaluate
only the connected component containing their referenced entities, so an
unrelated contradiction does not erase an otherwise valid answer.

## Difference bounds

For `to - from`, shortest-path closure gives:

- maximum from the shortest path `from -> to`; and
- minimum from the negated shortest path `to -> from`.

No finite path means that side is unbounded. The result status is:

- `bounded` when both sides are finite;
- `partially-bounded` when exactly one side is finite;
- `unbounded` when neither side is finite; or
- `inconsistent` when the evaluated component has a negative cycle.

## Relations

Point and interval relation queries test each mutually exclusive base relation
against the projected network.

The semantic result is:

- `resolved` when exactly one relation remains possible;
- `indeterminate` when more than one remains possible; or
- `inconsistent` when the evaluated component is inconsistent before adding a
  relation case.

Temporal precedence never implies causality. A relation result states only what
the temporal constraints permit.

## Proof receipts

The initial reasoner emits one of:

- a feasible integer schedule for consistency;
- a negative cycle for inconsistency;
- ordered upper and lower proof edges for difference bounds; or
- exhaustive relation cases, with a feasible schedule for possible cases and a
  negative cycle for impossible cases.

A verifier reconstructs the exact projected network, checks all digests, and
validates each ordered proof edge by source, endpoints, and weight against the
semantic result. A schedule proves satisfiability, not entailment. A bound path
proves its reported finite closure bound. A negative cycle is ordered and its
weights sum below zero. Relation resolution relies on complete enumeration of
the base relation set.

The semantic result is reasoner-independent. Witness selection and proof bytes
need not match across different reasoners unless a future proof profile says
otherwise.

## Resource limits

Parsing, projection, closure, and proof verification enforce explicit limits.
Implementations MUST reject a run or query that exceeds configured limits.
They MUST NOT silently truncate events, graph nodes, graph edges, proof cases,
or identifiers.

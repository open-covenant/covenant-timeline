# RFC 0009: Temporal-First Contract and Reasoning Kernel

- Status: Draft
- Authors: Project contributors
- Created: 2026-07-26
- Discussion:
  [issue 15](https://github.com/open-covenant/covenant-timeline/issues/15)
- Compatibility: breaking for new contracts; historical formats preserved
- Governance impact: expands the project mission and governed surfaces

## Problem

Core v0alpha1 and v0alpha2 are checkpoint ledgers. Their event sequence is the
only normative clock, and their only generic decision procedure is requirement
coverage. Adding timestamps as metadata would not turn that model into temporal
reasoning.

That contract is too narrow for the intended project. Long-running AI systems
must distinguish record order from when events occur, when claims apply, when
sources observe them, which scenario they belong to, what had been admitted at
a prior point, and which temporal conclusions follow from incomplete
constraints.

Natural-language chain of thought is not a verification boundary. Models should
propose temporal representations and questions, while a deterministic kernel
derives bounds, possible relations, schedules, or contradictions from explicit
inputs.

## Decision

The next contract version is temporal-first. v0alpha3 replaces checkpoints as
the central object model with:

- explicit discrete temporal axes;
- isolated actual, planned, forecast, and hypothetical contexts;
- dynamically declared points and proper intervals;
- digest-referenced coordinate, metric-constraint, and temporal-fact assertions;
- append-only correction and retraction;
- explicit record-time knowledge cuts;
- typed bounds, relation, and consistency queries; and
- canonical semantic results with reasoner-specific, independently checkable
  proof receipts.

Checkpoints become one possible consumer of temporal conclusions, not the
identity of the new contract.

v0alpha1 and v0alpha2 remain immutable compatibility formats. They are not
reinterpreted, and existing state digests do not change.

## Scope

This RFC defines:

1. the v0alpha3 temporal contract, run, event, query, and conclusion families;
2. deterministic projection of temporal state at an explicit knowledge cut;
3. a first reasoning kernel based on Simple Temporal Network constraints;
4. point and Allen interval relation queries over discrete proper intervals;
5. proof receipt classes for consistency, bounds, and possible relations;
6. a model-facing JSON interface; and
7. compatibility, conformance, safety, and evaluation requirements.

An experimental implementation may land while this RFC is Draft. It is not a
normative conformance claim until review and the required final-comment period
complete.

## Non-goals

v0alpha3 does not:

- mutate or reinterpret v0alpha1 or v0alpha2;
- read an ambient clock, locale, calendar, or time zone;
- build a scheduler, workflow engine, database, or agent runtime;
- define domain truth, source authority, or a universal event ontology;
- infer causality from temporal order;
- compare temporal axes without an explicit future mapping profile;
- solve arbitrary disjunctive interval algebra;
- infer absence, inactivity, or a missed observation without an authoritative
  completeness assertion;
- model uncertain contingent durations or dynamic controllability;
- define deontic obligation semantics;
- standardize recurrence or calendar-period arithmetic in the first kernel; or
- claim that a solver makes temporal reasoning native to model weights.

## Terminology

**Event sequence** is the contiguous order in which a Timeline run records
events. In v0alpha3 it is record order only, not the system's model of time.

**Temporal axis** is a named discrete coordinate system with a declared kind,
integer unit, and origin.

**Context** is an isolated actual, planned, forecast, or hypothetical scenario.
Constraints from different contexts do not interact without a future explicit
bridge.

**Temporal point** is an identified point on one axis in one context.

**Coordinate assertion** supplies an exact or bounded coordinate for an earlier
point relative to its axis origin. It carries evidence content digests and is
independently revisable.

**Temporal interval** is a proper interval whose start and end are points in the
same context and on the same axis. Proper means `end - start >= 1` declared
tick. Zero-duration entities are points, not intervals.

**Constraint assertion** states:

```text
minimum <= to - from <= maximum
```

At least one bound is present. Bounds are safe integers in the axis's declared
unit.

**Temporal fact** associates an opaque domain proposition with temporal
entities and evidence content digests. The initial kernel preserves facts but
does not authenticate or infer their domain truth.

**Knowledge cut** is the run prefix through an explicit event sequence,
including the empty prefix. It answers which assertions had been admitted by a
record position, not what was objectively true.

**Active projection** is the declared points and intervals plus coordinate,
fact, and constraint assertions remaining after valid supersession and
retraction events at one knowledge cut.

**Semantic result** is the canonical, reasoner-independent answer to a typed
query.

**Proof receipt** binds a semantic result to a reasoner and supplies a schedule,
bound path, relation-case witness, or negative cycle that another
implementation can check.

## Object model

### Contract

A `covenant.timeline.contract.v0alpha3` contract pins:

- contract and subject identity;
- one or more temporal axes; and
- one or more isolated scenario contexts.

Explicit coordinates and bounds use portable safe integers. A metric axis
describes elapsed ticks in a declared unit. An ordinal axis describes ordered
domain steps. Calendar periods such as months and civil-time normalization are
not elapsed integer units and must be converted by a future pinned profile
before entering the kernel.

The contract does not predeclare every future event. Points, intervals, facts,
and constraints arrive through the run stream so a model or runtime can extend
temporal state over time.

### Events

A `covenant.timeline.event.v0alpha3` event is one of:

- `point.declared`;
- `interval.declared`;
- `coordinate.asserted`;
- `constraint.asserted`;
- `fact.asserted`; or
- `assertion.retracted`.

Every event has an ID and contiguous sequence. References resolve only to
objects declared earlier in the same accepted prefix.

A point names a temporal entity in one context and on one axis. A separate
`coordinate.asserted` event places an exact or bounded integer coordinate on
that point. The projector compiles each active coordinate assertion into
constraints against the implicit origin of its axis.

Declaring an interval adds the invariant:

```text
end - start >= 1
```

Coordinate, constraint, and fact assertions carry lowercase SHA-256 content
digests for their evidence bytes. These references bind content identity; the
host remains responsible for retaining the bytes and validating source
authority. A new assertion may supersede earlier assertions of the same kind in
the same context. Coordinate assertions may supersede only assertions about the
same point. A retraction targets an earlier assertion and carries its own
evidence digest. Historical bytes remain present.

Supersession and retraction are acyclic because targets must be earlier.
Multiple active replacements of the same assertion remain multiple assertions;
the kernel does not invent source precedence.

Supersession is persistent. Once an admitted assertion supersedes an earlier
assertion, later retraction or supersession of the replacement does not restore
the stale assertion. Restoration requires a new assertion. This prevents
correction chains from silently resurrecting information that a later record
explicitly displaced.

### Run

A `covenant.timeline.run.v0alpha3` run contains the exact contract and append-only
events. The portable source of truth remains the contract plus event stream.

### Query

Every `covenant.timeline.query.v0alpha3` query names:

- query ID;
- context;
- explicit knowledge cut; and
- one typed operation.

`recordedThrough: null` selects the empty event prefix. A non-negative integer
selects events through that sequence, inclusive. There is no implicit latest
value; a caller querying the complete current run records its final admitted
sequence explicitly.

The initial operations are:

1. `context.consistency`;
2. `difference.bounds`;
3. `point.relations`; and
4. `interval.relations`.

The query never means “now.” A host that needs a current observation records an
authenticated point and constraint before querying.

### Conclusion

A `covenant.timeline.conclusion.v0alpha3` conclusion contains:

- query ID;
- typed semantic result;
- reasoner profile;
- state, query, and semantic-result digests; and
- proof receipt.

State, query, and semantic-result bytes are canonical across implementations.
Proof receipts are deterministic for a pinned reasoner and independently
checkable. They need not have identical bytes across different reasoners unless
a later proof profile defines canonical witness selection.

## State projection

Projection takes:

```text
(contract, event prefix, context)
    -> active temporal state
```

It performs no temporal inference while deciding which assertions are active.
It:

1. validates the contract and contiguous run prefix;
2. keeps declarations in the selected context;
3. removes assertions retracted in the prefix;
4. removes earlier assertions named by any admitted supersession record;
5. retains excluded assertions and events in the knowledge-cut digest and
   provenance history; and
6. compiles active coordinate assertions, proper-interval invariants, and
   difference assertions into kernel constraints.

The state digest binds the canonical contract, selected context ID, explicit
global cut, and the selected context's admitted prefix events, including
inactive, superseded, and retracted history. It excludes event payloads
belonging only to other contexts. Distinct provenance histories therefore do
not collapse merely because they produce the same active constraint graph.

Different scenario contexts are separate possible worlds. An observation,
forecast, plan, and counterfactual therefore cannot accidentally constrain one
another.

For bounds and relation queries, the solver uses the connected component of the
referenced points. An unrelated inconsistent component does not make an
unrelated query vacuously true or globally unusable. `context.consistency`
checks the entire selected context.

Conflicting active assertions in the same query component return an
inconsistent semantic result and a negative cycle. Source selection belongs to
an explicit authority or assumption profile; the generic projector never hides
a conflict.

## Initial reasoning kernel

### Coordinate domain

The first kernel reasons over discrete mathematical integers using exact
internal arithmetic. Portable input values, finite results, and schedule
witnesses must fit the JSON safe-integer range. That representation limit is
not an implicit lower or upper bound on every unanchored temporal variable;
otherwise an unconstrained difference could never be reported as unbounded.

Strict order compiles as one tick:

```text
a < b  iff  b - a >= 1
```

This makes strict inequalities portable. Dense time, floating-point
coordinates, leap-second policy, civil-time ambiguity, and calendar arithmetic
are outside the initial kernel.

If a tight finite result or a witness required for an exhaustive proof cannot
be represented safely, the query fails closed with an arithmetic-overflow
error. The reasoner does not misclassify a mathematically possible relation as
impossible merely because its witness would exceed the portable range.

### Difference constraints

Each admitted bound:

```text
to - from <= maximum
```

becomes a weighted edge from `from` to `to`. A minimum becomes the reverse edge:

```text
from - to <= -minimum
```

The kernel computes consistency, implied bounds, and deterministic schedules
using a reviewed all-pairs or single-source shortest-path implementation with
strict node, edge, integer, and operation limits.

### Point relations

`point.relations` returns the ordered set of relations consistent with the
selected state:

```text
before | equal | after
```

The result is:

- `resolved` when exactly one relation is possible;
- `indeterminate` when multiple relations are possible; or
- `inconsistent` when the query component has no satisfying assignment.

This is a projection query, not an entailment-status query.

### Interval relations

The first version supports the 13 Allen base relations for proper intervals:

```text
before, meets, overlaps, starts, during, finishes, equal,
finished-by, contains, started-by, overlapped-by, met-by, after
```

Each base relation compiles into conjunctions of equality and strict endpoint
constraints. The kernel checks each atomic relation for satisfiability and
returns all possible relations in the normative order above.

Arbitrary disjunctions are not admitted as constraints. A model may retain an
opaque candidate set outside the active constraint graph and query each
supported base relation. No unsupported alternative is silently approximated.

### Difference bounds

`difference.bounds` returns the tightest implied lower and upper bounds for:

```text
to - from
```

Its status is:

- `bounded` when both finite bounds exist;
- `partially-bounded` when one finite bound exists;
- `unbounded` when neither finite bound exists; or
- `inconsistent` when the query component has no satisfying assignment.

Null represents an absent finite bound, not an unknown numeric value.

### Consistency

`context.consistency` returns `consistent` with a satisfying schedule or
`inconsistent` with a negative cycle.

The kernel can answer whether a deadline relation is feasible under pinned
constraints. It does not decide whether an obligation exists, whether an action
will complete under uncontrollable duration, or whether a missing event failed
to occur.

## Proof receipts

The initial reasoner profile is `covenant.timeline.stn.v0alpha1`.

Receipt classes are:

- **schedule:** integer coordinates satisfying every active constraint in the
  checked scope;
- **bounds:** ordered shortest-path edges, including source, direction, and
  weight, supporting finite lower and upper bounds;
- **relation cases:** one schedule for each possible relation and one negative
  cycle for each impossible relation; and
- **negative cycle:** ordered source-bound edges whose endpoints join and whose
  summed weight is negative.

A schedule proves satisfiability, not entailment. Relation resolution follows
from the exhaustive and mutually exclusive base relations plus witnesses for
possible cases and contradictions for impossible cases. Bound paths support the
reported closure bounds.

Receipts reserve `@`-prefixed identifiers for synthetic proof graph objects.
Axis-origin nodes are `@origin:<axis-id>`, proper-interval edges are sourced by
`@interval:<interval-id>`, and relation-case edges are sourced by
`@query:<query-id>:<relation>:<zero-based-atomic-constraint-index>`. Coordinate
and declared difference edges use their assertion IDs. Declared portable IDs
cannot begin with `@`.

Proof verification is pure over pinned bytes. A verifier does not trust prose,
hidden chain of thought, generated code, or an unbound reasoner label.

## Temporal facts and completeness

A fact assertion records:

- opaque proposition reference;
- context;
- optional valid interval;
- optional observation and assertion points;
- record sequence;
- SHA-256 references to the admitted evidence bytes; and
- correction history.

Valid time means asserted applicability, not established truth. A knowledge cut
means assertions admitted by a record position, not system belief.

The first kernel preserves facts for model context and future typed fact
queries. It does not use absence of a fact as evidence. A future completeness
profile must introduce provenance-bound watermarks or closed-world scopes before
Timeline can conclude that an expected event did not occur.

## Model interface

The inference loop is:

```text
source bytes
    │
    ▼
model proposes points, intervals, facts, constraints, and query
    │
    ▼
schema and authority admission
    │
    ▼
deterministic kernel
    │
    ▼
canonical result + proof receipt + unresolved alternatives
    │
    ▼
model continues from the checked temporal state
```

The LLM is a probabilistic semantic compiler and planner, not temporal
authority. Implementations retain evidence or source-span references and expose
validation failures. Evaluation reports extraction, admission, solver, and
final-answer errors separately.

A runtime may require a temporal conclusion before a time-sensitive action.
The current checkpoint reducer may admit a verified conclusion through a
profile, but v0alpha3 does not retain checkpoints as its central contract.

Using the kernel as a normal tool is tool-integrated temporal reasoning. Calling
it during constrained decoding is inference-integrated temporal reasoning.
“Model-native” remains reserved for controlled model training or architecture
work that transfers to held-out temporal structures without relying solely on
the external kernel.

## Established foundations and integration hypothesis

The project does not invent events, intervals, temporal graphs, constraint
networks, bitemporal history, or neuro-symbolic reasoning. The implementation
must compare directly with:

- [Allen interval algebra](https://doi.org/10.1145/182.358434);
- [Simple Temporal Networks](<https://doi.org/10.1016/0004-3702(91)90006-6>);
- [Lamport ordering](https://lamport.org/pubs/time-clocks.pdf);
- [TimeML](https://timeml.org/);
- [jTLEX temporal graphs](https://aclanthology.org/2023.eacl-demo.4/);
- [OWL-Time](https://www.w3.org/TR/owl-time/);
- [W3C PROV](https://www.w3.org/TR/prov-o/); and
- temporal-database valid and transaction time.

The integration hypothesis is that content-addressed temporal state,
source-linked model extraction, explicit scenario and knowledge cuts,
deterministic cross-language semantic results, proof receipts, and binding to
real agent decisions form a useful portable substrate not supplied by any one
of those components.

Novelty is an empirical conclusion, not a name. A systematic prior-art review
and controlled evaluation must support it before the project claims a novel
reasoning method.

## Alternatives

### Extend checkpoint events with timestamps

Rejected. Timestamps do not define scenario, axis, interval, uncertainty,
validity, correction, query, or proof semantics.

### Keep the checkpoint contract central and bolt on a parallel temporal layer

Rejected as the future architecture. It preserves the narrow product identity
the new work is intended to replace. Historical checkpoint formats remain
available through compatibility APIs.

### Let the LLM reason in prose or generated code

Rejected as the verification boundary. Models may propose the representation,
but identical accepted inputs must produce identical semantic results.

### Adopt a complete ontology or temporal logic immediately

Rejected. The first functional core is a bounded, tractable integer constraint
network with explicit extension points.

### Build a new foundation model first

Rejected as the first delivery path. The portable kernel supplies a
vendor-neutral oracle, proof traces, training data, and controlled baseline for
later model research.

## Compatibility and migration

v0alpha3 is a new contract family:

- v0alpha1 and v0alpha2 replay and state digests remain unchanged;
- existing package APIs remain available during alpha;
- no timestamp is injected into historical events;
- adapters may convert authenticated historical material into new v0alpha3
  events without changing the source archive;
- a v0alpha3 conclusion may enter a v0alpha2 checkpoint only through an
  explicit evidence profile; and
- unsupported v0alpha3 semantics fail closed.

There is no claim that an arbitrary checkpoint contract can be mechanically
converted into temporal semantics. Migration tools must state which meaning was
supplied by a profile or operator.

## Security and privacy

Temporal data can reveal schedules, diagnoses, research activity, and
operational weaknesses. Implementations require payload minimization,
content-digest evidence references, scoped disclosure, and explicit retention
policy.

Threats include:

- forged or misbound coordinates, axes, and evidence;
- stale observations presented as current;
- scenario confusion between actual, planned, forecast, and hypothetical data;
- hindsight leakage across knowledge cuts;
- malicious supersession or retraction;
- integer overflow and arithmetic precision loss;
- constraint graphs designed for denial of service;
- proof substitution from another state, query, or reasoner;
- hidden contradictions removed during model-context compression;
- absence claims without a completeness frontier; and
- chronology presented as causality or authority.

Validation occurs before inference. Limits bound bytes, events, points,
intervals, constraints, contexts, proof size, and kernel operations. Unsupported
or excessive inputs fail closed.

High-stakes profiles require independent domain authority and privacy review.
Core verification proves derivation from admitted assertions, not clinical,
scientific, financial, or legal correctness.

## Effect-boundary impact

None. Projection and reasoning perform no external effects. The passage of
ambient time never changes state. A host appends an authenticated observation
before recomputing.

## Conformance cases

Before v0alpha3 can advance from Draft, the conformance program MUST cover:

- record order differing from temporal order;
- identical temporal constraints in different scenario contexts;
- exact, lower-bounded, upper-bounded, and unbounded points;
- coordinate and constraint overflow rejection;
- proper-interval enforcement;
- all three point relations;
- all 13 Allen interval relations;
- bounded, partially bounded, and unbounded differences;
- unrelated inconsistent components;
- query-scoped and whole-context inconsistency;
- correction, supersession, retraction, and historical knowledge cuts;
- cross-context and cross-axis rejection;
- stable semantic results under assertion reordering where record meaning is
  unchanged;
- schedules, bound paths, relation-case witnesses, and negative cycles;
- state, query, result, proof, and evidence substitution attacks;
- strict resource limits;
- no ambient clock, locale, or time-zone dependence; and
- cross-language state, query, and semantic-result agreement.

The experimental corpus in this repository is an initial slice of that
checklist. It does not yet cover every relation, adversarial substitution case,
resource boundary, or a second implementation.

Model evaluation compares the same models and evidence under direct prompting,
chain of thought, tool-integrated kernel use, and later inference-integrated
use. It reports unsupported definite answers and extraction failures, not only
aggregate accuracy.

## Governance impact

This proposal expands the charter mission from checkpoint verification to a
temporal reasoning substrate and adds the temporal contract, kernel, queries,
and proof receipts to governed project surfaces.

Acceptance therefore requires the charter's fourteen-day final-comment period.
The charter text is not amended while this RFC remains Draft. Experimental code
may land under alpha naming, but stable scope and conformance claims wait for
the governance process.

## Rollback

While Draft, the v0alpha3 implementation remains experimental and source-only.
It can be removed without changing released package behavior or historical
verification.

After an alpha release, rollback disables new v0alpha3 admission while
preserving historical v0alpha3 bytes and the ability to inspect them. It never
rewrites an accepted run.

## Unresolved questions

- Which exact resource limits should be normative?
- Should proof verification replay the kernel, check certificates directly, or
  support both profiles?
- How should explicit context bridges and uncertain clock mappings work?
- Which completeness and watermark model can support absence queries?
- When should recurrence, civil-time normalization, STNU controllability, and
  limited state-transition semantics enter?
- How should domain profiles express authority without selecting a universal
  source ranking?
- What minimum benchmark gain and transfer justify inference-integrated or
  model-native capability language?

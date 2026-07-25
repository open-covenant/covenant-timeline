# Clocks and Ordering

## Typed clocks

Every clock MUST declare:

- an identifier;
- a kind;
- its coordinate representation;
- an authority or source;
- total or partial ordering;
- uncertainty behavior;
- finality behavior;
- adapter and schema version.

Initial clock kinds are calendar, duration, logical, event, external,
simulation, market, and composite (`CTL-TIME-001`).

A wall-clock timestamp is not a universal coordinate. A venue sequence, block
height, release number, oracle round, simulation step, and civil date are not
implicitly comparable.

## Cross-clock relationships

A predicate comparing distinct clock identifiers MUST name a mapping or arbiter
declared by the contract (`CTL-TIME-002`). Implementations MUST reject an
undeclared comparison. A mapping is versioned data and becomes part of the
compiled contract digest.

## Observation times

Observations and accepted events distinguish:

- `occurredAt`: when the source says the event happened;
- `observedAt`: when the collector first observed it;
- `recordedAt`: when Timeline accepted it;
- `effectiveAt`: when the contract says it takes effect.

Implementations MAY record additional monotonic, ingestion, decision, and
evaluation times. They MUST NOT silently replace one time dimension with
another (`CTL-TIME-003`).

Backtests and simulations may only use evidence whose observation coordinate
was available at the simulated decision coordinate.

## Finality

Initial finality states are `provisional`, `confirmed`, `final`, `superseded`,
and `reverted`. Finality is a declared property of an observation, not inferred
from elapsed wall time.

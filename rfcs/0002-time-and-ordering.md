# RFC 0002: Time and Ordering

- Status: Draft
- Compatibility: Foundational

## Problem

Wall-clock timestamps cannot safely represent release order, venue sequence,
block finality, oracle rounds, simulation steps, or when evidence became known.

## Proposed design

Clocks are typed and declare coordinate representation, authority, ordering,
uncertainty, and finality. Initial kinds are calendar, duration, logical, event,
external, simulation, market, and composite.

Events distinguish occurrence, observation, record, and effective time.
Cross-clock comparison requires a declared mapping or arbiter.

## Invariants

- Independent sources have no implicit global order.
- Backtests use only evidence available at decision time.
- Finality is explicit and reversible when the source permits it.

## Conformance

Cases cover typed clocks, unmapped comparisons, time dimensions, lateness, and
future-data rejection.

## Unresolved questions

- Whether hybrid logical time is normative or a runtime projection.
- How calendar and time-zone database versions enter contract identity.

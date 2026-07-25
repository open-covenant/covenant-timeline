# Events and Corrections

## Event stream

An accepted event MUST contain:

- a content digest;
- run and stream identifiers;
- stream sequence and expected prior version;
- type and schema;
- contract digest;
- relevant clock observations;
- payload or payload digest;
- actor or collector identity;
- causal parents where known.

Accepted events are append-only (`CTL-EVENT-001`). Stream sequence and expected
prior version provide optimistic concurrency within one stream
(`CTL-EVENT-002`). Sequence does not assert a global total order across
independent streams.

## Corrections and reversals

A correction, revocation, reorg, dispute, redaction, or changed interpretation
MUST append an event referencing the affected event (`CTL-EVENT-003`). It MUST
NOT erase or replace the historical event.

Materialized views project the current interpretation. They are not the
authoritative ledger and may be rebuilt.

## Sensitive evidence

Raw secrets, private keys, and sensitive payloads MUST NOT enter the immutable
event stream. The event may retain a digest, media type, access class,
retention state, and retrieval reference.

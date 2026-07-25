# Compatibility

Every portable object identifies its schema version. Unknown fields fail unless
they are carried in the extension namespace.

Required extensions that an implementation does not understand MUST fail.
Optional extensions MAY be preserved without interpretation (`CTL-EXT-001`).

Before beta:

- breaking changes use a new alpha schema version;
- fixtures from released alpha versions remain in the repository;
- migration tools are preferred over silent coercion;
- no SemVer stability claim applies to the prototype package.

The bootstrap state-binding hardening does not change projected state or pinned
state digests. Exact contract and receipt-ID indexes are private reducer
metadata. They are intentionally not portable snapshots; a process boundary
reconstructs them by replaying the pinned contract and event stream.

Stable compatibility begins only after two implementations agree on canonical
fixtures and real Covenant and external runs complete an upgrade.

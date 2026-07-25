# Extensions and Compatibility

## Extensions

Extension identifiers are globally unique URIs. A required extension changes
whether a document can be interpreted safely. An implementation MUST reject an
unknown required extension. It MAY preserve an unknown optional extension
without interpreting it (`CTL-EXT-001`).

Extensions cannot change core canonicalization, ordering, replay, or authority
semantics.

## Versioning

The specification, schemas, conformance suite, engine, storage, HTTP API,
plugin ABI, SDKs, adapters, and domain profiles are versioned independently.

Major-zero versions are unstable. A stable implementation must continue to
verify historical runs using their pinned specification and policy versions.

Unknown core fields fail. Stable semantic fields are not removed or redefined
within a major version. Migration creates a new object with lineage; it does
not rewrite the original.

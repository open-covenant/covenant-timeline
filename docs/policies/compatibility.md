# Compatibility Policy

The specification, schemas, conformance corpus, SDKs, adapters, and profiles are
versioned independently.

All `0.x` surfaces are unstable. Breaking changes still require a changelog
entry, compatibility classification, and migration instructions.

Every run pins exact schema, policy, profile, and dependency versions or
digests. New software must preserve verification of historical runs under their
pinned semantics.

Unknown normative fields fail closed. Extensions are valid only inside the
defined extension namespace. Released fixtures and accepted historical events
are not rewritten.

After v1, SemVer applies per component. Stable deprecations last at least two
minor releases and six months. A breaking stable change requires a major
version unless a documented security emergency makes compatibility unsafe.

A compatibility claim means passing named conformance versions. It does not
claim general safety or fitness. No independent conforming implementation
exists yet.

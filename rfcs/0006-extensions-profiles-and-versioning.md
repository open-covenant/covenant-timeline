# RFC 0006: Extensions, Profiles, and Versioning

- Status: Draft
- Compatibility: Foundational

## Problem

Profiles must add domain vocabulary without silently changing core behavior.

## Proposed design

Extensions use globally unique URIs and declare whether they are required or
optional. Unknown required extensions fail. Unknown optional extensions remain
identifiable and preservable.

Specifications, schemas, conformance corpora, SDKs, adapters, and profiles are
independently versioned.

## Invariants

- Extensions cannot redefine canonicalization, ordering, replay, or the effect
  boundary.
- Stable readers keep verifying historical pinned runs.
- Migrations create new objects instead of rewriting historical bytes.

## Conformance

Required and optional extension behavior, compatibility matrices, and
historical fixtures are tested.

## Unresolved questions

- Whether extension discovery belongs in this project.
- Minimum deprecation windows before v1.

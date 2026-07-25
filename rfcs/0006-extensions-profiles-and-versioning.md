# RFC 0006: Extensions, Profiles, and Versioning

- Status: Draft
- Compatibility: Foundational

## Problem

Profiles must add domain vocabulary without silently changing core behavior.

## Proposed design

Extensions use globally unique URIs and declare whether they are required or
optional. Unknown required extensions fail. Unknown optional extensions remain
identifiable and preservable.

Specifications, schemas, conformance, kernels, runtimes, APIs, plugin ABIs,
SDKs, adapters, and profiles are independently versioned.

## Invariants

- Extensions cannot redefine canonicalization, ordering, replay, or authority.
- Stable readers keep verifying historical pinned runs.
- Corrections and migrations create new lineage instead of rewriting history.

## Conformance

Required and optional extension behavior, compatibility matrices, and
historical fixtures are tested.

## Unresolved questions

- Extension discovery and trust registry.
- Minimum deprecation windows before v1.

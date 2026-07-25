# RFC 0003: Canonicalization and Identity

- Status: Draft
- Compatibility: Foundational

## Problem

Replay and attestations require the same semantic input to have one portable
byte identity.

## Proposed design

Normative objects use I-JSON-compatible values and RFC 8785 canonical JSON.
Identifiers are SHA-256 digests over canonical UTF-8 bytes. Semantic defaults
are expanded during compilation and included in the compiled contract.

## Invariants

- No locale, key insertion order, or implicit default changes identity.
- Original objects stay verifiable after migration.

## Conformance

Golden bytes, Unicode and number edge cases, digests, and cross-language
differential cases are required.

## Unresolved questions

- Whether deterministic CBOR becomes an optional transport profile.
- Digest agility and multihash compatibility.

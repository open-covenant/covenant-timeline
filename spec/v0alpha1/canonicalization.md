# Canonicalization

Portable objects will use I-JSON-compatible values and RFC 8785 JSON
Canonicalization Scheme output. Content identifiers will be lowercase SHA-256
digests over canonical UTF-8 bytes.

Semantic defaults MUST be expanded before hashing. Ambient configuration MUST
NOT change canonical bytes.

The TypeScript package uses the pinned `canonicalize` RFC 8785 implementation
and rejects non-I-JSON values before serialization. Content identities use
lowercase SHA-256 over the canonical UTF-8 bytes.

The conformance suite includes the upstream JSON Canonicalization Scheme
fixtures for arrays, Unicode, locale-independent ordering, nested structures,
and ECMAScript number serialization. CI checks those expected bytes with both
the TypeScript package and the independent Python `rfc8785` implementation.
Replay fixture state digests pin byte identity across CLI upgrades.

The upstream 100-million-number stress corpus is not run in normal CI.
Cross-language agreement currently covers the published fixture corpus, not
every possible IEEE-754 value.

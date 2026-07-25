# Canonicalization

Portable objects will use I-JSON-compatible values and RFC 8785 JSON
Canonicalization Scheme output. Content identifiers will be lowercase SHA-256
digests over canonical UTF-8 bytes.

Semantic defaults MUST be expanded before hashing. Ambient configuration MUST
NOT change canonical bytes.

The bootstrap conformance runner currently tests only deterministic key ordering
for the supported fixture subset. It is not a complete RFC 8785 implementation.
Full byte-level conformance requires:

- a reviewed RFC 8785 implementation;
- invalid Unicode and number edge cases;
- official and adversarial fixtures;
- agreement between at least two languages.

Until then, `CTL-REPLAY-001` is a bootstrap stability requirement, not a stable
interoperability promise.

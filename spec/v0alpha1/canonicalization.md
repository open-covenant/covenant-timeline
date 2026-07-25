# Canonicalization and Quantities

## Canonical identity

Normative JSON objects use I-JSON-compatible values and RFC 8785 JSON
Canonicalization Scheme output. Content identifiers are lowercase hexadecimal
SHA-256 digests over canonical UTF-8 bytes unless a future version declares a
different algorithm.

Canonicalization does not fill defaults from ambient configuration. Defaults
that affect semantics are expanded during compilation and included in the
compiled contract.

## Quantities

Normative financial and physical quantities MUST carry a unit. Financial
quantities also identify an asset, venue or network where relevant, and scale.

Binary floating point is prohibited in normative financial evaluation.
Quantities use bounded integers, normalized decimal strings with explicit
scale, or explicit rationals with mandated rounding (`CTL-NUM-001`).

Example:

```json
{
  "value": "1250500",
  "scale": 4,
  "unit": "USDC"
}
```

This represents `125.0500 USDC`.

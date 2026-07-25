# Errors

Errors are machine-readable and stable within one protocol version.

An error contains:

```text
code
message
path
requirement
details
```

Initial classes:

| Code                                  | Meaning                                       |
| ------------------------------------- | --------------------------------------------- |
| `schema.invalid`                      | Document does not satisfy its declared schema |
| `timeline.clock.mapping_required`     | Cross-clock operation has no declared mapping |
| `timeline.extension.required_unknown` | Required extension is unsupported             |
| `timeline.replay.effect_forbidden`    | Replay attempted to authorize an effect       |
| `timeline.authority.score_not_grant`  | Scorecard was used as direct authority        |
| `timeline.quantity.invalid`           | Quantity, unit, scale, or rounding is invalid |
| `timeline.stream.version_conflict`    | Expected prior stream version does not match  |

Human-readable messages may improve without changing the code. Conformance
asserts codes, not message text.

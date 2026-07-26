# Replay performance and snapshot decision

Measured on 2026-07-26 with Node.js 24.14.0 on Darwin arm64:

| Events | Samples (ms)           | Median (ms) |
| ------ | ---------------------- | ----------- |
| 50,000 | 316.35, 325.36, 346.56 | 325.36      |

The benchmark uses the current maximum event count and projects 50,000
profile-bound evidence records. Run it with:

```sh
pnpm replay:benchmark
```

Portable continuation stores the contract and accepted event stream, then
replays them after restart. `FileRunArchiveStore` provides atomic filesystem
storage for that archive. It does not serialize or hydrate private reducer
metadata.

Snapshot hydration is not justified by this measurement. A sub-second median at
the supported maximum is materially cheaper and safer than introducing a second
trusted state format. Reconsider only when an independently operated adopter
provides a run, hardware profile, restart objective, and measured replay cost
that the event archive cannot meet.

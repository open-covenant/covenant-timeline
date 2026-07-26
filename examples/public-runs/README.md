# Public runs

These archives are generated from authenticated public evidence and contain no
private signing key or API credential.

`temporal-sdk-typescript-pr-2219.json` records a public software-delivery run
whose source pull request remained open for more than four days. Separate
collector, resume, and finalize processes exercise replay across a process
boundary. The archive contains the pinned policy, collector public key,
revocation snapshot, signed normalized GitHub payload, v0alpha2 run, and final
state digest.

Reverify it with:

```sh
pnpm build
node scripts/longitudinal-github-run.mjs verify \
  --out examples/public-runs/temporal-sdk-typescript-pr-2219.json
```

The archive proves that the profile and reducer can verify this public record.
It does not claim that the source project adopted Covenant Timeline.

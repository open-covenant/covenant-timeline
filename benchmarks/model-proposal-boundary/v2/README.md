# Model-proposal reliability suite v2

Version 2 is the frozen evidence suite for the existing
`covenant.timeline.model-proposal.v1` protocol. It measures whether a model can
produce compiler-valid, source-grounded proposal deltas and query intent across
three-cut temporal records.

The suite contains:

- 12 cases across six temporal families;
- 36 cuts and 108 observations at three repeats;
- one evidence record per gold temporal change;
- opaque evidence IDs and two realistic distractor records at every cut;
- explicit acceptable quote spans;
- corrections, confirmations, retractions, constraints, contradictions,
  historical queries, context traps, and interval relations; and
- a preregistered binary reliability gate.

Read [`PREREGISTRATION.md`](./PREREGISTRATION.md) before running the model. The
decision thresholds and operational retry rule are frozen there. A passing
result supports proposal-interface reliability only. This suite has no
baseline arm and cannot establish superiority over another memory or extraction
system.

The committed corpus is generated deterministically:

```sh
pnpm model-proposal:v2:materialize
pnpm model-proposal:test
```

The materialization test requires byte-identical corpus and support artifacts.
The formal workflow initializes and retains an attempt ledger, registers each
permitted attempt, and uses the v2 runner to claim that attempt and its output
path atomically before inference. The formal CLI rejects reuse and alternate
outputs against the retained ledger. These are operator-attested controls, not
cryptographic proof that the operator made no undisclosed provider calls. The
result, ledger, and gate remain verifiable after they are copied to another
location. After a provider run, evaluate its complete JSONL artifact with:

```sh
pnpm model-proposal:v2:gate -- \
  --results /tmp/covenant-timeline-proposal-v2-results.jsonl \
  --ledger /tmp/covenant-timeline-proposal-v2-ledger.json \
  --output /tmp/covenant-timeline-proposal-v2-gate.json
```

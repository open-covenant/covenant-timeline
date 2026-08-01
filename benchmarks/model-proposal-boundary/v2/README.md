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

## Recorded outcome

The first operationally valid attempt completed on 2026-08-01 against source
commit `fcdc4bcf5554bea58c754685aae11ed1e61853a3` using GPT-5.6 Sol. It
completed all 108 observations and returned `kill`.

Assertion F1 was 0.7692, projected-state and end-to-end exactness were 76/108,
and answer exactness was 87/108. Response schemas were valid on 108/108
observations, 107/108 candidates compiled and produced a projected result, and
every resulting proof verified. The failed semantic thresholds independently
determine the outcome.

The acceptable-support scorer also exposed a frozen oracle defect: it generally
required one full-sentence quote while the prompt requested the smallest
supporting substring. That defect makes the reported 0.1958 support F1
unsuitable as a standalone grounding estimate, but correcting it cannot change
the failed assertion, state, or answer gates.

See the [result analysis](../../../docs/model-proposal-v2-result.md) and
[complete release bundle](https://github.com/open-covenant/covenant-timeline/releases/tag/model-proposal-v2-attempt-1-2026-08-01).
The v2 interface and corpus will not be tuned or rerun.

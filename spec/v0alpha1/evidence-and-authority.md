# Evidence, Scorecards, and Authority

## Evidence

Evidence identifies:

- subject and claim;
- payload digest, media type, size, and retrieval reference;
- producer, collector, source, and signer where applicable;
- collection method and configuration;
- time coverage and relevant clock observations;
- provenance parents;
- confidence, completeness, finality, and revocation;
- confidentiality and retention class.

The subject, claim, payload digest, producer, and time coverage are required
(`CTL-EVID-001`). A signature proves that an identity signed bytes; source
policy determines whether those bytes support a claim.

## Evaluation

An evaluation names its evaluator, policy, inputs, output dimensions, units,
missing-data behavior, and explanation. Model-backed evaluations also pin the
model, prompt, fixture, provider, and declared nondeterminism.

## Scorecards

The minimum scorecard scope is:

```text
subject × capability × environment × policy × time window
```

A scorecard retains dimensions, units, evidence references, confidence,
missingness, sample coverage, policy, evaluator, and applicability boundaries
(`CTL-SCORE-001`). A scalar aggregate is optional.

## Authority

A scorecard is not an authorization (`CTL-AUTH-001`). A separate policy
combines scorecard evidence with current state, exposure, approvals, and hard
limits to produce a decision.

The project does not define human consumer, employment, insurance, or housing
credit scoring.

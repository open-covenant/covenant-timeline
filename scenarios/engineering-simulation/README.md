# Engineering Simulation

An engineering system is evaluated under a pinned model package, dependency
set, units, inputs, tolerances, deterministic seed, and virtual-clock policy.
One branch changes a failure schedule; another changes a model parameter.

Repeated execution of the same branch must produce the same canonical
decision. Branches retain their common ancestor and counterfactual identity.
Simulation evidence remains distinct from observed physical measurements.

The scenario fails if ambient time, locale, randomness, mutable model files, or
unversioned units change the result.

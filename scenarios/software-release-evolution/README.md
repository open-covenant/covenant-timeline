# Software Release Evolution

A repository advances through six releases. Release 3 introduces a regression,
release 4 repairs it, and release 6 passes every final gate.

The run must retain:

- source, requirement, toolchain, and policy identity per release;
- the first checkpoint where the regression appears;
- repair evidence and recovery time;
- separate snapshot and trajectory evaluations.

The release-6 result cannot replace or average away the release-3 failure.
Policy may accept the final release while still reporting the regression,
volatility, and recovery dimensions.

This scenario will provide Git, CI, coverage, security, and maintainability
evidence through the software-evolution profile.

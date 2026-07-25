# Agent Capability Delegation

An agent completes a series of scoped software deliveries. Evidence includes CI
results, review approvals, policy outcomes, disputes, and repairs.

A checkpoint contract requires explicit claims before it emits a Covenant
capability request:

```text
delivery.accepted + ci.tests.pass + review.approved
    -> covenant.capability.request
```

Covenant independently evaluates the request against current capabilities,
expiry, limits, and operator policy. It returns a receipt whether the request
succeeds or fails.

The scenario fails if missing evidence disappears from the decision, Timeline
directly grants a capability, replay invokes Covenant, or the agent can extend
its own mandate.

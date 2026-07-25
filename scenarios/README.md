# Reference Scenarios

Reference scenarios pressure-test the core boundary across disciplines. They are
non-normative: conformance behavior lives under `conformance/`.

Each scenario defines one failure that the protocol must make impossible or
visible:

| Scenario                                                      | Boundary                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| [Software release evolution](./software-release-evolution/)   | Final success cannot erase an intermediate regression     |
| [Agent capability delegation](./agent-capability-delegation/) | A scorecard recommends; independent policy authorizes     |
| [Trading shadow promotion](./trading-shadow-promotion/)       | Environment promotion is a decision, not a flag change    |
| [Prediction-market dispute](./prediction-market-dispute/)     | Dispute and finality append history                       |
| [Engineering simulation](./engineering-simulation/)           | Pinned model inputs and virtual time reproduce a decision |

Executable event sets and expected outputs will be added through conformance
RFCs rather than invented independently in the examples.

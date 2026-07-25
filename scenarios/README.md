# Reference Scenarios

Reference scenarios pressure-test the first product wedge. They are
non-normative; conformance behavior lives under `conformance/`.

Each scenario defines one failure that the protocol must make impossible or
visible:

| Scenario                                                      | Boundary                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Software release evolution](./software-release-evolution/)   | Final success cannot erase an intermediate regression                   |
| [Agent capability delegation](./agent-capability-delegation/) | Evidence can support a request but cannot bypass Covenant authorization |

The runnable software-release example lives under `examples/`. Additional
fixtures will be added through conformance RFCs.

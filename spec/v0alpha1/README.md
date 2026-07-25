# Covenant Timeline Core v0alpha1

Status: draft.

This directory contains the normative prose for the first Covenant Timeline
protocol iteration. The specification is incomplete and unstable.

Normative authority is ordered as follows:

1. this prose specification defines semantics;
2. JSON Schemas define document structure;
3. conformance cases define mechanically testable behavior;
4. RFCs record decisions and do not override a released specification;
5. scenarios are non-normative demonstrations.

The words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to
be interpreted as described by RFC 2119 and RFC 8174 when written in uppercase.

## Documents

- [Requirements](./requirements.md)
- [Object model](./object-model.md)
- [Clocks and ordering](./clocks.md)
- [Events and corrections](./events.md)
- [Reducer, replay, and effects](./replay-and-effects.md)
- [Evidence, scorecards, and authority](./evidence-and-authority.md)
- [Canonicalization and quantities](./canonicalization.md)
- [Extensions and compatibility](./compatibility.md)
- [Errors](./errors.md)

## Conformance

An implementation claiming `CORE/v0alpha1` conformance MUST identify the exact
specification and conformance-suite revisions it implements. Conformance means
protocol compatibility. It does not establish security, policy quality,
regulatory compliance, trading safety, or profitability.

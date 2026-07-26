# Python reducer

This is a second-language v0alpha2 reducer using Python and RFC 8785
canonicalization. It has no effect dispatcher and no dependency on the
TypeScript implementation.

`scripts/check-python-reducer.py` runs every v0alpha2 replay fixture and the
public longitudinal archive through this reducer and compares their state
digests with the corpus pinned by the TypeScript implementation.

Both implementations currently live in this repository. This establishes
cross-language conformance, not independent maintenance or governance.

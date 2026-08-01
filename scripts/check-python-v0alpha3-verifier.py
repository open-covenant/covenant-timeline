#!/usr/bin/env python3

import copy
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "implementations" / "python"))

import covenant_timeline_v0alpha3 as verifier  # noqa: E402


verify_conclusion = verifier.verify_conclusion


def main() -> None:
    fixtures = [
        (
            ROOT / "conformance" / "v0alpha3" / "runs" / "software-release.json",
            ROOT / "conformance" / "v0alpha3" / "queries" / "difference-bounds.json",
            ROOT
            / "conformance"
            / "v0alpha3"
            / "conclusions"
            / "difference-bounds.json",
        ),
        *[
            (
                ROOT / "conformance" / "v0alpha3" / "runs" / "software-release.json",
                ROOT
                / "conformance"
                / "v0alpha3"
                / "queries"
                / f"consistency-{phase}-correction.json",
                ROOT
                / "conformance"
                / "v0alpha3"
                / "conclusions"
                / f"consistency-{phase}-correction.json",
            )
            for phase in ("before", "after")
        ],
        *[
            (
                ROOT / "examples" / "correction-replay" / "run.json",
                ROOT / "examples" / "correction-replay" / "queries" / f"{name}.json",
                ROOT
                / "examples"
                / "correction-replay"
                / "conclusions"
                / f"{name}.json",
            )
            for name in ("before", "transition", "after")
        ],
    ]
    failures = []
    for run_path, query_path, conclusion_path in fixtures:
        run = load(run_path)
        query = load(query_path)
        conclusion = load(conclusion_path)
        label = conclusion_path.relative_to(ROOT)
        if not verify_conclusion(run, query, conclusion):
            failures.append(f"{label}: valid receipt was rejected")
            continue

        tampered = copy.deepcopy(conclusion)
        tampered["receipt"]["semanticResultDigest"] = "sha256:" + ("0" * 64)
        if verify_conclusion(run, query, tampered):
            failures.append(f"{label}: substituted result digest was accepted")

        tampered = copy.deepcopy(conclusion)
        proof = tampered["receipt"]["proof"]
        edges = proof.get("edges") or proof.get("upperEdges")
        if edges:
            edges[0]["maximum"] += 1
            if verify_conclusion(run, query, tampered):
                failures.append(f"{label}: substituted proof edge was accepted")
        elif proof.get("coordinates"):
            point_id = sorted(proof["coordinates"])[0]
            proof["coordinates"][point_id] += 1_000_000_000
            if verify_conclusion(run, query, tampered):
                failures.append(f"{label}: substituted schedule was accepted")

        malformed = copy.deepcopy(conclusion)
        proof = malformed["receipt"]["proof"]
        if "upperEdges" in proof:
            proof["upperEdges"] = [7]
            if verify_conclusion(run, query, malformed):
                failures.append(f"{label}: scalar bound-path edge was accepted")
        elif "edges" in proof:
            proof["edges"].append(7)
            if verify_conclusion(run, query, malformed):
                failures.append(f"{label}: scalar negative-cycle edge was accepted")

        float_run = integral_numbers_as_floats(run)
        float_query = integral_numbers_as_floats(query)
        float_conclusion = integral_numbers_as_floats(conclusion)
        if not verify_conclusion(float_run, float_query, float_conclusion):
            failures.append(f"{label}: integral JSON numbers were rejected")

    run = load(ROOT / "examples" / "correction-replay" / "run.json")
    query = load(ROOT / "examples" / "correction-replay" / "queries" / "before.json")
    conclusion = load(
        ROOT / "examples" / "correction-replay" / "conclusions" / "before.json"
    )
    for label, value in (
        ("boolean", True),
        ("fractional", 100.5),
        ("non-finite", float("inf")),
        ("out-of-range", float(2**53)),
    ):
        malformed = copy.deepcopy(run)
        malformed_coordinate = malformed["events"][2]["assertion"]["coordinate"]
        malformed_coordinate["minimum"] = value
        malformed_coordinate["maximum"] = value
        if verify_conclusion(malformed, query, conclusion):
            failures.append(f"{label} numeric bound was accepted")

    boolean_sequence = copy.deepcopy(run)
    boolean_sequence["events"][1]["sequence"] = True
    boolean_conclusion = copy.deepcopy(conclusion)
    boolean_conclusion["receipt"]["stateDigest"] = verifier.digest(
        {
            "schema": "covenant.timeline.state-input.v0alpha3",
            "contract": boolean_sequence["contract"],
            "contextId": query["contextId"],
            "recordedThrough": query["recordedThrough"],
            "events": boolean_sequence["events"][: query["recordedThrough"] + 1],
        }
    )
    if verify_conclusion(boolean_sequence, query, boolean_conclusion):
        failures.append("boolean event sequence was accepted")

    deeply_nested = copy.deepcopy(conclusion)
    nested = None
    for _ in range(sys.getrecursionlimit() + 100):
        nested = [nested]
    deeply_nested["result"] = nested
    if verify_conclusion(run, query, deeply_nested):
        failures.append("deeply nested malformed result was accepted")

    oversized_axes = copy.deepcopy(run)
    oversized_axes["contract"]["axes"] = [
        {
            "id": f"axis-{index}",
            "kind": "metric",
            "unit": "second",
            "origin": f"origin-{index}",
        }
        for index in range(verifier.MAX_AXES + 1)
    ]
    if verify_conclusion(oversized_axes, query, conclusion):
        failures.append("oversized axis array was accepted")

    oversized_references = copy.deepcopy(run)
    oversized_references["events"][2]["assertion"]["evidenceRefs"] = [
        f"sha256:{index:064x}" for index in range(verifier.MAX_EVIDENCE_REFS + 1)
    ]
    if verify_conclusion(oversized_references, query, conclusion):
        failures.append("oversized evidence-reference array was accepted")

    canonical_boundary = [None] * (verifier.MAX_CANONICAL_NODES - 1)
    try:
        verifier.digest(canonical_boundary)
    except Exception:
        failures.append("exact canonical node boundary was rejected")
    canonical_boundary.append(None)
    try:
        verifier.digest(canonical_boundary)
        failures.append("canonical node boundary overflow was accepted")
    except verifier.TemporalVerificationError:
        pass

    depth_boundary = None
    for _ in range(verifier.MAX_CANONICAL_DEPTH):
        depth_boundary = [depth_boundary]
    try:
        verifier.digest(depth_boundary)
    except Exception:
        failures.append("exact canonical depth boundary was rejected")
    try:
        verifier.digest([depth_boundary])
        failures.append("canonical depth boundary overflow was accepted")
    except verifier.TemporalVerificationError:
        pass

    composed_limit = composed_canonical_limit_run()
    try:
        verifier.validate_canonical_shape(composed_limit)
        failures.append("composed canonical node overflow was accepted")
    except verifier.TemporalVerificationError:
        pass
    if verify_conclusion(composed_limit, query, conclusion):
        failures.append("composed canonical node overflow verified a receipt")

    original_operations = verifier.MAX_OPERATIONS
    try:
        verifier.MAX_OPERATIONS = 0
        if verify_conclusion(run, query, conclusion):
            failures.append("operation-budget exhaustion was accepted")
    finally:
        verifier.MAX_OPERATIONS = original_operations

    if failures:
        raise SystemExit("\n".join(failures))
    print(
        "Python v0alpha3 verifier passed "
        f"({len(fixtures)} receipts across schedules, bounds, and a negative cycle)"
    )


def load(path: Path):
    def strict_object(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError(f"duplicate key {key}")
            value[key] = item
        return value

    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=strict_object)


def integral_numbers_as_floats(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return float(value)
    if isinstance(value, list):
        return [integral_numbers_as_floats(item) for item in value]
    if isinstance(value, dict):
        return {key: integral_numbers_as_floats(item) for key, item in value.items()}
    return value


def composed_canonical_limit_run():
    references = [
        f"sha256:{index:064x}" for index in range(verifier.MAX_EVIDENCE_REFS)
    ]
    contract = {
        "schema": "covenant.timeline.contract.v0alpha3",
        "id": "canonical-limit",
        "subject": {"kind": "repository", "id": "canonical-limit"},
        "axes": [
            {
                "id": "time",
                "kind": "metric",
                "unit": "millisecond",
                "origin": "unix",
            }
        ],
        "contexts": [{"id": "actual", "mode": "actual"}],
    }
    events = [
        {
            "schema": "covenant.timeline.event.v0alpha3",
            "id": "declare-point",
            "sequence": 0,
            "type": "point.declared",
            "point": {"id": "point", "contextId": "actual", "axisId": "time"},
        }
    ]
    for index in range(101):
        events.append(
            {
                "schema": "covenant.timeline.event.v0alpha3",
                "id": f"event-{index}",
                "sequence": index + 1,
                "type": "coordinate.asserted",
                "assertion": {
                    "id": f"assertion-{index}",
                    "contextId": "actual",
                    "pointId": "point",
                    "coordinate": {"minimum": 0, "maximum": 0},
                    "evidenceRefs": references,
                },
            }
        )
    return {
        "schema": "covenant.timeline.run.v0alpha3",
        "contract": contract,
        "events": events,
    }


if __name__ == "__main__":
    main()

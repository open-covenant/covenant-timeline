#!/usr/bin/env python3

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "implementations" / "python"))

from covenant_timeline import evaluate_run, validate_document  # noqa: E402


def main() -> None:
    cases = load(ROOT / "conformance" / "v0alpha2" / "run-cases.json")
    failures = []
    document_cases = load(
        ROOT / "conformance" / "v0alpha2" / "cases.json"
    )

    for case in document_cases:
        target = case["targetSchema"].rsplit("/", 1)[-1]
        try:
            valid = validate_document(case["document"], target)
        except Exception as error:
            failures.append(
                f'{case["id"]}: Python validator raised {type(error).__name__}'
            )
            continue
        if valid and case.get("semanticCheck") == "duplicate-checkpoints":
            checkpoint_ids = [
                checkpoint["id"]
                for checkpoint in case["document"].get("checkpoints", [])
            ]
            valid = len(checkpoint_ids) == len(set(checkpoint_ids))
        if valid != case["expect"]["valid"]:
            failures.append(
                f'{case["id"]}: Python document validation changed'
            )

    malformed_values = [
        (
            "decision.schema.json",
            {
                "schema": "covenant.timeline.decision.v0alpha2",
                "checkpointId": "complete",
                "outcome": [],
                "policy": {
                    "profile": "test.profile",
                    "policyRef": "test.policy",
                    "policyDigest": "sha256:" + ("a" * 64),
                },
                "evidenceRefs": [],
                "missingRequirements": [],
            },
        ),
        (
            "receipt.schema.json",
            {
                "id": "receipt",
                "commandId": "run:complete:1",
                "status": [],
                "effectDigest": "sha256:" + ("a" * 64),
            },
        ),
        (
            "evidence.schema.json",
            {
                "id": "evidence",
                "kind": "test",
                "claims": [[]],
                "payloadDigest": "sha256:" + ("a" * 64),
                "producer": "test",
                "authority": {},
            },
        ),
    ]
    for target, document in malformed_values:
        try:
            if validate_document(document, target):
                failures.append(f"{target}: accepted malformed Python value")
        except Exception as error:
            failures.append(
                f"{target}: malformed value raised {type(error).__name__}"
            )

    for case in cases:
        if not case["expect"]["valid"]:
            continue
        document = load(
            ROOT / "conformance" / "v0alpha2" / case["file"]
        )
        report = evaluate_run(document)
        if report["stateDigest"] != case["expect"]["stateDigest"]:
            failures.append(f'{case["id"]}: Python state digest changed')
        if report["verification"]["ok"] != case["expect"]["ok"]:
            failures.append(f'{case["id"]}: Python verification changed')

    archive = load(
        ROOT
        / "examples"
        / "public-runs"
        / "temporal-sdk-typescript-pr-2219.json"
    )
    public_report = evaluate_run(archive["run"])
    if public_report["stateDigest"] != archive["finalStateDigest"]:
        failures.append("public run: Python state digest changed")
    if not public_report["verification"]["ok"]:
        failures.append("public run: Python verification failed")

    if failures:
        raise SystemExit("\n".join(failures))
    print(
        "Python reducer passed "
        f"({len(document_cases)} documents, {len(cases)} runs, "
        "and 1 public archive)"
    )


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()

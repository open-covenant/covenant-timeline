#!/usr/bin/env python3

import json
from pathlib import Path

import rfc8785


CASES = Path("conformance/rfc8785/cases.json")


def main() -> None:
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    failures = []

    for case in cases:
        actual = rfc8785.dumps(case["input"]).decode("utf-8")
        if actual != case["canonical"]:
            failures.append(f'{case["id"]}: canonical output mismatch')

    if failures:
        raise SystemExit("\n".join(failures))

    print(f"cross-language canonicalization passed ({len(cases)} cases)")


if __name__ == "__main__":
    main()

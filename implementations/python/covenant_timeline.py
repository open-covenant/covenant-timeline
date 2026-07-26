from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import urlsplit

import rfc8785


IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9._:/-]{0,127}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")


def digest(value: Any) -> str:
    return f"sha256:{hashlib.sha256(rfc8785.dumps(value)).hexdigest()}"


def validate_document(document: Any, target: str) -> bool:
    validators = {
        "contract.schema.json": validate_contract,
        "evidence.schema.json": validate_evidence,
        "event.schema.json": validate_event,
        "decision.schema.json": validate_decision,
        "command.schema.json": validate_command,
        "receipt.schema.json": validate_receipt,
        "run.schema.json": validate_run,
    }
    validator = validators.get(target)
    return validator(document) if validator else False


def validate_contract(value: Any) -> bool:
    if not exact_object(
        value, {"schema", "id", "subject", "checkpoints"}, {"extensions"}
    ):
        return False
    if (
        value["schema"] != "covenant.timeline.contract.v0alpha2"
        or not identifier(value["id"])
        or not exact_object(value["subject"], {"kind", "id"})
        or not identifier(value["subject"]["kind"])
        or not identifier(value["subject"]["id"])
        or not isinstance(value["checkpoints"], list)
        or not value["checkpoints"]
    ):
        return False
    for checkpoint in value["checkpoints"]:
        if not exact_object(
            checkpoint, {"id", "requirements", "policy"}, {"onAccept"}
        ):
            return False
        if (
            not identifier(checkpoint["id"])
            or not identifier_list(checkpoint["requirements"], False)
            or not validate_policy_binding(checkpoint["policy"])
        ):
            return False
        if "onAccept" in checkpoint:
            command = checkpoint["onAccept"]
            if (
                not exact_object(command, {"kind", "payloadRef"})
                or not identifier(command["kind"])
                or not identifier(command["payloadRef"])
            ):
                return False
    checkpoint_ids = [checkpoint["id"] for checkpoint in value["checkpoints"]]
    if len(checkpoint_ids) != len(set(checkpoint_ids)):
        return False
    if "extensions" in value and not validate_extensions(value["extensions"]):
        return False
    return True


def validate_evidence(value: Any) -> bool:
    if not exact_object(
        value,
        {"id", "kind", "claims", "payloadDigest", "producer", "authority"},
    ):
        return False
    authority = value["authority"]
    return (
        identifier(value["id"])
        and identifier(value["kind"])
        and identifier_list(value["claims"], False)
        and is_digest(value["payloadDigest"])
        and identifier(value["producer"])
        and exact_object(
            authority,
            {"profile", "policyRef", "policyDigest", "proofDigest"},
        )
        and validate_policy_binding(authority, {"proofDigest"})
        and is_digest(authority["proofDigest"])
    )


def validate_event(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    base = (
        value.get("schema") == "covenant.timeline.event.v0alpha2"
        and identifier(value.get("id"))
        and isinstance(value.get("sequence"), int)
        and not isinstance(value.get("sequence"), bool)
        and 0 <= value["sequence"] <= 9_007_199_254_740_991
    )
    if not base:
        return False
    if value.get("type") == "evidence.recorded":
        return exact_object(
            value, {"schema", "id", "sequence", "type", "evidence"}
        ) and validate_evidence(value["evidence"])
    if value.get("type") == "checkpoint.evaluated":
        return (
            exact_object(
                value,
                {
                    "schema",
                    "id",
                    "sequence",
                    "type",
                    "checkpointId",
                    "evidenceRefs",
                },
            )
            and identifier(value["checkpointId"])
            and identifier_list(value["evidenceRefs"], True)
        )
    if value.get("type") == "receipt.recorded":
        return exact_object(
            value, {"schema", "id", "sequence", "type", "receipt"}
        ) and validate_receipt(value["receipt"])
    return False


def validate_decision(value: Any) -> bool:
    return (
        exact_object(
            value,
            {
                "schema",
                "checkpointId",
                "outcome",
                "policy",
                "evidenceRefs",
                "missingRequirements",
            },
        )
        and value["schema"] == "covenant.timeline.decision.v0alpha2"
        and identifier(value["checkpointId"])
        and isinstance(value["outcome"], str)
        and value["outcome"] in {"accepted", "rejected"}
        and validate_policy_binding(value["policy"])
        and identifier_list(value["evidenceRefs"], True)
        and identifier_list(value["missingRequirements"], True)
    )


def validate_command(value: Any) -> bool:
    return (
        exact_object(
            value,
            {
                "schema",
                "id",
                "kind",
                "payloadRef",
                "idempotencyKey",
                "replayPolicy",
            },
        )
        and value["schema"] == "covenant.timeline.command.v0alpha2"
        and isinstance(value["id"], str)
        and 1 <= len(value["id"]) <= 512
        and re.fullmatch(r"[a-z0-9][a-z0-9._:/-]*", value["id"]) is not None
        and identifier(value["kind"])
        and identifier(value["payloadRef"])
        and isinstance(value["idempotencyKey"], str)
        and 8 <= len(value["idempotencyKey"]) <= 512
        and value["replayPolicy"] == "forbid"
    )


def validate_receipt(value: Any) -> bool:
    return (
        exact_object(value, {"id", "commandId", "status", "effectDigest"})
        and identifier(value["id"])
        and isinstance(value["commandId"], str)
        and 1 <= len(value["commandId"]) <= 512
        and isinstance(value["status"], str)
        and value["status"] in {"succeeded", "failed", "indeterminate"}
        and is_digest(value["effectDigest"])
    )


def validate_run(value: Any) -> bool:
    if not exact_object(value, {"schema", "runId", "contract", "events"}):
        return False
    if (
        value["schema"] != "covenant.timeline.run.v0alpha2"
        or not identifier(value["runId"])
        or not validate_contract(value["contract"])
        or not isinstance(value["events"], list)
    ):
        return False
    ids = set()
    for index, event in enumerate(value["events"]):
        if (
            not validate_event(event)
            or event["sequence"] != index
            or event["id"] in ids
        ):
            return False
        ids.add(event["id"])
    return True


def validate_policy_binding(
    value: Any, additional: set[str] | None = None
) -> bool:
    required = {"profile", "policyRef", "policyDigest"}
    if not exact_object(value, required | (additional or set())):
        return False
    return (
        identifier(value["profile"])
        and identifier(value["policyRef"])
        and is_digest(value["policyDigest"])
    )


def exact_object(
    value: Any, required: set[str], optional: set[str] | None = None
) -> bool:
    return (
        isinstance(value, dict)
        and required.issubset(value)
        and set(value).issubset(required | (optional or set()))
    )


def identifier(value: Any) -> bool:
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None


def is_digest(value: Any) -> bool:
    return isinstance(value, str) and DIGEST.fullmatch(value) is not None


def identifier_list(value: Any, allow_empty: bool) -> bool:
    return (
        isinstance(value, list)
        and (allow_empty or bool(value))
        and all(identifier(item) for item in value)
        and len(value) == len(set(value))
    )


def validate_extensions(value: Any) -> bool:
    if not exact_object(value, set(), {"required", "optional"}):
        return False
    required = value.get("required")
    if required is not None:
        if not isinstance(required, list) or required:
            return False
    optional = value.get("optional")
    if optional is not None:
        if not isinstance(optional, dict):
            return False
        if not all(absolute_uri(key) for key in optional):
            return False
    return True


def absolute_uri(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    if any(character.isspace() for character in value):
        return False
    try:
        return bool(urlsplit(value).scheme)
    except ValueError:
        return False


def evaluate_run(document: dict[str, Any]) -> dict[str, Any]:
    state = replay(document["contract"], document["runId"], document["events"])
    return {
        "schema": "covenant.timeline.report.v0alpha2",
        "runId": document["runId"],
        "contractDigest": digest(document["contract"]),
        "eventsDigest": digest(document["events"]),
        "stateDigest": digest(state),
        "state": state,
        "verification": verify_run(state),
    }


def replay(
    contract: dict[str, Any], run_id: str, events: list[dict[str, Any]]
) -> dict[str, Any]:
    state: dict[str, Any] = {
        "contractId": contract["id"],
        "runId": run_id,
        "nextSequence": 0,
        "eventIds": {},
        "checkpoints": {
            checkpoint["id"]: {"status": "pending"}
            for checkpoint in contract["checkpoints"]
        },
        "evidence": {},
        "commands": {},
        "receipts": {},
        "findings": [],
    }
    receipt_ids: dict[str, str] = {}
    for event in events:
        apply_event(contract, state, receipt_ids, event)
    return state


def apply_event(
    contract: dict[str, Any],
    state: dict[str, Any],
    receipt_ids: dict[str, str],
    event: dict[str, Any],
) -> None:
    if event["sequence"] != state["nextSequence"]:
        raise ValueError(
            f'event sequence {event["sequence"]} does not match '
            f'{state["nextSequence"]}'
        )
    duplicate = event["id"] in state["eventIds"]
    state["nextSequence"] += 1
    state["eventIds"][event["id"]] = event["sequence"]
    if duplicate:
        add_finding(
            state, "timeline.event.duplicate", event["id"], event["id"]
        )
        return
    if event["type"] == "evidence.recorded":
        record_evidence(state, event)
    elif event["type"] == "checkpoint.evaluated":
        evaluate_checkpoint(contract, state, event)
    elif event["type"] == "receipt.recorded":
        record_receipt(state, receipt_ids, event)
    else:
        raise ValueError(f'unsupported event type {event["type"]}')


def record_evidence(state: dict[str, Any], event: dict[str, Any]) -> None:
    evidence = event["evidence"]
    if evidence["id"] in state["evidence"]:
        add_finding(
            state,
            "timeline.evidence.duplicate",
            event["id"],
            evidence["id"],
        )
        return
    state["evidence"][evidence["id"]] = evidence


def evaluate_checkpoint(
    contract: dict[str, Any], state: dict[str, Any], event: dict[str, Any]
) -> None:
    checkpoint = next(
        (
            value
            for value in contract["checkpoints"]
            if value["id"] == event["checkpointId"]
        ),
        None,
    )
    if checkpoint is None:
        add_finding(
            state,
            "timeline.checkpoint.unknown",
            event["id"],
            event["checkpointId"],
        )
        return
    if state["checkpoints"][checkpoint["id"]]["status"] == "accepted":
        add_finding(
            state,
            "timeline.checkpoint.finalized",
            event["id"],
            checkpoint["id"],
        )
        return

    claims: set[str] = set()
    invalid = False
    for evidence_id in event["evidenceRefs"]:
        evidence = state["evidence"].get(evidence_id)
        if evidence is None:
            add_finding(
                state,
                "timeline.evidence.unknown",
                event["id"],
                evidence_id,
            )
            invalid = True
            continue
        if not same_policy(checkpoint["policy"], evidence["authority"]):
            add_finding(
                state,
                "timeline.evidence.policy_mismatch",
                event["id"],
                evidence_id,
            )
            invalid = True
            continue
        claims.update(evidence["claims"])
    if invalid:
        return

    missing = [
        requirement
        for requirement in checkpoint["requirements"]
        if requirement not in claims
    ]
    outcome = "accepted" if not missing else "rejected"
    decision = {
        "schema": "covenant.timeline.decision.v0alpha2",
        "checkpointId": checkpoint["id"],
        "outcome": outcome,
        "policy": checkpoint["policy"],
        "evidenceRefs": event["evidenceRefs"],
        "missingRequirements": missing,
    }
    state["checkpoints"][checkpoint["id"]] = {
        "status": outcome,
        "decision": decision,
    }
    template = checkpoint.get("onAccept")
    if outcome == "rejected" or template is None:
        return
    command_id = f'{state["runId"]}:{checkpoint["id"]}:{event["sequence"]}'
    state["commands"][command_id] = {
        "schema": "covenant.timeline.command.v0alpha2",
        "id": command_id,
        "kind": template["kind"],
        "payloadRef": template["payloadRef"],
        "idempotencyKey": (
            f'{state["runId"]}/{checkpoint["id"]}/{event["sequence"]}'
        ),
        "replayPolicy": "forbid",
    }


def record_receipt(
    state: dict[str, Any],
    receipt_ids: dict[str, str],
    event: dict[str, Any],
) -> None:
    receipt = event["receipt"]
    if receipt["commandId"] not in state["commands"]:
        add_finding(
            state,
            "timeline.command.unknown",
            event["id"],
            receipt["commandId"],
        )
        return
    if receipt["commandId"] in state["receipts"]:
        add_finding(
            state,
            "timeline.receipt.duplicate",
            event["id"],
            receipt["commandId"],
        )
        return
    if receipt["id"] in receipt_ids:
        add_finding(
            state,
            "timeline.receipt.id_duplicate",
            event["id"],
            receipt["id"],
        )
        return
    state["receipts"][receipt["commandId"]] = receipt
    receipt_ids[receipt["id"]] = receipt["commandId"]


def verify_run(state: dict[str, Any]) -> dict[str, Any]:
    pending = [
        checkpoint_id
        for checkpoint_id, checkpoint in state["checkpoints"].items()
        if checkpoint["status"] == "pending"
    ]
    rejected = [
        checkpoint_id
        for checkpoint_id, checkpoint in state["checkpoints"].items()
        if checkpoint["status"] == "rejected"
    ]
    unresolved = [
        command_id
        for command_id in state["commands"]
        if command_id not in state["receipts"]
    ]
    failed = [
        command_id
        for command_id, receipt in state["receipts"].items()
        if receipt["status"] != "succeeded"
    ]
    return {
        "scope": "structural",
        "evaluation": "requirement-coverage",
        "evidenceAuthority": "external-profile",
        "policyAuthority": "contract",
        "policyBinding": "contract-digest",
        "effectAuthority": "external",
        "ok": not (
            pending
            or rejected
            or unresolved
            or failed
            or state["findings"]
        ),
        "pendingCheckpoints": pending,
        "rejectedCheckpoints": rejected,
        "unresolvedCommands": unresolved,
        "failedCommands": failed,
        "findings": state["findings"],
    }


def same_policy(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return all(
        left[field] == right[field]
        for field in ("profile", "policyRef", "policyDigest")
    )


def add_finding(
    state: dict[str, Any], code: str, event_id: str, detail: str
) -> None:
    state["findings"].append(
        {"code": code, "eventId": event_id, "detail": detail}
    )

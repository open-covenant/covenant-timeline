from __future__ import annotations

import hashlib
import math
import re
from collections import deque
from typing import Any

import rfc8785


IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9._:/-]{0,127}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
SAFE_MIN = -(2**53 - 1)
SAFE_MAX = 2**53 - 1
MAX_ASSERTIONS = 16_384
MAX_AXES = 256
MAX_CANONICAL_DEPTH = 128
MAX_CANONICAL_NODES = 1_000_000
MAX_CONTEXTS = 256
MAX_EDGES = 32_768
MAX_EVENTS = 50_000
MAX_EVIDENCE_REFS = 10_000
MAX_INTERVALS = 4096
MAX_OPERATIONS = 20_000_000
MAX_POINTS = 4096
ORIGIN_PREFIX = "@origin:"


class TemporalVerificationError(ValueError):
    pass


class OperationBudget:
    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.used = 0

    def consume(self, count: int = 1) -> None:
        self.used += count
        if self.used > self.limit:
            fail("verification exceeds the operation budget")


def digest(value: Any) -> str:
    validate_canonical_shape(value)
    return f"sha256:{hashlib.sha256(rfc8785.dumps(value)).hexdigest()}"


def verify_conclusion(
    run: dict[str, Any],
    query: dict[str, Any],
    conclusion: dict[str, Any],
) -> bool:
    try:
        validate_canonical_shape(run)
        validate_canonical_shape(query)
        validate_canonical_shape(conclusion)
        budget = OperationBudget(MAX_OPERATIONS)
        projection = project(run, query)
        graph = build_graph(projection)
        if query["type"] == "difference.bounds":
            graph = connected_scope(
                graph, [query["fromPointId"], query["toPointId"]], budget
            )
        if not verify_envelope(projection, query, conclusion):
            return False
        if query["type"] == "context.consistency":
            return verify_consistency(graph, conclusion, budget)
        if query["type"] == "difference.bounds":
            return verify_bounds(graph, query, conclusion, budget)
        return False
    except Exception:
        return False


def project(run: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    validate_canonical_shape(run)
    validate_canonical_shape(query)
    require_exact(run, {"schema", "contract", "events"}, "run")
    if run["schema"] != "covenant.timeline.run.v0alpha3":
        fail("unsupported run schema")
    validate_query(query)
    contract = run["contract"]
    require_exact(
        contract,
        {"schema", "id", "subject", "axes", "contexts"},
        "contract",
    )
    if contract["schema"] != "covenant.timeline.contract.v0alpha3":
        fail("unsupported contract schema")
    require_identifier(contract["id"], "contract id")
    require_exact(contract["subject"], {"kind", "id"}, "subject")
    require_identifier(contract["subject"]["kind"], "subject kind")
    require_identifier(contract["subject"]["id"], "subject id")
    contexts = index_by_id(contract["contexts"], "context", MAX_CONTEXTS)
    axes = index_by_id(contract["axes"], "axis", MAX_AXES)
    for axis in axes.values():
        require_exact(axis, {"id", "kind", "unit", "origin"}, "axis")
        if axis["kind"] not in {"metric", "ordinal"}:
            fail("axis kind is unsupported")
        require_identifier(axis["unit"], "axis unit")
        require_identifier(axis["origin"], "axis origin")
    for context in contexts.values():
        require_exact(context, {"id", "mode"}, "context")
        if context["mode"] not in {
            "actual",
            "forecast",
            "hypothetical",
            "planned",
        }:
            fail("context mode is unsupported")
    if query["contextId"] not in contexts:
        fail("query context is not declared")

    events = run["events"]
    if not isinstance(events, list) or len(events) > MAX_EVENTS:
        fail("events exceed the verifier profile")
    recorded_through = query["recordedThrough"]
    if recorded_through is None:
        prefix: list[dict[str, Any]] = []
    else:
        require_safe_integer(recorded_through, "recordedThrough")
        recorded_through = int(recorded_through)
        if recorded_through < 0 or recorded_through >= len(events):
            fail("recordedThrough is outside the run")
        prefix = events[: recorded_through + 1]

    points: dict[str, dict[str, Any]] = {}
    intervals: dict[str, dict[str, Any]] = {}
    assertions: dict[str, tuple[str, dict[str, Any]]] = {}
    retracted: set[str] = set()
    event_ids: set[str] = set()
    temporal_ids: set[str] = set()
    context_events: list[dict[str, Any]] = []

    for sequence, event in enumerate(prefix):
        if not isinstance(event, dict):
            fail("event must be an object")
        if event.get("schema") != "covenant.timeline.event.v0alpha3":
            fail("events must use v0alpha3 and contiguous sequence")
        require_safe_integer(event.get("sequence"), "event sequence")
        if int(event["sequence"]) != sequence:
            fail("events must use v0alpha3 and contiguous sequence")
        event_id = event.get("id")
        require_identifier(event_id, "event id")
        if event_id in event_ids:
            fail("event id is duplicated")
        event_ids.add(event_id)
        event_type = event.get("type")

        if event_type == "point.declared":
            require_exact(
                event,
                {"schema", "id", "sequence", "type", "point"},
                "point event",
            )
            point = event["point"]
            require_exact(point, {"id", "contextId", "axisId"}, "point")
            reserve(point["id"], temporal_ids, "point")
            require_identifier(point["contextId"], "point context")
            require_identifier(point["axisId"], "point axis")
            if point["contextId"] not in contexts or point["axisId"] not in axes:
                fail("point references an unknown context or axis")
            points[point["id"]] = point
            if len(points) > MAX_POINTS:
                fail("points exceed the verifier profile")
            if point["contextId"] == query["contextId"]:
                context_events.append(event)
        elif event_type == "interval.declared":
            require_exact(
                event,
                {"schema", "id", "sequence", "type", "interval"},
                "interval event",
            )
            interval = event["interval"]
            require_exact(
                interval,
                {"id", "contextId", "startPointId", "endPointId"},
                "interval",
            )
            reserve(interval["id"], temporal_ids, "interval")
            require_identifier(interval["contextId"], "interval context")
            require_identifier(interval["startPointId"], "interval start")
            require_identifier(interval["endPointId"], "interval end")
            start = points.get(interval["startPointId"])
            end = points.get(interval["endPointId"])
            if (
                start is None
                or end is None
                or start["contextId"] != interval["contextId"]
                or end["contextId"] != interval["contextId"]
                or start["axisId"] != end["axisId"]
            ):
                fail("interval references incompatible points")
            intervals[interval["id"]] = interval
            if len(intervals) > MAX_INTERVALS:
                fail("intervals exceed the verifier profile")
            if interval["contextId"] == query["contextId"]:
                context_events.append(event)
        elif event_type in {"coordinate.asserted", "constraint.asserted"}:
            require_exact(
                event,
                {"schema", "id", "sequence", "type", "assertion"},
                "assertion event",
            )
            assertion = event["assertion"]
            kind = "coordinate" if event_type == "coordinate.asserted" else "constraint"
            validate_assertion(assertion, kind, contexts, points, assertions)
            reserve(assertion["id"], temporal_ids, "assertion")
            assertions[assertion["id"]] = (kind, assertion)
            if len(assertions) > MAX_ASSERTIONS:
                fail("assertions exceed the verifier profile")
            if assertion["contextId"] == query["contextId"]:
                context_events.append(event)
        elif event_type == "fact.asserted":
            require_exact(
                event,
                {"schema", "id", "sequence", "type", "assertion"},
                "fact event",
            )
            assertion = event["assertion"]
            validate_fact(assertion, contexts, points, intervals, assertions)
            reserve(assertion["id"], temporal_ids, "assertion")
            assertions[assertion["id"]] = ("fact", assertion)
            if len(assertions) > MAX_ASSERTIONS:
                fail("assertions exceed the verifier profile")
            if assertion["contextId"] == query["contextId"]:
                context_events.append(event)
        elif event_type == "assertion.retracted":
            require_exact(
                event,
                {
                    "schema",
                    "id",
                    "sequence",
                    "type",
                    "assertionId",
                    "evidenceRefs",
                },
                "retraction event",
            )
            target = assertions.get(event["assertionId"])
            validate_evidence_refs(event["evidenceRefs"])
            if target is None:
                fail("retraction target is unknown")
            retracted.add(event["assertionId"])
            if target[1]["contextId"] == query["contextId"]:
                context_events.append(event)
        else:
            fail("unsupported event type")

    superseded = {
        target
        for _, assertion in assertions.values()
        for target in assertion.get("supersedes", [])
    }
    active = {
        identifier: record
        for identifier, record in assertions.items()
        if identifier not in retracted and identifier not in superseded
    }
    cut = prefix[-1]["sequence"] if prefix else None
    state_input = {
        "schema": "covenant.timeline.state-input.v0alpha3",
        "contract": contract,
        "contextId": query["contextId"],
        "recordedThrough": cut,
        "events": context_events,
    }
    return {
        "stateDigest": digest(state_input),
        "points": {
            identifier: value
            for identifier, value in points.items()
            if value["contextId"] == query["contextId"]
        },
        "intervals": {
            identifier: value
            for identifier, value in intervals.items()
            if value["contextId"] == query["contextId"]
        },
        "coordinates": [
            value
            for kind, value in active.values()
            if kind == "coordinate" and value["contextId"] == query["contextId"]
        ],
        "constraints": [
            value
            for kind, value in active.values()
            if kind == "constraint" and value["contextId"] == query["contextId"]
        ],
    }


def validate_query(query: dict[str, Any]) -> None:
    if not isinstance(query, dict):
        fail("query must be an object")
    query_type = query.get("type")
    common = {"schema", "id", "contextId", "recordedThrough", "type"}
    if query_type == "context.consistency":
        require_exact(query, common, "query")
    elif query_type == "difference.bounds":
        require_exact(query, common | {"fromPointId", "toPointId"}, "query")
        require_identifier(query["fromPointId"], "fromPointId")
        require_identifier(query["toPointId"], "toPointId")
    else:
        fail("proof profile supports consistency and difference bounds only")
    if query["schema"] != "covenant.timeline.query.v0alpha3":
        fail("unsupported query schema")
    require_identifier(query["id"], "query id")
    require_identifier(query["contextId"], "query context")


def validate_assertion(
    assertion: dict[str, Any],
    kind: str,
    contexts: dict[str, dict[str, Any]],
    points: dict[str, dict[str, Any]],
    assertions: dict[str, tuple[str, dict[str, Any]]],
) -> None:
    common = {"id", "contextId", "evidenceRefs"}
    optional = {"supersedes"}
    body = {"pointId", "coordinate"} if kind == "coordinate" else {"constraint"}
    require_exact(assertion, common | body, kind, optional)
    validate_assertion_base(assertion, kind, contexts, assertions)
    if kind == "coordinate":
        point = points.get(assertion["pointId"])
        if point is None or point["contextId"] != assertion["contextId"]:
            fail("coordinate references an incompatible point")
        validate_bounds(assertion.get("coordinate"))
        for target_id in assertion.get("supersedes", []):
            target = assertions[target_id]
            if target[0] != kind or target[1]["pointId"] != assertion["pointId"]:
                fail("coordinate supersession target is incompatible")
    else:
        constraint = assertion["constraint"]
        require_exact(
            constraint,
            {"fromPointId", "toPointId"},
            "constraint body",
            {"minimum", "maximum"},
        )
        validate_bounds(
            {
                key: constraint[key]
                for key in ("minimum", "maximum")
                if key in constraint
            }
        )
        start = points.get(constraint["fromPointId"])
        end = points.get(constraint["toPointId"])
        if (
            start is None
            or end is None
            or start["contextId"] != assertion["contextId"]
            or end["contextId"] != assertion["contextId"]
            or start["axisId"] != end["axisId"]
        ):
            fail("constraint references incompatible points")


def validate_fact(
    assertion: dict[str, Any],
    contexts: dict[str, dict[str, Any]],
    points: dict[str, dict[str, Any]],
    intervals: dict[str, dict[str, Any]],
    assertions: dict[str, tuple[str, dict[str, Any]]],
) -> None:
    require_exact(
        assertion,
        {"id", "contextId", "propositionRef", "evidenceRefs"},
        "fact",
        {"validDuring", "observedAt", "assertedAt", "supersedes"},
    )
    validate_assertion_base(assertion, "fact", contexts, assertions)
    require_identifier(assertion["propositionRef"], "propositionRef")
    if "validDuring" in assertion:
        interval = intervals.get(assertion["validDuring"])
        if interval is None or interval["contextId"] != assertion["contextId"]:
            fail("fact references an incompatible interval")
    for field in ("observedAt", "assertedAt"):
        if field not in assertion:
            continue
        point = points.get(assertion[field])
        if point is None or point["contextId"] != assertion["contextId"]:
            fail("fact references an incompatible point")


def validate_assertion_base(
    assertion: dict[str, Any],
    kind: str,
    contexts: dict[str, dict[str, Any]],
    assertions: dict[str, tuple[str, dict[str, Any]]],
) -> None:
    require_identifier(assertion["id"], "assertion id")
    if assertion["contextId"] not in contexts:
        fail("assertion context is unknown")
    validate_evidence_refs(assertion["evidenceRefs"])
    supersedes = assertion.get("supersedes", [])
    if "supersedes" in assertion and not supersedes:
        fail("supersedes must not be empty")
    if (
        not isinstance(supersedes, list)
        or len(supersedes) > MAX_ASSERTIONS
        or len(supersedes) != len(set(supersedes))
    ):
        fail("supersedes must be a unique array")
    for target_id in supersedes:
        target = assertions.get(target_id)
        if target is None or target[0] != kind:
            fail("supersession target is unknown or incompatible")
        if target[1]["contextId"] != assertion["contextId"]:
            fail("supersession crosses contexts")


def validate_bounds(value: Any) -> None:
    if not isinstance(value, dict) or not set(value).issubset({"minimum", "maximum"}):
        fail("bounds contain unsupported fields")
    if not value or ("minimum" not in value and "maximum" not in value):
        fail("bounds must contain a limit")
    for bound in ("minimum", "maximum"):
        if bound in value:
            require_safe_integer(value[bound], bound)
    if (
        "minimum" in value
        and "maximum" in value
        and value["minimum"] > value["maximum"]
    ):
        fail("minimum exceeds maximum")


def validate_evidence_refs(value: Any) -> None:
    if (
        not isinstance(value, list)
        or not value
        or len(value) > MAX_EVIDENCE_REFS
        or len(value) != len(set(value))
        or any(
            not isinstance(item, str) or DIGEST.fullmatch(item) is None
            for item in value
        )
    ):
        fail("evidenceRefs are invalid")


def build_graph(projection: dict[str, Any]) -> dict[str, Any]:
    points = projection["points"]
    nodes = set(points)
    point_axes = {identifier: point["axisId"] for identifier, point in points.items()}
    edges: list[tuple[str, str, int, str]] = []
    for assertion in projection["coordinates"]:
        point_id = assertion["pointId"]
        origin = f"{ORIGIN_PREFIX}{points[point_id]['axisId']}"
        nodes.add(origin)
        add_difference_edges(
            edges,
            origin,
            point_id,
            assertion["coordinate"],
            assertion["id"],
        )
    for interval in projection["intervals"].values():
        add_difference_edges(
            edges,
            interval["startPointId"],
            interval["endPointId"],
            {"minimum": 1},
            f"@interval:{interval['id']}",
        )
    for assertion in projection["constraints"]:
        constraint = assertion["constraint"]
        add_difference_edges(
            edges,
            constraint["fromPointId"],
            constraint["toPointId"],
            constraint,
            assertion["id"],
        )
    if len(edges) > MAX_EDGES:
        fail("edges exceed the verifier profile")
    return {
        "nodes": sorted(nodes),
        "edges": sorted(edges, key=lambda edge: (edge[0], edge[1], edge[2], edge[3])),
        "pointAxes": point_axes,
    }


def add_difference_edges(
    edges: list[tuple[str, str, int, str]],
    start: str,
    end: str,
    bounds: dict[str, Any],
    source: str,
) -> None:
    if "maximum" in bounds:
        edges.append((start, end, int(bounds["maximum"]), source))
    if "minimum" in bounds:
        edges.append((end, start, -int(bounds["minimum"]), source))


def connected_scope(
    graph: dict[str, Any], seeds: list[str], budget: OperationBudget
) -> dict[str, Any]:
    adjacency = {node: set() for node in graph["nodes"]}
    for start, end, _, _ in graph["edges"]:
        adjacency[start].add(end)
        adjacency[end].add(start)
    if any(seed not in adjacency for seed in seeds):
        fail("query references an unknown point")
    included = set(seeds)
    queue = deque(sorted(included))
    while queue:
        node = queue.popleft()
        for neighbour in sorted(adjacency[node]):
            budget.consume()
            if neighbour not in included:
                included.add(neighbour)
                queue.append(neighbour)
    return {
        "nodes": sorted(included),
        "edges": [
            edge
            for edge in graph["edges"]
            if edge[0] in included and edge[1] in included
        ],
        "pointAxes": {
            key: value for key, value in graph["pointAxes"].items() if key in included
        },
    }


def verify_envelope(
    projection: dict[str, Any],
    query: dict[str, Any],
    conclusion: dict[str, Any],
) -> bool:
    if not exact(conclusion, {"schema", "queryId", "result", "receipt"}):
        return False
    if (
        conclusion["schema"] != "covenant.timeline.conclusion.v0alpha3"
        or conclusion["queryId"] != query["id"]
    ):
        return False
    receipt = conclusion["receipt"]
    if not exact(
        receipt,
        {
            "reasoner",
            "stateDigest",
            "queryDigest",
            "semanticResultDigest",
            "proof",
        },
    ):
        return False
    return (
        receipt["reasoner"] == "covenant.timeline.stn.v0alpha1"
        and receipt["stateDigest"] == projection["stateDigest"]
        and receipt["queryDigest"] == digest(query)
        and receipt["semanticResultDigest"] == digest(conclusion["result"])
    )


def verify_consistency(
    graph: dict[str, Any], conclusion: dict[str, Any], budget: OperationBudget
) -> bool:
    result = conclusion["result"]
    if not exact(result, {"type", "status"}) or result["type"] != "context.consistency":
        return False
    consistent = graph_consistent(graph, budget)
    if result["status"] == "consistent":
        return consistent and validate_schedule(
            conclusion["receipt"]["proof"], graph, budget
        )
    if result["status"] == "inconsistent":
        return not consistent and validate_negative_cycle(
            conclusion["receipt"]["proof"], graph, budget
        )
    return False


def verify_bounds(
    graph: dict[str, Any],
    query: dict[str, Any],
    conclusion: dict[str, Any],
    budget: OperationBudget,
) -> bool:
    result = conclusion["result"]
    if not exact(result, {"type", "status", "minimum", "maximum"}):
        return False
    if result["type"] != "difference.bounds":
        return False
    if any(
        value is not None and not safe_integer(value)
        for value in (result["minimum"], result["maximum"])
    ):
        return False
    proof = conclusion["receipt"]["proof"]
    if not graph_consistent(graph, budget):
        return (
            result["status"] == "inconsistent"
            and result["minimum"] is None
            and result["maximum"] is None
            and validate_negative_cycle(proof, graph, budget)
        )

    start = query["fromPointId"]
    end = query["toPointId"]
    if graph["pointAxes"].get(start) != graph["pointAxes"].get(end):
        return False
    upper = shortest_path(graph, start, end, budget)
    reverse = shortest_path(graph, end, start, budget)
    minimum = None if reverse is None else -reverse
    maximum = upper
    if minimum is not None and maximum is not None:
        status = "bounded"
    elif minimum is not None or maximum is not None:
        status = "partially-bounded"
    else:
        status = "unbounded"
    if (
        result["status"] != status
        or result["minimum"] != minimum
        or result["maximum"] != maximum
        or not exact(proof, {"kind", "lowerEdges", "upperEdges"})
        or proof["kind"] != "bounds"
    ):
        return False
    return validate_path(
        proof["lowerEdges"], graph, end, start, reverse, budget
    ) and validate_path(
        proof["upperEdges"], graph, start, end, upper, budget
    )


def graph_consistent(graph: dict[str, Any], budget: OperationBudget) -> bool:
    distances = {node: 0 for node in graph["nodes"]}
    for iteration in range(len(graph["nodes"])):
        changed = False
        for start, end, weight, _ in graph["edges"]:
            budget.consume()
            candidate = distances[start] + weight
            if candidate < distances[end]:
                distances[end] = candidate
                changed = True
                if iteration == len(graph["nodes"]) - 1:
                    return False
        if not changed:
            break
    return True


def shortest_path(
    graph: dict[str, Any], source: str, target: str, budget: OperationBudget
) -> int | None:
    infinity = None
    distances: dict[str, int | None] = {node: infinity for node in graph["nodes"]}
    distances[source] = 0
    for _ in range(max(0, len(graph["nodes"]) - 1)):
        changed = False
        for start, end, weight, _ in graph["edges"]:
            budget.consume()
            if distances[start] is None:
                continue
            candidate = distances[start] + weight
            if distances[end] is None or candidate < distances[end]:
                distances[end] = candidate
                changed = True
        if not changed:
            break
    return distances[target]


def validate_schedule(
    proof: Any, graph: dict[str, Any], budget: OperationBudget
) -> bool:
    if not exact(proof, {"kind", "coordinates"}) or proof["kind"] != "schedule":
        return False
    coordinates = proof["coordinates"]
    if not isinstance(coordinates, dict) or set(coordinates) != set(graph["pointAxes"]):
        return False
    if any(not safe_integer(value) for value in coordinates.values()):
        return False
    for start, end, weight, _ in graph["edges"]:
        budget.consume()
        start_value = (
            0
            if start.startswith(ORIGIN_PREFIX)
            else integer_value(coordinates.get(start))
        )
        end_value = (
            0 if end.startswith(ORIGIN_PREFIX) else integer_value(coordinates.get(end))
        )
        if start_value is None or end_value is None or end_value - start_value > weight:
            return False
    return True


def validate_negative_cycle(
    proof: Any, graph: dict[str, Any], budget: OperationBudget
) -> bool:
    if not exact(proof, {"kind", "edges"}) or proof["kind"] != "negative-cycle":
        return False
    edges = proof["edges"]
    if not isinstance(edges, list) or not edges or len(edges) > MAX_EDGES:
        return False
    available = {
        (source, start, end, weight) for start, end, weight, source in graph["edges"]
    }
    total = 0
    for index, edge in enumerate(edges):
        budget.consume()
        if not valid_proof_edge(edge, available):
            return False
        next_edge = edges[(index + 1) % len(edges)]
        if (
            not isinstance(next_edge, dict)
            or edge["toNodeId"] != next_edge.get("fromNodeId")
        ):
            return False
        total += int(edge["maximum"])
    return total < 0


def validate_path(
    edges: Any,
    graph: dict[str, Any],
    source: str,
    target: str,
    expected: int | None,
    budget: OperationBudget,
) -> bool:
    if not isinstance(edges, list) or len(edges) > MAX_EDGES:
        return False
    if expected is None:
        return not edges
    if not edges:
        return source == target and expected == 0
    if (
        not isinstance(edges[0], dict)
        or not isinstance(edges[-1], dict)
        or edges[0].get("fromNodeId") != source
        or edges[-1].get("toNodeId") != target
    ):
        return False
    available = {
        (edge_source, start, end, weight)
        for start, end, weight, edge_source in graph["edges"]
    }
    total = 0
    for index, edge in enumerate(edges):
        budget.consume()
        if not valid_proof_edge(edge, available):
            return False
        if index and edges[index - 1].get("toNodeId") != edge["fromNodeId"]:
            return False
        total += int(edge["maximum"])
    return total == expected


def valid_proof_edge(edge: Any, available: set[tuple[str, str, str, int]]) -> bool:
    if not exact(edge, {"sourceId", "fromNodeId", "toNodeId", "maximum"}):
        return False
    maximum = edge["maximum"]
    return (
        safe_integer(maximum)
        and (
            edge["sourceId"],
            edge["fromNodeId"],
            edge["toNodeId"],
            int(maximum),
        )
        in available
    )


def index_by_id(
    values: Any, label: str, limit: int
) -> dict[str, dict[str, Any]]:
    if not isinstance(values, list) or not values or len(values) > limit:
        fail(f"{label}s must be a non-empty array")
    result: dict[str, dict[str, Any]] = {}
    for value in values:
        if not isinstance(value, dict):
            fail(f"{label} must be an object")
        identifier = value.get("id")
        require_identifier(identifier, f"{label} id")
        if identifier in result:
            fail(f"{label} id is duplicated")
        result[identifier] = value
    return result


def reserve(identifier: Any, values: set[str], label: str) -> None:
    require_identifier(identifier, f"{label} id")
    if identifier in values:
        fail(f"{label} id is already used")
    values.add(identifier)


def require_exact(
    value: Any,
    required: set[str],
    label: str,
    optional: set[str] | None = None,
) -> None:
    permitted = optional or set()
    if (
        not isinstance(value, dict)
        or not required.issubset(value)
        or not set(value).issubset(required | permitted)
    ):
        fail(f"{label} has an invalid shape")


def exact(value: Any, keys: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == keys


def require_identifier(value: Any, label: str) -> None:
    if not isinstance(value, str) or IDENTIFIER.fullmatch(value) is None:
        fail(f"{label} is invalid")


def require_safe_integer(value: Any, label: str) -> None:
    if not safe_integer(value):
        fail(f"{label} is not a safe integer")


def validate_canonical_shape(value: Any) -> None:
    nodes = 0
    ancestors: set[int] = set()
    stack: list[tuple[Any, int, bool]] = [(value, 0, False)]
    while stack:
        current, depth, leaving = stack.pop()
        if leaving:
            ancestors.remove(id(current))
            continue

        nodes += 1
        if nodes > MAX_CANONICAL_NODES:
            fail("value exceeds the canonical node limit")
        if depth > MAX_CANONICAL_DEPTH:
            fail("value exceeds the canonical depth limit")
        if current is None or isinstance(current, (bool, int, float, str)):
            if isinstance(current, float) and not math.isfinite(current):
                fail("canonical number must be finite")
            continue
        if not isinstance(current, (dict, list)):
            fail("value is not canonical JSON")

        identity = id(current)
        if identity in ancestors:
            fail("canonical JSON contains a cycle")
        ancestors.add(identity)
        stack.append((current, depth, True))
        if isinstance(current, list):
            for item in reversed(current):
                stack.append((item, depth + 1, False))
            continue
        if any(not isinstance(key, str) for key in current):
            fail("canonical object key is not a string")
        for item in current.values():
            stack.append((item, depth + 1, False))


def safe_integer(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return SAFE_MIN <= value <= SAFE_MAX
    return (
        isinstance(value, float)
        and math.isfinite(value)
        and value.is_integer()
        and SAFE_MIN <= value <= SAFE_MAX
    )


def integer_value(value: Any) -> int | None:
    return int(value) if safe_integer(value) else None


def fail(message: str) -> None:
    raise TemporalVerificationError(message)

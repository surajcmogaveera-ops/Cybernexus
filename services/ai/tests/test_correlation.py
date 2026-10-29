import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

import httpx
import pytest
from cybernexus_ai.contracts import CorrelationRequest
from cybernexus_ai.correlation import correlate_alerts
from cybernexus_ai.main import app

DATA_ROOT = Path(__file__).parents[3] / "data/synthetic"
DATASET = json.loads((DATA_ROOT / "alerts-v1.json").read_text(encoding="utf-8"))
GROUND_TRUTH = json.loads((DATA_ROOT / "ground-truth-v1.json").read_text(encoding="utf-8"))


def fixture_request() -> tuple[CorrelationRequest, dict[str, str]]:
    case_ids: dict[str, str] = {}
    alerts = []
    for fixture in DATASET["records"]:
        case_id = fixture["caseId"]
        record = fixture["record"]
        alert_id = str(uuid5(NAMESPACE_URL, f"cybernexus:{case_id}"))
        case_ids[case_id] = alert_id
        payload = record["payload"]
        entity_fields = (
            ("user", ("userId", "user", "actorId"), "normalizedAttributes.userId"),
            ("device", ("deviceId", "hostId", "endpointId"), "normalizedAttributes.deviceId"),
            ("cloud_resource", ("cloudResourceId", "resourceId", "resource"), "normalizedAttributes.cloudResourceId"),
        )
        entities = []
        for entity_type, candidates, field_path in entity_fields:
            for candidate in candidates:
                value = payload.get(candidate)
                if isinstance(value, str) and value.strip():
                    entities.append({"entityType": entity_type, "value": value, "fieldPath": field_path})
                    break
        for candidate in ("sourceIp", "destinationIp", "remoteIp", "ipAddress"):
            value = payload.get(candidate)
            if isinstance(value, str) and value.strip():
                entities.append({"entityType": "ip", "value": value, "fieldPath": f"payload.{candidate}"})
        observed = datetime.fromisoformat(record["observedAt"].replace("Z", "+00:00"))
        observed_utc = observed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        alerts.append({
            "id": alert_id,
            "source": record["source"],
            "alertType": record.get("alertType", record["payload"].get("eventType", "unknown")),
            "observedAt": observed_utc,
            "entities": entities,
        })
    request = CorrelationRequest.model_validate({
        "contractVersion": "v1",
        "requestId": str(uuid5(NAMESPACE_URL, "cybernexus:correlation-test")),
        "alerts": alerts,
    })
    return request, case_ids


def connected(source: str, target: str, relationships) -> bool:  # noqa: ANN001
    graph: dict[str, set[str]] = {}
    for item in relationships:
        if item.status != "proposed":
            continue
        graph.setdefault(str(item.sourceAlertId), set()).add(str(item.targetAlertId))
        graph.setdefault(str(item.targetAlertId), set()).add(str(item.sourceAlertId))
    pending = [source]
    visited = set()
    while pending:
        current = pending.pop()
        if current == target:
            return True
        if current in visited:
            continue
        visited.add(current)
        pending.extend(graph.get(current, set()) - visited)
    return False


def test_phase8_ground_truth_groups_are_supported_by_direct_evidence():
    request, case_ids = fixture_request()
    result = correlate_alerts(request)
    for group in GROUND_TRUTH["expectedRelatedGroups"]:
        ids = [case_ids[case_id] for case_id in group["caseIds"]]
        for left, right in zip(ids, ids[1:]):
            assert connected(left, right, result.relationships)
    for pair in GROUND_TRUTH["expectedUnrelatedPairs"]:
        ids = {case_ids[case_id] for case_id in pair["caseIds"]}
        assert not any(
            {str(item.sourceAlertId), str(item.targetAlertId)} == ids
            and item.status == "proposed"
            for item in result.relationships
        )
    ambiguous = next(
        item for item in result.relationships if item.relationshipType == "shared_ip"
    )
    assert ambiguous.status == "review_required"
    assert ambiguous.confidence == 0.45


def test_timestamps_alone_do_not_correlate_and_missing_entities_stay_unlinked():
    request, _ = fixture_request()
    no_entity = CorrelationRequest.model_validate({
        **request.model_dump(mode="json"),
        "alerts": [
            {"id": "a4ad6c3d-4f19-4e88-b95f-04fdff23f175", "source": "a", "observedAt": "2026-10-29T08:00:00Z", "entities": []},
            {"id": "d4c75ab2-34b8-4710-ae63-32b11a0189df", "source": "b", "observedAt": "2026-10-29T08:01:00Z", "entities": []},
        ],
    })
    assert correlate_alerts(no_entity).relationships == []


def test_conflicting_device_context_requires_review_and_result_is_repeatable():
    base_id = "4a493f53-fec7-4ba5-b8a8-6f3191ce7fb0"
    other_id = "5e338751-34e3-45e7-b8de-c7c107c2a4b8"
    request = CorrelationRequest.model_validate({
        "contractVersion": "v1",
        "requestId": "8c9e9f24-f6f9-4e24-933e-f2fe2f9a0f45",
        "alerts": [
            {"id": base_id, "source": "idp", "observedAt": "2026-10-29T08:00:00Z", "entities": [
                {"entityType": "user", "value": "user-1", "fieldPath": "normalizedAttributes.userId"},
                {"entityType": "device", "value": "device-a", "fieldPath": "normalizedAttributes.deviceId"},
            ]},
            {"id": other_id, "source": "edr", "observedAt": "2026-10-29T08:10:00Z", "entities": [
                {"entityType": "user", "value": "USER-1", "fieldPath": "normalizedAttributes.userId"},
                {"entityType": "device", "value": "device-b", "fieldPath": "normalizedAttributes.deviceId"},
            ]},
        ],
    })
    first = correlate_alerts(request)
    second = correlate_alerts(request)
    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert first.relationships[0].status == "review_required"
    assert first.relationships[0].confidence <= 0.74
    assert "device" in first.relationships[0].rationale


def test_internal_correlation_endpoint_requires_service_token(monkeypatch):
    request, _ = fixture_request()

    async def exercise():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            monkeypatch.delenv("CYBERNEXUS_AI_SERVICE_TOKEN", raising=False)
            missing_config = await client.post("/internal/v1/correlations", json=request.model_dump(mode="json"))
            assert missing_config.status_code == 503
            monkeypatch.setenv("CYBERNEXUS_AI_SERVICE_TOKEN", "phase-nine-test-token-with-over-32-characters")
            unauthorized = await client.post("/internal/v1/correlations", json=request.model_dump(mode="json"))
            assert unauthorized.status_code == 401
            authorized = await client.post(
                "/internal/v1/correlations",
                headers={"Authorization": "Bearer phase-nine-test-token-with-over-32-characters"},
                json=request.model_dump(mode="json"),
            )
            assert authorized.status_code == 200
            assert authorized.json() == correlate_alerts(request).model_dump(mode="json")
            invalid = await client.post(
                "/internal/v1/correlations",
                headers={"Authorization": "Bearer phase-nine-test-token-with-over-32-characters"},
                json={
                    "contractVersion": "v1",
                    "requestId": "8c9e9f24-f6f9-4e24-933e-f2fe2f9a0f45",
                    "alerts": [{
                        "id": "4a493f53-fec7-4ba5-b8a8-6f3191ce7fb0",
                        "source": "idp",
                        "observedAt": "2026-10-29T08:00:00Z",
                        "entities": [{"entityType": "user", "value": "SENSITIVE-UNTRUSTED-INPUT"}],
                    }],
                },
            )
            assert invalid.status_code == 422
            assert "SENSITIVE-UNTRUSTED-INPUT" not in invalid.text

    asyncio.run(exercise())

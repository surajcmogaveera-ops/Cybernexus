"""Deterministic rule-based correlation; scores describe rule strength, not probability."""

from collections import defaultdict
from datetime import datetime

from cybernexus_ai.contracts import (
    CorrelationCandidate,
    CorrelationEvidence,
    CorrelationRequest,
    CorrelationResult,
)

WINDOW_SECONDS = 2 * 60 * 60
BASE_STRENGTH = {
    "user": 0.90,
    "device": 0.92,
    "cloud_resource": 0.90,
}
RELATIONSHIP_TYPES = {
    "user": "shared_user",
    "device": "shared_device",
    "cloud_resource": "shared_cloud_resource",
    "ip": "shared_ip",
}
ENTITY_LABELS = {
    "user": "user or account",
    "device": "device or host",
    "cloud_resource": "cloud resource",
}


def correlate_alerts(request: CorrelationRequest) -> CorrelationResult:
    """Return supported direct links, never links based on time alone."""
    alerts = {str(alert.id): alert for alert in request.alerts}
    entity_groups: dict[tuple[str, str], list[tuple[datetime, str, str]]] = defaultdict(list)
    entity_values: dict[str, dict[str, set[str]]] = {}

    for alert_id, alert in alerts.items():
        values: dict[str, set[str]] = defaultdict(set)
        for entity in alert.entities:
            normalized_value = entity.value.strip().casefold()
            values[entity.entityType].add(normalized_value)
            entity_groups[(entity.entityType, normalized_value)].append(
                (datetime.fromisoformat(str(alert.observedAt).replace("Z", "+00:00")), alert_id, entity.fieldPath)
            )
        entity_values[alert_id] = values

    adjacent_pairs: set[tuple[str, str]] = set()
    for (entity_type, _), members in entity_groups.items():
        ordered = sorted(members, key=lambda member: (member[0], member[1], member[2]))
        for left, right in zip(ordered, ordered[1:]):
            if left[1] == right[1]:
                continue
            elapsed = abs((right[0] - left[0]).total_seconds())
            if elapsed <= WINDOW_SECONDS:
                adjacent_pairs.add(tuple(sorted((left[1], right[1]))))

    candidates: list[CorrelationCandidate] = []
    strong_types = tuple(BASE_STRENGTH)
    for source_id, target_id in sorted(adjacent_pairs):
        shared: dict[str, list[CorrelationEvidence]] = {}
        for entity_type in (*strong_types, "ip"):
            source_entities = {
                entity.value.strip().casefold(): entity.fieldPath
                for entity in alerts[source_id].entities
                if entity.entityType == entity_type
            }
            target_entities = {
                entity.value.strip().casefold(): entity.fieldPath
                for entity in alerts[target_id].entities
                if entity.entityType == entity_type
            }
            common = sorted(source_entities.keys() & target_entities.keys())
            if common:
                shared[entity_type] = [
                    CorrelationEvidence(
                        entityType=entity_type,
                        sourceField=source_entities[value],
                        targetField=target_entities[value],
                    )
                    for value in common
                ]

        matched_strong_types = [kind for kind in strong_types if shared.get(kind)]
        conflicts = [
            kind
            for kind in strong_types
            if entity_values[source_id].get(kind)
            and entity_values[target_id].get(kind)
            and not shared.get(kind)
        ]
        supplemental_ip = shared.get("ip", [])

        if matched_strong_types:
            combined_evidence = [
                evidence
                for kind in matched_strong_types
                for evidence in shared[kind]
            ] + supplemental_ip
            repeated_same_pipeline = any(
                entity_type == "device" and len(matched_strong_types) == 1
                for entity_type in matched_strong_types
            ) and (
                alerts[source_id].source.casefold() == alerts[target_id].source.casefold()
                and (alerts[source_id].alertType or "").casefold()
                == (alerts[target_id].alertType or "").casefold()
            )
            status = (
                "review_required"
                if conflicts or repeated_same_pipeline
                else "proposed"
            )
            for entity_type in matched_strong_types:
                confidence = min(
                    0.98,
                    BASE_STRENGTH[entity_type]
                    + (0.03 if len(matched_strong_types) > 1 else 0),
                )
                if conflicts:
                    confidence = min(confidence, 0.74)
                elif repeated_same_pipeline:
                    confidence = min(confidence, 0.74)
                conflict_text = (
                    " Different values were present for "
                    + ", ".join(conflicts)
                    + "; analyst review is required."
                    if conflicts
                    else (
                        " The alerts share only a device within the same source and event type; "
                        "the separate source event IDs are retained and analyst review is required."
                        if repeated_same_pipeline
                        else ""
                    )
                )
                candidates.append(
                    CorrelationCandidate(
                        sourceAlertId=source_id,
                        targetAlertId=target_id,
                        relationshipType=RELATIONSHIP_TYPES[entity_type],
                        confidence=confidence,
                        rationale=(
                            f"Both alerts share a normalized {ENTITY_LABELS[entity_type]} identifier, "
                            "and their event times are within the configured 120-minute review window. "
                            "This is a candidate relationship, not a confirmed attack."
                            f"{conflict_text}"
                        ),
                        evidence=combined_evidence[:16],
                        status=status,
                    )
                )
        elif supplemental_ip:
            candidates.append(
                CorrelationCandidate(
                    sourceAlertId=source_id,
                    targetAlertId=target_id,
                    relationshipType="shared_ip",
                    confidence=0.45,
                    rationale=(
                        "The alerts share an IP address within the configured 120-minute review window, "
                        "but an IP alone may represent shared infrastructure or NAT and is insufficient "
                        "to associate these alerts."
                    ),
                    evidence=supplemental_ip,
                    status="review_required",
                )
            )

    candidates.sort(
        key=lambda item: (
            str(item.sourceAlertId),
            str(item.targetAlertId),
            item.relationshipType,
        )
    )
    return CorrelationResult(
        contractVersion="v1",
        requestId=request.requestId,
        relationships=candidates,
    )

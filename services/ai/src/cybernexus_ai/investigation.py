"""Deterministic, non-generative incident analysis fallback."""

from collections import Counter

from cybernexus_ai.contracts import (
    IncidentAnalysisEvidenceReference,
    IncidentAnalysisFinding,
    IncidentAnalysisRequest,
    IncidentAnalysisResult,
)

SEVERITY_ORDER = {
    "unknown": -1,
    "informational": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 4,
}


def analyze_incident(request: IncidentAnalysisRequest) -> IncidentAnalysisResult:
    """Summarize stored metadata without interpreting alert text as instructions."""
    alerts = request.alerts
    relationships = request.relationships
    severity_counts = Counter(alert.severity for alert in alerts)
    severity_summary = ", ".join(
        f"{severity_counts[severity]} {severity}"
        for severity in SEVERITY_ORDER
        if severity_counts[severity]
    )
    proposed_severity = max(
        (alert.severity for alert in alerts),
        key=lambda severity: SEVERITY_ORDER[severity],
    )
    if proposed_severity == "unknown":
        proposed_severity = request.incidentSeverity

    alert_evidence = [
        IncidentAnalysisEvidenceReference(
            kind="alert",
            id=alert.id,
            fieldPaths=["severity", "observedAt"],
        )
        for alert in alerts
    ]
    total_records = len(alerts) + len(relationships)
    findings = [
        IncidentAnalysisFinding(
            conclusion=(
                f"The linked source records contain {len(alerts)} alerts with "
                f"source-reported severity values: {severity_summary}."
            ),
            rationale=(
                "This is a count of stored severity and event-time fields. "
                "It does not establish alert accuracy, intent, or causation."
            ),
            evidence=alert_evidence,
            confidence=len(alerts) / total_records,
            uncertainty=(
                "Source payloads and alert titles were not interpreted by this "
                "deterministic fallback."
            ),
            verificationStatus="unverified",
        )
    ]

    relationship_evidence = [
        IncidentAnalysisEvidenceReference(
            kind="relationship",
            id=relationship.id,
            fieldPaths=["status", "relationshipType", "confidence"],
        )
        for relationship in relationships
    ]
    if relationships:
        needs_review = sum(
            relationship.status == "review_required"
            for relationship in relationships
        )
        relationship_label = "record" if len(relationships) == 1 else "records"
        review_label = "requires" if needs_review == 1 else "require"
        findings.append(
            IncidentAnalysisFinding(
                conclusion=(
                    f"The incident has {len(relationships)} persisted candidate "
                    f"relationship {relationship_label}; {needs_review} "
                    f"{review_label} analyst review."
                ),
                rationale=(
                    "Relationship records describe hypotheses from Phase 9. "
                    "They do not confirm an attack path or causal connection."
                ),
                evidence=relationship_evidence,
                confidence=len(relationships) / total_records,
                uncertainty=(
                    "The fallback does not independently resolve or semantically "
                    "verify relationship explanations."
                ),
                verificationStatus="unverified",
            )
        )

    cited_record_ids = {
        evidence.id
        for finding in findings
        for evidence in finding.evidence
    }
    coverage = len(cited_record_ids) / total_records
    needs_human_review = True
    missing_information = [
        "Raw payload contents and title text were excluded from fallback interpretation.",
        "Alert intent, accuracy, and causality were not determined.",
    ]
    if any(item.status == "review_required" for item in relationships):
        missing_information.append(
            "One or more candidate relationships remain unresolved for analyst review."
        )

    reported_conflicts = []
    if any(item.status == "review_required" for item in relationships):
        reported_conflicts.append(
            {
                "description": (
                    "One or more candidate relationships remain review-required; "
                    "this is unresolved ambiguity, not confirmed contradictory evidence."
                ),
                "evidence": relationship_evidence[:20],
            }
        )

    steps = [
        "Review the original alert records and their source context.",
        "Validate or reject candidate relationships using approved evidence.",
    ]
    return IncidentAnalysisResult(
        contractVersion="v1",
        requestId=request.requestId,
        analysisMethod="deterministic_fallback",
        summary=(
            f"Deterministic fallback summarized {len(alerts)} persisted alert "
            f"records ({severity_summary}). No causal or threat conclusion was made."
        ),
        proposedSeverity=proposed_severity,
        analysisConfidence=coverage,
        findings=findings,
        missingInformation=missing_information,
        reportedConflicts=reported_conflicts,
        recommendedNextSteps=steps,
        needsHumanReview=needs_human_review,
        humanReviewRationale=(
            "This fallback performs bounded metadata summarization only; it does "
            "not validate semantic claims or source accuracy."
        ),
    )

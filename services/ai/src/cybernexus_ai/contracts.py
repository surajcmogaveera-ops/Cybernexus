"""Versioned wire contracts shared semantically with packages/shared."""

import re
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_serializer,
    model_validator,
)


def omit_null_default(schema: dict[str, object]) -> None:
    schema.pop("default", None)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_serializer(mode="wrap")
    def omit_absent_optional_values(self, handler):  # noqa: ANN001
        serialized = handler(self)
        return {
            key: value for key, value in serialized.items() if value is not None
        }


def validate_identifier(value: object) -> UUID:
    if isinstance(value, UUID):
        parsed = value
        raw = str(value)
    elif isinstance(value, str):
        raw = value
        try:
            parsed = UUID(value)
        except ValueError as exc:
            raise ValueError("identifier must be an RFC UUID") from exc
    else:
        raise ValueError("identifier must be a UUID string")
    if raw != "00000000-0000-0000-0000-000000000000" and not re.fullmatch(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",
        raw,
    ):
        raise ValueError("identifier must be an RFC UUID")
    return parsed


Identifier = Annotated[UUID, BeforeValidator(validate_identifier)]
ErrorPathItem = Annotated[str, StringConstraints(max_length=200)] | Annotated[
    int, Field(strict=True, ge=0)
]
ErrorDetailMessage = Annotated[
    str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)
]
ErrorMessage = Annotated[
    str, StringConstraints(min_length=1, max_length=500, strip_whitespace=True)
]
FindingConclusion = Annotated[
    str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)
]
FindingRationale = Annotated[
    str, StringConstraints(min_length=1, max_length=2000, strip_whitespace=True)
]
AbstentionReason = Annotated[
    str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)
]


class UtcTimestamp(str):
    """Validated ISO 8601 timestamp with UTC Z suffix, matching the TS schema."""

    @classmethod
    def __get_pydantic_core_schema__(cls, source, handler):  # noqa: ANN001
        from pydantic_core import core_schema

        def validate(value: str) -> str:
            if not isinstance(value, str) or not re.fullmatch(
                r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", value
            ):
                raise ValueError("timestamp must be ISO 8601 UTC ending in Z")
            try:
                datetime.fromisoformat(value[:-1] + "+00:00")
            except ValueError as exc:
                raise ValueError("timestamp must be a valid date and time") from exc
            return value

        return core_schema.no_info_after_validator_function(
            validate, core_schema.str_schema()
        )


class ApiErrorDetail(StrictModel):
    path: list[ErrorPathItem] = Field(max_length=32)
    message: ErrorDetailMessage


class ApiErrorBody(StrictModel):
    code: Literal[
        "VALIDATION_ERROR",
        "MALFORMED_JSON",
        "NOT_FOUND",
        "UNSUPPORTED_CONTRACT_VERSION",
        "CONFLICT",
        "INTERNAL_SERVER_ERROR",
    ]
    message: ErrorMessage
    details: list[ApiErrorDetail] = Field(
        default=None, max_length=100, json_schema_extra=omit_null_default
    )


class ApiErrorResponse(StrictModel):
    error: ApiErrorBody


class PaginationRequest(StrictModel):
    page: int = Field(default=1, ge=1, strict=True)
    pageSize: int = Field(default=25, ge=1, le=100, strict=True)


class PaginationResponse(StrictModel):
    items: list[dict[str, object]] = Field(max_length=100)
    page: int = Field(ge=1)
    pageSize: int = Field(ge=1, le=100)
    hasNext: bool = Field(strict=True)
    totalItems: int = Field(
        default=None, ge=0, strict=True, json_schema_extra=omit_null_default
    )


class EvidenceReference(StrictModel):
    kind: Literal["alert", "artifact", "log", "other"]
    id: Identifier


class AnalysisOptions(StrictModel):
    maxFindings: int = Field(default=10, ge=1, le=20, strict=True)
    includeRecommendations: bool = Field(default=True, strict=True)


class AnalysisRequest(StrictModel):
    contractVersion: Literal["v1"]
    requestId: Identifier
    alertIds: list[Identifier] = Field(min_length=1, max_length=100)
    evidence: list[EvidenceReference] = Field(default_factory=list, max_length=100)
    context: str = Field(
        default=None, max_length=4000, json_schema_extra=omit_null_default
    )
    options: AnalysisOptions = Field(default_factory=AnalysisOptions)


class AnalysisFinding(StrictModel):
    conclusion: FindingConclusion
    rationale: FindingRationale
    evidence: list[EvidenceReference] = Field(max_length=20)
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)
    uncertainty: str = Field(
        default=None, max_length=1000, json_schema_extra=omit_null_default
    )
    verificationStatus: Literal["unverified"]


class AnalysisResult(StrictModel):
    contractVersion: Literal["v1"]
    requestId: Identifier
    findings: list[AnalysisFinding] = Field(max_length=20)
    missingInformation: list[str] = Field(default_factory=list, max_length=20)
    abstentionReason: AbstentionReason = Field(
        default=None, json_schema_extra=omit_null_default
    )
    recommendedNextSteps: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("missingInformation", "recommendedNextSteps")
    @classmethod
    def bound_strings(cls, values: list[str]) -> list[str]:
        if any(not value.strip() or len(value.strip()) > 500 for value in values):
            raise ValueError("entries must contain 1 to 500 characters")
        return [value.strip() for value in values]


IncidentAnalysisSeverity = Literal[
    "informational", "low", "medium", "high", "critical", "unknown"
]
IncidentAnalysisRelationshipType = Literal[
    "shared_user", "shared_device", "shared_cloud_resource", "shared_ip"
]
IncidentAnalysisRelationshipStatus = Literal[
    "proposed", "review_required", "accepted", "rejected"
]


class IncidentAnalysisAlert(StrictModel):
    id: Identifier
    source: Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)]
    alertType: Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)] = Field(default=None, json_schema_extra=omit_null_default)
    title: Annotated[str, StringConstraints(min_length=1, max_length=500, strip_whitespace=True)]
    severity: IncidentAnalysisSeverity
    observedAt: UtcTimestamp


class IncidentAnalysisRelationship(StrictModel):
    id: Identifier
    sourceAlertId: Identifier
    targetAlertId: Identifier
    relationshipType: IncidentAnalysisRelationshipType
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)
    rationale: Annotated[str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)]
    status: IncidentAnalysisRelationshipStatus


class IncidentAnalysisRequest(StrictModel):
    contractVersion: Literal["v1"]
    requestId: Identifier
    incidentId: Identifier
    incidentSeverity: IncidentAnalysisSeverity
    alerts: list[IncidentAnalysisAlert] = Field(min_length=1, max_length=100)
    relationships: list[IncidentAnalysisRelationship] = Field(max_length=800)

    @model_validator(mode="after")
    def relationships_are_incident_scoped(self):
        alert_ids = {alert.id for alert in self.alerts}
        if len(alert_ids) != len(self.alerts):
            raise ValueError("analysis input cannot repeat alert IDs")
        if any(
            relationship.sourceAlertId not in alert_ids
            or relationship.targetAlertId not in alert_ids
            for relationship in self.relationships
        ):
            raise ValueError("analysis relationships must belong to supplied alerts")
        return self


class IncidentAnalysisEvidenceReference(StrictModel):
    kind: Literal["alert", "relationship"]
    id: Identifier
    fieldPaths: list[Annotated[str, StringConstraints(min_length=1, max_length=160, strip_whitespace=True)]] = Field(min_length=1, max_length=8)

    @field_validator("fieldPaths")
    @classmethod
    def unique_field_paths(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("evidence field paths must be unique")
        return value


class IncidentAnalysisFinding(StrictModel):
    conclusion: FindingConclusion
    rationale: FindingRationale
    evidence: list[IncidentAnalysisEvidenceReference] = Field(max_length=20)
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)
    uncertainty: Annotated[str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)] = Field(default=None, json_schema_extra=omit_null_default)
    verificationStatus: Literal["unverified"]


class IncidentAnalysisConflict(StrictModel):
    description: Annotated[str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)]
    evidence: list[IncidentAnalysisEvidenceReference] = Field(min_length=1, max_length=20)


class IncidentAnalysisResult(StrictModel):
    contractVersion: Literal["v1"]
    requestId: Identifier
    analysisMethod: Literal["deterministic_fallback", "gemini"]
    summary: Annotated[str, StringConstraints(min_length=1, max_length=2000, strip_whitespace=True)]
    proposedSeverity: IncidentAnalysisSeverity
    analysisConfidence: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)
    findings: list[IncidentAnalysisFinding] = Field(max_length=20)
    missingInformation: list[Annotated[str, StringConstraints(min_length=1, max_length=500, strip_whitespace=True)]] = Field(max_length=20)
    reportedConflicts: list[IncidentAnalysisConflict] = Field(max_length=10)
    recommendedNextSteps: list[Annotated[str, StringConstraints(min_length=1, max_length=500, strip_whitespace=True)]] = Field(max_length=20)
    needsHumanReview: bool
    humanReviewRationale: Annotated[str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)] = Field(default=None, json_schema_extra=omit_null_default)
    abstentionReason: AbstentionReason = Field(default=None, json_schema_extra=omit_null_default)

    @model_validator(mode="after")
    def human_review_requires_rationale(self):
        if self.needsHumanReview and not self.humanReviewRationale:
            raise ValueError("human review requires an explanation")
        return self


CorrelationEntityType = Literal["user", "device", "cloud_resource", "ip"]
CorrelationRelationshipType = Literal[
    "shared_user", "shared_device", "shared_cloud_resource", "shared_ip"
]
CorrelationStatus = Literal["proposed", "review_required", "accepted", "rejected"]


class CorrelationEntity(StrictModel):
    entityType: CorrelationEntityType
    value: Annotated[str, StringConstraints(min_length=1, max_length=512, strip_whitespace=True)]
    fieldPath: Annotated[str, StringConstraints(min_length=1, max_length=160, strip_whitespace=True)]


class CorrelationAlertInput(StrictModel):
    id: Identifier
    source: Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)]
    alertType: Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)] = Field(default=None, json_schema_extra=omit_null_default)
    observedAt: UtcTimestamp
    entities: list[CorrelationEntity] = Field(max_length=8)


class CorrelationRequest(StrictModel):
    contractVersion: Literal["v1"]
    requestId: Identifier
    alerts: list[CorrelationAlertInput] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_alert_ids(self):
        ids = [alert.id for alert in self.alerts]
        if len(ids) != len(set(ids)):
            raise ValueError("correlation requests cannot repeat alert IDs")
        return self


class CorrelationEvidence(StrictModel):
    entityType: CorrelationEntityType
    sourceField: Annotated[str, StringConstraints(min_length=1, max_length=160, strip_whitespace=True)]
    targetField: Annotated[str, StringConstraints(min_length=1, max_length=160, strip_whitespace=True)]


class CorrelationCandidate(StrictModel):
    sourceAlertId: Identifier
    targetAlertId: Identifier
    relationshipType: CorrelationRelationshipType
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)
    rationale: Annotated[str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)]
    evidence: list[CorrelationEvidence] = Field(min_length=1, max_length=16)
    status: CorrelationStatus

    @model_validator(mode="after")
    def distinct_alerts(self):
        if self.sourceAlertId == self.targetAlertId:
            raise ValueError("a relationship must connect two different alerts")
        return self


class CorrelationResult(StrictModel):
    contractVersion: Literal["v1"]
    requestId: Identifier
    relationships: list[CorrelationCandidate] = Field(max_length=800)


class HealthResponse(StrictModel):
    status: Literal["ok"]
    service: Annotated[str, StringConstraints(min_length=1, max_length=120, strip_whitespace=True)]


class AIServiceReadinessResponse(StrictModel):
    status: Literal["ok"]
    service: Literal["cybernexus-ai"]
    analysisMode: Literal["deterministic", "gemini"]
    geminiConfiguration: Literal[
        "disabled", "not_configured", "configured_unverified"
    ]
    geminiConnectivity: Literal["disabled", "unverified"]

import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from cybernexus_ai.contracts import (
    AnalysisRequest,
    AnalysisFinding,
    AnalysisResult,
    CorrelationRequest,
    CorrelationResult,
    ApiErrorBody,
    ApiErrorResponse,
    HealthResponse,
    Identifier,
    PaginationRequest,
    PaginationResponse,
    UtcTimestamp,
)

FIXTURE_PATH = Path(__file__).parents[3] / "packages/shared/fixtures/contracts-v1.json"
FIXTURES = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
CORRELATION_FIXTURE_PATH = Path(__file__).parents[3] / "packages/shared/fixtures/correlation-v1.json"
CORRELATION_FIXTURE = json.loads(CORRELATION_FIXTURE_PATH.read_text(encoding="utf-8"))


def test_shared_correlation_contract_fixtures_are_accepted():
    request = CorrelationRequest.model_validate(CORRELATION_FIXTURE["request"])
    assert request.model_dump(mode="json") == CORRELATION_FIXTURE["request"]
    assert CorrelationResult.model_validate(CORRELATION_FIXTURE["result"]).model_dump(mode="json") == CORRELATION_FIXTURE["result"]
    from cybernexus_ai.correlation import correlate_alerts

    assert correlate_alerts(request).model_dump(mode="json") == CORRELATION_FIXTURE["result"]
    with pytest.raises(ValidationError):
        CorrelationRequest.model_validate({**CORRELATION_FIXTURE["request"], "contractVersion": "v2"})
    candidate = CORRELATION_FIXTURE["result"]["relationships"][0]
    with pytest.raises(ValidationError):
        CorrelationResult.model_validate({**CORRELATION_FIXTURE["result"], "relationships": [{**candidate, "evidence": []}]})


def test_shared_v1_fixtures_are_accepted():
    assert TypeAdapter(Identifier).validate_python(FIXTURES["identifier"])
    assert TypeAdapter(UtcTimestamp).validate_python(FIXTURES["timestamp"]) == FIXTURES["timestamp"]
    assert HealthResponse.model_validate(FIXTURES["health"]).model_dump() == FIXTURES["health"]
    assert ApiErrorResponse.model_validate(FIXTURES["error"]).model_dump(mode="json") == FIXTURES["error"]
    assert ApiErrorResponse.model_validate(FIXTURES["conflictError"]).model_dump(mode="json") == FIXTURES["conflictError"]
    assert PaginationRequest.model_validate({}).model_dump() == {"page": 1, "pageSize": 25}
    assert PaginationRequest.model_validate(FIXTURES["paginationRequest"]).model_dump() == FIXTURES["paginationRequest"]
    assert PaginationResponse.model_validate(FIXTURES["emptyPaginationResponse"]).model_dump() == FIXTURES["emptyPaginationResponse"]
    assert AnalysisRequest.model_validate(FIXTURES["analysisRequest"]).model_dump(mode="json") == FIXTURES["analysisRequest"]
    assert AnalysisResult.model_validate(FIXTURES["analysisResult"]).model_dump(mode="json") == FIXTURES["analysisResult"]


def test_optional_fields_are_non_nullable_in_schemas_and_omit_on_wire():
    optional_schema_fields = {
        ApiErrorBody: "details",
        PaginationResponse: "totalItems",
        AnalysisRequest: "context",
        AnalysisFinding: "uncertainty",
        AnalysisResult: "abstentionReason",
    }
    for model, field in optional_schema_fields.items():
        schema = model.model_json_schema()["properties"][field]
        assert "default" not in schema or schema["default"] is not None
        assert not any(
            option.get("type") == "null" for option in schema.get("anyOf", [])
        )

    request_data = dict(FIXTURES["analysisRequest"])
    request_data.pop("context")
    request = AnalysisRequest.model_validate(request_data)
    assert "context" not in json.loads(request.model_dump_json())
    assert AnalysisRequest.model_validate(FIXTURES["analysisRequest"]).context == FIXTURES["analysisRequest"]["context"]

    finding_data = dict(FIXTURES["analysisResult"]["findings"][0])
    finding_data.pop("uncertainty")
    assert "uncertainty" not in json.loads(AnalysisFinding.model_validate(finding_data).model_dump_json())
    for model, data, field in (
        (ApiErrorBody, {"code": "NOT_FOUND", "message": "Missing."}, "details"),
        (PaginationResponse, {"items": [], "page": 1, "pageSize": 25, "hasNext": False}, "totalItems"),
        (AnalysisRequest, request_data, "context"),
        (AnalysisFinding, finding_data, "uncertainty"),
        (AnalysisResult, FIXTURES["analysisResult"], "abstentionReason"),
    ):
        model.model_validate(data)
        with pytest.raises(ValidationError):
            model.model_validate({**data, field: None})

    error_data = {"error": {"code": "NOT_FOUND", "message": "Missing."}}
    assert json.loads(ApiErrorResponse.model_validate(error_data).model_dump_json()) == error_data
    error_fixture = ApiErrorResponse.model_validate(FIXTURES["error"]).model_dump(mode="json")
    assert error_fixture == FIXTURES["error"]
    page_data = {"items": [], "page": 1, "pageSize": 25, "hasNext": False}
    assert json.loads(PaginationResponse.model_validate(page_data).model_dump_json()) == page_data
    result = AnalysisResult.model_validate(FIXTURES["analysisResult"])
    assert json.loads(result.model_dump_json()) == FIXTURES["analysisResult"]


def test_trimmed_text_limits_use_shared_fixture_cases():
    cases = FIXTURES["trimmedTextCases"]
    base = dict(FIXTURES["analysisResult"])
    maximum = cases["maximumLength"]
    exact = cases["character"] * maximum
    whitespace_wrapped = f"{cases['prefix']}{exact}{cases['suffix']}"
    over = cases["character"] * (maximum + 1)

    for field in ("missingInformation", "recommendedNextSteps"):
        valid = {**base, field: [whitespace_wrapped]}
        parsed = AnalysisResult.model_validate(valid)
        assert getattr(parsed, field) == [exact]
        with pytest.raises(ValidationError):
            AnalysisResult.model_validate({**base, field: [over]})
        with pytest.raises(ValidationError):
            AnalysisResult.model_validate({**base, field: [cases["emptyWhitespace"]]})


@pytest.mark.parametrize(
    "timestamp",
    [
        "2026-02-30T08:15:00Z",
        "2026-10-28T08:15:00",
        "2026-10-28T08:15:00+00:00",
        "2026-10-28T13:45:00+05:30",
    ],
)
def test_utc_timestamp_rejects_invalid_date_or_timezone(timestamp):
    with pytest.raises(ValidationError):
        TypeAdapter(UtcTimestamp).validate_python(timestamp)


@pytest.mark.parametrize("identifier", ["not-a-uuid"])
def test_identifier_rejects_non_rfc_uuid(identifier):
    with pytest.raises(ValidationError):
        TypeAdapter(Identifier).validate_python(identifier)


def test_identifier_accepts_nil_uuid_like_zod():
    assert str(TypeAdapter(Identifier).validate_python("00000000-0000-0000-0000-000000000000")) == "00000000-0000-0000-0000-000000000000"


def test_health_and_errors_are_strict_and_bounded():
    with pytest.raises(ValidationError):
        HealthResponse.model_validate({"status": "starting", "service": "ai"})
    with pytest.raises(ValidationError):
        ApiErrorResponse.model_validate({"error": {"code": "X", "message": "safe", "stack": "secret"}})
    with pytest.raises(ValidationError):
        ApiErrorResponse.model_validate({"error": {"code": "X", "message": "safe", "details": None}})
    with pytest.raises(ValidationError):
        ApiErrorResponse.model_validate({"error": {"code": "X", "message": "safe", "details": [{"path": [-1], "message": "bad"}]}})


def test_pagination_defaults_bounds_and_empty_result():
    assert PaginationResponse.model_validate(FIXTURES["emptyPaginationResponse"]).items == []
    for value in ({"page": 0}, {"pageSize": 101}, {"page": "2"}, {"page": True}):
        with pytest.raises(ValidationError):
            PaginationRequest.model_validate(value)
    with pytest.raises(ValidationError):
        PaginationResponse.model_validate({"items": [], "page": 1, "pageSize": 25, "hasNext": False, "totalItems": -1})
    with pytest.raises(ValidationError):
        PaginationResponse.model_validate({"items": [], "page": 1, "pageSize": 25, "hasNext": 0})


def test_analysis_requests_enforce_version_bounds_and_strictness():
    base = FIXTURES["analysisRequest"]
    assert AnalysisRequest.model_validate(base).contractVersion == "v1"
    invalid = [
        {**base, "contractVersion": "v2"},
        {**base, "surprise": True},
        {**base, "context": "x" * 4001},
        {**base, "alertIds": []},
        {**base, "alertIds": ["bad"]},
        {**base, "evidence": [{"kind": "alert", "id": "bad"}]},
        {**base, "context": None},
        {key: value for key, value in base.items() if key != "requestId"},
    ]
    for value in invalid:
        with pytest.raises(ValidationError):
            AnalysisRequest.model_validate(value)
    with pytest.raises(ValidationError):
        AnalysisRequest.model_validate({**base, "options": {"maxFindings": 21}})
    with pytest.raises(ValidationError):
        AnalysisRequest.model_validate({**base, "options": {"includeRecommendations": 1}})


def test_analysis_results_are_bounded_and_always_advisory():
    base = FIXTURES["analysisResult"]
    assert AnalysisResult.model_validate(base).findings[0].verificationStatus == "unverified"
    finding = base["findings"][0]
    invalid = [
        {**base, "contractVersion": "v2"},
        {**base, "unexpected": 1},
        {**base, "findings": [{**finding, "confidence": 1.1}]},
        {**base, "findings": [{**finding, "verificationStatus": "verified"}]},
        {**base, "findings": [{**finding, "evidence": [{"kind": "alert", "id": "bad"}]}]},
        {**base, "findings": [{**finding, "uncertainty": None}]},
        {**base, "abstentionReason": None},
        {**base, "findings": [{**finding, "conclusion": "x" * 1001}]},
    ]
    for value in invalid:
        with pytest.raises(ValidationError):
            AnalysisResult.model_validate(value)

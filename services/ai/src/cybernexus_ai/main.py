import os
import re
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from cybernexus_ai.contracts import (
    CorrelationRequest,
    CorrelationResult,
    HealthResponse,
    IncidentAnalysisRequest,
    IncidentAnalysisResult,
)
from cybernexus_ai.correlation import correlate_alerts
from cybernexus_ai.providers import (
    ProviderSettings,
    analyze_with_fallback,
    create_configured_provider,
)

app = FastAPI(title="CyberNexus AI Service", version="0.1.0")


@app.exception_handler(RequestValidationError)
async def safe_validation_error(
    _request: Request, _error: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": "Request did not match the internal v1 contract."},
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="cybernexus-ai")


def require_internal_service_token(
    authorization: str | None = Header(default=None),
) -> None:
    expected = os.environ.get("CYBERNEXUS_AI_SERVICE_TOKEN", "")
    if len(expected) < 32 or len(expected) > 512:
        raise HTTPException(
            status_code=503,
            detail="Internal correlation service is not configured.",
        )
    match = re.fullmatch(r"Bearer ([A-Za-z0-9._~+/=-]{32,512})", authorization or "", re.IGNORECASE)
    if not match or not secrets.compare_digest(match.group(1), expected):
        raise HTTPException(status_code=401, detail="Internal authentication required.")


@app.post(
    "/internal/v1/correlations",
    response_model=CorrelationResult,
    dependencies=[Depends(require_internal_service_token)],
)
def correlate(request: CorrelationRequest) -> CorrelationResult:
    return correlate_alerts(request)


@app.post(
    "/internal/v1/incident-analyses",
    response_model=IncidentAnalysisResult,
    dependencies=[Depends(require_internal_service_token)],
)
async def analyze(request: IncidentAnalysisRequest) -> IncidentAnalysisResult:
    provider = create_configured_provider(ProviderSettings.from_environment())
    return await analyze_with_fallback(request, provider)

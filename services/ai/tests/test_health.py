import asyncio

import httpx
from cybernexus_ai.providers import ProviderSettings
from cybernexus_ai.main import app


def test_health_endpoint_reports_service_liveness_without_provider_connectivity(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_LIVE_ENABLED", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only-secret-never-returned")

    async def request_health():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get("/health")

    response = asyncio.run(request_health())
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "cybernexus-ai"}
    assert "test-only-secret-never-returned" not in response.text
    assert "gemini" not in response.text.lower()


def test_internal_readiness_requires_service_auth_and_reports_disabled_gemini(monkeypatch):
    token = "phase-test-internal-service-token-with-32-characters"
    key_sentinel = "mock-gemini-key-never-returned"
    monkeypatch.setenv("CYBERNEXUS_AI_SERVICE_TOKEN", token)
    monkeypatch.setenv("AI_PROVIDER", "deterministic")
    monkeypatch.setenv("GEMINI_LIVE_ENABLED", "false")
    monkeypatch.setenv("GEMINI_API_KEY", key_sentinel)

    async def request_readiness():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            unauthorized = await client.get("/internal/v1/health")
            authorized = await client.get(
                "/internal/v1/health",
                headers={"Authorization": f"Bearer {token}"},
            )
            return unauthorized, authorized

    unauthorized, authorized = asyncio.run(request_readiness())
    assert unauthorized.status_code == 401
    assert authorized.status_code == 200
    assert authorized.json() == {
        "status": "ok",
        "service": "cybernexus-ai",
        "analysisMode": "deterministic",
        "geminiConfiguration": "disabled",
        "geminiConnectivity": "disabled",
    }
    assert token not in authorized.text
    assert key_sentinel not in authorized.text


def test_provider_readiness_marks_configured_gemini_unverified_without_calling_it():
    settings = ProviderSettings(
        provider="gemini",
        gemini_live_enabled=True,
        gemini_api_key="mock-only-key",
        gemini_model="gemini-test-model",
    )

    assert settings.readiness() == {
        "analysisMode": "gemini",
        "geminiConfiguration": "configured_unverified",
        "geminiConnectivity": "unverified",
    }

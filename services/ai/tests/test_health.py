import asyncio

import httpx
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

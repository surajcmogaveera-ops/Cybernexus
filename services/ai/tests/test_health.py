import asyncio

import httpx
from cybernexus_ai.main import app


def test_health_endpoint_returns_service_status():
    async def request_health():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get("/health")

    response = asyncio.run(request_health())
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "cybernexus-ai"}

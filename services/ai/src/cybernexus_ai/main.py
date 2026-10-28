from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="CyberNexus AI Service", version="0.1.0")


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "cybernexus-ai"


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()

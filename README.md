# CyberNexus

CyberNexus is an AI-assisted SOC prototype for explainable incident triage and qualified analyst assignment. This repository is the Phase 1 monorepo scaffold; it contains no incident processing or external AI integration yet.

## Prerequisites

- Node.js 22 or newer and pnpm 10 or newer
- Python 3.11 or newer and `pip` (or `uv`) for the AI service
- PostgreSQL 16 or newer for later database-backed phases

The React application and initial API checks do not require a running PostgreSQL instance.

## Install

```sh
pnpm install
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, `cp .env.example .env` on macOS/Linux). Then create the Python environment and install its dependencies:

```powershell
py -m venv services/ai/.venv
.\services\ai\.venv\Scripts\python.exe -m pip install -e "services/ai[dev]"
```

```sh
python3 -m venv services/ai/.venv
services/ai/.venv/bin/python -m pip install -e "services/ai[dev]"
```

## Develop

```sh
pnpm dev                 # web :5173 and API :3001
```

Run the AI service in a second terminal:

```powershell
.\services\ai\.venv\Scripts\python.exe -m uvicorn cybernexus_ai.main:app --reload --port 8000 --app-dir services/ai/src
```

```sh
services/ai/.venv/bin/python -m uvicorn cybernexus_ai.main:app --reload --port 8000 --app-dir services/ai/src
```

The API health endpoint is `GET http://localhost:3001/health`; the internal AI service exposes `GET http://127.0.0.1:8000/health`.

## Build and checks

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm format:check
```

Run the Python tests with `services/ai/.venv/bin/python -m pytest` on macOS/Linux or `services\ai\.venv\Scripts\python.exe -m pytest` in PowerShell.

## Environment variables

Copy `.env.example` to `.env`. `DATABASE_URL` is the PostgreSQL connection string used by Prisma when database work is introduced. `API_PORT`, `WEB_ORIGIN`, and `AI_SERVICE_URL` configure the local services. The QpiAI key variables are blank placeholders; no QpiAI integration is connected. Never put secrets in frontend variables or commit `.env`.

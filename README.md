# CyberNexus

CyberNexus is an AI-assisted SOC prototype for explainable incident triage and qualified analyst assignment. Its React dashboard can display explicitly labelled synthetic demo fixtures or authenticated incident, alert, analysis, prioritization/SLA, assignment, graph, timeline and incident-audit data from the versioned Express API. See [`docs/connected-soc-dashboard.md`](docs/connected-soc-dashboard.md) for unavailable endpoints and status limits; see [`docs/phase-17-final-validation.md`](docs/phase-17-final-validation.md) for final validation and local demonstration notes.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.25.0 (the repository's pinned version)
- Python 3.11 or newer for the AI service
- PostgreSQL 16 or newer is used by database-backed API workflows; it is not required to view the synthetic dashboard or use the Express liveness endpoint

## Install

From the repository root, install the JavaScript workspace from its lockfile:

```sh
pnpm install --frozen-lockfile
```

Set up the AI service environment once:

```powershell
py -m venv services/ai/.venv
.\services\ai\.venv\Scripts\python.exe -m pip install -e "services/ai[dev]"
```

```sh
python3 -m venv services/ai/.venv
services/ai/.venv/bin/python -m pip install -e "services/ai[dev]"
```

Copy `.env.example` to `.env` only if you need to customize local settings (`Copy-Item .env.example .env` in PowerShell or `cp .env.example .env` on macOS/Linux). `API_PORT` defaults to `3001`, and `WEB_ORIGIN` defaults to `http://127.0.0.1:5173`. `DATABASE_URL` is used by Prisma-backed operations; the dashboard's `/health` check does not verify database readiness. `AI_SERVICE_URL` and QpiAI key placeholders do not indicate a connected provider. Analysis defaults to `AI_PROVIDER=deterministic`; Gemini additionally requires a server-side key and `GEMINI_LIVE_ENABLED=true`, which must remain false until owner review of eligibility and data-use terms. The dashboard reads no bearer token or provider key in the browser. Never put real secrets in `.env.example` or frontend variables.

Gemini settings belong in the FastAPI service environment, not the root `.env` loaded by Express. For local setup, copy `services/ai/.env.example` to `services/ai/.env`; keep `GEMINI_LIVE_ENABLED=false` until owner review. The internal service token must match the API's local configuration.

## Develop locally

Start the React/Vite web app and Express API together:

```sh
pnpm dev
```

In a second terminal, start FastAPI with the project virtual environment:

```powershell
.\services\ai\.venv\Scripts\python.exe -m uvicorn cybernexus_ai.main:app --reload --host 127.0.0.1 --port 8000 --app-dir services/ai/src --env-file services/ai/.env
```

```sh
services/ai/.venv/bin/python -m uvicorn cybernexus_ai.main:app --reload --host 127.0.0.1 --port 8000 --app-dir services/ai/src --env-file services/ai/.env
```

The development servers use these local addresses:

- Web: `http://127.0.0.1:5173`
- Express health: `http://127.0.0.1:3001/health`
- Vite proxy to Express: `http://127.0.0.1:5173/api/health`
- FastAPI health: `http://127.0.0.1:8000/health`

The Vite `/api` proxy forwards to Express on port 3001. To stop a service, press `Ctrl+C` in the terminal running it. Uvicorn loads `services/ai/.env` only when started with the documented `--env-file` option; otherwise FastAPI uses the process environment and safe provider defaults. The browser and Express do not receive the Gemini key. The dashboard uses local synthetic fixtures. Its Express indicator checks the real `/health` endpoint through Vite; PostgreSQL is shown as unknown because that liveness endpoint does not check the database, AI service and Gemini provider are shown as unknown because the dashboard only probes Express. It does not probe private FastAPI liveness or external Gemini connectivity. Successful startup does not verify database readiness or external providers.

Alert ingestion, correlation, incident management, AI analysis, evidence validation, prioritization, and assignment are documented in [`docs/alert-ingestion.md`](docs/alert-ingestion.md), [`docs/correlation-and-incidents.md`](docs/correlation-and-incidents.md), [`docs/analysis-and-evidence-validation.md`](docs/analysis-and-evidence-validation.md), [`docs/prioritization-sla-audit.md`](docs/prioritization-sla-audit.md), and [`docs/assignment-optimization.md`](docs/assignment-optimization.md). Connected API workflows require configured Express bearer credentials, a reachable PostgreSQL database, and a private FastAPI service token (`CYBERNEXUS_AI_SERVICE_TOKEN`) held only by the API and AI service. Without a token, the dashboard shows labelled synthetic fixtures; it does not represent them as persisted system data.

## Checks

```sh
pnpm check:workspace   # offline, frozen lockfile/workspace consistency; does not install packages
pnpm check:env          # rejects tracked .env files; .env.example is allowed
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Run the Python tests with the project environment:

```powershell
.\services\ai\.venv\Scripts\python.exe -m pytest -q services\ai\tests
```

```sh
services/ai/.venv/bin/python -m pytest -q services/ai/tests
```

# CyberNexus

CyberNexus is an AI-assisted SOC prototype for explainable incident triage and qualified analyst assignment. The current application is a local health-check scaffold; it does not yet ingest alerts or provide incident workflows.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.25.0 (the repository's pinned version)
- Python 3.11 or newer for the AI service
- PostgreSQL 16 or newer is intended for later database-backed phases; it is not required by the current health-check scaffold

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

Copy `.env.example` to `.env` only if you need to customize local settings (`Copy-Item .env.example .env` in PowerShell or `cp .env.example .env` on macOS/Linux). A `.env` file is optional for the current health-only startup. `API_PORT` defaults to `3001`, and `WEB_ORIGIN` defaults to `http://127.0.0.1:5173`; set them only when changing those local endpoints. `DATABASE_URL` is needed only for later Prisma/database operations, which are not part of the current health checks. `AI_SERVICE_URL` and the blank QpiAI key placeholders are unused by the scaffold; no external integration is configured. Never put real secrets in `.env.example` or frontend variables.

## Develop locally

Start the React/Vite web app and Express API together:

```sh
pnpm dev
```

In a second terminal, start FastAPI with the project virtual environment:

```powershell
.\services\ai\.venv\Scripts\python.exe -m uvicorn cybernexus_ai.main:app --reload --host 127.0.0.1 --port 8000 --app-dir services/ai/src
```

```sh
services/ai/.venv/bin/python -m uvicorn cybernexus_ai.main:app --reload --host 127.0.0.1 --port 8000 --app-dir services/ai/src
```

The development servers use these local addresses:

- Web: `http://127.0.0.1:5173`
- Express health: `http://127.0.0.1:3001/health`
- Vite proxy to Express: `http://127.0.0.1:5173/api/health`
- FastAPI health: `http://127.0.0.1:8000/health`

The Vite `/api` proxy forwards to Express on port 3001. To stop a service, press `Ctrl+C` in the terminal running it. The current API and AI services expose health checks only; successful startup does not verify PostgreSQL or external providers.

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

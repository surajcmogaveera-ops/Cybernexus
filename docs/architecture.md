# CyberNexus architecture

The React/Vite browser client calls the Node/Express API. The Node API owns authentication, authorization, persistence, and audit writes. It will call the private Python/FastAPI service for internal analysis workflows. PostgreSQL is accessed by the API through Prisma. The browser must never call the AI service or external AI/optimization providers directly.

This scaffold includes local health endpoints only. QpiAI Agent Hive and QpiAI Opt are not integrated or represented as connected. The database schema is an initial placeholder; domain models will be added in later phases.

## API and JSON contracts

The TypeScript contracts in `packages/shared` define alert input and records, incidents, analysts, assignments, health responses, and API errors. JSON fields use camelCase, identifiers use UUID strings, and timestamps use ISO 8601 UTC strings ending in `Z`. Provider-specific alert fields stay inside the untrusted `payload` object. The Node API validates request bodies with these schemas and returns errors as `{ "error": { "code": "...", "message": "...", "details": [{ "path": ["field"], "message": "..." }] } }`; error responses never include stack traces.

Python does not import TypeScript. FastAPI and Pydantic exchange ordinary JSON using the same field names and UTC timestamp convention. The web client validates the Node health response against the shared health contract. The Python health endpoint uses the same `status` and `service` field names, with its exact JSON shape covered by the Python endpoint test. The Vite development server proxies `/api/*` to the Node API and removes the `/api` prefix.

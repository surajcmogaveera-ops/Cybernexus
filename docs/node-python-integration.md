# Phase 13 — Node–Python integration report

## Status

**PASS WITH REMAINING ISSUES.** The production Express-to-FastAPI HTTP clients
were exercised against a separately running local Uvicorn process for both
correlation and deterministic incident analysis. The isolated PostgreSQL test
database setting is absent, so authorized API workflows that persist
correlation, analysis, and audit records were not run. No database connection
was made during this verification.

## Communication path verified

The integration test is
[`apps/api/src/integration/python-boundary.integration.test.ts`](../apps/api/src/integration/python-boundary.integration.test.ts).
It starts `cybernexus_ai.main:app` on loopback using a fresh synthetic
service-to-service token, with `AI_PROVIDER=deterministic` and
`GEMINI_LIVE_ENABLED=false`. It then invokes the same production clients used by
Express:

- `createCorrelationServiceClient` sends `POST /internal/v1/correlations`.
- `createIncidentAnalysisServiceClient` sends
  `POST /internal/v1/incident-analyses`.
- Each client uses the bearer token, bounded response reader, timeout,
  TypeScript schema validation, and request-ID consistency checks.
- FastAPI validates the token and Pydantic request, then returns its normal
  versioned response.

The test also starts Express with the production routers and verifies public
requests without API credentials receive `401`. Missing and incorrect internal
credentials receive `401`; a malformed authenticated internal request receives
`422` with a generic validation message. Tokens are generated for the test and
are not printed.

## Results and limits

- Correlation crosses the real HTTP boundary and returns a `v1` candidate with
  rationale, matching normalized-user evidence fields, and `proposed` status.
- A synthetic pair with timestamps but no entity evidence returns no
  relationship.
- Incident analysis crosses the real HTTP boundary and returns
  `deterministic_fallback`, `needsHumanReview: true`, unverified findings,
  incident-request-scoped references, and explicit missing-information
  uncertainty.
- Existing mocked suites continue to cover transport unavailability, malformed
  or unexpected responses, request-ID mismatch, invalid evidence, and safe API
  error mapping. No retries were introduced.
- The existing API integration tests require `CYBERNEXUS_TEST_DATABASE_URL` to
  identify a loopback PostgreSQL database named `cybernexus_test`. That
  variable is not configured here. The available development `DATABASE_URL`
  was not used. Database persistence, audit writes, authorized end-to-end
  correlation/analysis, and their cleanup behavior remain unverified in this
  run.
- The test did not make a Gemini request or call an external provider. The
  deterministic Python fallback was used.
- Structural evidence references were checked by the existing Express and
  Python schemas. Semantic claim support remains unverified.
- No defect requiring changes to the service clients, FastAPI endpoints,
  authentication, or failure mapping was found. No schema, migration, or
  production workflow code was changed for this phase.

## Commands and outcomes

- `pnpm --filter @cybernexus/api exec vitest run src/integration/python-boundary.integration.test.ts --reporter=verbose` — **3 passed**.
- `pnpm test` — **94 passed, 11 skipped** (database integration suites skipped
  because the isolated database setting is absent).
- `python -m pytest -q services/ai/tests` — **32 passed**.
- `pnpm typecheck` — **passed**.
- `pnpm lint` — **passed**.
- `pnpm format:check` — **passed**.
- `pnpm build` — **passed**, with existing dependency annotation notices and a
  761.36 kB minified JavaScript chunk warning.
- `pnpm check:env` — **passed**; no real `.env` files are tracked.
- `git diff --check` — **passed**; Git reported line-ending conversion notices
  for pre-existing modified files.

No database migrations, commits, or pushes were performed. The pre-existing
working-tree changes were preserved.

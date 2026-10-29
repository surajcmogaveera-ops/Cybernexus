# Revised Phase 17 — Final validation, security evaluation, deployment readiness and demonstration

This revised phase consolidates original Phases 19 and 20 while retaining their historical rows in the canonical roadmap. Validation used synthetic fixtures and the loopback-only `cybernexus_test` database. No database schema or migration was changed, no live Gemini or QpiAI request was made, and no external deployment or publication occurred.

## Validation record

The initial repository-wide checks completed before documentation edits. The initial `pnpm test` run passed its shared, API, and web suites while skipping database integration suites because the test URL was not set. Then the existing test-database URL was checked without printing its value: its database name was changed to `cybernexus_test`, the destination resolved to loopback, and Prisma reported the existing migrations up to date. No migration command was run. Database-backed suites use unique synthetic test identifiers and their existing cleanup hooks.

The full API suite passed when run serially against that verified database: `pnpm exec vitest run --maxWorkers=1 --minWorkers=1` from `apps/api` passed 22 files and 89 tests, including persistence, ingestion, correlation/incident, analysis, assignment, prioritization, and Python HTTP-boundary coverage. The root test command with concurrent API tests reproducibly had one failure: the correlation integration test's incident-list request returned HTTP 500. That same test passed in isolation and the full API suite passed serially. This is recorded as test concurrency interference pending root-cause analysis; the concurrent failure is not hidden by the serial pass.

Baseline workspace results:

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed before documentation edits.
- `pnpm check:env`: passed; no tracked real `.env` files.
- `pnpm build`: passed; Vite reported the existing large JavaScript chunk warning and upstream annotation warnings.
- `pnpm --filter @cybernexus/api exec prisma validate`: passed.
- `pnpm check:workspace`: blocked because the offline pnpm mirror lacks metadata for `@typescript-eslint/project-service` (`ERR_PNPM_NO_OFFLINE_META`).
- `python -m pytest -q services/ai/tests`: 34 passed.
- `git diff --check`: passed at baseline; the repository contains many pre-existing user changes and line-ending warnings.

The full root test command was not rerun after enabling the test DB because its parallel API runner hits the reproducible integration failure. Its baseline without database credentials passed shared (17), API (78 with 11 DB tests skipped), and web (18) tests. The serialized API rerun provides the database-backed result above.

## Acceptance matrix

| Area                                        | Status          | Evidence and remaining limit                                                                                                                                                                                                           |
| ------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing unit, contract, and frontend suite | PASS            | Root test run passed shared/API/web suites.                                                                                                                                                                                            |
| Database integration                        | PASS            | All 11 DB tests passed within the serial API run on loopback `cybernexus_test`; no migration was needed.                                                                                                                               |
| Python service tests                        | PASS            | 34 passed; no Python source was changed in this phase.                                                                                                                                                                                 |
| End-to-end core workflow                    | PARTIAL         | Separate integration tests exercise ingest, correlation/incident, analysis, priority/SLA, assignment, timeline, audit, and the real local FastAPI boundary. A single browser-driven scenario spanning all stages was not run.          |
| Security and trust-boundary regression      | PARTIAL         | Existing auth/scope, validation, evidence-reference, deterministic fallback, assignment authorization/freshness, audit and simulation tests pass. This is not an independent penetration test or a proof of semantic evidence support. |
| Synthetic evaluation and ground truth       | PARTIAL         | Versioned synthetic fixtures/ground truth exist and unit tests consume fixtures. No aggregate model-quality or operational evaluation metric is claimed; there is no connected metrics API.                                            |
| Dashboard truthful data/status states       | PARTIAL         | Existing UI tests cover API-derived data and unavailable states. Connected mode does not invent missing records, audit events, metrics, solver output, FastAPI health or Gemini connectivity. No browser-to-database system test ran.  |
| Local deployment/demo instructions          | PASS            | Existing README and service docs describe local startup; this report adds isolated test-target evidence and the limits of the current demonstration. Production deployment artifacts/hosting are not established.                      |
| External deployment or publication          | NOT IMPLEMENTED | No deployment, publishing, commit, or push was performed.                                                                                                                                                                              |
| Gemini and QpiAI connectivity               | BLOCKED         | No provider request was made. Gemini remains disabled; QpiAI integrations remain blocked/unselected as documented in Phase 15.                                                                                                         |
| Parallel full API test run                  | PARTIAL         | One correlation integration assertion fails only under the concurrent API test run (HTTP 500); isolated and serial API runs pass.                                                                                                      |
| Offline workspace lock check                | BLOCKED         | Missing package metadata in the configured offline pnpm mirror.                                                                                                                                                                        |

## Reproducible local synthetic demonstration

Use a dedicated local development database and synthetic data only. Do not point these steps at production or a shared operational database.

1. Install the pinned JavaScript workspace and the documented Python dependencies using the [README setup steps](../README.md#install). Start PostgreSQL locally and configure `DATABASE_URL` for the dedicated demo database in the ignored root `.env`.
2. Apply the repository's existing migrations to that dedicated database using `pnpm --filter @cybernexus/api prisma:migrate:deploy`. For the integration test database, first verify its name and loopback destination; the API integration suite itself refuses nonlocal or non-`cybernexus_test` targets.
3. For a populated demonstration, run `pnpm --filter @cybernexus/api prisma:seed` only against a disposable synthetic demo database. The seed uses stable synthetic identifiers and upserts, but it is not a database reset and should not be run against an operational dataset.
4. Configure the Express `CYBERNEXUS_API_TOKENS_JSON` credential with at least `api:read` and `api:write` scopes, and `audit:read` if audit history is to be shown. Keep the token server-side until entering it into the dashboard. Configure the shared private service token as described in the README if using FastAPI-backed workflows.
5. Start web and Express with `pnpm dev`. In another terminal, start FastAPI using the project virtual environment and the README's Uvicorn command. FastAPI `.env` loading requires the explicit `--env-file services/ai/.env` option. Keep `AI_PROVIDER=deterministic` and `GEMINI_LIVE_ENABLED=false`.
6. Open `http://127.0.0.1:5173`, enter the authorized synthetic-demo bearer token, and inspect available incident routes. Health indicators report only what each exposed endpoint verifies. Missing data, evaluation metrics, private FastAPI health, and Gemini connectivity remain unavailable/unknown rather than inferred.

The seed is repeatable but is not a cleanup command. Recreate or clear only a disposable demo database using a separately reviewed procedure; this phase did not add or run a destructive reset script. Automated integration tests delete their own random-ID fixtures through their test cleanup hooks.

## Remaining work

- Diagnose and eliminate the correlation integration test's concurrent-run failure; retain serial execution as an explicit local verification mode meanwhile.
- Add and execute one browser-driven scenario across the supported workflows against a seeded, isolated local test database.
- Add a metrics-producing evaluation harness only after agreeing on ground-truth matching rules and reporting confidence/coverage; do not infer metrics from API counts.
- Resolve deployment target, managed secret storage, backup/restore, readiness, observability, rollback and operator ownership before any deployment. This phase intentionally did not deploy.
- Obtain the owner's eligibility and data-use review before enabling Gemini. Do not send operational logs or personal/confidential data to an external provider.

**Phase result: PASS WITH REMAINING ISSUES.** The existing workflow suites, including the complete serialized database-backed API suite, are green; concurrency, cross-layer browser validation, evaluation metrics, provider eligibility, and production deployment remain explicit follow-up work. Stop at revised Phase 17.

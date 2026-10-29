# Phase 8 — Synthetic Dataset and Alert Ingestion

This document describes the Phase 8 alert ingestion API and fixtures. The Express API owns authorization, validation, Prisma writes, and audit events. FastAPI is not involved in ingestion. The dashboard remains backed by its own local synthetic fixtures and does not display alerts imported through these endpoints.

## Local configuration

Set `DATABASE_URL` to a PostgreSQL database for normal API writes and configure `CYBERNEXUS_API_TOKENS_JSON` with bearer credentials in an ignored local `.env` file or a deployment secret store. Each configured token must be at least 32 characters. Read requests need `api:read`; writes need `api:write`. Missing or invalid auth configuration fails closed. Never put credentials in fixtures, source control, or browser configuration.

The PostgreSQL integration test reads `CYBERNEXUS_TEST_DATABASE_URL` directly from the Vitest process environment. It does not load that variable from `.env`. In PowerShell, set it for the current session only (`$env:CYBERNEXUS_TEST_DATABASE_URL = ...`) after confirming it points to the local `cybernexus_test` database. The test's guard checks the host and database name, then uses this verified value as `DATABASE_URL` for the test process. Do not use `cybernexus_dev`. Tests skip when the test variable is absent. Final Phase 8 verification constructed this URL from the existing local configuration in process memory, confirmed the connected database was `cybernexus_test` on IPv6 loopback, applied the pending alert-ingestion migration, and verified both migrations were applied. No development database migration was run.

Before applying the unique source-event index to a database with existing records, check for duplicates with this read-only query:

```sql
SELECT "source", "externalId", COUNT(*)
FROM "SecurityAlert"
WHERE "externalId" IS NOT NULL
GROUP BY "source", "externalId"
HAVING COUNT(*) > 1;
```

The migration does not merge or delete rows. Resolve any returned duplicates through a separately reviewed data migration plan before applying it.

## Input and normalization

Each input is a strict JSON object with required `source`, `observedAt`, `title`, `severity`, and object-valued `payload`. Optional `externalId` and `alertType` remain absent when not supplied. Unknown top-level fields are rejected. Each serialized input record is limited to 32 KiB; a batch contains 1–50 records and the existing Express JSON body limit also applies.

`observedAt` must be a valid ISO date-time with `Z` or an explicit UTC offset. It is stored as an instant and returned in UTC. `ingestedAt` is generated separately by the database. `source`, `alertType`, and severity matching are case-insensitive; source and alert type are normalized to lowercase.

Severity aliases map as follows:

- `informational`, `info` → `informational`
- `low`, `notice` → `low`
- `medium`, `moderate`, `warning`, `warn` → `medium`
- `high`, `error` → `high`
- `severe`, `fatal`, `critical` → `critical`
- `unknown` → `unknown`

Other severity strings are rejected. The raw `payload` object is stored unchanged. Normalized entity attributes are extracted only from supported string fields: `userId` from `userId`, `user`, or `actorId`; `deviceId` from `deviceId`, `hostId`, or `endpointId`; and `cloudResourceId` from `cloudResourceId`, `resourceId`, or `resource`. `sourceMetadata` records the input field names, original source values and entity field paths; absent identifiers are not invented.

## Endpoints

All routes are under `/api/v1/alerts`, require bearer authentication, and are subject to the existing request controls.

### Ingest one record

`POST /api/v1/alerts/ingest` requires `api:write`. Send one JSON record. An accepted event returns `201` with `{ "status": "accepted", "alert": ... }`. An exact retry returns `200` with `{ "status": "duplicate", "alertId": "..." }`. Reusing an identity with changed normalized content returns `409` with the shared `CONFLICT` error. Invalid input returns `400`; authentication and authorization failures return `401` or `403`; storage failures use the safe gateway error response.

```sh
curl -X POST http://127.0.0.1:3001/api/v1/alerts/ingest \
  -H 'Authorization: Bearer YOUR_CONFIGURED_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: retry-2026-001' \
  --data '{"source":"demo-idp","externalId":"event-001","observedAt":"2026-10-29T08:15:00Z","title":"Synthetic sign-in alert","severity":"warning","payload":{"userId":"demo-user-01","synthetic":true}}'
```

`Idempotency-Key` is optional, 1–120 safe ASCII characters. `(source, externalId)` is the primary duplicate identity when an external ID is present; otherwise `(source, Idempotency-Key)` provides retry protection. If neither exists, repeated submissions are retained as separate records. Content equality includes normalized event fields and raw payload. A conflicting retry never overwrites existing content.

### Import a JSON batch

`POST /api/v1/alerts/upload` requires `api:write` and accepts `{ "records": [ ... ] }`. The response is `200` with aggregate `accepted`, `rejected`, `duplicate`, and `failed` counts plus one indexed outcome per input. Each record is processed and audited in its own database transaction, so valid records can persist when another record is invalid or fails. A conflict is reported as `rejected` with `CONFLICT`. A batch `Idempotency-Key`, when supplied, is combined with the zero-based record index to provide stable retry identities for the same ordered batch. Keep record order stable when retrying.

### Retrieve records

`GET /api/v1/alerts` requires `api:read`. Optional filters are `source`, `severity`, `alertType`, `from`, `to`, and `q` (case-insensitive search over title, source, and external ID). `from` is inclusive and `to` exclusive; both must include a timezone and `to` must be later than `from`. Pagination uses one-based `page` (default 1) and `pageSize` (default 25, maximum 100). The response contains `items`, `page`, `pageSize`, `hasNext`, and `totalItems`.

## Fixtures

`data/synthetic/alerts-v1.json` contains stable fictional provider events spanning identity, endpoint, cloud, and network contexts, plus an unrelated nearby event, an ID-less event, and untrusted instruction-like alert text. `ground-truth-v1.json` separately records expected related, unrelated, ambiguous, and untrusted cases for future evaluation. It is not read by ingestion and is never returned as an application finding. `invalid-records-v1.json` holds rejected examples, while `duplicate-submissions-v1.json` distinguishes exact retries from changed-content conflicts. The existing dashboard demo dataset remains separate and unchanged in purpose.

## Verification and limitations

Run database-independent tests with `pnpm --filter @cybernexus/api exec vitest run src/alerts/normalization.test.ts src/alerts/routes.test.ts`. The real database test is `src/alerts/database.integration.test.ts`; it only runs when the process environment contains a verified local `CYBERNEXUS_TEST_DATABASE_URL` for `cybernexus_test`. Never substitute the development database. Check migration status before applying the Phase 8 migration.

Phase 8 does not implement correlation, incident creation, AI investigation, risk prioritization, analyst assignment, or dashboard-to-API integration. The synthetic records contain fictional data only. Production authentication lifecycle, distributed rate limiting, retention, and deployment database operations remain outside this phase.

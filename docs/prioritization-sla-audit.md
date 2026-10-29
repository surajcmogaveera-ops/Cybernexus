# Phase 14 — Prioritization, SLA, response plans, and audit

## Deterministic risk policy

`risk-v1` is implemented in `apps/api/src/prioritization/policy.ts`. The authoritative score is an integer from 0 to 100. Its points are:

| Factor                                                              |           Contribution |
| ------------------------------------------------------------------- | ---------------------: |
| Severity base: critical / high / medium / low / informational       | 70 / 55 / 40 / 25 / 10 |
| At least three linked alerts                                        |                     +5 |
| One or more analyst-accepted relationships                          |                    +10 |
| One or more proposed or review-required relationships               |                     +5 |
| SLA urgency: overdue/breached / approaching / at most 50% remaining |         +15 / +10 / +5 |

Contributions are added and capped at 100. Priority thresholds are critical (85–100), high (65–84), medium (40–64), and low (0–39). Unknown severity yields a null score and `unclassified`; the system does not fill missing severity with a number. Proposed relationships add only a small uncertainty/caution factor and do not establish an attack path. Asset value, business impact, threat intelligence, estimated effort, assignment feasibility, and analyst workload are unavailable and are explicitly returned as limitations. Analysis confidence is returned as a separate Phase 11 value and never changes the risk score.

Each calculation stores its policy version, calculation time, input snapshot, risk score, recommended classification, SLA state, deadline, and factor explanations in an append-only `IncidentPriorityCalculation` row. `POST /api/v1/incidents/:id/priority/recalculate` writes the calculation and audit event in one transaction. `GET /api/v1/incidents/:id/priority` retrieves the latest stored recommendation and combines it with the current override. A missing calculation returns 404 rather than silently writing from a GET request.

## SLA policy and breach-risk rules

`response-sla-v1` derives its response target from incident severity and anchors the deadline at `Incident.createdAt`, never the alert ingestion time:

| Severity      |     Initial response target |
| ------------- | --------------------------: |
| Critical      |                  60 minutes |
| High          |                 240 minutes |
| Medium        |               1,440 minutes |
| Low           |               4,320 minutes |
| Informational |              10,080 minutes |
| Unknown       | No target; deadline unknown |

An unresolved incident is `on_track` while more than 25% of its target remains, `approaching_deadline` at 25% or less, and `overdue` at or past the deadline. A completed incident is `met` when its `resolvedAt` (or fallback `closedAt`) is at or before its deadline; otherwise it is `breached`. Unknown severity or creation time produces `deadline_unknown`, never an implicit compliant state. Calculations use UTC instants and accept an injected reference time for deterministic tests.

`breach-rules-v1` is a rule-based band, not a trained prediction: missing deadlines return `unknown`; measured completion returns `not_applicable`; an unresolved overdue incident returns `high`; an approaching high/critical effective priority returns `high`, other approaching incidents `moderate`; an on-track critical priority returns `moderate`; other on-track incidents return `low`. The response explicitly sets `predictiveModel: false`. The policy does not use assignments or workload.

## Suggested response plans

`POST /api/v1/incidents/:id/response-plan` creates bounded, deterministic suggestions from linked alert IDs, supported normalized alert categories, incident severity, and candidate relationship IDs. Steps include order, rationale, exact evidence references, `status: suggested`, `approvalStatus: review_required`, and `performed: false`. Supported categories include authentication, process start, IAM policy change, DNS anomaly, MFA enrollment, user report, and connection observation. Each distinct supported alert category gets its own evidence-scoped suggestion; unsupported categories receive only general source-validation guidance. High/critical severity adds a recommendation to consult the approved response playbook. No suggestion executes a command, changes an incident, assigns an analyst, or performs containment.

Each generated step is recorded as an `incident.response_step.suggested` audit event in the same transaction. The audit metadata includes the suggestion, rationale, evidence references, ordering, review status, and `performed: false`. There is no workflow to approve, reject, or mark a recommendation completed in Phase 14; those states are therefore never fabricated.

## Priority overrides and audit history

`POST /api/v1/incidents/:id/priority/override` requires `api:write`, a supported priority, and a trimmed reason of 10–1,000 characters. It records the configured bearer principal subject as actor, the previous effective priority, new override, reason, and policy version. The manual override is stored separately from every calculated recommendation. The update and audit event share one Prisma transaction. Optimistic `updatedAt` matching rejects a concurrent update; repeating the same override returns 409. The API does not expose operations to edit or delete audit records.

`GET /api/v1/incidents/:id/audit` requires the distinct `audit:read` scope and supports bounded pages (page 1–100; size 1–100). It includes events targeted at the incident and its bounded linked alerts, relationships, and recent analysis runs. Metadata is allowlisted and scalar-only to avoid returning payloads, arbitrary nested records, secrets, or connection details. Audit actor IDs come from the authenticated subject; the API does not invent a user identity.

## API and verification

- `POST /api/v1/incidents/:id/priority/recalculate` — authenticated `api:write`, empty JSON object or no body.
- `GET /api/v1/incidents/:id/priority` — `api:read`, latest persisted calculation.
- `POST /api/v1/incidents/:id/priority/override` — `api:write`, strict priority and reason body.
- `GET /api/v1/incidents/:id/sla` — `api:read`, current deadline state.
- `GET /api/v1/incidents/:id/breach-risk` — `api:read`, transparent rules-based estimate.
- `POST /api/v1/incidents/:id/response-plan` — `api:write`, generated and audited suggestions.
- `GET /api/v1/incidents/:id/audit?page=1&pageSize=25` — `audit:read`, bounded sanitized history.

Inputs and outputs use strict shared TypeScript contracts in `packages/shared/src/index.ts`. Missing incidents or stored priority calculations return 404, malformed requests 400, and conflicting overrides 409. Unexpected persistence errors use the existing generic safe 500 response. The additive migration is `apps/api/prisma/migrations/20261029200000_priority_sla_audit/migration.sql`.

Database integration tests are `apps/api/src/prioritization/database.integration.test.ts`. They reject any target except local `cybernexus_test`; before running them, configure the test URL in the process environment, verify `current_database()` and loopback address, and check migration status. Never use `cybernexus_dev`, reset a database, or print connection credentials. Run policy tests with `pnpm --filter @cybernexus/api exec vitest run src/prioritization/policy.test.ts`.

## Phase 14 audit update

The Phase 14 review found and corrected three deterministic-policy gaps without changing the database schema or API response schemas:

- Response-plan generation now produces a separate, evidence-scoped suggestion for every supported alert category present. Unsupported categories receive only source-validation guidance.
- Severity and alert-category lookups now reject inherited JavaScript object properties. Unexpected severity values normalize to `unknown` and receive no numeric score; prototype-named or arbitrary alert categories cannot become executable-looking recommendations or trigger a lookup error.
- Invalid non-null resolution/closure timestamps raise a bounded policy error rather than being misclassified as a breached SLA.

The policy tests cover attainable scores around every priority threshold, every SLA state and deadline boundary, UTC offset normalization, invalid inputs, deterministic output, unsupported alert categories, per-category evidence, and the no-action/review-required contract. Database-free route tests verify authentication scopes, strict body and query validation, invalid identifiers, and safe malformed-JSON handling. The database-backed audit/persistence tests were not run in this review because `CYBERNEXUS_TEST_DATABASE_URL` is not configured. Previous recorded database results remain historical evidence; this update does not claim a fresh database verification.

Baseline focused policy tests passed (14); the three PostgreSQL integration tests skipped. After the changes, focused policy, route, and database suites reported **23 passed, 3 skipped**. `pnpm test` reported **103 passed, 11 skipped** across shared, API, and web; all skipped tests require the isolated database. `python -m pytest -q services/ai/tests` passed (32). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm check:env`, and `git diff --check` passed. The build emitted dependency annotation notices and the existing 761.36 kB minified JavaScript chunk warning. No migration was run, and the development database was not used.

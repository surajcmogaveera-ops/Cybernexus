# Revised Phase 16 — Connected SOC dashboard

## Audit findings

Before this phase, the React views were populated from `demoDashboardData`: overview metrics and charts, incident queue, alert explorer, investigation details, analyst cards, assignment rows, evaluation counts, and illustrative audit rows. The only network check was the public Express `/health` endpoint (reached from the UI as `/api/health`). The Vite proxy rewrote every `/api` path, which made `/api/v1/*` requests miss the Express API routes.

Express already exposed authenticated contracts for incidents and linked alerts, alert listing, stored incident analysis, priority and SLA/breach-risk records, current assignments, incident timeline, entity graph, assignment simulation, and incident audit history. The API requires a bearer token with `api:read`; audit history additionally requires `audit:read`. The browser had no credential entry and did not call these endpoints. The API has no evaluation-metrics endpoint, analyst-capacity listing endpoint, public FastAPI health endpoint, Gemini configuration endpoint, or live Gemini connectivity check.

## Implemented integration

- Vite now rewrites only `/api/health` to `/health`; versioned `/api/v1/*` paths retain their API prefix.
- The dashboard offers a password-style token entry and validates it with `/api/v1/session`. The token exists only in React memory and is cleared when disconnecting or reloading; it is not stored or logged.
- The connected view loads all bounded incident and alert pages and active assignments using existing Express routes and shared schemas for incident, alert, analysis, priority, SLA, breach-risk and audit records. Timeline, graph, and route envelopes receive bounded structural checks; no business policy is reimplemented in the frontend. It loads selected incident detail, timeline, graph, stored analysis, priority, SLA, breach-risk and audit history from the existing per-incident routes.
- Missing stored analysis or priority is shown as absent. Optional route failures and denied audit access are shown as unavailable. Connected mode never falls back to synthetic records. Without a token, the existing sample workspace remains explicitly labelled synthetic demo data.
- Assignment simulation is a separate action and display from applied assignment records. The UI accepts its result only when the API reports `assignmentsPersisted: false`; it provides no apply action.
- Service status distinguishes the Express health response from FastAPI health, Gemini server configuration, and verified Gemini connectivity. The latter three are displayed as unknown/not verified because no public status route exists; the dashboard does not probe or call a model provider.
- Evaluation view states that evaluation metrics are unavailable. It does not convert incident counts into model performance or operational metrics.

## Remaining gaps and verification limits

There is no global audit endpoint, evaluation endpoint, analyst profile/capacity read endpoint, or public health/status route for FastAPI and Gemini. Existing incident-scoped audit access works only for credentials with `audit:read`. The frontend tests use synthetic HTTP responses; this run did not connect the UI to a database-backed API process because the isolated `CYBERNEXUS_TEST_DATABASE_URL` is unavailable. Database integration tests were skipped, so persistence-backed dashboard content remains unverified in this run. No schema, migration, Gemini setting, or external service was changed or called.

## Phase 16 result

**PASS WITH REMAINING ISSUES.** Supported API workflows are connected behind explicit bearer authorization; missing endpoints and unavailable records are represented honestly. Final end-to-end validation and deployment remain out of scope.

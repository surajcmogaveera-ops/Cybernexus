# Phase 9 — Correlation and incident workflows

## Service boundary

The public API is owned by Express. It authenticates callers, enforces `api:read` or `api:write`, loads stored alert records, constructs a bounded shared `v1` request, checks the FastAPI result against the source records, then writes authoritative rows through Prisma. FastAPI is a private deterministic correlation service; it has no database connection and does not make public authorization decisions.

Configure `AI_SERVICE_URL` for the private service and `CYBERNEXUS_AI_SERVICE_TOKEN` for service-to-service authentication. The token must contain at least 32 characters. HTTP is accepted only for loopback hosts; a non-loopback service must use HTTPS. Requests and responses are bounded to 1 MiB and calls time out after 3 seconds. Keep the token in an ignored environment file or secret store; never place it in browser configuration.

## Deterministic rules and score meaning

The engine normalizes entity values with Unicode NFKC and case folding and considers directly shared users/accounts, devices/hosts, cloud resources, and IP addresses within a 120-minute event-time window. Timestamps constrain a relationship supported by entity evidence; timestamps alone never create a candidate. Candidate evidence records the entity type and the exact source and target field paths. Express independently verifies both values, type, time window, response request ID, score, and status before persistence.

The numeric `confidence` is a deterministic rule-strength indicator, not a probability, model output, incident severity, or risk score:

| Rule                                                               |                       Score | Default status  | Handling                                |
| ------------------------------------------------------------------ | --------------------------: | --------------- | --------------------------------------- |
| Shared user/account                                                |                        0.90 | proposed        | Candidate relationship                  |
| Shared device/host                                                 |                        0.92 | proposed        | Candidate relationship                  |
| Shared cloud resource                                              |                        0.90 | proposed        | Candidate relationship                  |
| More than one independent strong entity type                       | Base + 0.03, capped at 0.98 | proposed        | Stronger rule support                   |
| Strong match with conflicting values of another strong entity type |                At most 0.74 | review_required | Keep uncertainty visible                |
| Same source and event type sharing only a device                   |                At most 0.74 | review_required | Preserve distinct source events         |
| Shared IP address only                                             |                        0.45 | review_required | IP/NAT context is insufficient to group |

Only `proposed`/`accepted` relationship components with score at least 0.85 and at least two distinct alerts can create an incident. Incident severity is the maximum source-alert severity and is not derived from confidence. New incidents set `needsHumanReview` to true and explicitly state that candidate edges do not confirm an attack. No standalone-incident rule is used. Alerts without adequate evidence remain available and ungrouped.

Synthetic ground truth in `data/synthetic/ground-truth-v1.json` is loaded only by tests. The correlation service does not read it. The tests cover labeled related groups, unrelated close-time alerts, ambiguous shared-IP events, missing identifiers, conflicting context, repeatability, private-service authentication, and invalid/untrusted request handling.

## Persistence and graph meaning

`Entity` stores normalized entity values. `AlertEntity` edges record values observed on an alert with the source field path and event time; these are direct observations derived from the persisted alert. `AlertRelationship` edges are inferred hypotheses and retain the rule type, confidence, rationale, supporting field-path evidence, status, and algorithm version. The graph API returns separate `alert_entity` and `correlation` edge types and includes the correlation status and rationale. It does not claim a confirmed attack path. ATT&CK technique mappings are not added because the source fixtures do not provide a validated technique mapping.

Stable SHA-256 keys make relationship and exact-component incident writes idempotent. A retry returns the same persisted relationship and incident. Existing relationship review decisions are never overwritten by a retry. Alerts already linked to an incident are not silently merged into another group. Entity links, relationships, incident alert links, incident rows, and their audit events are written in one Prisma transaction. Foreign keys and unique indexes back the application checks. The relational schema still permits a direct database writer to create an incident with no links; production writes must use the Express workflow.

## API

All public endpoints require configured bearer authentication:

- `POST /api/v1/correlation/run` — `api:write`; body contains 1–100 unique alert UUIDs. Missing alerts return 404; unavailable or invalid internal service output returns a safe 503/502.
- `GET /api/v1/incidents` — `api:read`; bounded page/pageSize and optional status/severity filters.
- `GET /api/v1/incidents/:incidentId` — `api:read`; incident, linked source alerts, and persisted candidate relationships.
- `GET /api/v1/incidents/:incidentId/timeline` — `api:read`; chronological incident creation, alert observation, candidate proposal, and audited status/review events.
- `GET /api/v1/incidents/:incidentId/graph` — `api:read`; incident, alert, and entity nodes with observed and inferred edges.
- `PATCH /api/v1/relationships/:relationshipId/status` — `api:write`; a proposed/review-required candidate may be accepted or rejected once; decision and audit write share a transaction.
- `PATCH /api/v1/incidents/:incidentId/status` — `api:write`; allowed transitions are `new → triaged`, `triaged → investigating|resolved`, `investigating → resolved`, and `resolved → investigating|closed`. Closed is terminal. Invalid transitions return 409.

Correlation runs, new candidate relationships, incident creation, relationship decisions, and incident status transitions generate audit events. The audit table is application-audited, not cryptographically tamper-proof.

## Verification

Run database-independent API and Python checks with `pnpm --filter @cybernexus/api test` and `python -m pytest -q services/ai/tests`. The Phase 9 API integration suite is `apps/api/src/correlation/database.integration.test.ts`; it skips when `CYBERNEXUS_TEST_DATABASE_URL` is absent and rejects non-loopback hosts or databases other than `cybernexus_test`. Derive the test URL from existing local configuration in process memory only, verify `current_database()` and loopback server address, check migration status, and apply the versioned migration only to that test database. Never substitute `cybernexus_dev` or print a connection URL.

The Phase 7 dashboard remains synthetic. Connecting it to these persisted APIs belongs to a later integration phase. AI investigations and evidence validation were added in Phase 10. Deterministic prioritization, SLA tracking, suggested response plans, and audit history were added in Phase 11. Analyst assignment, response execution, and QpiAI integrations remain unimplemented.

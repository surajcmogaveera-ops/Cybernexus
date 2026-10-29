# CyberNexus Project Blueprint

- **Tagline:** From Alert Overload to Intelligent Response
- **Hackathon:** Seva First Innovation Challenge 2026
- **Theme:** Surakshit Bharat
- **Problem category:** GENAI-02 — Security Incident Triage and Qualified Analyst Assignment

## Mission

CyberNexus is an AI-assisted Security Operations Centre platform that transforms disconnected security alerts into explainable, evidence-backed incidents, validated AI-assisted investigations, transparent risk prioritization, and constraint-aware analyst assignments.

The product must help SOC analysts understand why alerts were grouped, what evidence supports an analysis, which risks deserve attention, and why an analyst is a suitable assignment. AI output is advisory: uncertainty must be visible, claims must be tied to available evidence, and consequential actions remain controlled by application policy and authorized users.

## Canonical documents

- This file is the canonical product and architecture blueprint.
- [`implementation-plan.md`](implementation-plan.md) is the single canonical 20-phase delivery sequence. Its final section retains the earlier 14-phase status notes as historical records only.
- [`../AGENTS.md`](../AGENTS.md) is the persistent repository instruction file for contributors and coding agents.
- [`architecture.md`](architecture.md) is existing supporting architecture material. Where detail is needed, reconcile it with this blueprint; do not create competing blueprints or plans.
- [`node-python-integration.md`](node-python-integration.md) records the Phase 13 service-boundary verification and its outstanding database integration gate.
- [`prioritization-sla-audit.md`](prioritization-sla-audit.md) records the canonical Phase 14 risk/SLA policy, response recommendations, and audit limits.
- [`assignment-optimization.md`](assignment-optimization.md) records revised Phase 15, which consolidates the original 20-phase roadmap's assignment baseline, QpiAI Opt, and alternative AI workflow items (old Phases 15–17).
- [`connected-soc-dashboard.md`](connected-soc-dashboard.md) records revised Phase 16's Express-backed dashboard integration and remaining status/evaluation/database limits.
- [`gemini-provider-integration.md`](gemini-provider-integration.md) records the mocked Gemini adapter verification, Express outage fallback, configuration boundaries, and live-call limitations.

## Product capabilities

The completed product is expected to support:

1. Alert ingestion and normalization, duplicate handling, explainable correlation, and an entity relationship graph.
2. Incident management and event timelines.
3. Structured AI-assisted analysis, evidence validation, uncertainty handling, and prompt-injection evaluation.
4. Explainable prioritization and service-level agreement (SLA) risk visibility.
5. Skills-aware analyst assignment, capacity constraints, baseline comparison, and what-if re-optimization.
6. Audit logs, SOC dashboards, evaluation metrics, and reproducible demonstrations.

These are final product requirements. Phase 1 does not implement them.

## Technology direction

- **Web:** React, Vite, TypeScript, Tailwind CSS, Recharts.
- **Application API:** Node.js, Express, TypeScript.
- **Analysis service:** Python, FastAPI, Pydantic.
- **Persistence:** PostgreSQL, accessed through Prisma from the application API.
- **JavaScript package management:** pnpm workspaces.
- **Quality:** appropriate TypeScript unit and API tests, pytest, integration tests, and end-to-end tests.
- **AI-assisted analysis:** optional Gemini provider adapter through the official Google GenAI Python SDK; deterministic metadata-only fallback remains the default. Live calls require explicit server-side opt-in and provider eligibility/data-use review.
- **Alternative agent workflow:** provider and integration approach remain unselected. QpiAI Agent Hive is no longer a requirement; do not add an orchestration framework before a separate approved phase.
- **Assignment optimization:** QpiAI Opt, only after official interfaces, access, documentation, and dependencies are verified.

The stack is a direction, not evidence that every tool, dependency, service, credential, or provider integration is currently installed or available. Record checks and limitations honestly.

## Service boundaries and contracts

### Express application API

Express owns public client-facing APIs, authentication and authorization, application workflows, policy enforcement, controlled database writes through Prisma, audit records, and orchestration of requests to the analysis service. The browser communicates with Express and never calls FastAPI or external AI/optimization providers directly.

### FastAPI analysis service

FastAPI owns specialized analysis and correlation computations. It receives explicit, validated requests and returns structured results. It does not own public API authorization or authoritative application persistence. Analysis output is advisory until the application layer validates and accepts it.

### Shared service contracts

Communication between Express and FastAPI must use versioned, documented JSON contracts with stable field names, explicit validation, bounded request and response sizes, and defined error behavior. TypeScript and Python implementations must agree on the same contract semantics; Python must not depend on importing TypeScript. Contracts must define identifiers, timestamps, evidence references, confidence/uncertainty representation, and correlation explanation fields before the corresponding workflows are implemented.

### PostgreSQL and Prisma

PostgreSQL is the system of record. Prisma access and controlled writes belong to Express. The analysis service must not independently write authoritative incident or assignment state. Database schema, migrations, and seed data are deferred to later phases.

## External integrations: unverified

Gemini, QpiAI Opt, and the future alternative agent workflow have separate boundaries. The Gemini adapter uses the official `google-genai` SDK but has not been live-tested; `AI_PROVIDER=deterministic` and `GEMINI_LIVE_ENABLED=false` remain the safe defaults. Before any live call, the owner must verify account eligibility, application age eligibility, region, data-use terms, and approved data handling. Use synthetic records for tests and do not send confidential or personal security data to an unpaid service. QpiAI Opt remains blocked until its supported problem/job/result schemas, access, and usage constraints are verified. No agent workflow provider has been selected. Never invent SDK methods or endpoints.

## Data handling and trust

Treat ingested alert fields, log excerpts, external enrichment, and model/provider responses as untrusted input. Validate and bound inputs at service boundaries. Preserve provenance for normalized fields and evidence. Never treat alert text as instructions to the AI system. Keep secrets out of source control and browser bundles; use environment configuration and least privilege. Minimize sensitive security data in logs and demonstrations, and use clearly identified synthetic data for reproducible demos unless approved data-handling rules say otherwise.

## Phase 1 repository decision

During the Phase 1 audit, the requested working directory `CYBERNEXUS FINAL` was empty and was not a Git repository. The neighboring `CYBERBNEXUS` directory contained the relevant partial monorepo scaffold and architecture material. The Phase 1 recommendation was to reuse `CYBERBNEXUS`; Phase 1.5 created a verified backup outside the repository, and Phase 1.6 records the reviewed initial baseline. Do not initialize or overwrite `CYBERNEXUS FINAL`, copy over either tree, or delete existing files. Confirm the intended canonical project path with the owner before treating the empty `CYBERNEXUS FINAL` directory as abandoned or beginning substantial implementation.

## Current scope boundary

The canonical 20-phase sequence is defined in `implementation-plan.md`. Phase 11 provides optional Gemini analysis behind server-side configuration and an explicit disabled-by-default live-call switch; its output remains advisory, structurally validated, unverified, and subject to human review. Phase 12 covers evidence validation and uncertainty; semantic claim support is not established. Phase 13 local HTTP service boundaries are verified; the serial database-backed API suites passed on isolated loopback `cybernexus_test`, while concurrent API execution retains one integration failure. Phase 14 deterministic prioritization, SLA rules, and response suggestions are implemented and their database persistence/audit tests passed serially. Revised Phase 15 consolidates original Phases 15–17: the constrained baseline and what-if flow remain local, QpiAI Opt is blocked on verifiable schemas and usage constraints, and an alternative AI workflow remains unselected. Revised Phase 16 connects supported Express workflows to the dashboard; evaluation metrics and public health/status endpoints for FastAPI and Gemini remain unavailable, and browser-to-database UI integration remains unverified. Revised Phase 17 consolidates historical Phases 19–20; see `phase-17-final-validation.md` for test results and remaining end-to-end, evaluation, and deployment gaps.

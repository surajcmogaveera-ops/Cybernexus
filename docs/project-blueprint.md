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
- [`implementation-plan.md`](implementation-plan.md) is the canonical 24-phase delivery sequence.
- [`../AGENTS.md`](../AGENTS.md) is the persistent repository instruction file for contributors and coding agents.
- [`architecture.md`](architecture.md) is existing supporting architecture material. Where detail is needed, reconcile it with this blueprint; do not create competing blueprints or plans.

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
- **AI workflow orchestration:** QpiAI Agent Hive, only after official interfaces, access, documentation, and dependencies are verified.
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

QpiAI Agent Hive and QpiAI Opt are unverified external integrations. No SDK methods, endpoints, capabilities, credentials, or compatibility assumptions may be invented. Before implementation, confirm official documentation and supported interfaces, actual account/access availability, package/runtime dependencies, licensing or usage constraints, and a feasible integration boundary. If any check fails, record it and propose a documented alternative for explicit product review. Until verified, keep these providers out of runtime dependencies and describe them as planned, not connected.

## Data handling and trust

Treat ingested alert fields, log excerpts, external enrichment, and model/provider responses as untrusted input. Validate and bound inputs at service boundaries. Preserve provenance for normalized fields and evidence. Never treat alert text as instructions to the AI system. Keep secrets out of source control and browser bundles; use environment configuration and least privilege. Minimize sensitive security data in logs and demonstrations, and use clearly identified synthetic data for reproducible demos unless approved data-handling rules say otherwise.

## Phase 1 repository decision

During the Phase 1 audit, the requested working directory `CYBERNEXUS FINAL` was empty and was not a Git repository. The neighboring `CYBERBNEXUS` directory contained the relevant partial monorepo scaffold and architecture material. The Phase 1 recommendation was to reuse `CYBERBNEXUS`; Phase 1.5 created a verified backup outside the repository, and Phase 1.6 records the reviewed initial baseline. Do not initialize or overwrite `CYBERNEXUS FINAL`, copy over either tree, or delete existing files. Confirm the intended canonical project path with the owner before treating the empty `CYBERNEXUS FINAL` directory as abandoned or beginning substantial implementation.

## Current scope boundary

Phase 1 establishes the repository/environment baseline, canonical documentation, architecture boundaries, roadmap, and security/data-loss review. It does not implement UI features, business APIs, domain database schema, AI algorithms, assignment algorithms, dashboards, external integrations, deployments, or Phase 2 work.

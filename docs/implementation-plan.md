# CyberNexus Implementation Plan

This is the single canonical implementation roadmap. It contains exactly 24 sequential phases across the eight required parts. Complete and review each phase in order; later product scope does not authorize skipping verification or claiming an unperformed check succeeded. The roadmap is planning, not evidence of implementation.

## Part 1: Foundation (Phases 1–3)

### Phase 1 — Clean start and environment audit

Inspect the chosen working directory, Git metadata and history, branches, uncommitted/ignored files, documentation, stack tool availability, and dependency state. Protect existing work. Record repository choice, service boundaries, security/data-loss findings, limitations, and the roadmap. Stop for owner review; do not begin Phase 2 without explicit approval.

### Phase 2 — Repository baseline and contributor workflow

After approval, confirm the canonical repository path, preserve the existing scaffold in a reviewed initial commit or verified backup, reconcile repository naming, establish contribution conventions, and document reproducible local setup. Keep existing user work intact.

### Phase 3 — Monorepo tooling and local development foundation

Verify the pinned Node.js/pnpm/Python toolchain and workspace layout; align package-manager version and lockfile. Establish consistent lint/format/typecheck/test commands, environment templates, local service startup, and safe generated-file/secret exclusions. Verify commands actually run.

## Part 2: Backend, database and contracts (Phases 4–6)

### Phase 4 — Shared API and service contracts

Specify and validate versioned contracts shared semantically by TypeScript and Pydantic for errors, IDs, UTC timestamps, pagination, health, and service-to-service analysis requests/results. Add compatibility and contract tests.

### Phase 5 — PostgreSQL and Prisma persistence foundation

Confirm local/CI PostgreSQL availability and configuration. Design reviewed domain migrations, constraints, indexes, and seed conventions; generate Prisma client and verify migrations against a disposable database. Express remains the sole owner of authoritative writes.

### Phase 6 — Express application API and access control

Build public API routing, input validation, authentication/authorization, policy enforcement, error handling, request tracing, rate limits, and audit-write foundations. Keep FastAPI private and apply controlled persistence through Prisma.

## Part 3: Alert data and correlation (Phases 7–9)

### Phase 7 — Alert ingestion and normalization

Define supported source adapters and canonical alert contracts; ingest, validate, normalize, timestamp, and retain provenance for source fields. Add safe size/rate limits and malformed-input handling.

### Phase 8 — Duplicate detection and idempotency

Define stable duplicate keys and retention windows; make repeated ingestion safe and explain duplicate decisions. Measure false merges and missed duplicates using reproducible fixtures.

### Phase 9 — Explainable correlation and entity graph

Implement correlation in FastAPI behind shared contracts. Return contributing signals, evidence references, uncertainty, and machine-readable explanations; represent related entities and links with provenance. Evaluate against labeled fixtures before exposing results.

## Part 4: Incidents, AI analysis and evidence validation (Phases 10–12)

### Phase 10 — Incident lifecycle and event timeline

Implement incident creation and lifecycle transitions through Express, with authorization, controlled persistence, immutable event history, alert membership, and analyst-visible timeline ordering.

### Phase 11 — Structured AI-assisted investigation

Add a bounded analysis workflow that produces schema-validated findings, evidence references, confidence/uncertainty, and recommended next steps. Keep generated content advisory, record model/config provenance, and route orchestration through the documented service boundary.

### Phase 12 — Evidence validation and adversarial evaluation

Validate each material finding against available evidence, distinguish unsupported claims and missing context, and test prompt-injection resistance using a reviewed evaluation set. Define abstention and human escalation behavior; do not promote failed claims as facts.

## Part 5: Prioritization and SLA management (Phases 13–14)

### Phase 13 — Explainable risk prioritization

Define a versioned prioritization model with visible contributing factors, weights or rules, uncertainty, and audit provenance. Compare rankings against labeled scenarios and make score changes explainable.

### Phase 14 — SLA tracking and risk visibility

Define policy-configurable SLA clocks, pause/resume rules, breach risk thresholds, and time-source behavior. Surface imminent risk and breach history through APIs with testable boundary cases.

## Part 6: Assignment and optimization (Phases 15–17)

### Phase 15 — Analyst skills, availability and capacity model

Define analyst skills, proficiency, shifts, workload, capacity, eligibility, and constraints with authorized updates, freshness rules, and audit history. Avoid exposing unnecessary personnel data.

### Phase 16 — Assignment baseline and explainable recommendations

Build a deterministic baseline that respects eligibility, skill fit, availability, workload, and capacity. Return reasons, constraint outcomes, and unassigned/uncertain cases; compare recommendations against the baseline.

### Phase 17 — Optimization integration and what-if re-optimization

Verify QpiAI Opt official interfaces, access, dependencies, and constraints before any provider code. If confirmed, integrate behind a provider-neutral adapter and compare with the baseline; otherwise document a reviewed alternative. Add reproducible what-if scenarios and explainable constraint trade-offs. Treat QpiAI Agent Hive similarly before using it for workflow orchestration.

## Part 7: Connected SOC interface (Phases 18–20)

### Phase 18 — SOC dashboard and triage queue

Connect the React client to Express contracts. Provide queue filters, prioritized incidents, SLA risk, and status summaries with accessible loading, empty, and error states. Visualizations must be traceable to API data.

### Phase 19 — Incident investigation and entity views

Add incident detail, alert evidence, event timeline, correlation explanation, entity relationship graph, and structured AI findings. Make provenance, uncertainty, and unsupported claims clear to analysts.

### Phase 20 — Assignment and analyst workflow interface

Add skills-aware recommendations, capacity and constraint explanations, baseline comparison, authorized assignment actions, and what-if re-optimization controls. Show decision provenance and audit-visible outcomes.

## Part 8: Testing, security, deployment and final demonstration (Phases 21–24)

### Phase 21 — Automated test and evaluation coverage

Complete focused TypeScript unit/API tests, pytest coverage, contract and database integration tests, browser end-to-end flows, accessibility checks, and AI/correlation/assignment evaluation suites. Track quality thresholds and reproducible seeds/fixtures.

### Phase 22 — Security and privacy hardening

Review threat model, authz boundaries, secrets, dependency risk, injection, prompt injection, data retention, logging, rate limits, and audit integrity. Fix and re-verify findings; document residual risks and incident response assumptions.

### Phase 23 — Deployment and operational readiness

Build reproducible deployment artifacts for the chosen environment, apply least privilege, managed secrets, database backup/migration procedures, health/readiness checks, observability, and rollback guidance. Verify deployment and recovery procedures in a safe environment.

### Phase 24 — Final evaluation and reproducible demonstration

Run end-to-end scenarios from alert ingestion through evidence-backed analysis, prioritization, SLA risk, and constrained assignment. Report evaluation metrics and limitations, verify synthetic/demo data provenance, prepare a scripted reproducible demonstration, and review final acceptance evidence with stakeholders.

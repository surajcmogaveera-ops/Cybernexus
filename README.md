CyberNexus
Explainable, AI-assisted security incident triage for Security Operations Centre (SOC) teams.

CyberNexus is a modular SOC incident-triage platform designed to help analysts make sense of related security alerts, understand why they may belong to the same incident, review evidence-backed analysis, prioritize cases, and distribute work more consistently.

The project emphasizes explainability, evidence validation, deterministic safety checks, and auditable decisions. It is a development project; features that depend on external services, credentials, or a configured database should not be assumed to be enabled in every environment.
Contents
- Problem and approach
- Key capabilities
- Architecture
- Technology stack
- Repository layout
- Prerequisites
- Local setup
- Configuration and security
- Testing and quality checks
- Data and integration status
- Limitations
- Project roadmap
Problem and approach
SOC teams can receive many alerts from identity systems, endpoints, and cloud environments. Looking at each alert independently can make it harder to recognize a wider incident, validate what the evidence actually supports, and decide which case needs attention first.

CyberNexus is being built to support that workflow:
1. Ingest supported alert records and preserve their original information.
2. Normalize records into a common representation.
3. Identify potentially related alerts using explainable correlation signals.
4. Present incidents with links back to the supporting alerts and evidence.
5. Generate structured investigation assistance and validate its evidence references.
6. Prioritize incidents using a documented, reproducible risk and response-deadline policy.
7. Recommend analyst assignments based on relevant skills, availability, workload, and deadlines.
8. Record important decisions so analysts can understand what changed and why.
CyberNexus assists investigation; it does not replace analyst judgment or guarantee that an alert is malicious.
Key capabilities
The intended and implemented scope is organized around the following capabilities. Availability depends on the current code, configuration, and whether the required services are running.
- Alert handling: common alert representation and source-record preservation.
- Explainable correlation: identify potentially related alerts and expose the signals behind a relationship.
- Incident management: group related alerts into cases while retaining links to their evidence.
- AI-assisted investigation: produce structured investigation output through the dedicated AI service when configured.
- Evidence validation: check that cited evidence references correspond to available records and expose uncertainty rather than treating unsupported claims as facts.
- Deterministic fallback: retain a non-LLM path for supported analysis behavior when AI-provider use is unavailable or disabled.
- Risk and SLA prioritization: use documented rules to calculate priority and highlight response-deadline risk.
- Analyst assignment: provide a baseline assignment plan that accounts for skills, availability, capacity, and deadlines.
- Assignment explanation: make assignment decisions easier to review.
- What-if re-optimization: evaluate a proposed assignment change without applying it to the live plan.
- Audit history: retain traceable records of important workflow decisions.
- Synthetic data and ground truth: support repeatable development and evaluation without requiring access to a real organization’s security telemetry.
- Security-focused testing: exercise evidence validation, service boundaries, fallback behavior, and prompt-injection resilience.
The entity-relationship graph, baseline comparisons, optimization integrations, and other advanced capabilities should be treated as available only to the extent they are present and enabled in the checked-out version.
Architecture
┌───────────────────────────────────────────────────────────┐
│                    React + Vite web app                   │
│       Dashboard · incidents · analysis · workflows        │
└─────────────────────────────┬─────────────────────────────┘
                              │ HTTP API
┌─────────────────────────────▼─────────────────────────────┐
│                  Node.js + Express API                    │
│ Alerts · correlation · incidents · prioritization          │
│ assignment · audit · auth · database access                │
└───────────────┬──────────────────────┬────────────────────┘
                │                      │
                ▼                      ▼
┌──────────────────────────┐  ┌────────────────────────────┐
│ PostgreSQL + Prisma      │  │ Python + FastAPI AI service │
│ Persistent application   │  │ Structured investigation    │
│ records and relationships│  │ and provider boundary       │
└──────────────────────────┘  └────────────────────────────┘
The Express API is the main application backend. The Python/FastAPI service isolates specialized AI investigation functionality behind a service boundary. PostgreSQL is the relational data store, and Prisma is used for schema and database access. Shared TypeScript contracts help keep interfaces consistent across the monorepo.

QpiAI Agent Hive and QpiAI Opt are planned/targeted integrations for workflow orchestration and assignment optimization respectively; do not assume either external integration is active unless it is configured and verified in the current environment.
Technology stack
Area	Technology
Web frontend	React, TypeScript, Vite
Main API	Node.js, Express, TypeScript
AI service	Python, FastAPI
Database	PostgreSQL
ORM and schema	Prisma
Monorepo package manager	pnpm
Shared contracts	TypeScript package
Tests	Project TypeScript test tooling and Python pytest


Repository layout
.
├── apps/
│   ├── api/             # Express API, domain services and API tests
│   └── web/             # React/Vite user interface
├── packages/
│   └── shared/          # Shared TypeScript contracts and types
├── services/
│   └── ai/              # FastAPI service and Python tests
├── docs/                # Blueprint, implementation plan and design notes
├── prisma/              # Root-level Prisma files, if present in this checkout
├── pnpm-workspace.yaml
└── package.json
The exact set of files may evolve as implementation progresses.
Prerequisites
Install the versions compatible with the repository's package manifests:
- Node.js (an active LTS release recommended)
- pnpm
- Python 3
- PostgreSQL for database-backed workflows
Some checks and workflows may work without every service running; integration tests that require PostgreSQL or the AI service may need additional configuration.
Local setup
Run these commands from the repository root in PowerShell or a compatible terminal.
1. Install JavaScript dependencies
pnpm install
2. Configure environment variables
Create a local .env file only after checking the repository's environment example, configuration loader, and documentation. Use local development values and keep credentials out of Git.

At minimum, database-backed workflows need a valid PostgreSQL connection string in the variable expected by the current Prisma/API configuration. Internal service authentication may also be required when the Express API calls the FastAPI service. Use the exact variable names documented by the checked-out code; do not copy placeholder secrets into a shared repository.
3. Prepare the database
Review the Prisma schema and available migration scripts before running database commands. Use the migration/deployment command defined by the root package.json and the project's documented development workflow. Do not run destructive database resets against data you need to keep.
4. Start the services
Use the scripts defined in the root and workspace package.json files. A typical development workflow starts the API and web app in separate terminals, and starts the FastAPI service when testing AI-assisted investigation.
pnpm --filter @cybernexus/api dev
pnpm --filter @cybernexus/web dev
The exact script names can differ by repository version. Check the package scripts if a command is not defined. Start the Python service using the instructions in services/ai and its package/configuration files.
Configuration and security
- Keep .env files, API tokens, database passwords, private keys, and provider credentials out of commits.
- Check git status, .gitignore, and tracked files before pushing changes. A file already tracked by Git is not made safe merely by adding it to .gitignore.
- Use scoped, locally generated credentials where the application requires authentication.
- Keep internal AI-service credentials server-side; do not expose them through frontend environment variables or browser code.
- Treat alert content and investigation evidence as untrusted input.
- Validate AI-generated evidence references before displaying findings as supported conclusions.
- Prefer deterministic policy decisions for risk scoring and assignment constraints; use AI to assist analysis, not to silently override validation or authorization.
- Use synthetic or explicitly authorized telemetry for development and testing.
- Do not connect the application to production security systems without appropriate authorization and review.
Testing and quality checks
Run the scripts that actually exist in the current checkout. Start by inspecting available scripts:
pnpm run
pnpm --filter @cybernexus/api run
pnpm --filter @cybernexus/web run
Common checks, when defined by the repository, include:
pnpm test
pnpm typecheck
pnpm lint
pnpm build
Python tests can be run with the project's configured environment, for example:
python -m pytest services/ai/tests
Use the Python environment and dependency instructions supplied with services/ai. Database integration tests may require PostgreSQL and the correct test database configuration. Report actual command output rather than assuming a check passed because it was started.
Data and integration status
CyberNexus supports development with synthetic/sample data so core workflows can be exercised without a live SOC feed. A real connector should only be described as supported after its ingestion path, authentication, error handling, and tests have been implemented and verified.

The dashboard showing sample data does not by itself mean that CyberNexus is connected to a live security provider. Similarly, the presence of an AI service does not mean an external AI provider is configured. If the AI provider or service is unavailable, behavior depends on the configured deterministic fallback and the current workflow implementation.
Limitations
- This is an actively developed project; not every planned feature or integration is necessarily complete.
- Sample data and synthetic ground truth are not evidence of production detection accuracy.
- Correlation indicates that alerts may be related; it is not proof that they share a cause.
- AI-generated investigation output can be incomplete or wrong and must be reviewed against the source evidence.
- Risk scores and assignment recommendations are only as useful as their documented policy, inputs, and validation.
- Production deployment requires additional work around operational monitoring, access control, secret management, data retention, resilience, and security review.
Project roadmap
The implementation plan is tracked in [`docs/implementation-plan.md`](docs/implementation-plan.md), with the broader project design in [`docs/project-blueprint.md`](docs/project-blueprint.md). These documents are the source of truth for phase status and detailed acceptance criteria.
Contributing
1. Create a focused branch for your change.
2. Make the smallest change that addresses the issue.
3. Add or update tests and documentation.
4. Run relevant checks and record their actual results.
5. Review staged files for secrets and unintended artifacts before committing.
License
Check the repository's LICENSE file for the applicable license and terms.

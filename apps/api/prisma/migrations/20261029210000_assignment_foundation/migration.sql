-- Add explicit assignment inputs and reproducible recommendation snapshots.
ALTER TABLE "Incident"
  ADD COLUMN "assignmentRequirementsKnown" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Analyst"
  ADD COLUMN "maxConcurrentAssignments" INTEGER,
  ADD CONSTRAINT "Analyst_maxConcurrentAssignments_check"
    CHECK ("maxConcurrentAssignments" IS NULL OR "maxConcurrentAssignments" BETWEEN 1 AND 1000);

CREATE TABLE "IncidentRequiredSkill" (
  "incidentId" UUID NOT NULL,
  "skill" VARCHAR(80) NOT NULL,
  CONSTRAINT "IncidentRequiredSkill_pkey" PRIMARY KEY ("incidentId", "skill"),
  CONSTRAINT "IncidentRequiredSkill_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "IncidentRequiredSkill_skill_incidentId_idx"
  ON "IncidentRequiredSkill"("skill", "incidentId");

CREATE TABLE "AssignmentOptimizationRun" (
  "id" UUID NOT NULL,
  "algorithmVersion" VARCHAR(40) NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  "actorId" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "runtimeMs" INTEGER NOT NULL,
  "inputSnapshot" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  CONSTRAINT "AssignmentOptimizationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssignmentOptimizationRun_runtimeMs_check" CHECK ("runtimeMs" >= 0)
);
CREATE INDEX "AssignmentOptimizationRun_createdAt_idx"
  ON "AssignmentOptimizationRun"("createdAt");
CREATE INDEX "AssignmentOptimizationRun_provider_status_createdAt_idx"
  ON "AssignmentOptimizationRun"("provider", "status", "createdAt");

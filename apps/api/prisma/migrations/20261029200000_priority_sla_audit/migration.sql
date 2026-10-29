-- Add reproducible priority snapshots and auditable incident overrides.
CREATE TYPE "IncidentPriority" AS ENUM (
  'critical',
  'high',
  'medium',
  'low',
  'unclassified'
);

ALTER TABLE "Incident"
  ADD COLUMN "priorityOverride" "IncidentPriority",
  ADD COLUMN "priorityOverrideReason" VARCHAR(1000),
  ADD COLUMN "priorityOverrideActorId" VARCHAR(120),
  ADD COLUMN "priorityOverrideAt" TIMESTAMPTZ(6),
  ADD CONSTRAINT "Incident_priorityOverride_fields_check"
    CHECK (
      ("priorityOverride" IS NULL AND "priorityOverrideReason" IS NULL AND "priorityOverrideActorId" IS NULL AND "priorityOverrideAt" IS NULL)
      OR
      ("priorityOverride" IS NOT NULL AND "priorityOverrideReason" IS NOT NULL AND length(trim("priorityOverrideReason")) >= 10 AND "priorityOverrideActorId" IS NOT NULL AND "priorityOverrideAt" IS NOT NULL)
    ),
  ADD CONSTRAINT "Incident_priorityOverride_allowed_check"
    CHECK ("priorityOverride" IS NULL OR "priorityOverride" <> 'unclassified');

CREATE TABLE "IncidentPriorityCalculation" (
  "id" UUID NOT NULL,
  "incidentId" UUID NOT NULL,
  "policyVersion" VARCHAR(40) NOT NULL,
  "calculatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "riskScore" INTEGER,
  "recommendedPriority" "IncidentPriority" NOT NULL,
  "slaState" VARCHAR(40) NOT NULL,
  "deadlineAt" TIMESTAMPTZ(6),
  "inputs" JSONB NOT NULL,
  "factors" JSONB NOT NULL,
  CONSTRAINT "IncidentPriorityCalculation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IncidentPriorityCalculation_riskScore_check"
    CHECK ("riskScore" IS NULL OR "riskScore" BETWEEN 0 AND 100),
  CONSTRAINT "IncidentPriorityCalculation_classification_check"
    CHECK (("riskScore" IS NULL AND "recommendedPriority" = 'unclassified') OR ("riskScore" IS NOT NULL AND "recommendedPriority" <> 'unclassified')),
  CONSTRAINT "IncidentPriorityCalculation_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "IncidentPriorityCalculation_incidentId_calculatedAt_idx"
  ON "IncidentPriorityCalculation"("incidentId", "calculatedAt");

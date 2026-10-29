-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('informational', 'low', 'medium', 'high', 'critical', 'unknown');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('new', 'triaged', 'investigating', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "AnalystAvailability" AS ENUM ('available', 'unavailable');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('active', 'reassigned', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('alert', 'artifact', 'log', 'other');

-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('requested', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AnalysisVerificationStatus" AS ENUM ('unverified');

-- CreateEnum
CREATE TYPE "AnalysisContractVersion" AS ENUM ('v1');

-- CreateTable
CREATE TABLE "SecurityAlert" (
    "id" UUID NOT NULL,
    "source" VARCHAR(120) NOT NULL,
    "externalId" VARCHAR(200) NOT NULL,
    "alertType" VARCHAR(120),
    "title" VARCHAR(500) NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "observedAt" TIMESTAMPTZ(6) NOT NULL,
    "ingestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "sourceMetadata" JSONB,
    "normalizedAttributes" JSONB,

    CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'new',
    "severity" "AlertSeverity" NOT NULL,
    "needsHumanReview" BOOLEAN,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentAlert" (
    "incidentId" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "linkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provenance" VARCHAR(500),

    CONSTRAINT "IncidentAlert_pkey" PRIMARY KEY ("incidentId","alertId")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "contractVersion" "AnalysisContractVersion" NOT NULL DEFAULT 'v1',
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'requested',
    "context" VARCHAR(4000),
    "maxFindings" INTEGER NOT NULL DEFAULT 10,
    "includeRecommendations" BOOLEAN NOT NULL DEFAULT true,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "abstentionReason" VARCHAR(1000),
    "missingInformation" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedNextSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "incidentId" UUID,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRunAlert" (
    "analysisRunId" UUID NOT NULL,
    "alertId" UUID NOT NULL,

    CONSTRAINT "AnalysisRunAlert_pkey" PRIMARY KEY ("analysisRunId","alertId")
);

-- CreateTable
CREATE TABLE "AnalysisRunEvidenceReference" (
    "analysisRunId" UUID NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "referenceId" UUID NOT NULL,

    CONSTRAINT "AnalysisRunEvidenceReference_pkey" PRIMARY KEY ("analysisRunId","kind","referenceId")
);

-- CreateTable
CREATE TABLE "AnalysisFinding" (
    "id" UUID NOT NULL,
    "analysisRunId" UUID NOT NULL,
    "conclusion" VARCHAR(1000) NOT NULL,
    "rationale" VARCHAR(2000) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "uncertainty" VARCHAR(1000),
    "verificationStatus" "AnalysisVerificationStatus" NOT NULL DEFAULT 'unverified',

    CONSTRAINT "AnalysisFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisFindingEvidenceReference" (
    "analysisFindingId" UUID NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "referenceId" UUID NOT NULL,

    CONSTRAINT "AnalysisFindingEvidenceReference_pkey" PRIMARY KEY ("analysisFindingId","kind","referenceId")
);

-- CreateTable
CREATE TABLE "Analyst" (
    "id" UUID NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "availability" "AnalystAvailability" NOT NULL DEFAULT 'unavailable',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Analyst_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalystSkill" (
    "analystId" UUID NOT NULL,
    "skill" VARCHAR(80) NOT NULL,

    CONSTRAINT "AnalystSkill_pkey" PRIMARY KEY ("analystId","skill")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "analystId" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'active',
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "explanation" VARCHAR(2000) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "targetType" VARCHAR(120) NOT NULL,
    "targetId" UUID NOT NULL,
    "actorId" VARCHAR(120),
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- Preserve contract bounds for writes that bypass application validation.
ALTER TABLE "AnalysisRun"
  ADD CONSTRAINT "AnalysisRun_maxFindings_check"
  CHECK ("maxFindings" BETWEEN 1 AND 20);

ALTER TABLE "AnalysisFinding"
  ADD CONSTRAINT "AnalysisFinding_confidence_check"
  CHECK ("confidence" BETWEEN 0 AND 1);

-- CreateIndex
CREATE INDEX "SecurityAlert_source_externalId_idx" ON "SecurityAlert"("source", "externalId");

-- CreateIndex
CREATE INDEX "SecurityAlert_observedAt_idx" ON "SecurityAlert"("observedAt");

-- CreateIndex
CREATE INDEX "SecurityAlert_severity_observedAt_idx" ON "SecurityAlert"("severity", "observedAt");

-- CreateIndex
CREATE INDEX "Incident_status_severity_createdAt_idx" ON "Incident"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_updatedAt_idx" ON "Incident"("updatedAt");

-- CreateIndex
CREATE INDEX "IncidentAlert_alertId_linkedAt_idx" ON "IncidentAlert"("alertId", "linkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRun_requestId_key" ON "AnalysisRun"("requestId");

-- CreateIndex
CREATE INDEX "AnalysisRun_incidentId_requestedAt_idx" ON "AnalysisRun"("incidentId", "requestedAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_status_requestedAt_idx" ON "AnalysisRun"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "AnalysisRunAlert_alertId_idx" ON "AnalysisRunAlert"("alertId");

-- CreateIndex
CREATE INDEX "AnalysisRunEvidenceReference_kind_referenceId_idx" ON "AnalysisRunEvidenceReference"("kind", "referenceId");

-- CreateIndex
CREATE INDEX "AnalysisFinding_analysisRunId_idx" ON "AnalysisFinding"("analysisRunId");

-- CreateIndex
CREATE INDEX "AnalysisFindingEvidenceReference_kind_referenceId_idx" ON "AnalysisFindingEvidenceReference"("kind", "referenceId");

-- CreateIndex
CREATE INDEX "AnalystSkill_skill_analystId_idx" ON "AnalystSkill"("skill", "analystId");

-- CreateIndex
CREATE INDEX "Assignment_incidentId_assignedAt_idx" ON "Assignment"("incidentId", "assignedAt");

-- CreateIndex
CREATE INDEX "Assignment_analystId_status_assignedAt_idx" ON "Assignment"("analystId", "status", "assignedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_occurredAt_idx" ON "AuditEvent"("targetType", "targetId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_occurredAt_idx" ON "AuditEvent"("eventType", "occurredAt");

-- AddForeignKey
ALTER TABLE "IncidentAlert" ADD CONSTRAINT "IncidentAlert_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IncidentAlert" ADD CONSTRAINT "IncidentAlert_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "SecurityAlert"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisRunAlert" ADD CONSTRAINT "AnalysisRunAlert_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisRunAlert" ADD CONSTRAINT "AnalysisRunAlert_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "SecurityAlert"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisRunEvidenceReference" ADD CONSTRAINT "AnalysisRunEvidenceReference_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisFinding" ADD CONSTRAINT "AnalysisFinding_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisFindingEvidenceReference" ADD CONSTRAINT "AnalysisFindingEvidenceReference_analysisFindingId_fkey" FOREIGN KEY ("analysisFindingId") REFERENCES "AnalysisFinding"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalystSkill" ADD CONSTRAINT "AnalystSkill_analystId_fkey" FOREIGN KEY ("analystId") REFERENCES "Analyst"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_analystId_fkey" FOREIGN KEY ("analystId") REFERENCES "Analyst"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

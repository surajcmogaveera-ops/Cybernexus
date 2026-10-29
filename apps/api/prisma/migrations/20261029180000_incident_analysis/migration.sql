-- Add persisted provenance and validation outcomes for Phase 10 analyses.
ALTER TYPE "EvidenceKind" ADD VALUE 'relationship';

CREATE TYPE "AnalysisValidationStatus" AS ENUM (
  'references_validated',
  'insufficient_evidence',
  'reported_conflicts'
);

ALTER TABLE "AnalysisRun"
  ADD COLUMN "summary" VARCHAR(2000),
  ADD COLUMN "proposedSeverity" "AlertSeverity",
  ADD COLUMN "analysisConfidence" DOUBLE PRECISION,
  ADD COLUMN "validationStatus" "AnalysisValidationStatus",
  ADD COLUMN "providerId" VARCHAR(120),
  ADD COLUMN "needsHumanReview" BOOLEAN,
  ADD COLUMN "humanReviewRationale" VARCHAR(1000),
  ADD COLUMN "reportedConflicts" JSONB,
  ADD COLUMN "sourceSnapshotHash" VARCHAR(64);

ALTER TABLE "AnalysisRun"
  ADD CONSTRAINT "AnalysisRun_analysisConfidence_check"
  CHECK ("analysisConfidence" IS NULL OR "analysisConfidence" BETWEEN 0 AND 1);

ALTER TABLE "AnalysisRunEvidenceReference"
  ADD COLUMN "fieldPaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "AnalysisFinding"
  ADD COLUMN "evidenceValidationStatus" "AnalysisValidationStatus";

ALTER TABLE "AnalysisFindingEvidenceReference"
  ADD COLUMN "fieldPaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

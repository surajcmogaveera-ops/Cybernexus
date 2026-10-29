-- Persist provenance-bearing entity links and explainable alert relationships.
CREATE TYPE "CorrelationEntityType" AS ENUM ('user', 'device', 'cloud_resource', 'ip');
CREATE TYPE "CorrelationRelationshipType" AS ENUM ('shared_user', 'shared_device', 'shared_cloud_resource', 'shared_ip');
CREATE TYPE "CorrelationStatus" AS ENUM ('proposed', 'review_required', 'accepted', 'rejected');

ALTER TABLE "Incident"
  ADD COLUMN "correlationKey" VARCHAR(64);

CREATE UNIQUE INDEX "Incident_correlationKey_key"
  ON "Incident"("correlationKey");

CREATE TABLE "Entity" (
  "id" UUID NOT NULL,
  "entityType" "CorrelationEntityType" NOT NULL,
  "value" VARCHAR(512) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Entity_entityType_value_key"
  ON "Entity"("entityType", "value");
CREATE INDEX "Entity_entityType_createdAt_idx"
  ON "Entity"("entityType", "createdAt");

CREATE TABLE "AlertEntity" (
  "alertId" UUID NOT NULL,
  "entityId" UUID NOT NULL,
  "fieldPath" VARCHAR(160) NOT NULL,
  "observedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "AlertEntity_pkey" PRIMARY KEY ("alertId", "entityId")
);

CREATE INDEX "AlertEntity_entityId_observedAt_idx"
  ON "AlertEntity"("entityId", "observedAt");

CREATE TABLE "AlertRelationship" (
  "id" UUID NOT NULL,
  "correlationKey" VARCHAR(64) NOT NULL,
  "sourceAlertId" UUID NOT NULL,
  "targetAlertId" UUID NOT NULL,
  "relationshipType" "CorrelationRelationshipType" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "rationale" VARCHAR(1000) NOT NULL,
  "evidence" JSONB NOT NULL,
  "status" "CorrelationStatus" NOT NULL DEFAULT 'proposed',
  "correlationVersion" VARCHAR(20) NOT NULL DEFAULT 'v1',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlertRelationship_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AlertRelationship_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1),
  CONSTRAINT "AlertRelationship_distinct_alerts_check" CHECK ("sourceAlertId" <> "targetAlertId")
);

CREATE UNIQUE INDEX "AlertRelationship_correlationKey_key"
  ON "AlertRelationship"("correlationKey");
CREATE UNIQUE INDEX "AlertRelationship_sourceAlertId_targetAlertId_relationshipType_key"
  ON "AlertRelationship"("sourceAlertId", "targetAlertId", "relationshipType");
CREATE INDEX "AlertRelationship_status_createdAt_idx"
  ON "AlertRelationship"("status", "createdAt");
CREATE INDEX "AlertRelationship_sourceAlertId_targetAlertId_idx"
  ON "AlertRelationship"("sourceAlertId", "targetAlertId");

ALTER TABLE "AlertEntity"
  ADD CONSTRAINT "AlertEntity_alertId_fkey"
  FOREIGN KEY ("alertId") REFERENCES "SecurityAlert"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AlertEntity"
  ADD CONSTRAINT "AlertEntity_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AlertRelationship"
  ADD CONSTRAINT "AlertRelationship_sourceAlertId_fkey"
  FOREIGN KEY ("sourceAlertId") REFERENCES "SecurityAlert"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AlertRelationship"
  ADD CONSTRAINT "AlertRelationship_targetAlertId_fkey"
  FOREIGN KEY ("targetAlertId") REFERENCES "SecurityAlert"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

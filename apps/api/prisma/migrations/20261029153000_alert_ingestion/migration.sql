-- Missing source event IDs are stored as NULL. PostgreSQL unique indexes allow
-- multiple NULL values, while preventing concurrent duplicate source events.
ALTER TABLE "SecurityAlert"
  ALTER COLUMN "externalId" DROP NOT NULL;

ALTER TABLE "SecurityAlert"
  ADD COLUMN "idempotencyKey" VARCHAR(180);

DROP INDEX "SecurityAlert_source_externalId_idx";

CREATE UNIQUE INDEX "SecurityAlert_source_externalId_key"
  ON "SecurityAlert"("source", "externalId");

CREATE UNIQUE INDEX "SecurityAlert_source_idempotencyKey_key"
  ON "SecurityAlert"("source", "idempotencyKey");

CREATE INDEX "SecurityAlert_alertType_observedAt_idx"
  ON "SecurityAlert"("alertType", "observedAt");

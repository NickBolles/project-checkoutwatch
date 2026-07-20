-- Restore triggeredBy to run provenance and move queue idempotency into an indexed key.
ALTER TABLE "CheckRun" ADD COLUMN "jobKey" TEXT;

UPDATE "CheckRun"
SET "jobKey" = "triggeredBy", "triggeredBy" = 'schedule'
WHERE "triggeredBy" LIKE 'job:%';

CREATE UNIQUE INDEX "CheckRun_jobKey_key" ON "CheckRun"("jobKey");

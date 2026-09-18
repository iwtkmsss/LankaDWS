-- Every task has exactly one active responsible participant.
-- Keep the oldest active responsible when legacy data contains duplicates.
UPDATE "TaskParticipant"
SET "removedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "role" = 'RESPONSIBLE'
  AND "removedAt" IS NULL
  AND "id" <> (
    SELECT keeper."id"
    FROM "TaskParticipant" AS keeper
    WHERE keeper."taskId" = "TaskParticipant"."taskId"
      AND keeper."role" = 'RESPONSIBLE'
      AND keeper."removedAt" IS NULL
    ORDER BY keeper."createdAt" ASC, keeper."id" ASC
    LIMIT 1
  );

-- Backfill tasks that have no active responsible with their reporter.
INSERT INTO "TaskParticipant" (
  "id",
  "taskId",
  "userId",
  "role",
  "addedById",
  "createdAt",
  "updatedAt",
  "removedAt"
)
SELECT
  'tpart_' || lower(hex(randomblob(12))),
  task."id",
  task."reporterId",
  'RESPONSIBLE',
  task."createdById",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL
FROM "Task" AS task
WHERE NOT EXISTS (
  SELECT 1
  FROM "TaskParticipant" AS participant
  WHERE participant."taskId" = task."id"
    AND participant."role" = 'RESPONSIBLE'
    AND participant."removedAt" IS NULL
)
ON CONFLICT("taskId", "userId") DO UPDATE SET
  "role" = 'RESPONSIBLE',
  "addedById" = excluded."addedById",
  "removedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "TaskParticipant_one_active_responsible_key"
ON "TaskParticipant"("taskId")
WHERE "role" = 'RESPONSIBLE' AND "removedAt" IS NULL;

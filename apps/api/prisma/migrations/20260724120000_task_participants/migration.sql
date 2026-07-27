CREATE TABLE "TaskParticipant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "addedById" TEXT NOT NULL,
  "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" DATETIME,
  CONSTRAINT "TaskParticipant_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskParticipant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TaskParticipant_addedById_fkey"
    FOREIGN KEY ("addedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TaskParticipant_role_check"
    CHECK ("role" IN ('CO_EXECUTOR', 'OBSERVER'))
);

CREATE UNIQUE INDEX "TaskParticipant_active_role_key"
  ON "TaskParticipant"("taskId", "userId", "role")
  WHERE "removedAt" IS NULL;
CREATE INDEX "TaskParticipant_taskId_role_removedAt_userId_idx"
  ON "TaskParticipant"("taskId", "role", "removedAt", "userId");
CREATE INDEX "TaskParticipant_userId_role_removedAt_taskId_idx"
  ON "TaskParticipant"("userId", "role", "removedAt", "taskId");

CREATE TRIGGER "TaskParticipant_scope_guard_insert"
BEFORE INSERT ON "TaskParticipant"
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Task" AS task
      JOIN "User" AS participant
        ON participant."id" = NEW."userId"
       AND participant."workspaceId" = task."workspaceId"
       AND participant."status" = 'ACTIVE'
      JOIN "UserCompanyAccess" AS access
        ON access."userId" = participant."id"
       AND access."companyId" = task."companyId"
       AND access."status" = 'ACTIVE'
      JOIN "User" AS actor
        ON actor."id" = NEW."addedById"
       AND actor."workspaceId" = task."workspaceId"
       AND actor."status" = 'ACTIVE'
      WHERE task."id" = NEW."taskId"
    )
    THEN RAISE(ABORT, 'task_participant_scope_mismatch')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM "Task" AS task
      WHERE task."id" = NEW."taskId"
        AND task."groupId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "GroupMember" AS member
          WHERE member."groupId" = task."groupId"
            AND member."userId" = NEW."userId"
            AND member."leftAt" IS NULL
        )
    )
    THEN RAISE(ABORT, 'task_participant_group_mismatch')
  END;
END;

CREATE TRIGGER "TaskParticipant_core_immutable_update"
BEFORE UPDATE ON "TaskParticipant"
WHEN NEW."taskId" IS NOT OLD."taskId"
  OR NEW."userId" IS NOT OLD."userId"
  OR NEW."role" IS NOT OLD."role"
  OR NEW."addedById" IS NOT OLD."addedById"
  OR NEW."addedAt" IS NOT OLD."addedAt"
BEGIN
  SELECT RAISE(ABORT, 'task_participant_immutable');
END;

CREATE TRIGGER "TaskParticipant_removal_one_way"
BEFORE UPDATE OF "removedAt" ON "TaskParticipant"
WHEN OLD."removedAt" IS NOT NULL
  OR NEW."removedAt" IS NULL
BEGIN
  SELECT RAISE(ABORT, 'task_participant_removal_immutable');
END;

CREATE TRIGGER "Task_participant_scope_immutable_update"
BEFORE UPDATE OF "workspaceId", "companyId", "groupId" ON "Task"
WHEN (
  NEW."workspaceId" IS NOT OLD."workspaceId"
  OR NEW."companyId" IS NOT OLD."companyId"
  OR NEW."groupId" IS NOT OLD."groupId"
)
AND EXISTS (
  SELECT 1
  FROM "TaskParticipant" AS participant
  WHERE participant."taskId" = OLD."id"
    AND participant."removedAt" IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'task_participant_scope_immutable');
END;

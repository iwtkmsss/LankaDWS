CREATE TABLE "TaskFollower" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mutedAt" DATETIME,
  CONSTRAINT "TaskFollower_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskFollower_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TaskFollower_taskId_userId_key"
  ON "TaskFollower"("taskId", "userId");
CREATE INDEX "TaskFollower_userId_mutedAt_taskId_idx"
  ON "TaskFollower"("userId", "mutedAt", "taskId");
CREATE INDEX "TaskFollower_taskId_mutedAt_userId_idx"
  ON "TaskFollower"("taskId", "mutedAt", "userId");

CREATE TABLE "TaskUserState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "favoritedAt" DATETIME,
  "important" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TaskUserState_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskUserState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskUserState_important_check"
    CHECK ("important" IN (0, 1))
);

CREATE UNIQUE INDEX "TaskUserState_taskId_userId_key"
  ON "TaskUserState"("taskId", "userId");
CREATE INDEX "TaskUserState_userId_favoritedAt_taskId_idx"
  ON "TaskUserState"("userId", "favoritedAt", "taskId");
CREATE INDEX "TaskUserState_userId_important_taskId_idx"
  ON "TaskUserState"("userId", "important", "taskId");

CREATE TABLE "TaskReminder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "remindAt" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TaskReminder_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskReminder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskReminder_status_check"
    CHECK ("status" IN ('ACTIVE', 'SENT', 'CANCELLED'))
);

CREATE UNIQUE INDEX "TaskReminder_active_time_key"
  ON "TaskReminder"("taskId", "userId", "remindAt")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "TaskReminder_userId_status_remindAt_idx"
  ON "TaskReminder"("userId", "status", "remindAt");
CREATE INDEX "TaskReminder_taskId_userId_status_remindAt_idx"
  ON "TaskReminder"("taskId", "userId", "status", "remindAt");

CREATE TRIGGER "TaskFollower_scope_guard_insert"
BEFORE INSERT ON "TaskFollower"
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Task" AS task
      JOIN "User" AS user
        ON user."id" = NEW."userId"
       AND user."workspaceId" = task."workspaceId"
       AND user."status" = 'ACTIVE'
      JOIN "UserCompanyAccess" AS access
        ON access."userId" = user."id"
       AND access."companyId" = task."companyId"
       AND access."status" = 'ACTIVE'
      WHERE task."id" = NEW."taskId"
        AND (
          task."groupId" IS NULL
          OR EXISTS (
            SELECT 1
            FROM "GroupMember" AS member
            WHERE member."groupId" = task."groupId"
              AND member."userId" = NEW."userId"
              AND member."leftAt" IS NULL
          )
        )
    )
    THEN RAISE(ABORT, 'task_follower_scope_mismatch')
  END;
END;

CREATE TRIGGER "TaskFollower_core_immutable_update"
BEFORE UPDATE ON "TaskFollower"
WHEN NEW."taskId" IS NOT OLD."taskId"
  OR NEW."userId" IS NOT OLD."userId"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN
  SELECT RAISE(ABORT, 'task_follower_immutable');
END;

CREATE TRIGGER "TaskUserState_scope_guard_insert"
BEFORE INSERT ON "TaskUserState"
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Task" AS task
      JOIN "User" AS user
        ON user."id" = NEW."userId"
       AND user."workspaceId" = task."workspaceId"
       AND user."status" = 'ACTIVE'
      JOIN "UserCompanyAccess" AS access
        ON access."userId" = user."id"
       AND access."companyId" = task."companyId"
       AND access."status" = 'ACTIVE'
      WHERE task."id" = NEW."taskId"
        AND (
          task."groupId" IS NULL
          OR EXISTS (
            SELECT 1
            FROM "GroupMember" AS member
            WHERE member."groupId" = task."groupId"
              AND member."userId" = NEW."userId"
              AND member."leftAt" IS NULL
          )
        )
    )
    THEN RAISE(ABORT, 'task_user_state_scope_mismatch')
  END;
END;

CREATE TRIGGER "TaskUserState_core_immutable_update"
BEFORE UPDATE ON "TaskUserState"
WHEN NEW."taskId" IS NOT OLD."taskId"
  OR NEW."userId" IS NOT OLD."userId"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN
  SELECT RAISE(ABORT, 'task_user_state_immutable');
END;

CREATE TRIGGER "TaskReminder_scope_guard_insert"
BEFORE INSERT ON "TaskReminder"
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Task" AS task
      JOIN "User" AS user
        ON user."id" = NEW."userId"
       AND user."workspaceId" = task."workspaceId"
       AND user."status" = 'ACTIVE'
      JOIN "UserCompanyAccess" AS access
        ON access."userId" = user."id"
       AND access."companyId" = task."companyId"
       AND access."status" = 'ACTIVE'
      WHERE task."id" = NEW."taskId"
        AND (
          task."groupId" IS NULL
          OR EXISTS (
            SELECT 1
            FROM "GroupMember" AS member
            WHERE member."groupId" = task."groupId"
              AND member."userId" = NEW."userId"
              AND member."leftAt" IS NULL
          )
        )
    )
    THEN RAISE(ABORT, 'task_reminder_scope_mismatch')
  END;
END;

CREATE TRIGGER "TaskReminder_core_immutable_update"
BEFORE UPDATE ON "TaskReminder"
WHEN NEW."taskId" IS NOT OLD."taskId"
  OR NEW."userId" IS NOT OLD."userId"
  OR NEW."remindAt" IS NOT OLD."remindAt"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN
  SELECT RAISE(ABORT, 'task_reminder_immutable');
END;

CREATE TRIGGER "TaskReminder_status_transition_update"
BEFORE UPDATE OF "status" ON "TaskReminder"
WHEN NEW."status" IS NOT OLD."status"
  AND NOT (
    OLD."status" = 'ACTIVE'
    AND NEW."status" IN ('SENT', 'CANCELLED')
  )
BEGIN
  SELECT RAISE(ABORT, 'task_reminder_invalid_transition');
END;

CREATE TRIGGER "Task_personal_scope_immutable_update"
BEFORE UPDATE OF "workspaceId", "companyId", "groupId" ON "Task"
WHEN (
  NEW."workspaceId" IS NOT OLD."workspaceId"
  OR NEW."companyId" IS NOT OLD."companyId"
  OR NEW."groupId" IS NOT OLD."groupId"
)
AND (
  EXISTS (
    SELECT 1 FROM "TaskFollower" AS follower
    WHERE follower."taskId" = OLD."id"
  )
  OR EXISTS (
    SELECT 1 FROM "TaskUserState" AS state
    WHERE state."taskId" = OLD."id"
  )
  OR EXISTS (
    SELECT 1 FROM "TaskReminder" AS reminder
    WHERE reminder."taskId" = OLD."id"
      AND reminder."status" = 'ACTIVE'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'task_personal_scope_immutable');
END;

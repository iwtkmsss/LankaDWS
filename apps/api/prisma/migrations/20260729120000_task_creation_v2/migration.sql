-- Task creation v2 is a breaking, data-preserving SQLite rebuild.
-- Rollback requires restoring the pre-deploy backup because multiple
-- RESPONSIBLE rows cannot be reduced to the former single assignee safely.

PRAGMA defer_foreign_keys = ON;
PRAGMA foreign_keys = OFF;

CREATE TEMP TABLE "_TaskV2MigrationGuard" (
  "ok" INTEGER NOT NULL CHECK ("ok" = 1)
);

INSERT INTO "_TaskV2MigrationGuard" ("ok")
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM "Task" AS task
    LEFT JOIN "User" AS creator ON creator."id" = task."creatorId"
    LEFT JOIN "User" AS assignee ON assignee."id" = task."assigneeId"
    WHERE creator."id" IS NULL OR assignee."id" IS NULL
  )
  THEN 0
  ELSE 1
END;

INSERT INTO "_TaskV2MigrationGuard" ("ok")
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM "BackgroundJob"
    WHERE "type" = 'task.recurrence'
      AND (
        json_valid("safePayload") = 0
        OR json_extract("safePayload", '$.frequency') NOT IN ('DAILY', 'WEEKLY', 'MONTHLY')
        OR CAST(json_extract("safePayload", '$.interval') AS INTEGER) < 1
        OR json_extract("safePayload", '$.occurrenceAt') IS NULL
      )
  )
  THEN 0
  ELSE 1
END;

DROP TABLE "_TaskV2MigrationGuard";

DROP TRIGGER IF EXISTS "Comment_task_scope_guard_insert";
DROP TRIGGER IF EXISTS "EntityLink_task_scope_guard_insert";
DROP TRIGGER IF EXISTS "TaskParticipant_scope_guard_insert";
DROP TRIGGER IF EXISTS "TaskFollower_scope_guard_insert";
DROP TRIGGER IF EXISTS "TaskUserState_scope_guard_insert";
DROP TRIGGER IF EXISTS "TaskReminder_scope_guard_insert";
DROP TRIGGER IF EXISTS "FileLink_task_scope_guard_insert";

CREATE TEMP TABLE "_TaskV2Legacy" AS
SELECT
  "id",
  "creatorId",
  "assigneeId",
  "deadline",
  "recurrenceKey"
FROM "Task";

CREATE TABLE "Project" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Project_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Project_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Project_status_check"
    CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE UNIQUE INDEX "Project_companyId_normalizedName_key"
  ON "Project"("companyId", "normalizedName");
CREATE INDEX "Project_workspaceId_companyId_status_name_idx"
  ON "Project"("workspaceId", "companyId", "status", "name");

CREATE TABLE "Tag" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "color" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Tag_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Tag_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Tag_companyId_normalizedName_key"
  ON "Tag"("companyId", "normalizedName");
CREATE INDEX "Tag_workspaceId_companyId_name_idx"
  ON "Tag"("workspaceId", "companyId", "name");

CREATE TABLE "new_Task" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "groupId" TEXT,
  "projectId" TEXT,
  "parentTaskId" TEXT,
  "number" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "createdById" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "startsAt" DATETIME,
  "dueAt" DATETIME,
  "estimatedMinutes" INTEGER,
  "blockReason" TEXT,
  "completedAt" DATETIME,
  "version" INTEGER NOT NULL DEFAULT 1,
  "recurrenceId" TEXT,
  "recurrenceOccurrenceAt" DATETIME,
  "archivedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Task_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Task_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Task_parentTaskId_fkey"
    FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Task_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Task_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Task_recurrenceId_fkey"
    FOREIGN KEY ("recurrenceId") REFERENCES "TaskRecurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Task_status_check"
    CHECK ("status" IN ('NEW', 'PLANNED', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', 'CANCELLED', 'ARCHIVED')),
  CONSTRAINT "Task_priority_check"
    CHECK ("priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  CONSTRAINT "Task_dates_check"
    CHECK ("startsAt" IS NULL OR "dueAt" IS NULL OR "startsAt" <= "dueAt"),
  CONSTRAINT "Task_estimate_check"
    CHECK ("estimatedMinutes" IS NULL OR ("estimatedMinutes" > 0 AND "estimatedMinutes" <= 525600))
);

INSERT INTO "new_Task" (
  "id",
  "workspaceId",
  "companyId",
  "groupId",
  "projectId",
  "parentTaskId",
  "number",
  "title",
  "description",
  "createdById",
  "reporterId",
  "status",
  "priority",
  "startsAt",
  "dueAt",
  "estimatedMinutes",
  "blockReason",
  "completedAt",
  "version",
  "recurrenceId",
  "recurrenceOccurrenceAt",
  "archivedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  task."id",
  task."workspaceId",
  task."companyId",
  task."groupId",
  NULL,
  task."parentTaskId",
  task."number",
  task."title",
  task."description",
  COALESCE((
    SELECT audit."actorId"
    FROM "AuditEvent" AS audit
    JOIN "User" AS actor ON actor."id" = audit."actorId"
    WHERE audit."entityType" = 'TASK'
      AND audit."entityId" = task."id"
      AND audit."result" = 'SUCCESS'
      AND audit."action" IN ('task.created', 'task.created_from_message')
    ORDER BY audit."createdAt" ASC, audit."id" ASC
    LIMIT 1
  ), task."creatorId"),
  task."creatorId",
  task."status",
  CASE task."priority" WHEN 'CRITICAL' THEN 'URGENT' ELSE task."priority" END,
  NULL,
  task."deadline",
  NULL,
  task."blockReason",
  task."completedAt",
  task."version",
  NULL,
  NULL,
  task."archivedAt",
  task."createdAt",
  task."updatedAt"
FROM "Task" AS task;

DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";

CREATE UNIQUE INDEX "Task_number_key" ON "Task"("number");
CREATE UNIQUE INDEX "Task_recurrenceId_recurrenceOccurrenceAt_key"
  ON "Task"("recurrenceId", "recurrenceOccurrenceAt");
CREATE INDEX "Task_companyId_status_dueAt_id_idx"
  ON "Task"("companyId", "status", "dueAt", "id");
CREATE INDEX "Task_groupId_status_dueAt_id_idx"
  ON "Task"("groupId", "status", "dueAt", "id");
CREATE INDEX "Task_projectId_status_dueAt_id_idx"
  ON "Task"("projectId", "status", "dueAt", "id");
CREATE INDEX "Task_parentTaskId_status_dueAt_id_idx"
  ON "Task"("parentTaskId", "status", "dueAt", "id");
CREATE INDEX "Task_reporterId_status_dueAt_idx"
  ON "Task"("reporterId", "status", "dueAt");
CREATE INDEX "Task_createdById_updatedAt_idx"
  ON "Task"("createdById", "updatedAt");
CREATE INDEX "Task_recurrenceId_recurrenceOccurrenceAt_idx"
  ON "Task"("recurrenceId", "recurrenceOccurrenceAt");

CREATE TABLE "new_TaskParticipant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "addedById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "removedAt" DATETIME,
  CONSTRAINT "TaskParticipant_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskParticipant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TaskParticipant_addedById_fkey"
    FOREIGN KEY ("addedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TaskParticipant_role_check"
    CHECK ("role" IN ('RESPONSIBLE', 'COLLABORATOR', 'WATCHER'))
);

WITH "participant_candidates" AS (
  SELECT
    'tpart_migrated_' || legacy."id" || '_' || legacy."assigneeId" AS "id",
    legacy."id" AS "taskId",
    legacy."assigneeId" AS "userId",
    'RESPONSIBLE' AS "role",
    legacy."creatorId" AS "addedById",
    task."createdAt" AS "createdAt",
    task."updatedAt" AS "updatedAt",
    NULL AS "removedAt",
    3 AS "precedence"
  FROM "_TaskV2Legacy" AS legacy
  JOIN "Task" AS task ON task."id" = legacy."id"

  UNION ALL

  SELECT
    participant."id",
    participant."taskId",
    participant."userId",
    CASE participant."role"
      WHEN 'CO_EXECUTOR' THEN 'COLLABORATOR'
      WHEN 'OBSERVER' THEN 'WATCHER'
    END,
    participant."addedById",
    participant."addedAt",
    COALESCE(participant."removedAt", participant."addedAt"),
    participant."removedAt",
    CASE participant."role" WHEN 'CO_EXECUTOR' THEN 2 ELSE 1 END
  FROM "TaskParticipant" AS participant
),
"ranked_participants" AS (
  SELECT
    candidate.*,
    row_number() OVER (
      PARTITION BY candidate."taskId", candidate."userId"
      ORDER BY
        CASE WHEN candidate."removedAt" IS NULL THEN 0 ELSE 1 END,
        candidate."precedence" DESC,
        candidate."createdAt" DESC,
        candidate."id" DESC
    ) AS "rank"
  FROM "participant_candidates" AS candidate
)
INSERT INTO "new_TaskParticipant" (
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
  "id",
  "taskId",
  "userId",
  "role",
  "addedById",
  "createdAt",
  "updatedAt",
  "removedAt"
FROM "ranked_participants"
WHERE "rank" = 1;

DROP TABLE "TaskParticipant";
ALTER TABLE "new_TaskParticipant" RENAME TO "TaskParticipant";

CREATE UNIQUE INDEX "TaskParticipant_taskId_userId_key"
  ON "TaskParticipant"("taskId", "userId");
CREATE INDEX "TaskParticipant_taskId_role_removedAt_userId_idx"
  ON "TaskParticipant"("taskId", "role", "removedAt", "userId");
CREATE INDEX "TaskParticipant_userId_role_removedAt_taskId_idx"
  ON "TaskParticipant"("userId", "role", "removedAt", "taskId");

CREATE TABLE "new_TaskChecklistItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "isCompleted" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL,
  "completedById" TEXT,
  "completedAt" DATETIME,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TaskChecklistItem_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskChecklistItem_completed_check"
    CHECK ("isCompleted" IN (0, 1))
);

INSERT INTO "new_TaskChecklistItem" (
  "id",
  "taskId",
  "title",
  "isCompleted",
  "position",
  "completedById",
  "completedAt",
  "version",
  "createdAt",
  "updatedAt"
)
SELECT
  item."id",
  item."taskId",
  item."text",
  item."isDone",
  item."position",
  item."completedById",
  item."completedAt",
  item."version",
  task."createdAt",
  task."updatedAt"
FROM "TaskChecklistItem" AS item
JOIN "Task" AS task ON task."id" = item."taskId";

DROP TABLE "TaskChecklistItem";
ALTER TABLE "new_TaskChecklistItem" RENAME TO "TaskChecklistItem";
CREATE UNIQUE INDEX "TaskChecklistItem_taskId_position_key"
  ON "TaskChecklistItem"("taskId", "position");

CREATE TABLE "new_TaskReminder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "userId" TEXT,
  "triggerType" TEXT NOT NULL,
  "remindAt" DATETIME,
  "offsetMinutes" INTEGER,
  "channel" TEXT NOT NULL DEFAULT 'IN_APP',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "sentAt" DATETIME,
  "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TaskReminder_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskReminder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskReminder_trigger_check"
    CHECK ("triggerType" IN ('AT', 'BEFORE_START', 'BEFORE_DUE')),
  CONSTRAINT "TaskReminder_channel_check"
    CHECK ("channel" = 'IN_APP'),
  CONSTRAINT "TaskReminder_status_check"
    CHECK ("status" IN ('ACTIVE', 'SENT', 'CANCELLED')),
  CONSTRAINT "TaskReminder_shape_check"
    CHECK (
      ("triggerType" = 'AT' AND "remindAt" IS NOT NULL AND "offsetMinutes" IS NULL)
      OR
      ("triggerType" IN ('BEFORE_START', 'BEFORE_DUE') AND "remindAt" IS NOT NULL AND "offsetMinutes" > 0)
    )
);

INSERT INTO "new_TaskReminder" (
  "id",
  "taskId",
  "userId",
  "triggerType",
  "remindAt",
  "offsetMinutes",
  "channel",
  "status",
  "sentAt",
  "cancelledAt",
  "createdAt",
  "updatedAt"
)
SELECT
  reminder."id",
  reminder."taskId",
  reminder."userId",
  'AT',
  reminder."remindAt",
  NULL,
  'IN_APP',
  reminder."status",
  CASE WHEN reminder."status" = 'SENT' THEN reminder."updatedAt" ELSE NULL END,
  CASE WHEN reminder."status" = 'CANCELLED' THEN reminder."updatedAt" ELSE NULL END,
  reminder."createdAt",
  reminder."updatedAt"
FROM "TaskReminder" AS reminder;

DROP TABLE "TaskReminder";
ALTER TABLE "new_TaskReminder" RENAME TO "TaskReminder";

CREATE UNIQUE INDEX "TaskReminder_active_definition_key"
  ON "TaskReminder"(
    "taskId",
    COALESCE("userId", '*'),
    "triggerType",
    COALESCE("remindAt", ''),
    COALESCE("offsetMinutes", -1)
  )
  WHERE "status" = 'ACTIVE';
CREATE INDEX "TaskReminder_userId_status_remindAt_idx"
  ON "TaskReminder"("userId", "status", "remindAt");
CREATE INDEX "TaskReminder_taskId_status_remindAt_idx"
  ON "TaskReminder"("taskId", "status", "remindAt");

CREATE TABLE "TaskTag" (
  "taskId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  PRIMARY KEY ("taskId", "tagId"),
  CONSTRAINT "TaskTag_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskTag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaskTag_tagId_taskId_idx" ON "TaskTag"("tagId", "taskId");

CREATE TABLE "TaskRelation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceTaskId" TEXT NOT NULL,
  "targetTaskId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskRelation_sourceTaskId_fkey"
    FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskRelation_targetTaskId_fkey"
    FOREIGN KEY ("targetTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskRelation_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TaskRelation_type_check"
    CHECK ("type" IN ('RELATED', 'BLOCKS', 'DUPLICATES'))
);
CREATE UNIQUE INDEX "TaskRelation_sourceTaskId_targetTaskId_key"
  ON "TaskRelation"("sourceTaskId", "targetTaskId");
CREATE INDEX "TaskRelation_targetTaskId_type_sourceTaskId_idx"
  ON "TaskRelation"("targetTaskId", "type", "sourceTaskId");

CREATE TABLE "TaskRecurrence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "templateTaskId" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "interval" INTEGER NOT NULL,
  "daysOfWeekJson" TEXT,
  "dayOfMonth" INTEGER,
  "startsAt" DATETIME NOT NULL,
  "endsAt" DATETIME,
  "maxOccurrences" INTEGER,
  "generatedOccurrences" INTEGER NOT NULL DEFAULT 1,
  "nextRunAt" DATETIME,
  "timezone" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TaskRecurrence_templateTaskId_fkey"
    FOREIGN KEY ("templateTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskRecurrence_frequency_check"
    CHECK ("frequency" IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY')),
  CONSTRAINT "TaskRecurrence_interval_check"
    CHECK ("interval" BETWEEN 1 AND 365),
  CONSTRAINT "TaskRecurrence_occurrence_check"
    CHECK ("maxOccurrences" IS NULL OR "maxOccurrences" BETWEEN 2 AND 10000),
  CONSTRAINT "TaskRecurrence_active_check"
    CHECK ("isActive" IN (0, 1))
);
CREATE UNIQUE INDEX "TaskRecurrence_templateTaskId_key"
  ON "TaskRecurrence"("templateTaskId");
CREATE INDEX "TaskRecurrence_isActive_nextRunAt_id_idx"
  ON "TaskRecurrence"("isActive", "nextRunAt", "id");

WITH "ranked_recurrence_jobs" AS (
  SELECT
    job.*,
    row_number() OVER (
      PARTITION BY job."entityId"
      ORDER BY
        CASE WHEN job."state" IN ('QUEUED', 'RUNNING') THEN 0 ELSE 1 END,
        CASE WHEN job."state" IN ('QUEUED', 'RUNNING') THEN job."runAt" END ASC,
        job."createdAt" DESC,
        job."id" DESC
    ) AS "rank"
  FROM "BackgroundJob" AS job
  WHERE job."type" = 'task.recurrence'
)
INSERT INTO "TaskRecurrence" (
  "id",
  "templateTaskId",
  "frequency",
  "interval",
  "daysOfWeekJson",
  "dayOfMonth",
  "startsAt",
  "endsAt",
  "maxOccurrences",
  "generatedOccurrences",
  "nextRunAt",
  "timezone",
  "isActive",
  "version",
  "createdAt",
  "updatedAt"
)
SELECT
  'rec_migrated_' || job."entityId",
  job."entityId",
  json_extract(job."safePayload", '$.frequency'),
  CAST(json_extract(job."safePayload", '$.interval') AS INTEGER),
  NULL,
  NULL,
  COALESCE(task."dueAt", task."createdAt"),
  NULLIF(json_extract(job."safePayload", '$.until'), ''),
  NULL,
  1 + (
    SELECT count(*)
    FROM "_TaskV2Legacy" AS occurrence
    WHERE occurrence."recurrenceKey" LIKE json_extract(job."safePayload", '$.seriesKey') || ':%'
  ),
  CASE WHEN job."state" IN ('QUEUED', 'RUNNING')
    THEN json_extract(job."safePayload", '$.occurrenceAt')
    ELSE NULL
  END,
  company."timezone",
  CASE WHEN job."state" IN ('QUEUED', 'RUNNING') THEN 1 ELSE 0 END,
  1,
  job."createdAt",
  CURRENT_TIMESTAMP
FROM "ranked_recurrence_jobs" AS job
JOIN "Task" AS task ON task."id" = job."entityId"
JOIN "Company" AS company ON company."id" = task."companyId"
WHERE job."rank" = 1;

UPDATE "Task"
SET
  "recurrenceId" = 'rec_migrated_' || "id",
  "recurrenceOccurrenceAt" = (
    SELECT recurrence."startsAt"
    FROM "TaskRecurrence" AS recurrence
    WHERE recurrence."templateTaskId" = "Task"."id"
  )
WHERE "id" IN (SELECT "templateTaskId" FROM "TaskRecurrence");

UPDATE "Task"
SET
  "recurrenceId" = (
    SELECT recurrence."id"
    FROM "TaskRecurrence" AS recurrence
    JOIN "BackgroundJob" AS job
      ON job."entityId" = recurrence."templateTaskId"
     AND job."type" = 'task.recurrence'
    JOIN "_TaskV2Legacy" AS legacy ON legacy."id" = "Task"."id"
    WHERE legacy."recurrenceKey" LIKE json_extract(job."safePayload", '$.seriesKey') || ':%'
    LIMIT 1
  ),
  "recurrenceOccurrenceAt" = (
    SELECT substr(
      legacy."recurrenceKey",
      length(json_extract(job."safePayload", '$.seriesKey')) + 2
    )
    FROM "BackgroundJob" AS job
    JOIN "_TaskV2Legacy" AS legacy ON legacy."id" = "Task"."id"
    WHERE job."type" = 'task.recurrence'
      AND legacy."recurrenceKey" LIKE json_extract(job."safePayload", '$.seriesKey') || ':%'
    LIMIT 1
  )
WHERE EXISTS (
  SELECT 1
  FROM "BackgroundJob" AS job
  JOIN "_TaskV2Legacy" AS legacy ON legacy."id" = "Task"."id"
  WHERE job."type" = 'task.recurrence'
    AND legacy."recurrenceKey" LIKE json_extract(job."safePayload", '$.seriesKey') || ':%'
);

INSERT OR IGNORE INTO "BackgroundJob" (
  "id",
  "type",
  "entityType",
  "entityId",
  "state",
  "safePayload",
  "runAt",
  "idempotencyKey",
  "createdAt",
  "updatedAt"
)
SELECT
  'job_' || recurrence."id",
  'task.recurrence.generate',
  'TASK_RECURRENCE',
  recurrence."id",
  'QUEUED',
  json_object('occurrenceAt', recurrence."nextRunAt"),
  recurrence."nextRunAt",
  'task-recurrence:' || recurrence."id" || ':' || recurrence."nextRunAt",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "TaskRecurrence" AS recurrence
WHERE recurrence."isActive" = 1
  AND recurrence."nextRunAt" IS NOT NULL;

UPDATE "BackgroundJob"
SET
  "state" = 'CANCELLED',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'task.recurrence'
  AND "state" IN ('QUEUED', 'RUNNING');

CREATE TABLE "TimeEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "startedAt" DATETIME NOT NULL,
  "endedAt" DATETIME,
  "durationSeconds" INTEGER,
  "description" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TimeEntry_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TimeEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TimeEntry_shape_check"
    CHECK (
      (
        "endedAt" IS NULL
        AND "durationSeconds" IS NULL
      )
      OR
      (
        "endedAt" IS NOT NULL
        AND "endedAt" >= "startedAt"
        AND "durationSeconds" BETWEEN 1 AND 86400
      )
    )
);
CREATE UNIQUE INDEX "TimeEntry_one_active_per_user_key"
  ON "TimeEntry"("userId")
  WHERE "endedAt" IS NULL;
CREATE INDEX "TimeEntry_taskId_startedAt_id_idx"
  ON "TimeEntry"("taskId", "startedAt", "id");
CREATE INDEX "TimeEntry_userId_endedAt_startedAt_idx"
  ON "TimeEntry"("userId", "endedAt", "startedAt");

CREATE TRIGGER "Project_scope_guard_insert"
BEFORE INSERT ON "Project"
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Company" AS company
    WHERE company."id" = NEW."companyId"
      AND company."workspaceId" = NEW."workspaceId"
  ) THEN RAISE(ABORT, 'project_scope_mismatch') END;
END;

CREATE TRIGGER "Project_scope_guard_update"
BEFORE UPDATE OF "workspaceId", "companyId" ON "Project"
WHEN NEW."workspaceId" IS NOT OLD."workspaceId"
  OR NEW."companyId" IS NOT OLD."companyId"
BEGIN
  SELECT RAISE(ABORT, 'project_scope_immutable');
END;

CREATE TRIGGER "Tag_scope_guard_insert"
BEFORE INSERT ON "Tag"
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Company" AS company
    WHERE company."id" = NEW."companyId"
      AND company."workspaceId" = NEW."workspaceId"
  ) THEN RAISE(ABORT, 'tag_scope_mismatch') END;
END;

CREATE TRIGGER "Tag_scope_guard_update"
BEFORE UPDATE OF "workspaceId", "companyId" ON "Tag"
WHEN NEW."workspaceId" IS NOT OLD."workspaceId"
  OR NEW."companyId" IS NOT OLD."companyId"
BEGIN
  SELECT RAISE(ABORT, 'tag_scope_immutable');
END;

CREATE TRIGGER "Task_scope_guard_insert"
BEFORE INSERT ON "Task"
BEGIN
  SELECT CASE
    WHEN NEW."groupId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Group" AS task_group
      WHERE task_group."id" = NEW."groupId"
        AND task_group."workspaceId" = NEW."workspaceId"
        AND task_group."companyId" = NEW."companyId"
    )
    THEN RAISE(ABORT, 'task_group_scope_mismatch')
  END;
  SELECT CASE
    WHEN NEW."projectId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Project" AS project
      WHERE project."id" = NEW."projectId"
        AND project."workspaceId" = NEW."workspaceId"
        AND project."companyId" = NEW."companyId"
        AND project."status" = 'ACTIVE'
    )
    THEN RAISE(ABORT, 'task_project_scope_mismatch')
  END;
END;

CREATE TRIGGER "Task_scope_guard_update"
BEFORE UPDATE OF "workspaceId", "companyId", "groupId", "projectId" ON "Task"
BEGIN
  SELECT CASE
    WHEN NEW."groupId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Group" AS task_group
      WHERE task_group."id" = NEW."groupId"
        AND task_group."workspaceId" = NEW."workspaceId"
        AND task_group."companyId" = NEW."companyId"
    )
    THEN RAISE(ABORT, 'task_group_scope_mismatch')
  END;
  SELECT CASE
    WHEN NEW."projectId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Project" AS project
      WHERE project."id" = NEW."projectId"
        AND project."workspaceId" = NEW."workspaceId"
        AND project."companyId" = NEW."companyId"
        AND project."status" = 'ACTIVE'
    )
    THEN RAISE(ABORT, 'task_project_scope_mismatch')
  END;
  SELECT CASE
    WHEN (
      NEW."workspaceId" IS NOT OLD."workspaceId"
      OR NEW."companyId" IS NOT OLD."companyId"
      OR NEW."groupId" IS NOT OLD."groupId"
      OR NEW."projectId" IS NOT OLD."projectId"
    )
    AND (
      OLD."parentTaskId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "Task" AS child WHERE child."parentTaskId" = OLD."id")
    )
    THEN RAISE(ABORT, 'task_hierarchy_scope_immutable')
  END;
END;

CREATE TRIGGER "Task_hierarchy_guard_insert"
BEFORE INSERT ON "Task"
WHEN NEW."parentTaskId" IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW."parentTaskId" = NEW."id"
    THEN RAISE(ABORT, 'task_parent_cycle') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "Task" AS parent
    WHERE parent."id" = NEW."parentTaskId"
      AND parent."workspaceId" = NEW."workspaceId"
      AND parent."companyId" = NEW."companyId"
      AND parent."groupId" IS NEW."groupId"
      AND parent."projectId" IS NEW."projectId"
  ) THEN RAISE(ABORT, 'task_parent_scope_mismatch') END;
  SELECT CASE WHEN (
    WITH RECURSIVE "ancestors"("id", "parentTaskId", "depth") AS (
      SELECT parent."id", parent."parentTaskId", 1
      FROM "Task" AS parent
      WHERE parent."id" = NEW."parentTaskId"
      UNION ALL
      SELECT parent."id", parent."parentTaskId", ancestors."depth" + 1
      FROM "Task" AS parent
      JOIN "ancestors" ON parent."id" = ancestors."parentTaskId"
      WHERE ancestors."depth" <= 20
    )
    SELECT COALESCE(max("depth"), 0) FROM "ancestors"
  ) > 20 THEN RAISE(ABORT, 'task_subtask_depth_exceeded') END;
END;

CREATE TRIGGER "Task_hierarchy_guard_update"
BEFORE UPDATE OF "parentTaskId" ON "Task"
WHEN NEW."parentTaskId" IS NOT OLD."parentTaskId"
  AND NEW."parentTaskId" IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW."parentTaskId" = NEW."id"
    THEN RAISE(ABORT, 'task_parent_cycle') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "Task" AS parent
    WHERE parent."id" = NEW."parentTaskId"
      AND parent."workspaceId" = NEW."workspaceId"
      AND parent."companyId" = NEW."companyId"
      AND parent."groupId" IS NEW."groupId"
      AND parent."projectId" IS NEW."projectId"
  ) THEN RAISE(ABORT, 'task_parent_scope_mismatch') END;
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE "ancestors"("id", "parentTaskId", "depth") AS (
      SELECT parent."id", parent."parentTaskId", 1
      FROM "Task" AS parent
      WHERE parent."id" = NEW."parentTaskId"
      UNION ALL
      SELECT parent."id", parent."parentTaskId", ancestors."depth" + 1
      FROM "Task" AS parent
      JOIN "ancestors" ON parent."id" = ancestors."parentTaskId"
      WHERE ancestors."depth" <= 20
    )
    SELECT 1 FROM "ancestors" WHERE "id" = NEW."id"
  ) THEN RAISE(ABORT, 'task_parent_cycle') END;
  SELECT CASE WHEN (
    WITH RECURSIVE "ancestors"("id", "parentTaskId", "depth") AS (
      SELECT parent."id", parent."parentTaskId", 1
      FROM "Task" AS parent
      WHERE parent."id" = NEW."parentTaskId"
      UNION ALL
      SELECT parent."id", parent."parentTaskId", ancestors."depth" + 1
      FROM "Task" AS parent
      JOIN "ancestors" ON parent."id" = ancestors."parentTaskId"
      WHERE ancestors."depth" <= 20
    )
    SELECT COALESCE(max("depth"), 0) FROM "ancestors"
  ) > 20 THEN RAISE(ABORT, 'task_subtask_depth_exceeded') END;
  SELECT CASE WHEN (
    (
      WITH RECURSIVE "ancestors"("id", "parentTaskId", "depth") AS (
        SELECT parent."id", parent."parentTaskId", 1
        FROM "Task" AS parent
        WHERE parent."id" = NEW."parentTaskId"
        UNION ALL
        SELECT parent."id", parent."parentTaskId", ancestors."depth" + 1
        FROM "Task" AS parent
        JOIN "ancestors" ON parent."id" = ancestors."parentTaskId"
        WHERE ancestors."depth" <= 20
      )
      SELECT COALESCE(max("depth"), 0) FROM "ancestors"
    )
    +
    (
      WITH RECURSIVE "descendants"("id", "depth") AS (
        SELECT child."id", 1
        FROM "Task" AS child
        WHERE child."parentTaskId" = OLD."id"
        UNION ALL
        SELECT child."id", descendants."depth" + 1
        FROM "Task" AS child
        JOIN "descendants" ON child."parentTaskId" = descendants."id"
        WHERE descendants."depth" <= 20
      )
      SELECT COALESCE(max("depth"), 0) FROM "descendants"
    )
  ) > 20 THEN RAISE(ABORT, 'task_subtask_depth_exceeded') END;
END;

CREATE TRIGGER "Task_active_descendants_completion_guard"
BEFORE UPDATE OF "status" ON "Task"
WHEN NEW."status" = 'DONE'
  AND OLD."status" IS NOT 'DONE'
  AND EXISTS (
    WITH RECURSIVE "descendants"("id") AS (
      SELECT child."id" FROM "Task" AS child WHERE child."parentTaskId" = OLD."id"
      UNION ALL
      SELECT child."id"
      FROM "Task" AS child
      JOIN "descendants" ON child."parentTaskId" = descendants."id"
    )
    SELECT 1
    FROM "Task" AS descendant
    JOIN "descendants" ON descendants."id" = descendant."id"
    WHERE descendant."status" NOT IN ('DONE', 'CANCELLED', 'ARCHIVED')
      AND descendant."archivedAt" IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'task_active_descendants');
END;

CREATE TRIGGER "Task_active_descendants_archive_guard"
BEFORE UPDATE OF "status", "archivedAt" ON "Task"
WHEN (NEW."status" = 'ARCHIVED' OR NEW."archivedAt" IS NOT NULL)
  AND EXISTS (
    WITH RECURSIVE "descendants"("id") AS (
      SELECT child."id" FROM "Task" AS child WHERE child."parentTaskId" = OLD."id"
      UNION ALL
      SELECT child."id"
      FROM "Task" AS child
      JOIN "descendants" ON child."parentTaskId" = descendants."id"
    )
    SELECT 1
    FROM "Task" AS descendant
    JOIN "descendants" ON descendants."id" = descendant."id"
    WHERE descendant."status" NOT IN ('DONE', 'CANCELLED', 'ARCHIVED')
      AND descendant."archivedAt" IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'task_active_descendants');
END;

CREATE TRIGGER "TaskParticipant_scope_guard_insert"
BEFORE INSERT ON "TaskParticipant"
BEGIN
  SELECT CASE WHEN NOT EXISTS (
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
    WHERE task."id" = NEW."taskId"
      AND (
        task."groupId" IS NULL
        OR EXISTS (
          SELECT 1 FROM "GroupMember" AS member
          WHERE member."groupId" = task."groupId"
            AND member."userId" = NEW."userId"
            AND member."leftAt" IS NULL
        )
      )
  ) THEN RAISE(ABORT, 'task_participant_scope_mismatch') END;
END;

CREATE TRIGGER "TaskParticipant_scope_guard_update"
BEFORE UPDATE OF "role", "removedAt" ON "TaskParticipant"
WHEN NEW."removedAt" IS NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
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
    WHERE task."id" = NEW."taskId"
  ) THEN RAISE(ABORT, 'task_participant_scope_mismatch') END;
END;

CREATE TRIGGER "TaskParticipant_core_immutable_update"
BEFORE UPDATE ON "TaskParticipant"
WHEN NEW."taskId" IS NOT OLD."taskId"
  OR NEW."userId" IS NOT OLD."userId"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN
  SELECT RAISE(ABORT, 'task_participant_core_immutable');
END;

CREATE TRIGGER "TaskParticipant_last_responsible_update"
BEFORE UPDATE OF "role", "removedAt" ON "TaskParticipant"
WHEN OLD."role" = 'RESPONSIBLE'
  AND OLD."removedAt" IS NULL
  AND (NEW."role" <> 'RESPONSIBLE' OR NEW."removedAt" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "TaskParticipant" AS other
    WHERE other."taskId" = OLD."taskId"
      AND other."id" <> OLD."id"
      AND other."role" = 'RESPONSIBLE'
      AND other."removedAt" IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'task_responsible_required');
END;

CREATE TRIGGER "TaskParticipant_last_responsible_delete"
BEFORE DELETE ON "TaskParticipant"
WHEN OLD."role" = 'RESPONSIBLE'
  AND OLD."removedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "TaskParticipant" AS other
    WHERE other."taskId" = OLD."taskId"
      AND other."id" <> OLD."id"
      AND other."role" = 'RESPONSIBLE'
      AND other."removedAt" IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'task_responsible_required');
END;

CREATE TRIGGER "TaskReminder_scope_guard_insert"
BEFORE INSERT ON "TaskReminder"
WHEN NEW."userId" IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Task" AS task
    JOIN "User" AS recipient
      ON recipient."id" = NEW."userId"
     AND recipient."workspaceId" = task."workspaceId"
     AND recipient."status" = 'ACTIVE'
    JOIN "UserCompanyAccess" AS access
      ON access."userId" = recipient."id"
     AND access."companyId" = task."companyId"
     AND access."status" = 'ACTIVE'
    WHERE task."id" = NEW."taskId"
  ) THEN RAISE(ABORT, 'task_reminder_scope_mismatch') END;
END;

CREATE TRIGGER "TaskReminder_core_immutable_update"
BEFORE UPDATE ON "TaskReminder"
WHEN NEW."taskId" IS NOT OLD."taskId"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN
  SELECT RAISE(ABORT, 'task_reminder_core_immutable');
END;

CREATE TRIGGER "TaskReminder_scope_guard_update"
BEFORE UPDATE OF "userId", "status" ON "TaskReminder"
WHEN NEW."userId" IS NOT NULL
  AND NEW."status" = 'ACTIVE'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Task" AS task
    JOIN "User" AS recipient
      ON recipient."id" = NEW."userId"
     AND recipient."workspaceId" = task."workspaceId"
     AND recipient."status" = 'ACTIVE'
    JOIN "UserCompanyAccess" AS access
      ON access."userId" = recipient."id"
     AND access."companyId" = task."companyId"
     AND access."status" = 'ACTIVE'
    WHERE task."id" = NEW."taskId"
  ) THEN RAISE(ABORT, 'task_reminder_scope_mismatch') END;
END;

CREATE TRIGGER "TaskReminder_status_transition_update"
BEFORE UPDATE OF "status" ON "TaskReminder"
WHEN NEW."status" IS NOT OLD."status"
  AND NOT (OLD."status" = 'ACTIVE' AND NEW."status" IN ('SENT', 'CANCELLED'))
BEGIN
  SELECT RAISE(ABORT, 'task_reminder_invalid_transition');
END;

CREATE TRIGGER "TaskFollower_scope_guard_insert"
BEFORE INSERT ON "TaskFollower"
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Task" AS task
    JOIN "User" AS follower
      ON follower."id" = NEW."userId"
     AND follower."workspaceId" = task."workspaceId"
     AND follower."status" = 'ACTIVE'
    JOIN "UserCompanyAccess" AS access
      ON access."userId" = follower."id"
     AND access."companyId" = task."companyId"
     AND access."status" = 'ACTIVE'
    WHERE task."id" = NEW."taskId"
      AND (
        task."groupId" IS NULL
        OR EXISTS (
          SELECT 1 FROM "GroupMember" AS member
          WHERE member."groupId" = task."groupId"
            AND member."userId" = NEW."userId"
            AND member."leftAt" IS NULL
        )
      )
  ) THEN RAISE(ABORT, 'task_follower_scope_mismatch') END;
END;

CREATE TRIGGER "TaskUserState_scope_guard_insert"
BEFORE INSERT ON "TaskUserState"
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Task" AS task
    JOIN "User" AS state_user
      ON state_user."id" = NEW."userId"
     AND state_user."workspaceId" = task."workspaceId"
     AND state_user."status" = 'ACTIVE'
    JOIN "UserCompanyAccess" AS access
      ON access."userId" = state_user."id"
     AND access."companyId" = task."companyId"
     AND access."status" = 'ACTIVE'
    WHERE task."id" = NEW."taskId"
      AND (
        task."groupId" IS NULL
        OR EXISTS (
          SELECT 1 FROM "GroupMember" AS member
          WHERE member."groupId" = task."groupId"
            AND member."userId" = NEW."userId"
            AND member."leftAt" IS NULL
        )
      )
  ) THEN RAISE(ABORT, 'task_user_state_scope_mismatch') END;
END;

CREATE TRIGGER "FileLink_task_scope_guard_insert"
BEFORE INSERT ON "FileLink"
WHEN NEW."entityType" IN ('TASK', 'TASK_COMMENT')
BEGIN
  SELECT CASE
    WHEN NEW."purpose" <> 'ATTACHMENT' OR NEW."aclMode" <> 'ENTITY'
    THEN RAISE(ABORT, 'task_file_link_policy_mismatch')
  END;
  SELECT CASE
    WHEN NEW."entityType" = 'TASK' AND NOT EXISTS (
      SELECT 1
      FROM "Task" AS task
      JOIN "FileObject" AS file
        ON file."id" = NEW."fileId"
       AND file."workspaceId" = task."workspaceId"
       AND file."companyId" = task."companyId"
      WHERE task."id" = NEW."entityId"
    )
    THEN RAISE(ABORT, 'task_file_link_scope_mismatch')
  END;
  SELECT CASE
    WHEN NEW."entityType" = 'TASK' AND (
      SELECT count(*)
      FROM "FileLink" AS existing
      WHERE existing."entityType" = 'TASK'
        AND existing."entityId" = NEW."entityId"
        AND existing."purpose" = 'ATTACHMENT'
    ) >= 10
    THEN RAISE(ABORT, 'task_attachment_limit')
  END;
  SELECT CASE
    WHEN NEW."entityType" = 'TASK_COMMENT' AND NOT EXISTS (
      SELECT 1
      FROM "Comment" AS comment
      JOIN "Task" AS task
        ON task."id" = comment."entityId"
       AND comment."entityType" = 'TASK'
       AND comment."deletedAt" IS NULL
      JOIN "FileObject" AS file
        ON file."id" = NEW."fileId"
       AND file."workspaceId" = task."workspaceId"
       AND file."companyId" = task."companyId"
      JOIN "FileLink" AS task_link
        ON task_link."fileId" = file."id"
       AND task_link."entityType" = 'TASK'
       AND task_link."entityId" = task."id"
       AND task_link."purpose" = 'ATTACHMENT'
       AND task_link."aclMode" = 'ENTITY'
      WHERE comment."id" = NEW."entityId"
    )
    THEN RAISE(ABORT, 'task_comment_file_link_scope_mismatch')
  END;
  SELECT CASE
    WHEN NEW."entityType" = 'TASK_COMMENT' AND (
      SELECT count(*)
      FROM "FileLink" AS existing
      WHERE existing."entityType" = 'TASK_COMMENT'
        AND existing."entityId" = NEW."entityId"
        AND existing."purpose" = 'ATTACHMENT'
    ) >= 5
    THEN RAISE(ABORT, 'task_comment_attachment_limit')
  END;
END;

CREATE TRIGGER "Task_participant_scope_immutable_update"
BEFORE UPDATE OF "workspaceId", "companyId", "groupId" ON "Task"
WHEN (
  NEW."workspaceId" IS NOT OLD."workspaceId"
  OR NEW."companyId" IS NOT OLD."companyId"
  OR NEW."groupId" IS NOT OLD."groupId"
)
AND EXISTS (
  SELECT 1 FROM "TaskParticipant" AS participant
  WHERE participant."taskId" = OLD."id"
    AND participant."removedAt" IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'task_participant_scope_immutable');
END;

CREATE TRIGGER "Task_personal_scope_immutable_update"
BEFORE UPDATE OF "workspaceId", "companyId", "groupId" ON "Task"
WHEN (
  NEW."workspaceId" IS NOT OLD."workspaceId"
  OR NEW."companyId" IS NOT OLD."companyId"
  OR NEW."groupId" IS NOT OLD."groupId"
)
AND (
  EXISTS (SELECT 1 FROM "TaskFollower" AS follower WHERE follower."taskId" = OLD."id")
  OR EXISTS (SELECT 1 FROM "TaskUserState" AS state WHERE state."taskId" = OLD."id")
  OR EXISTS (
    SELECT 1 FROM "TaskReminder" AS reminder
    WHERE reminder."taskId" = OLD."id" AND reminder."status" = 'ACTIVE'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'task_personal_scope_immutable');
END;

CREATE TRIGGER "Task_content_scope_immutable_update"
BEFORE UPDATE OF "workspaceId", "companyId", "groupId", "projectId" ON "Task"
WHEN (
  NEW."workspaceId" IS NOT OLD."workspaceId"
  OR NEW."companyId" IS NOT OLD."companyId"
  OR NEW."groupId" IS NOT OLD."groupId"
  OR NEW."projectId" IS NOT OLD."projectId"
)
AND (
  EXISTS (
    SELECT 1 FROM "FileLink" AS file_link
    WHERE file_link."entityType" = 'TASK' AND file_link."entityId" = OLD."id"
  )
  OR EXISTS (
    SELECT 1 FROM "Comment" AS comment
    WHERE comment."entityType" = 'TASK' AND comment."entityId" = OLD."id"
  )
  OR EXISTS (
    SELECT 1 FROM "EntityLink" AS entity_link
    WHERE (
      entity_link."sourceType" = 'TASK' AND entity_link."sourceId" = OLD."id"
    ) OR (
      entity_link."targetType" = 'TASK' AND entity_link."targetId" = OLD."id"
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'task_content_scope_immutable');
END;

CREATE TRIGGER "TaskRelation_guard_insert"
BEFORE INSERT ON "TaskRelation"
BEGIN
  SELECT CASE WHEN NEW."sourceTaskId" = NEW."targetTaskId"
    THEN RAISE(ABORT, 'task_relation_self') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Task" AS source
    JOIN "Task" AS target
      ON target."id" = NEW."targetTaskId"
     AND target."workspaceId" = source."workspaceId"
     AND target."companyId" = source."companyId"
    WHERE source."id" = NEW."sourceTaskId"
  ) THEN RAISE(ABORT, 'task_relation_scope_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Task" AS source
    JOIN "Task" AS target ON target."id" = NEW."targetTaskId"
    JOIN "User" AS actor
      ON actor."id" = NEW."createdById"
     AND actor."workspaceId" = source."workspaceId"
     AND actor."status" = 'ACTIVE'
    JOIN "UserCompanyAccess" AS access
      ON access."userId" = actor."id"
     AND access."companyId" = source."companyId"
     AND access."status" = 'ACTIVE'
    WHERE source."id" = NEW."sourceTaskId"
      AND (
        source."groupId" IS NULL
        OR EXISTS (
          SELECT 1 FROM "GroupMember" AS member
          WHERE member."groupId" = source."groupId"
            AND member."userId" = actor."id"
            AND member."leftAt" IS NULL
        )
      )
      AND (
        target."groupId" IS NULL
        OR EXISTS (
          SELECT 1 FROM "GroupMember" AS member
          WHERE member."groupId" = target."groupId"
            AND member."userId" = actor."id"
            AND member."leftAt" IS NULL
        )
      )
  ) THEN RAISE(ABORT, 'task_relation_actor_scope_mismatch') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM "TaskRelation" AS relation
    WHERE (
      relation."sourceTaskId" = NEW."sourceTaskId"
      AND relation."targetTaskId" = NEW."targetTaskId"
    ) OR (
      relation."sourceTaskId" = NEW."targetTaskId"
      AND relation."targetTaskId" = NEW."sourceTaskId"
    )
  ) THEN RAISE(ABORT, 'task_relation_duplicate') END;
  SELECT CASE
    WHEN NEW."type" IN ('RELATED', 'DUPLICATES')
      AND NEW."sourceTaskId" > NEW."targetTaskId"
    THEN RAISE(ABORT, 'task_relation_not_canonical')
  END;
  SELECT CASE
    WHEN NEW."type" = 'BLOCKS' AND EXISTS (
      WITH RECURSIVE "blocked_tasks"("id") AS (
        SELECT NEW."targetTaskId"
        UNION
        SELECT relation."targetTaskId"
        FROM "TaskRelation" AS relation
        JOIN "blocked_tasks" ON relation."sourceTaskId" = blocked_tasks."id"
        WHERE relation."type" = 'BLOCKS'
      )
      SELECT 1 FROM "blocked_tasks" WHERE "id" = NEW."sourceTaskId"
    )
    THEN RAISE(ABORT, 'task_relation_blocking_cycle')
  END;
END;

CREATE TRIGGER "TaskRelation_core_immutable_update"
BEFORE UPDATE ON "TaskRelation"
BEGIN
  SELECT RAISE(ABORT, 'task_relation_immutable');
END;

CREATE TRIGGER "TimeEntry_scope_guard_insert"
BEFORE INSERT ON "TimeEntry"
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Task" AS task
    JOIN "User" AS entry_user
      ON entry_user."id" = NEW."userId"
     AND entry_user."workspaceId" = task."workspaceId"
     AND entry_user."status" = 'ACTIVE'
    JOIN "UserCompanyAccess" AS access
      ON access."userId" = entry_user."id"
     AND access."companyId" = task."companyId"
     AND access."status" = 'ACTIVE'
    WHERE task."id" = NEW."taskId"
  ) THEN RAISE(ABORT, 'task_time_scope_mismatch') END;
END;

CREATE TRIGGER "TimeEntry_core_immutable_update"
BEFORE UPDATE ON "TimeEntry"
WHEN NEW."taskId" IS NOT OLD."taskId"
  OR NEW."userId" IS NOT OLD."userId"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN
  SELECT RAISE(ABORT, 'task_time_core_immutable');
END;

CREATE TRIGGER "TaskRecurrence_scope_guard_insert"
BEFORE INSERT ON "TaskRecurrence"
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "Task" AS template
    WHERE template."id" = NEW."templateTaskId"
      AND template."parentTaskId" IS NULL
      AND template."archivedAt" IS NULL
  ) THEN RAISE(ABORT, 'task_recurrence_template_invalid') END;
END;

CREATE TRIGGER "TaskRecurrence_template_immutable_update"
BEFORE UPDATE OF "templateTaskId" ON "TaskRecurrence"
WHEN NEW."templateTaskId" IS NOT OLD."templateTaskId"
BEGIN
  SELECT RAISE(ABORT, 'task_recurrence_template_immutable');
END;

CREATE TRIGGER "Comment_task_scope_guard_insert"
BEFORE INSERT ON "Comment"
WHEN NEW."entityType" = 'TASK'
BEGIN
  SELECT CASE
    WHEN NEW."visibility" <> 'PARTICIPANTS'
      OR NEW."deletedAt" IS NOT NULL
      OR length(trim(NEW."body")) < 1
      OR length(NEW."body") > 4000
    THEN RAISE(ABORT, 'task_comment_policy_mismatch')
  END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Task" AS task
    JOIN "User" AS author
      ON author."id" = NEW."authorId"
     AND author."workspaceId" = task."workspaceId"
     AND author."status" = 'ACTIVE'
    JOIN "UserCompanyAccess" AS access
      ON access."userId" = author."id"
     AND access."companyId" = task."companyId"
     AND access."status" = 'ACTIVE'
    WHERE task."id" = NEW."entityId"
      AND NEW."workspaceId" = task."workspaceId"
      AND NEW."companyId" = task."companyId"
      AND (
        task."groupId" IS NULL
        OR EXISTS (
          SELECT 1 FROM "GroupMember" AS member
          WHERE member."groupId" = task."groupId"
            AND member."userId" = author."id"
            AND member."leftAt" IS NULL
        )
      )
      AND (
        task."reporterId" = author."id"
        OR EXISTS (
          SELECT 1 FROM "TaskParticipant" AS participant
          WHERE participant."taskId" = task."id"
            AND participant."userId" = author."id"
            AND participant."removedAt" IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM "UserRole" AS user_role
          JOIN "RolePermission" AS permission
            ON permission."roleId" = user_role."roleId"
           AND permission."permissionCode" IN ('tasks.manage', 'tasks.edit.any')
          WHERE user_role."userId" = author."id"
            AND user_role."status" = 'ACTIVE'
            AND user_role."validFrom" <= CURRENT_TIMESTAMP
            AND (user_role."validTo" IS NULL OR user_role."validTo" > CURRENT_TIMESTAMP)
        )
      )
  ) THEN RAISE(ABORT, 'task_comment_scope_mismatch') END;
  SELECT CASE
    WHEN NEW."replyToCommentId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Comment" AS parent
        WHERE parent."id" = NEW."replyToCommentId"
          AND parent."workspaceId" = NEW."workspaceId"
          AND parent."companyId" = NEW."companyId"
          AND parent."entityType" = 'TASK'
          AND parent."entityId" = NEW."entityId"
          AND parent."replyToCommentId" IS NULL
          AND parent."deletedAt" IS NULL
      )
    THEN RAISE(ABORT, 'task_comment_reply_mismatch')
  END;
END;

CREATE TRIGGER "EntityLink_task_scope_guard_insert"
BEFORE INSERT ON "EntityLink"
WHEN NEW."sourceType" = 'TASK' OR NEW."targetType" = 'TASK'
BEGIN
  SELECT CASE
    WHEN (
      NEW."sourceType" = 'TASK' AND NEW."targetType" = 'TASK'
    ) OR (
      NEW."sourceType" <> 'TASK' AND NEW."targetType" <> 'TASK'
    ) OR (
      CASE WHEN NEW."sourceType" = 'TASK' THEN NEW."targetType" ELSE NEW."sourceType" END
    ) NOT IN ('MESSAGE', 'LIFECYCLE', 'DOCUMENT')
    OR NEW."relation" NOT IN ('RELATED', 'STEP')
    THEN RAISE(ABORT, 'task_entity_link_policy_mismatch')
  END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM "Task" AS task
    JOIN "User" AS actor
      ON actor."id" = NEW."createdBy"
     AND actor."workspaceId" = task."workspaceId"
     AND actor."status" = 'ACTIVE'
    JOIN "UserCompanyAccess" AS access
      ON access."userId" = actor."id"
     AND access."companyId" = task."companyId"
     AND access."status" = 'ACTIVE'
    WHERE task."id" = CASE WHEN NEW."sourceType" = 'TASK' THEN NEW."sourceId" ELSE NEW."targetId" END
      AND (
        task."groupId" IS NULL
        OR EXISTS (
          SELECT 1 FROM "GroupMember" AS member
          WHERE member."groupId" = task."groupId"
            AND member."userId" = actor."id"
            AND member."leftAt" IS NULL
        )
      )
      AND (
        task."reporterId" = actor."id"
        OR EXISTS (
          SELECT 1 FROM "TaskParticipant" AS participant
          WHERE participant."taskId" = task."id"
            AND participant."userId" = actor."id"
            AND participant."removedAt" IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM "UserRole" AS user_role
          JOIN "RolePermission" AS permission
            ON permission."roleId" = user_role."roleId"
           AND permission."permissionCode" IN ('tasks.manage', 'tasks.edit.any')
          WHERE user_role."userId" = actor."id"
            AND user_role."status" = 'ACTIVE'
        )
      )
  ) THEN RAISE(ABORT, 'task_entity_link_scope_mismatch') END;
  SELECT CASE
    WHEN (
      CASE WHEN NEW."sourceType" = 'TASK' THEN NEW."targetType" ELSE NEW."sourceType" END
    ) = 'MESSAGE'
    AND NOT EXISTS (
      SELECT 1
      FROM "Message" AS message
      JOIN "MessageThread" AS thread ON thread."id" = message."threadId"
      JOIN "ThreadParticipant" AS participant
        ON participant."threadId" = thread."id"
       AND participant."userId" = NEW."createdBy"
       AND participant."leftAt" IS NULL
      JOIN "Task" AS task ON task."id" = CASE
        WHEN NEW."sourceType" = 'TASK' THEN NEW."sourceId"
        ELSE NEW."targetId"
      END
      WHERE message."id" = CASE
          WHEN NEW."sourceType" = 'TASK' THEN NEW."targetId"
          ELSE NEW."sourceId"
        END
        AND thread."workspaceId" = task."workspaceId"
        AND (thread."companyId" IS NULL OR thread."companyId" = task."companyId")
    )
    THEN RAISE(ABORT, 'task_message_link_scope_mismatch')
  END;
  SELECT CASE
    WHEN (
      CASE WHEN NEW."sourceType" = 'TASK' THEN NEW."targetType" ELSE NEW."sourceType" END
    ) = 'LIFECYCLE'
    AND NOT EXISTS (
      SELECT 1
      FROM "LifecycleProcess" AS process
      JOIN "Task" AS task ON task."id" = CASE
        WHEN NEW."sourceType" = 'TASK' THEN NEW."sourceId"
        ELSE NEW."targetId"
      END
      WHERE process."id" = CASE
          WHEN NEW."sourceType" = 'TASK' THEN NEW."targetId"
          ELSE NEW."sourceId"
        END
        AND process."workspaceId" = task."workspaceId"
        AND process."companyId" = task."companyId"
    )
    THEN RAISE(ABORT, 'task_lifecycle_link_scope_mismatch')
  END;
  SELECT CASE
    WHEN (
      CASE WHEN NEW."sourceType" = 'TASK' THEN NEW."targetType" ELSE NEW."sourceType" END
    ) = 'DOCUMENT'
    AND NOT EXISTS (
      SELECT 1
      FROM "Document" AS document
      JOIN "Task" AS task ON task."id" = CASE
        WHEN NEW."sourceType" = 'TASK' THEN NEW."sourceId"
        ELSE NEW."targetId"
      END
      WHERE document."id" = CASE
          WHEN NEW."sourceType" = 'TASK' THEN NEW."targetId"
          ELSE NEW."sourceId"
        END
        AND document."workspaceId" = task."workspaceId"
        AND document."companyId" = task."companyId"
    )
    THEN RAISE(ABORT, 'task_document_link_scope_mismatch')
  END;
END;

INSERT OR IGNORE INTO "Permission" ("code", "domain", "risk", "description") VALUES
  ('tasks.edit.any', 'tasks', 'HIGH', 'Edit any readable task'),
  ('tasks.reporter.manage', 'tasks', 'HIGH', 'Change task reporter'),
  ('tasks.responsibles.manage', 'tasks', 'NORMAL', 'Manage task responsibles'),
  ('tasks.participants.manage', 'tasks', 'NORMAL', 'Manage task participants'),
  ('tasks.recurrence.manage', 'tasks', 'NORMAL', 'Manage task recurrence'),
  ('tasks.time.read', 'tasks', 'NORMAL', 'Read task time entries'),
  ('tasks.time.write', 'tasks', 'NORMAL', 'Write task time entries'),
  ('tasks.relations.manage', 'tasks', 'NORMAL', 'Manage task relations'),
  ('tasks.delete', 'tasks', 'HIGH', 'Archive tasks');

INSERT OR IGNORE INTO "RolePermission" (
  "id", "roleId", "permissionCode", "scope", "companyIdsJson", "version"
)
SELECT
  'rp_task_v2_' || role_permission."roleId" || '_' || replace(permission."code", '.', '_'),
  role_permission."roleId",
  permission."code",
  role_permission."scope",
  role_permission."companyIdsJson",
  1
FROM "RolePermission" AS role_permission
JOIN "Permission" AS permission
  ON permission."code" IN (
    'tasks.responsibles.manage',
    'tasks.participants.manage',
    'tasks.recurrence.manage',
    'tasks.time.read',
    'tasks.time.write',
    'tasks.relations.manage'
  )
WHERE role_permission."permissionCode" = 'tasks.create';

INSERT OR IGNORE INTO "RolePermission" (
  "id", "roleId", "permissionCode", "scope", "companyIdsJson", "version"
)
SELECT
  'rp_task_v2_' || role_permission."roleId" || '_' || replace(permission."code", '.', '_'),
  role_permission."roleId",
  permission."code",
  role_permission."scope",
  role_permission."companyIdsJson",
  1
FROM "RolePermission" AS role_permission
JOIN "Permission" AS permission
  ON permission."code" IN (
    'tasks.edit.any',
    'tasks.reporter.manage',
    'tasks.responsibles.manage',
    'tasks.participants.manage',
    'tasks.recurrence.manage',
    'tasks.time.read',
    'tasks.time.write',
    'tasks.relations.manage'
  )
WHERE role_permission."permissionCode" = 'tasks.manage';

INSERT OR IGNORE INTO "RolePermission" (
  "id", "roleId", "permissionCode", "scope", "companyIdsJson", "version"
)
SELECT
  'rp_task_v2_' || role."id" || '_' || replace(permission."code", '.', '_'),
  role."id",
  permission."code",
  'ALL_COMPANIES',
  '[]',
  1
FROM "Role" AS role
JOIN "Permission" AS permission
  ON permission."code" LIKE 'tasks.%'
WHERE role."isFullAdmin" = 1;

DROP TABLE "_TaskV2Legacy";

PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = OFF;

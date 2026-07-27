ALTER TABLE "Task" ADD COLUMN "groupId" TEXT REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "parentTaskId" TEXT REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "blockReason" TEXT;
ALTER TABLE "Task" ADD COLUMN "completedAt" DATETIME;

CREATE INDEX "Task_groupId_status_deadline_id_idx"
  ON "Task"("groupId", "status", "deadline", "id");
CREATE INDEX "Task_parentTaskId_status_deadline_id_idx"
  ON "Task"("parentTaskId", "status", "deadline", "id");

CREATE TRIGGER "Task_group_scope_guard_insert"
BEFORE INSERT ON "Task"
WHEN NEW."groupId" IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Group" AS g
      WHERE g."id" = NEW."groupId"
        AND g."workspaceId" = NEW."workspaceId"
        AND g."companyId" = NEW."companyId"
    )
    THEN RAISE(ABORT, 'task_group_scope_mismatch')
  END;
END;

CREATE TRIGGER "Task_group_scope_guard_update"
BEFORE UPDATE OF "groupId", "workspaceId", "companyId" ON "Task"
WHEN NEW."groupId" IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Group" AS g
      WHERE g."id" = NEW."groupId"
        AND g."workspaceId" = NEW."workspaceId"
        AND g."companyId" = NEW."companyId"
    )
    THEN RAISE(ABORT, 'task_group_scope_mismatch')
  END;
END;

CREATE TRIGGER "Task_hierarchy_guard_insert"
BEFORE INSERT ON "Task"
WHEN NEW."parentTaskId" IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW."parentTaskId" = NEW."id"
    THEN RAISE(ABORT, 'task_parent_cycle')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Task" AS parent
      WHERE parent."id" = NEW."parentTaskId"
    )
    THEN RAISE(ABORT, 'task_parent_missing')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM "Task" AS parent
      WHERE parent."id" = NEW."parentTaskId"
        AND parent."parentTaskId" IS NOT NULL
    )
    THEN RAISE(ABORT, 'task_subtask_depth_exceeded')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Task" AS parent
      WHERE parent."id" = NEW."parentTaskId"
        AND parent."workspaceId" = NEW."workspaceId"
        AND parent."companyId" = NEW."companyId"
        AND parent."groupId" IS NEW."groupId"
    )
    THEN RAISE(ABORT, 'task_parent_scope_mismatch')
  END;
END;

CREATE TRIGGER "Task_parent_immutable_update"
BEFORE UPDATE OF "parentTaskId" ON "Task"
WHEN NEW."parentTaskId" IS NOT OLD."parentTaskId"
BEGIN
  SELECT RAISE(ABORT, 'task_parent_immutable');
END;

CREATE TRIGGER "Task_hierarchy_scope_immutable_update"
BEFORE UPDATE OF "workspaceId", "companyId", "groupId" ON "Task"
WHEN (
  NEW."workspaceId" IS NOT OLD."workspaceId"
  OR NEW."companyId" IS NOT OLD."companyId"
  OR NEW."groupId" IS NOT OLD."groupId"
)
AND (
  OLD."parentTaskId" IS NOT NULL
  OR EXISTS (
    SELECT 1
    FROM "Task" AS child
    WHERE child."parentTaskId" = OLD."id"
  )
)
BEGIN
  SELECT RAISE(ABORT, 'task_hierarchy_scope_immutable');
END;

CREATE TRIGGER "Task_active_subtasks_completion_guard"
BEFORE UPDATE OF "status" ON "Task"
WHEN NEW."status" = 'DONE'
  AND OLD."status" IS NOT 'DONE'
  AND EXISTS (
    SELECT 1
    FROM "Task" AS child
    WHERE child."parentTaskId" = OLD."id"
      AND child."status" NOT IN ('DONE', 'CANCELLED', 'ARCHIVED')
      AND child."archivedAt" IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'task_active_subtasks');
END;

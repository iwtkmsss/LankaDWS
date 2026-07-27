CREATE TRIGGER "FileLink_task_scope_guard_insert"
BEFORE INSERT ON "FileLink"
WHEN NEW."entityType" IN ('TASK', 'TASK_COMMENT')
BEGIN
  SELECT CASE
    WHEN NEW."purpose" <> 'ATTACHMENT'
      OR NEW."aclMode" <> 'ENTITY'
    THEN RAISE(ABORT, 'task_file_link_policy_mismatch')
  END;

  SELECT CASE
    WHEN NEW."entityType" = 'TASK'
      AND NOT EXISTS (
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
    WHEN NEW."entityType" = 'TASK'
      AND (
        SELECT count(*)
        FROM "FileLink" AS existing
        WHERE existing."entityType" = 'TASK'
          AND existing."entityId" = NEW."entityId"
          AND existing."purpose" = 'ATTACHMENT'
      ) >= 20
    THEN RAISE(ABORT, 'task_attachment_limit')
  END;

  SELECT CASE
    WHEN NEW."entityType" = 'TASK_COMMENT'
      AND NOT EXISTS (
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
    WHEN NEW."entityType" = 'TASK_COMMENT'
      AND (
        SELECT count(*)
        FROM "FileLink" AS existing
        WHERE existing."entityType" = 'TASK_COMMENT'
          AND existing."entityId" = NEW."entityId"
          AND existing."purpose" = 'ATTACHMENT'
      ) >= 5
    THEN RAISE(ABORT, 'task_comment_attachment_limit')
  END;
END;

CREATE TRIGGER "FileLink_task_core_immutable_update"
BEFORE UPDATE ON "FileLink"
WHEN OLD."entityType" IN ('TASK', 'TASK_COMMENT')
  OR NEW."entityType" IN ('TASK', 'TASK_COMMENT')
BEGIN
  SELECT RAISE(ABORT, 'task_file_link_immutable');
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

  SELECT CASE
    WHEN NOT EXISTS (
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
            SELECT 1
            FROM "GroupMember" AS member
            WHERE member."groupId" = task."groupId"
              AND member."userId" = author."id"
              AND member."leftAt" IS NULL
          )
        )
        AND (
          task."creatorId" = author."id"
          OR task."assigneeId" = author."id"
          OR EXISTS (
            SELECT 1
            FROM "TaskParticipant" AS participant
            WHERE participant."taskId" = task."id"
              AND participant."userId" = author."id"
              AND participant."removedAt" IS NULL
          )
          OR EXISTS (
            SELECT 1
            FROM "UserRole" AS user_role
            JOIN "Role" AS role
              ON role."id" = user_role."roleId"
             AND role."status" = 'ACTIVE'
            JOIN "RolePermission" AS permission
              ON permission."roleId" = role."id"
             AND permission."permissionCode" = 'tasks.manage'
            WHERE user_role."userId" = author."id"
              AND user_role."status" = 'ACTIVE'
              AND user_role."validFrom" <= CURRENT_TIMESTAMP
              AND (
                user_role."validTo" IS NULL
                OR user_role."validTo" > CURRENT_TIMESTAMP
              )
          )
        )
    )
    THEN RAISE(ABORT, 'task_comment_scope_mismatch')
  END;

  SELECT CASE
    WHEN NEW."replyToCommentId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "Comment" AS parent
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

CREATE TRIGGER "Comment_task_core_immutable_update"
BEFORE UPDATE ON "Comment"
WHEN (
  OLD."entityType" = 'TASK'
  OR NEW."entityType" = 'TASK'
)
AND (
  NEW."id" IS NOT OLD."id"
  OR NEW."workspaceId" IS NOT OLD."workspaceId"
  OR NEW."companyId" IS NOT OLD."companyId"
  OR NEW."entityType" IS NOT OLD."entityType"
  OR NEW."entityId" IS NOT OLD."entityId"
  OR NEW."authorId" IS NOT OLD."authorId"
  OR NEW."visibility" IS NOT OLD."visibility"
  OR NEW."replyToCommentId" IS NOT OLD."replyToCommentId"
  OR NEW."createdAt" IS NOT OLD."createdAt"
)
BEGIN
  SELECT RAISE(ABORT, 'task_comment_immutable');
END;

CREATE TRIGGER "EntityLink_task_scope_guard_insert"
BEFORE INSERT ON "EntityLink"
WHEN NEW."sourceType" = 'TASK'
  OR NEW."targetType" = 'TASK'
BEGIN
  SELECT CASE
    WHEN (
      NEW."sourceType" = 'TASK'
      AND NEW."targetType" = 'TASK'
    )
    OR (
      NEW."sourceType" <> 'TASK'
      AND NEW."targetType" <> 'TASK'
    )
    OR (
      CASE
        WHEN NEW."sourceType" = 'TASK' THEN NEW."targetType"
        ELSE NEW."sourceType"
      END
    ) NOT IN ('MESSAGE', 'LIFECYCLE', 'DOCUMENT')
    OR NEW."relation" NOT IN ('RELATED', 'STEP')
    THEN RAISE(ABORT, 'task_entity_link_policy_mismatch')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
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
      WHERE task."id" = CASE
          WHEN NEW."sourceType" = 'TASK' THEN NEW."sourceId"
          ELSE NEW."targetId"
        END
        AND (
          task."groupId" IS NULL
          OR EXISTS (
            SELECT 1
            FROM "GroupMember" AS member
            WHERE member."groupId" = task."groupId"
              AND member."userId" = actor."id"
              AND member."leftAt" IS NULL
          )
        )
        AND (
          task."creatorId" = actor."id"
          OR task."assigneeId" = actor."id"
          OR EXISTS (
            SELECT 1
            FROM "TaskParticipant" AS participant
            WHERE participant."taskId" = task."id"
              AND participant."userId" = actor."id"
              AND participant."removedAt" IS NULL
          )
          OR EXISTS (
            SELECT 1
            FROM "UserRole" AS user_role
            JOIN "Role" AS role
              ON role."id" = user_role."roleId"
             AND role."status" = 'ACTIVE'
            JOIN "RolePermission" AS permission
              ON permission."roleId" = role."id"
             AND permission."permissionCode" = 'tasks.manage'
            WHERE user_role."userId" = actor."id"
              AND user_role."status" = 'ACTIVE'
              AND user_role."validFrom" <= CURRENT_TIMESTAMP
              AND (
                user_role."validTo" IS NULL
                OR user_role."validTo" > CURRENT_TIMESTAMP
              )
          )
        )
    )
    THEN RAISE(ABORT, 'task_entity_link_scope_mismatch')
  END;

  SELECT CASE
    WHEN (
      CASE
        WHEN NEW."sourceType" = 'TASK' THEN NEW."targetType"
        ELSE NEW."sourceType"
      END
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
        AND (
          thread."companyId" IS NULL
          OR thread."companyId" = task."companyId"
        )
    )
    THEN RAISE(ABORT, 'task_message_link_scope_mismatch')
  END;

  SELECT CASE
    WHEN (
      CASE
        WHEN NEW."sourceType" = 'TASK' THEN NEW."targetType"
        ELSE NEW."sourceType"
      END
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
      CASE
        WHEN NEW."sourceType" = 'TASK' THEN NEW."targetType"
        ELSE NEW."sourceType"
      END
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

CREATE TRIGGER "EntityLink_task_core_immutable_update"
BEFORE UPDATE ON "EntityLink"
WHEN OLD."sourceType" = 'TASK'
  OR OLD."targetType" = 'TASK'
  OR NEW."sourceType" = 'TASK'
  OR NEW."targetType" = 'TASK'
BEGIN
  SELECT RAISE(ABORT, 'task_entity_link_immutable');
END;

CREATE TRIGGER "Task_content_scope_immutable_update"
BEFORE UPDATE OF "workspaceId", "companyId", "groupId" ON "Task"
WHEN (
  NEW."workspaceId" IS NOT OLD."workspaceId"
  OR NEW."companyId" IS NOT OLD."companyId"
  OR NEW."groupId" IS NOT OLD."groupId"
)
AND (
  EXISTS (
    SELECT 1
    FROM "FileLink" AS file_link
    WHERE file_link."entityType" = 'TASK'
      AND file_link."entityId" = OLD."id"
  )
  OR EXISTS (
    SELECT 1
    FROM "Comment" AS comment
    WHERE comment."entityType" = 'TASK'
      AND comment."entityId" = OLD."id"
  )
  OR EXISTS (
    SELECT 1
    FROM "EntityLink" AS entity_link
    WHERE (
      entity_link."sourceType" = 'TASK'
      AND entity_link."sourceId" = OLD."id"
    )
    OR (
      entity_link."targetType" = 'TASK'
      AND entity_link."targetId" = OLD."id"
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'task_content_scope_immutable');
END;

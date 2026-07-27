DROP TRIGGER IF EXISTS "ThreadParticipant_chat_scope_guard_insert";
DROP TRIGGER IF EXISTS "ThreadParticipant_chat_state_guard_update";
DROP TRIGGER IF EXISTS "Message_chat_scope_guard_insert";
DROP TRIGGER IF EXISTS "Message_chat_core_guard_update";

UPDATE "ThreadParticipant"
SET "role" = 'MEMBER'
WHERE "threadId" IN (
  SELECT "id"
  FROM "MessageThread"
  WHERE "kind" = 'DIRECT'
);

CREATE TRIGGER "ThreadParticipant_chat_scope_guard_insert"
BEFORE INSERT ON "ThreadParticipant"
BEGIN
  SELECT CASE
    WHEN NEW."role" NOT IN ('OWNER', 'MEMBER')
      OR NEW."notificationMode" NOT IN ('ALL', 'NONE')
      OR NEW."version" <> 1
    THEN RAISE(ABORT, 'chat_participant_policy_mismatch')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "MessageThread" AS thread
      JOIN "User" AS participant
        ON participant."id" = NEW."userId"
       AND participant."workspaceId" = thread."workspaceId"
       AND participant."status" = 'ACTIVE'
      JOIN "UserCompanyAccess" AS access
        ON access."userId" = participant."id"
       AND access."companyId" = thread."companyId"
       AND access."status" = 'ACTIVE'
      WHERE thread."id" = NEW."threadId"
    )
    THEN RAISE(ABORT, 'chat_participant_scope_mismatch')
  END;

  SELECT CASE
    WHEN (
      SELECT thread."kind"
      FROM "MessageThread" AS thread
      WHERE thread."id" = NEW."threadId"
    ) IN ('DIRECT', 'COMPANY')
    AND NEW."role" <> 'MEMBER'
    THEN RAISE(ABORT, 'chat_participant_role_mismatch')
  END;

  SELECT CASE
    WHEN (
      SELECT thread."kind"
      FROM "MessageThread" AS thread
      WHERE thread."id" = NEW."threadId"
    ) = 'DIRECT'
    AND (
      SELECT count(*)
      FROM "ThreadParticipant" AS participant
      WHERE participant."threadId" = NEW."threadId"
        AND participant."leftAt" IS NULL
    ) >= 2
    THEN RAISE(ABORT, 'chat_direct_participant_limit')
  END;

  SELECT CASE
    WHEN NEW."lastReadMessageId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "Message"
        WHERE "id" = NEW."lastReadMessageId"
          AND "threadId" = NEW."threadId"
      )
    THEN RAISE(ABORT, 'chat_read_pointer_mismatch')
  END;
END;

CREATE TRIGGER "ThreadParticipant_chat_state_guard_update"
BEFORE UPDATE ON "ThreadParticipant"
BEGIN
  SELECT CASE
    WHEN NEW."id" IS NOT OLD."id"
      OR NEW."threadId" IS NOT OLD."threadId"
      OR NEW."userId" IS NOT OLD."userId"
      OR NEW."joinedAt" IS NOT OLD."joinedAt"
      OR NEW."notificationMode" NOT IN ('ALL', 'NONE')
      OR NEW."role" NOT IN ('OWNER', 'MEMBER')
      OR NEW."version" < OLD."version"
      OR NEW."version" > OLD."version" + 1
      OR (
        (
          NEW."role" IS NOT OLD."role"
          OR NEW."leftAt" IS NOT OLD."leftAt"
          OR NEW."notificationMode" IS NOT OLD."notificationMode"
          OR NEW."lastReadMessageId" IS NOT OLD."lastReadMessageId"
        )
        AND NEW."version" <> OLD."version" + 1
      )
      OR (
        OLD."leftAt" IS NOT NULL
        AND NEW."leftAt" IS NOT OLD."leftAt"
        AND NEW."leftAt" IS NOT NULL
      )
    THEN RAISE(ABORT, 'chat_participant_state_mismatch')
  END;

  SELECT CASE
    WHEN (
      SELECT thread."kind"
      FROM "MessageThread" AS thread
      WHERE thread."id" = NEW."threadId"
    ) IN ('DIRECT', 'COMPANY')
    AND (
      NEW."role" IS NOT OLD."role"
      OR NEW."leftAt" IS NOT OLD."leftAt"
    )
    THEN RAISE(ABORT, 'chat_participant_membership_immutable')
  END;

  SELECT CASE
    WHEN OLD."leftAt" IS NOT NULL
      AND NEW."leftAt" IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "MessageThread" AS thread
        JOIN "User" AS participant
          ON participant."id" = NEW."userId"
         AND participant."workspaceId" = thread."workspaceId"
         AND participant."status" = 'ACTIVE'
        JOIN "UserCompanyAccess" AS access
          ON access."userId" = participant."id"
         AND access."companyId" = thread."companyId"
         AND access."status" = 'ACTIVE'
        WHERE thread."id" = NEW."threadId"
      )
    THEN RAISE(ABORT, 'chat_participant_scope_mismatch')
  END;

  SELECT CASE
    WHEN OLD."leftAt" IS NULL
      AND NEW."leftAt" IS NOT NULL
      AND (
        SELECT thread."kind"
        FROM "MessageThread" AS thread
        WHERE thread."id" = NEW."threadId"
      ) = 'GROUP'
      AND (
        SELECT count(*)
        FROM "ThreadParticipant" AS participant
        WHERE participant."threadId" = NEW."threadId"
          AND participant."leftAt" IS NULL
      ) <= 2
    THEN RAISE(ABORT, 'chat_group_participant_minimum')
  END;

  SELECT CASE
    WHEN OLD."role" = 'OWNER'
      AND OLD."leftAt" IS NULL
      AND (
        NEW."role" <> 'OWNER'
        OR NEW."leftAt" IS NOT NULL
      )
      AND (
        SELECT thread."kind"
        FROM "MessageThread" AS thread
        WHERE thread."id" = NEW."threadId"
      ) IN ('GROUP', 'CONTEXTUAL')
      AND NOT EXISTS (
        SELECT 1
        FROM "ThreadParticipant" AS owner
        WHERE owner."threadId" = NEW."threadId"
          AND owner."id" <> NEW."id"
          AND owner."role" = 'OWNER'
          AND owner."leftAt" IS NULL
      )
    THEN RAISE(ABORT, 'chat_group_owner_required')
  END;

  SELECT CASE
    WHEN NEW."lastReadMessageId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "Message" AS next_message
        WHERE next_message."id" = NEW."lastReadMessageId"
          AND next_message."threadId" = NEW."threadId"
      )
    THEN RAISE(ABORT, 'chat_read_pointer_mismatch')
  END;

  SELECT CASE
    WHEN OLD."lastReadMessageId" IS NOT NULL
      AND NEW."lastReadMessageId" IS NOT OLD."lastReadMessageId"
      AND EXISTS (
        SELECT 1
        FROM "Message" AS current_message
        JOIN "Message" AS next_message
          ON next_message."id" = NEW."lastReadMessageId"
         AND next_message."threadId" = current_message."threadId"
        WHERE current_message."id" = OLD."lastReadMessageId"
          AND (
            next_message."createdAt" < current_message."createdAt"
            OR (
              next_message."createdAt" = current_message."createdAt"
              AND next_message."id" <= current_message."id"
            )
          )
      )
    THEN RAISE(ABORT, 'chat_read_pointer_regression')
  END;
END;

CREATE TRIGGER "Message_chat_scope_guard_insert"
BEFORE INSERT ON "Message"
BEGIN
  SELECT CASE
    WHEN length(trim(NEW."body")) < 1
      OR length(NEW."body") > 8000
      OR NEW."editedAt" IS NOT NULL
      OR NEW."deletedAt" IS NOT NULL
      OR NEW."version" <> 1
    THEN RAISE(ABORT, 'chat_message_policy_mismatch')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "MessageThread" AS thread
      JOIN "ThreadParticipant" AS participant
        ON participant."threadId" = thread."id"
       AND participant."userId" = NEW."authorId"
       AND participant."leftAt" IS NULL
      WHERE thread."id" = NEW."threadId"
    )
    THEN RAISE(ABORT, 'chat_message_author_scope_mismatch')
  END;

  SELECT CASE
    WHEN NEW."replyToId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "Message" AS parent
        WHERE parent."id" = NEW."replyToId"
          AND parent."threadId" = NEW."threadId"
          AND parent."replyToId" IS NULL
          AND parent."deletedAt" IS NULL
      )
    THEN RAISE(ABORT, 'chat_message_reply_mismatch')
  END;

  SELECT CASE
    WHEN (
      SELECT thread."kind"
      FROM "MessageThread" AS thread
      WHERE thread."id" = NEW."threadId"
    ) = 'DIRECT'
    AND (
      SELECT count(*)
      FROM "ThreadParticipant" AS participant
      WHERE participant."threadId" = NEW."threadId"
        AND participant."leftAt" IS NULL
    ) <> 2
    THEN RAISE(ABORT, 'chat_direct_participant_count')
  END;

  SELECT CASE
    WHEN (
      SELECT thread."kind"
      FROM "MessageThread" AS thread
      WHERE thread."id" = NEW."threadId"
    ) = 'GROUP'
    AND (
      SELECT count(*)
      FROM "ThreadParticipant" AS participant
      WHERE participant."threadId" = NEW."threadId"
        AND participant."leftAt" IS NULL
    ) < 2
    THEN RAISE(ABORT, 'chat_group_participant_count')
  END;
END;

CREATE TRIGGER "Message_chat_core_guard_update"
BEFORE UPDATE ON "Message"
BEGIN
  SELECT CASE
    WHEN NEW."id" IS NOT OLD."id"
      OR NEW."threadId" IS NOT OLD."threadId"
      OR NEW."authorId" IS NOT OLD."authorId"
      OR NEW."replyToId" IS NOT OLD."replyToId"
      OR NEW."createdAt" IS NOT OLD."createdAt"
      OR NEW."version" < OLD."version"
      OR NEW."version" > OLD."version" + 1
      OR (
        OLD."deletedAt" IS NOT NULL
        AND (
          NEW."body" IS NOT OLD."body"
          OR NEW."editedAt" IS NOT OLD."editedAt"
          OR NEW."deletedAt" IS NOT OLD."deletedAt"
          OR NEW."version" IS NOT OLD."version"
        )
      )
      OR (
        NEW."body" IS NOT OLD."body"
        AND (
          NEW."deletedAt" IS NOT OLD."deletedAt"
          OR NEW."editedAt" IS NULL
          OR NEW."version" <> OLD."version" + 1
        )
      )
      OR (
        NEW."deletedAt" IS NOT OLD."deletedAt"
        AND (
          OLD."deletedAt" IS NOT NULL
          OR NEW."deletedAt" IS NULL
          OR NEW."body" IS NOT OLD."body"
          OR NEW."version" <> OLD."version" + 1
        )
      )
      OR (
        NEW."editedAt" IS NOT OLD."editedAt"
        AND NEW."body" IS OLD."body"
      )
      OR (
        NEW."version" IS NOT OLD."version"
        AND NEW."body" IS OLD."body"
        AND NEW."deletedAt" IS OLD."deletedAt"
      )
    THEN RAISE(ABORT, 'chat_message_core_immutable')
  END;
END;

CREATE TRIGGER "FileLink_message_scope_guard_insert"
BEFORE INSERT ON "FileLink"
WHEN NEW."entityType" = 'MESSAGE'
BEGIN
  SELECT CASE
    WHEN NEW."purpose" <> 'ATTACHMENT'
      OR NEW."aclMode" <> 'ENTITY'
    THEN RAISE(ABORT, 'chat_file_link_policy_mismatch')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Message" AS message
      JOIN "MessageThread" AS thread
        ON thread."id" = message."threadId"
      JOIN "FileObject" AS file
        ON file."id" = NEW."fileId"
       AND file."workspaceId" = thread."workspaceId"
       AND file."companyId" = thread."companyId"
      WHERE message."id" = NEW."entityId"
        AND message."deletedAt" IS NULL
    )
    THEN RAISE(ABORT, 'chat_file_link_scope_mismatch')
  END;

  SELECT CASE
    WHEN (
      SELECT count(*)
      FROM "FileLink" AS existing
      WHERE existing."entityType" = 'MESSAGE'
        AND existing."entityId" = NEW."entityId"
        AND existing."purpose" = 'ATTACHMENT'
    ) >= 5
    THEN RAISE(ABORT, 'chat_attachment_limit')
  END;
END;

CREATE TRIGGER "FileLink_message_core_immutable_update"
BEFORE UPDATE ON "FileLink"
WHEN OLD."entityType" = 'MESSAGE'
  OR NEW."entityType" = 'MESSAGE'
BEGIN
  SELECT RAISE(ABORT, 'chat_file_link_immutable');
END;

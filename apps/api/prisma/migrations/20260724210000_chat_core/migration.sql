ALTER TABLE "MessageThread" ADD COLUMN "directKey" TEXT;
ALTER TABLE "MessageThread" ADD COLUMN "createdById" TEXT;

ALTER TABLE "ThreadParticipant" ADD COLUMN "notificationMode" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "ThreadParticipant" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "MessageThread"
SET "kind" = 'CONTEXTUAL'
WHERE "kind" = 'CONTEXT';

UPDATE "ThreadParticipant"
SET "role" = 'MEMBER'
WHERE "role" = 'PARTICIPANT';

CREATE UNIQUE INDEX "MessageThread_directKey_key"
ON "MessageThread"("directKey");

CREATE INDEX "MessageThread_workspaceId_companyId_kind_idx"
ON "MessageThread"("workspaceId", "companyId", "kind");

CREATE INDEX "ThreadParticipant_threadId_leftAt_notificationMode_idx"
ON "ThreadParticipant"("threadId", "leftAt", "notificationMode");

CREATE TRIGGER "MessageThread_chat_scope_guard_insert"
BEFORE INSERT ON "MessageThread"
BEGIN
  SELECT CASE
    WHEN NEW."companyId" IS NULL
      OR NEW."kind" NOT IN ('DIRECT', 'GROUP', 'CONTEXTUAL', 'COMPANY')
      OR NEW."version" <> 1
      OR (
        NEW."kind" = 'GROUP'
        AND (
          NEW."title" IS NULL
          OR length(trim(NEW."title")) < 2
          OR length(NEW."title") > 120
        )
      )
      OR (
        NEW."kind" = 'DIRECT'
        AND NEW."directKey" IS NOT NULL
        AND length(NEW."directKey") <> 64
      )
      OR (
        NEW."kind" <> 'DIRECT'
        AND NEW."directKey" IS NOT NULL
      )
      OR (
        (NEW."entityType" IS NULL) <> (NEW."entityId" IS NULL)
      )
    THEN RAISE(ABORT, 'chat_thread_policy_mismatch')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Company" AS company
      WHERE company."id" = NEW."companyId"
        AND company."workspaceId" = NEW."workspaceId"
        AND company."status" = 'ACTIVE'
    )
    THEN RAISE(ABORT, 'chat_thread_scope_mismatch')
  END;

  SELECT CASE
    WHEN NEW."createdById" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "User" AS actor
        JOIN "UserCompanyAccess" AS access
          ON access."userId" = actor."id"
         AND access."companyId" = NEW."companyId"
         AND access."status" = 'ACTIVE'
        WHERE actor."id" = NEW."createdById"
          AND actor."workspaceId" = NEW."workspaceId"
          AND actor."status" = 'ACTIVE'
      )
    THEN RAISE(ABORT, 'chat_thread_creator_scope_mismatch')
  END;
END;

CREATE TRIGGER "MessageThread_chat_core_guard_update"
BEFORE UPDATE ON "MessageThread"
BEGIN
  SELECT CASE
    WHEN NEW."id" IS NOT OLD."id"
      OR NEW."workspaceId" IS NOT OLD."workspaceId"
      OR NEW."companyId" IS NOT OLD."companyId"
      OR NEW."kind" IS NOT OLD."kind"
      OR NEW."entityType" IS NOT OLD."entityType"
      OR NEW."entityId" IS NOT OLD."entityId"
      OR NEW."createdById" IS NOT OLD."createdById"
      OR NEW."createdAt" IS NOT OLD."createdAt"
      OR (
        NEW."directKey" IS NOT OLD."directKey"
        AND NOT (
          OLD."kind" = 'DIRECT'
          AND OLD."directKey" IS NULL
          AND NEW."directKey" IS NOT NULL
          AND length(NEW."directKey") = 64
        )
      )
      OR NEW."version" < OLD."version"
      OR NEW."version" > OLD."version" + 1
    THEN RAISE(ABORT, 'chat_thread_core_immutable')
  END;
END;

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
      OR NEW."role" IS NOT OLD."role"
      OR NEW."joinedAt" IS NOT OLD."joinedAt"
      OR NEW."notificationMode" NOT IN ('ALL', 'NONE')
      OR (
        OLD."leftAt" IS NOT NULL
        AND NEW."leftAt" IS NOT OLD."leftAt"
      )
      OR (
        OLD."leftAt" IS NULL
        AND NEW."leftAt" IS NOT NULL
        AND NEW."lastReadMessageId" IS NOT OLD."lastReadMessageId"
      )
      OR (
        NEW."notificationMode" IS NOT OLD."notificationMode"
        AND NEW."version" <> OLD."version" + 1
      )
      OR (
        NEW."lastReadMessageId" IS NOT OLD."lastReadMessageId"
        AND NEW."version" <> OLD."version" + 1
      )
      OR NEW."version" < OLD."version"
      OR NEW."version" > OLD."version" + 1
    THEN RAISE(ABORT, 'chat_participant_state_mismatch')
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
    ) < 3
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
        NEW."body" IS NOT OLD."body"
        AND (
          NEW."editedAt" IS NULL
          OR NEW."version" <> OLD."version" + 1
        )
      )
      OR (
        OLD."deletedAt" IS NOT NULL
        AND NEW."deletedAt" IS NOT OLD."deletedAt"
      )
    THEN RAISE(ABORT, 'chat_message_core_immutable')
  END;
END;

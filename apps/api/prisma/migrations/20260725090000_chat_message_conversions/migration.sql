CREATE TRIGGER "EntityLink_event_message_scope_guard_insert"
BEFORE INSERT ON "EntityLink"
WHEN NEW."sourceType" = 'EVENT'
  OR NEW."targetType" = 'EVENT'
BEGIN
  SELECT CASE
    WHEN (
      NEW."sourceType" = 'EVENT'
      AND NEW."targetType" = 'EVENT'
    )
    OR (
      NEW."sourceType" <> 'EVENT'
      AND NEW."targetType" <> 'EVENT'
    )
    OR (
      CASE
        WHEN NEW."sourceType" = 'EVENT' THEN NEW."targetType"
        ELSE NEW."sourceType"
      END
    ) <> 'MESSAGE'
    OR NEW."relation" <> 'RELATED'
    THEN RAISE(ABORT, 'event_message_link_policy_mismatch')
  END;

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM "Event" AS event
      JOIN "Message" AS message
        ON message."id" = CASE
          WHEN NEW."sourceType" = 'EVENT' THEN NEW."targetId"
          ELSE NEW."sourceId"
        END
       AND message."deletedAt" IS NULL
      JOIN "MessageThread" AS thread
        ON thread."id" = message."threadId"
       AND thread."workspaceId" = event."workspaceId"
       AND thread."companyId" = event."companyId"
      JOIN "ThreadParticipant" AS participant
        ON participant."threadId" = thread."id"
       AND participant."userId" = NEW."createdBy"
       AND participant."leftAt" IS NULL
      JOIN "User" AS actor
        ON actor."id" = NEW."createdBy"
       AND actor."id" = event."ownerId"
       AND actor."workspaceId" = event."workspaceId"
       AND actor."status" = 'ACTIVE'
      JOIN "UserCompanyAccess" AS access
        ON access."userId" = actor."id"
       AND access."companyId" = event."companyId"
       AND access."status" = 'ACTIVE'
      WHERE event."id" = CASE
        WHEN NEW."sourceType" = 'EVENT' THEN NEW."sourceId"
        ELSE NEW."targetId"
      END
    )
    THEN RAISE(ABORT, 'event_message_link_scope_mismatch')
  END;
END;

CREATE TRIGGER "EntityLink_event_message_immutable_update"
BEFORE UPDATE ON "EntityLink"
WHEN OLD."sourceType" = 'EVENT'
  OR OLD."targetType" = 'EVENT'
  OR NEW."sourceType" = 'EVENT'
  OR NEW."targetType" = 'EVENT'
BEGIN
  SELECT RAISE(ABORT, 'event_message_link_immutable');
END;

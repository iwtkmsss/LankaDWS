ALTER TABLE "FeedSourceHead"
ADD COLUMN "countsAsUnread" BOOLEAN NOT NULL DEFAULT true;

UPDATE "FeedSourceHead"
SET "countsAsUnread" = (
    SELECT item."countsAsUnread"
    FROM "FeedItem" item
    WHERE item."id" = "FeedSourceHead"."itemId"
);

CREATE INDEX "FeedSourceHead_workspaceId_companyId_countsAsUnread_occurredAt_itemId_idx"
    ON "FeedSourceHead"("workspaceId", "companyId", "countsAsUnread", "occurredAt", "itemId");

DROP TRIGGER "FeedSourceHead_scope_guard_insert";
DROP TRIGGER "FeedSourceHead_scope_guard_update";

CREATE TRIGGER "FeedSourceHead_scope_guard_insert"
BEFORE INSERT ON "FeedSourceHead"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "FeedItem" item
        WHERE item."id" = NEW."itemId"
          AND item."workspaceId" = NEW."workspaceId"
          AND item."companyId" = NEW."companyId"
          AND item."sourceType" = NEW."sourceType"
          AND item."sourceId" = NEW."sourceId"
          AND item."sourceVersion" = NEW."sourceVersion"
          AND item."countsAsUnread" = NEW."countsAsUnread"
          AND item."occurredAt" = NEW."occurredAt"
    ) THEN RAISE(ABORT, 'feed_source_head_scope_mismatch') END;
END;

CREATE TRIGGER "FeedSourceHead_scope_guard_update"
BEFORE UPDATE ON "FeedSourceHead"
BEGIN
    SELECT CASE WHEN
        NEW."workspaceId" <> OLD."workspaceId"
        OR NEW."companyId" <> OLD."companyId"
        OR NEW."sourceType" <> OLD."sourceType"
        OR NEW."sourceId" <> OLD."sourceId"
    THEN RAISE(ABORT, 'feed_source_head_identity_immutable') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "FeedItem" item
        WHERE item."id" = NEW."itemId"
          AND item."workspaceId" = NEW."workspaceId"
          AND item."companyId" = NEW."companyId"
          AND item."sourceType" = NEW."sourceType"
          AND item."sourceId" = NEW."sourceId"
          AND item."sourceVersion" = NEW."sourceVersion"
          AND item."countsAsUnread" = NEW."countsAsUnread"
          AND item."occurredAt" = NEW."occurredAt"
    ) THEN RAISE(ABORT, 'feed_source_head_scope_mismatch') END;
    SELECT CASE WHEN
        NEW."sourceVersion" < OLD."sourceVersion"
        OR (
            NEW."sourceVersion" = OLD."sourceVersion"
            AND NEW."occurredAt" < OLD."occurredAt"
        )
        OR (
            NEW."sourceVersion" = OLD."sourceVersion"
            AND NEW."occurredAt" = OLD."occurredAt"
            AND NEW."itemId" < OLD."itemId"
        )
    THEN RAISE(ABORT, 'feed_source_head_regression') END;
END;

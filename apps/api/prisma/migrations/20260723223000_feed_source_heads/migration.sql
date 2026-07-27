CREATE TABLE "FeedSourceHead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedSourceHead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedSourceHead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedSourceHead_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FeedItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FeedSourceHead_itemId_key" ON "FeedSourceHead"("itemId");
CREATE UNIQUE INDEX "FeedSourceHead_workspaceId_companyId_sourceType_sourceId_key"
    ON "FeedSourceHead"("workspaceId", "companyId", "sourceType", "sourceId");
CREATE INDEX "FeedSourceHead_workspaceId_companyId_occurredAt_itemId_idx"
    ON "FeedSourceHead"("workspaceId", "companyId", "occurredAt", "itemId");

INSERT INTO "FeedSourceHead" (
    "id",
    "workspaceId",
    "companyId",
    "sourceType",
    "sourceId",
    "itemId",
    "sourceVersion",
    "occurredAt"
)
SELECT
    'fhead_' || item."id",
    item."workspaceId",
    item."companyId",
    item."sourceType",
    item."sourceId",
    item."id",
    item."sourceVersion",
    item."occurredAt"
FROM "FeedItem" item
WHERE NOT EXISTS (
    SELECT 1
    FROM "FeedItem" newer
    WHERE newer."workspaceId" = item."workspaceId"
      AND newer."companyId" = item."companyId"
      AND newer."sourceType" = item."sourceType"
      AND newer."sourceId" = item."sourceId"
      AND (
          newer."sourceVersion" > item."sourceVersion"
          OR (
              newer."sourceVersion" = item."sourceVersion"
              AND newer."occurredAt" > item."occurredAt"
          )
          OR (
              newer."sourceVersion" = item."sourceVersion"
              AND newer."occurredAt" = item."occurredAt"
              AND newer."id" > item."id"
          )
      )
);

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

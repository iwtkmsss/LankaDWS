CREATE TABLE "FeedUserItemState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "feedItemId" TEXT NOT NULL,
    "favoritedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeedUserItemState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedUserItemState_feedItemId_fkey" FOREIGN KEY ("feedItemId") REFERENCES "FeedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FeedUserItemState_userId_feedItemId_key"
ON "FeedUserItemState"("userId", "feedItemId");

CREATE INDEX "FeedUserItemState_userId_favoritedAt_idx"
ON "FeedUserItemState"("userId", "favoritedAt");

CREATE INDEX "FeedUserItemState_feedItemId_idx"
ON "FeedUserItemState"("feedItemId");

CREATE TRIGGER "FeedUserItemState_scope_guard_insert"
BEFORE INSERT ON "FeedUserItemState"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "FeedItem" item
        JOIN "User" user
          ON user."id" = NEW."userId"
         AND user."workspaceId" = item."workspaceId"
         AND user."status" = 'ACTIVE'
        JOIN "UserCompanyAccess" access
          ON access."userId" = user."id"
         AND access."companyId" = item."companyId"
         AND access."status" = 'ACTIVE'
        WHERE item."id" = NEW."feedItemId"
    ) THEN RAISE(ABORT, 'feed_user_item_state_scope_mismatch') END;
END;

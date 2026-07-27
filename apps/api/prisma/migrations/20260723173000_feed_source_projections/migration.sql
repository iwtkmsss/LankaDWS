CREATE TABLE "FeedItemRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedItemRecipient_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FeedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedItemRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FeedItemRecipient_itemId_userId_key" ON "FeedItemRecipient"("itemId", "userId");
CREATE INDEX "FeedItemRecipient_userId_itemId_idx" ON "FeedItemRecipient"("userId", "itemId");

CREATE TRIGGER "FeedItemRecipient_scope_guard_insert"
BEFORE INSERT ON "FeedItemRecipient"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "FeedItem" item
        JOIN "User" user ON user."id" = NEW."userId" AND user."workspaceId" = item."workspaceId"
        JOIN "UserCompanyAccess" access
          ON access."userId" = user."id"
         AND access."companyId" = item."companyId"
         AND access."status" = 'ACTIVE'
        WHERE item."id" = NEW."itemId"
    ) THEN RAISE(ABORT, 'feed_item_recipient_scope_mismatch') END;
END;

CREATE TRIGGER "FeedItemRecipient_append_only_update"
BEFORE UPDATE ON "FeedItemRecipient"
BEGIN
    SELECT RAISE(ABORT, 'feed_item_recipient_append_only');
END;

CREATE TRIGGER "FeedItemRecipient_append_only_delete"
BEFORE DELETE ON "FeedItemRecipient"
BEGIN
    SELECT RAISE(ABORT, 'feed_item_recipient_append_only');
END;

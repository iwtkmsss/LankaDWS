ALTER TABLE "Comment" ADD COLUMN "replyToCommentId" TEXT;

CREATE INDEX "Comment_replyToCommentId_idx" ON "Comment"("replyToCommentId");

CREATE TABLE "FeedPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgementVersion" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedPost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedPost_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedPost_ack_version_check" CHECK (
        ("requiresAcknowledgement" = false AND "acknowledgementVersion" = 0)
        OR ("requiresAcknowledgement" = true AND "acknowledgementVersion" > 0)
    )
);

CREATE INDEX "FeedPost_workspaceId_companyId_status_publishedAt_id_idx" ON "FeedPost"("workspaceId", "companyId", "status", "publishedAt", "id");
CREATE INDEX "FeedPost_authorId_status_publishedAt_idx" ON "FeedPost"("authorId", "status", "publishedAt");
CREATE INDEX "FeedPost_groupId_status_publishedAt_idx" ON "FeedPost"("groupId", "status", "publishedAt");

CREATE TABLE "FeedPostRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedPostRecipient_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedPostRecipient_type_check" CHECK ("type" IN ('COMPANY', 'GROUP', 'USER'))
);

CREATE UNIQUE INDEX "FeedPostRecipient_postId_type_recipientId_key" ON "FeedPostRecipient"("postId", "type", "recipientId");
CREATE INDEX "FeedPostRecipient_type_recipientId_postId_idx" ON "FeedPostRecipient"("type", "recipientId", "postId");

CREATE TABLE "FeedAcknowledgementRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acknowledgementVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedAcknowledgementRecipient_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedAcknowledgementRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FeedAcknowledgementRecipient_postId_userId_acknowledgementVersion_key" ON "FeedAcknowledgementRecipient"("postId", "userId", "acknowledgementVersion");
CREATE INDEX "FeedAcknowledgementRecipient_userId_acknowledgementVersion_postId_idx" ON "FeedAcknowledgementRecipient"("userId", "acknowledgementVersion", "postId");

CREATE TABLE "FeedPostAcknowledgement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acknowledgementVersion" INTEGER NOT NULL,
    "acknowledgedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedPostAcknowledgement_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedPostAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FeedPostAcknowledgement_postId_userId_acknowledgementVersion_key" ON "FeedPostAcknowledgement"("postId", "userId", "acknowledgementVersion");
CREATE INDEX "FeedPostAcknowledgement_userId_acknowledgedAt_idx" ON "FeedPostAcknowledgement"("userId", "acknowledgedAt");

CREATE TABLE "FeedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "postId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "actorId" TEXT,
    "visibility" TEXT NOT NULL,
    "safePayload" TEXT NOT NULL,
    "countsAsUnread" BOOLEAN NOT NULL DEFAULT true,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedItem_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FeedItem_eventKey_key" ON "FeedItem"("eventKey");
CREATE INDEX "FeedItem_workspaceId_companyId_occurredAt_id_idx" ON "FeedItem"("workspaceId", "companyId", "occurredAt", "id");
CREATE INDEX "FeedItem_postId_sourceVersion_idx" ON "FeedItem"("postId", "sourceVersion");
CREATE INDEX "FeedItem_sourceType_sourceId_sourceVersion_idx" ON "FeedItem"("sourceType", "sourceId", "sourceVersion");

CREATE TABLE "FeedReadCursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lastReadOccurredAt" DATETIME NOT NULL,
    "lastReadItemId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedReadCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedReadCursor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FeedReadCursor_userId_companyId_key" ON "FeedReadCursor"("userId", "companyId");
CREATE INDEX "FeedReadCursor_companyId_lastReadOccurredAt_lastReadItemId_idx" ON "FeedReadCursor"("companyId", "lastReadOccurredAt", "lastReadItemId");

CREATE TABLE "FeedReaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LIKE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedReaction_kind_check" CHECK ("kind" = 'LIKE')
);

CREATE UNIQUE INDEX "FeedReaction_postId_userId_kind_key" ON "FeedReaction"("postId", "userId", "kind");
CREATE INDEX "FeedReaction_userId_createdAt_idx" ON "FeedReaction"("userId", "createdAt");

CREATE TABLE "FeedSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ALL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedSubscription_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedSubscription_mode_check" CHECK ("mode" IN ('ALL', 'MENTIONS', 'NONE'))
);

CREATE UNIQUE INDEX "FeedSubscription_postId_userId_key" ON "FeedSubscription"("postId", "userId");
CREATE INDEX "FeedSubscription_userId_mode_idx" ON "FeedSubscription"("userId", "mode");

CREATE TABLE "FeedMention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "commentId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedMention_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FeedMention_postId_commentId_userId_key" ON "FeedMention"("postId", "commentId", "userId");
CREATE INDEX "FeedMention_userId_createdAt_idx" ON "FeedMention"("userId", "createdAt");

CREATE TRIGGER "FeedPost_scope_guard_insert"
BEFORE INSERT ON "FeedPost"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "Company" c
        JOIN "User" author ON author."id" = NEW."authorId" AND author."workspaceId" = NEW."workspaceId"
        JOIN "UserCompanyAccess" access ON access."userId" = author."id" AND access."companyId" = NEW."companyId" AND access."status" = 'ACTIVE'
        WHERE c."id" = NEW."companyId" AND c."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'feed_post_scope_mismatch') END;
    SELECT CASE WHEN NEW."groupId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "Group" g
        WHERE g."id" = NEW."groupId" AND g."workspaceId" = NEW."workspaceId" AND g."companyId" = NEW."companyId" AND g."status" = 'ACTIVE'
    ) THEN RAISE(ABORT, 'feed_post_group_scope_mismatch') END;
END;

CREATE TRIGGER "FeedPost_scope_guard_update"
BEFORE UPDATE OF "workspaceId", "companyId", "groupId", "authorId" ON "FeedPost"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "Company" c
        JOIN "User" author ON author."id" = NEW."authorId" AND author."workspaceId" = NEW."workspaceId"
        JOIN "UserCompanyAccess" access ON access."userId" = author."id" AND access."companyId" = NEW."companyId" AND access."status" = 'ACTIVE'
        WHERE c."id" = NEW."companyId" AND c."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'feed_post_scope_mismatch') END;
END;

CREATE TRIGGER "FeedPostRecipient_scope_guard_insert"
BEFORE INSERT ON "FeedPostRecipient"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "FeedPost" post
        WHERE post."id" = NEW."postId"
          AND (
            (NEW."type" = 'COMPANY' AND NEW."recipientId" = post."companyId")
            OR (NEW."type" = 'GROUP' AND EXISTS (
                SELECT 1 FROM "Group" g WHERE g."id" = NEW."recipientId" AND g."companyId" = post."companyId"
            ))
            OR (NEW."type" = 'USER' AND EXISTS (
                SELECT 1 FROM "UserCompanyAccess" access
                WHERE access."userId" = NEW."recipientId" AND access."companyId" = post."companyId" AND access."status" = 'ACTIVE'
            ))
          )
    ) THEN RAISE(ABORT, 'feed_recipient_scope_mismatch') END;
END;

CREATE TRIGGER "FeedAcknowledgementRecipient_scope_guard_insert"
BEFORE INSERT ON "FeedAcknowledgementRecipient"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "FeedPost" post
        JOIN "UserCompanyAccess" access ON access."userId" = NEW."userId" AND access."companyId" = post."companyId" AND access."status" = 'ACTIVE'
        WHERE post."id" = NEW."postId"
          AND post."requiresAcknowledgement" = true
          AND NEW."acknowledgementVersion" = post."acknowledgementVersion"
    ) THEN RAISE(ABORT, 'feed_ack_recipient_scope_mismatch') END;
END;

CREATE TRIGGER "FeedPostAcknowledgement_scope_guard_insert"
BEFORE INSERT ON "FeedPostAcknowledgement"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "FeedAcknowledgementRecipient" recipient
        WHERE recipient."postId" = NEW."postId"
          AND recipient."userId" = NEW."userId"
          AND recipient."acknowledgementVersion" = NEW."acknowledgementVersion"
    ) THEN RAISE(ABORT, 'feed_ack_recipient_required') END;
END;

CREATE TRIGGER "FeedItem_scope_guard_insert"
BEFORE INSERT ON "FeedItem"
BEGIN
    SELECT CASE WHEN NEW."postId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "FeedPost" post
        WHERE post."id" = NEW."postId"
          AND post."workspaceId" = NEW."workspaceId"
          AND post."companyId" = NEW."companyId"
          AND post."id" = NEW."sourceId"
    ) THEN RAISE(ABORT, 'feed_item_scope_mismatch') END;
END;

CREATE TRIGGER "FeedItem_append_only_update"
BEFORE UPDATE ON "FeedItem"
BEGIN
    SELECT RAISE(ABORT, 'feed_item_append_only');
END;

CREATE TRIGGER "FeedItem_append_only_delete"
BEFORE DELETE ON "FeedItem"
BEGIN
    SELECT RAISE(ABORT, 'feed_item_append_only');
END;

CREATE TRIGGER "FeedReadCursor_scope_guard_insert"
BEFORE INSERT ON "FeedReadCursor"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "UserCompanyAccess" access
        WHERE access."userId" = NEW."userId" AND access."companyId" = NEW."companyId" AND access."status" = 'ACTIVE'
    ) THEN RAISE(ABORT, 'feed_cursor_scope_mismatch') END;
END;

CREATE TRIGGER "FeedReadCursor_scope_guard_update"
BEFORE UPDATE OF "userId", "companyId" ON "FeedReadCursor"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "UserCompanyAccess" access
        WHERE access."userId" = NEW."userId" AND access."companyId" = NEW."companyId" AND access."status" = 'ACTIVE'
    ) THEN RAISE(ABORT, 'feed_cursor_scope_mismatch') END;
END;

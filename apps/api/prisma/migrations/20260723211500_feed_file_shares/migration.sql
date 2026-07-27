CREATE TABLE "FeedFileShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL,
    "audienceKey" TEXT NOT NULL,
    "groupId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "FeedFileShare_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FeedFileShareRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedFileShareRecipient_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "FeedFileShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShareRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "FeedItem"
ADD COLUMN "fileShareId" TEXT REFERENCES "FeedFileShare" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FeedFileShare_workspaceId_companyId_status_createdAt_idx"
ON "FeedFileShare"("workspaceId", "companyId", "status", "createdAt");

CREATE INDEX "FeedFileShare_fileId_status_createdAt_idx"
ON "FeedFileShare"("fileId", "status", "createdAt");

CREATE INDEX "FeedFileShare_ownerId_status_createdAt_idx"
ON "FeedFileShare"("ownerId", "status", "createdAt");

CREATE INDEX "FeedFileShare_groupId_status_idx"
ON "FeedFileShare"("groupId", "status");

CREATE UNIQUE INDEX "FeedFileShare_active_audience_key"
ON "FeedFileShare"("fileId", "ownerId", "audienceKey")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "FeedFileShareRecipient_shareId_userId_key"
ON "FeedFileShareRecipient"("shareId", "userId");

CREATE INDEX "FeedFileShareRecipient_userId_shareId_idx"
ON "FeedFileShareRecipient"("userId", "shareId");

CREATE INDEX "FeedItem_fileShareId_sourceVersion_idx"
ON "FeedItem"("fileShareId", "sourceVersion");

CREATE TRIGGER "FeedFileShare_scope_guard_insert"
BEFORE INSERT ON "FeedFileShare"
BEGIN
    SELECT CASE WHEN NEW."audienceType" NOT IN ('COMPANY', 'GROUP', 'USER')
        OR NEW."status" != 'ACTIVE'
        OR NEW."version" != 1
        OR length(NEW."audienceKey") = 0
        OR NOT EXISTS (
            SELECT 1
            FROM "Company" company
            JOIN "User" owner
              ON owner."id" = NEW."ownerId"
             AND owner."workspaceId" = company."workspaceId"
             AND owner."status" = 'ACTIVE'
            JOIN "UserCompanyAccess" access
              ON access."userId" = owner."id"
             AND access."companyId" = company."id"
             AND access."status" = 'ACTIVE'
            JOIN "FileObject" file
              ON file."id" = NEW."fileId"
             AND file."workspaceId" = company."workspaceId"
             AND file."companyId" = company."id"
             AND file."ownerId" = owner."id"
            WHERE company."id" = NEW."companyId"
              AND company."workspaceId" = NEW."workspaceId"
              AND company."status" = 'ACTIVE'
        )
        OR (NEW."audienceType" = 'COMPANY' AND NEW."groupId" IS NOT NULL)
        OR (NEW."audienceType" = 'USER' AND NEW."groupId" IS NOT NULL)
        OR (NEW."audienceType" = 'GROUP' AND (
            NEW."groupId" IS NULL
            OR NOT EXISTS (
                SELECT 1 FROM "Group" group_row
                WHERE group_row."id" = NEW."groupId"
                  AND group_row."workspaceId" = NEW."workspaceId"
                  AND group_row."companyId" = NEW."companyId"
                  AND group_row."status" = 'ACTIVE'
            )
        ))
    THEN RAISE(ABORT, 'feed_file_share_scope_mismatch') END;
END;

CREATE TRIGGER "FeedFileShare_lifecycle_guard_update"
BEFORE UPDATE ON "FeedFileShare"
BEGIN
    SELECT CASE WHEN NEW."id" != OLD."id"
        OR NEW."workspaceId" != OLD."workspaceId"
        OR NEW."companyId" != OLD."companyId"
        OR NEW."fileId" != OLD."fileId"
        OR NEW."ownerId" != OLD."ownerId"
        OR NEW."audienceType" != OLD."audienceType"
        OR NEW."audienceKey" != OLD."audienceKey"
        OR COALESCE(NEW."groupId", '') != COALESCE(OLD."groupId", '')
        OR NEW."createdAt" != OLD."createdAt"
        OR OLD."status" != 'ACTIVE'
        OR NEW."status" != 'REVOKED'
        OR NEW."version" != OLD."version" + 1
        OR NEW."revokedAt" IS NULL
    THEN RAISE(ABORT, 'feed_file_share_invalid_transition') END;
END;

CREATE TRIGGER "FeedFileShare_no_delete"
BEFORE DELETE ON "FeedFileShare"
BEGIN
    SELECT RAISE(ABORT, 'feed_file_share_audit_history');
END;

CREATE TRIGGER "FeedFileShareRecipient_scope_guard_insert"
BEFORE INSERT ON "FeedFileShareRecipient"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "FeedFileShare" share
        JOIN "User" user
          ON user."id" = NEW."userId"
         AND user."workspaceId" = share."workspaceId"
         AND user."status" = 'ACTIVE'
        JOIN "UserCompanyAccess" access
          ON access."userId" = user."id"
         AND access."companyId" = share."companyId"
         AND access."status" = 'ACTIVE'
        WHERE share."id" = NEW."shareId"
          AND share."status" = 'ACTIVE'
          AND share."audienceType" = 'USER'
    ) THEN RAISE(ABORT, 'feed_file_share_recipient_scope_mismatch') END;
END;

CREATE TRIGGER "FeedFileShareRecipient_append_only_update"
BEFORE UPDATE ON "FeedFileShareRecipient"
BEGIN
    SELECT RAISE(ABORT, 'feed_file_share_recipient_append_only');
END;

CREATE TRIGGER "FeedFileShareRecipient_append_only_delete"
BEFORE DELETE ON "FeedFileShareRecipient"
BEGIN
    SELECT RAISE(ABORT, 'feed_file_share_recipient_append_only');
END;

CREATE TRIGGER "FeedItem_file_share_guard_insert"
BEFORE INSERT ON "FeedItem"
BEGIN
    SELECT CASE WHEN (
        NEW."sourceType" = 'FILE'
        AND (
            NEW."fileShareId" IS NULL
            OR NEW."sourceId" != NEW."fileShareId"
            OR NEW."action" != 'SHARED'
            OR NOT EXISTS (
                SELECT 1
                FROM "FeedFileShare" share
                WHERE share."id" = NEW."fileShareId"
                  AND share."workspaceId" = NEW."workspaceId"
                  AND share."companyId" = NEW."companyId"
                  AND share."ownerId" = NEW."actorId"
                  AND share."version" = NEW."sourceVersion"
                  AND share."status" = 'ACTIVE'
            )
        )
    ) OR (
        NEW."sourceType" != 'FILE'
        AND NEW."fileShareId" IS NOT NULL
    ) THEN RAISE(ABORT, 'feed_item_file_share_mismatch') END;
END;

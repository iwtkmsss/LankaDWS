-- Retire work groups without changing independent group chats or task data.
-- Keep the entire data/schema transformation atomic; dependencies are explicit
-- because foreign keys are disabled during SQLite table reconstruction.
PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

CREATE TEMP TABLE retired_group_posts AS
SELECT id FROM "FeedPost" WHERE groupId IS NOT NULL
  OR id IN (SELECT postId FROM "FeedPostRecipient" WHERE type = 'GROUP');
CREATE TEMP TABLE retired_group_shares AS
SELECT id FROM "FeedFileShare" WHERE groupId IS NOT NULL OR audienceType = 'GROUP';
CREATE TEMP TABLE retired_group_comments AS
SELECT id FROM "Comment" WHERE entityType = 'FEED_POST'
  AND entityId IN (SELECT id FROM retired_group_posts);
CREATE TEMP TABLE retired_group_items AS
SELECT id FROM "FeedItem" WHERE visibility = 'GROUP'
  OR postId IN (SELECT id FROM retired_group_posts)
  OR fileShareId IN (SELECT id FROM retired_group_shares)
  OR (sourceType = 'POST' AND sourceId IN (SELECT id FROM retired_group_posts))
  OR (sourceType = 'FILE' AND sourceId IN (SELECT id FROM retired_group_shares));

DELETE FROM "FeedItemRecipient" WHERE itemId IN (SELECT id FROM retired_group_items);
DELETE FROM "FeedUserItemState" WHERE feedItemId IN (SELECT id FROM retired_group_items);
DELETE FROM "FeedSourceHead" WHERE itemId IN (SELECT id FROM retired_group_items);
-- Read cursors remain monotonic timestamp/id watermarks, even if a row is removed.
DELETE FROM "FeedItem" WHERE id IN (SELECT id FROM retired_group_items);
DELETE FROM "TaskCommentReaction" WHERE commentId IN (SELECT id FROM retired_group_comments);
DELETE FROM "FeedMention" WHERE postId IN (SELECT id FROM retired_group_posts)
  OR commentId IN (SELECT id FROM retired_group_comments);
DELETE FROM "ContentMention" WHERE
  (sourceType = 'FEED_POST' AND sourceId IN (SELECT id FROM retired_group_posts))
  OR (sourceType = 'FEED_COMMENT' AND sourceId IN (SELECT id FROM retired_group_comments));
DELETE FROM "FileLink" WHERE
  (entityType = 'FEED_POST' AND entityId IN (SELECT id FROM retired_group_posts))
  OR (entityType = 'FEED_COMMENT' AND entityId IN (SELECT id FROM retired_group_comments));
DELETE FROM "Notification" WHERE entityType = 'GROUP'
  OR (entityType = 'FEED_POST' AND entityId IN (SELECT id FROM retired_group_posts))
  OR (entityType = 'FEED_COMMENT' AND entityId IN (SELECT id FROM retired_group_comments))
  OR (entityType = 'FEED_FILE_SHARE' AND entityId IN (SELECT id FROM retired_group_shares));
DELETE FROM "Comment" WHERE id IN (SELECT id FROM retired_group_comments);
DELETE FROM "FeedPostRecipient" WHERE postId IN (SELECT id FROM retired_group_posts);
DELETE FROM "FeedAcknowledgementRecipient" WHERE postId IN (SELECT id FROM retired_group_posts);
DELETE FROM "FeedPostAcknowledgement" WHERE postId IN (SELECT id FROM retired_group_posts);
DELETE FROM "FeedReaction" WHERE postId IN (SELECT id FROM retired_group_posts);
DELETE FROM "FeedSubscription" WHERE postId IN (SELECT id FROM retired_group_posts);
DELETE FROM "FeedPost" WHERE id IN (SELECT id FROM retired_group_posts);
DELETE FROM "FeedFileShareRecipient" WHERE shareId IN (SELECT id FROM retired_group_shares);
DELETE FROM "FeedFileShare" WHERE id IN (SELECT id FROM retired_group_shares);
DELETE FROM "DriveShare" WHERE principalType = 'GROUP';
DELETE FROM "DocumentAcl" WHERE principalType = 'GROUP';
DELETE FROM "ArticleAudience" WHERE principalType = 'GROUP';
DELETE FROM "CompanyCapability" WHERE code = 'GROUPS_UI';
UPDATE "MessageThread" SET kind = 'GROUP', entityType = NULL, entityId = NULL,
  version = version + 1 WHERE entityType = 'GROUP';
UPDATE "SavedView" SET queryState = json_remove(queryState, '$.groupId'), version = version + 1
  WHERE module IN ('TASKS', 'FEED') AND json_valid(queryState)
  AND json_type(queryState, '$.groupId') IS NOT NULL;
UPDATE "UserUiPreference" SET valueJson = json_set(valueJson, '$.visible', json((
  SELECT json_group_array(value) FROM json_each(valueJson, '$.visible') WHERE value <> 'group'
))), version = version + 1
  WHERE module = 'TASKS' AND json_valid(valueJson)
  AND EXISTS (SELECT 1 FROM json_each(valueJson, '$.visible') WHERE value = 'group');

-- DropIndex
DROP INDEX "Group_companyId_key_key";

-- DropIndex
DROP INDEX "Group_ownerId_status_idx";

-- DropIndex
DROP INDEX "Group_companyId_discoverability_status_updatedAt_idx";

-- DropIndex
DROP INDEX "Group_workspaceId_companyId_status_idx";

-- DropIndex
DROP INDEX "GroupJoinRequest_decidedById_idx";

-- DropIndex
DROP INDEX "GroupJoinRequest_requesterId_status_idx";

-- DropIndex
DROP INDEX "GroupJoinRequest_groupId_status_createdAt_idx";

-- DropIndex
DROP INDEX "GroupJoinRequest_activeKey_key";

-- DropIndex
DROP INDEX "GroupMember_groupId_userId_key";

-- DropIndex
DROP INDEX "GroupMember_groupId_role_leftAt_idx";

-- DropIndex
DROP INDEX "GroupMember_userId_leftAt_idx";

-- DropTable
DROP TABLE "Group";

-- DropTable
DROP TABLE "GroupJoinRequest";

-- DropTable
DROP TABLE "GroupMember";

-- RedefineTables
CREATE TABLE "new_FeedFileShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL,
    "audienceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "FeedFileShare_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FeedFileShare" ("audienceKey", "audienceType", "companyId", "createdAt", "fileId", "id", "ownerId", "revokedAt", "status", "updatedAt", "version", "workspaceId") SELECT "audienceKey", "audienceType", "companyId", "createdAt", "fileId", "id", "ownerId", "revokedAt", "status", "updatedAt", "version", "workspaceId" FROM "FeedFileShare";
DROP TABLE "FeedFileShare";
ALTER TABLE "new_FeedFileShare" RENAME TO "FeedFileShare";
CREATE INDEX "FeedFileShare_workspaceId_companyId_status_createdAt_idx" ON "FeedFileShare"("workspaceId", "companyId", "status", "createdAt");
CREATE INDEX "FeedFileShare_fileId_status_createdAt_idx" ON "FeedFileShare"("fileId", "status", "createdAt");
CREATE INDEX "FeedFileShare_ownerId_status_createdAt_idx" ON "FeedFileShare"("ownerId", "status", "createdAt");
CREATE TABLE "new_FeedPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeedPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedPost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FeedPost" ("acknowledgementVersion", "archivedAt", "authorId", "body", "companyId", "createdAt", "editedAt", "id", "publishedAt", "requiresAcknowledgement", "status", "updatedAt", "version", "workspaceId") SELECT "acknowledgementVersion", "archivedAt", "authorId", "body", "companyId", "createdAt", "editedAt", "id", "publishedAt", "requiresAcknowledgement", "status", "updatedAt", "version", "workspaceId" FROM "FeedPost";
DROP TABLE "FeedPost";
ALTER TABLE "new_FeedPost" RENAME TO "FeedPost";
CREATE INDEX "FeedPost_workspaceId_companyId_status_publishedAt_id_idx" ON "FeedPost"("workspaceId", "companyId", "status", "publishedAt", "id");
CREATE INDEX "FeedPost_authorId_status_publishedAt_idx" ON "FeedPost"("authorId", "status", "publishedAt");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "parentTaskId" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "requiresAcceptance" BOOLEAN NOT NULL DEFAULT false,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "startsAt" DATETIME,
    "dueAt" DATETIME,
    "estimatedMinutes" INTEGER,
    "blockReason" TEXT,
    "completedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "recurrenceId" TEXT,
    "recurrenceOccurrenceAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "TaskRecurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("archivedAt", "blockReason", "companyId", "completedAt", "createdAt", "createdById", "description", "dueAt", "estimatedMinutes", "id", "number", "parentTaskId", "priority", "projectId", "recurrenceId", "recurrenceOccurrenceAt", "reporterId", "requiresAcceptance", "startsAt", "status", "title", "updatedAt", "version", "workspaceId") SELECT "archivedAt", "blockReason", "companyId", "completedAt", "createdAt", "createdById", "description", "dueAt", "estimatedMinutes", "id", "number", "parentTaskId", "priority", "projectId", "recurrenceId", "recurrenceOccurrenceAt", "reporterId", "requiresAcceptance", "startsAt", "status", "title", "updatedAt", "version", "workspaceId" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_number_key" ON "Task"("number");
CREATE INDEX "Task_companyId_status_dueAt_id_idx" ON "Task"("companyId", "status", "dueAt", "id");
CREATE INDEX "Task_projectId_status_dueAt_id_idx" ON "Task"("projectId", "status", "dueAt", "id");
CREATE INDEX "Task_parentTaskId_status_dueAt_id_idx" ON "Task"("parentTaskId", "status", "dueAt", "id");
CREATE INDEX "Task_reporterId_status_dueAt_idx" ON "Task"("reporterId", "status", "dueAt");
CREATE INDEX "Task_createdById_updatedAt_idx" ON "Task"("createdById", "updatedAt");
CREATE INDEX "Task_recurrenceId_recurrenceOccurrenceAt_idx" ON "Task"("recurrenceId", "recurrenceOccurrenceAt");
CREATE UNIQUE INDEX "Task_recurrenceId_recurrenceOccurrenceAt_key" ON "Task"("recurrenceId", "recurrenceOccurrenceAt");

DROP TABLE retired_group_items;
DROP TABLE retired_group_comments;
DROP TABLE retired_group_shares;
DROP TABLE retired_group_posts;
COMMIT;
PRAGMA foreign_keys=ON;

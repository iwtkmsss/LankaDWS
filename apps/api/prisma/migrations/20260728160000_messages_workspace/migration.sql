-- SQLite validates every existing trigger while a referenced table is rebuilt.
-- User is referenced by scope guards across the schema, so an additive column
-- is the safe coordinated-deploy path. The application backfill replaces the
-- copied display names with canonical NFKC values before the API starts.
ALTER TABLE "User"
ADD COLUMN "normalizedDisplayName" TEXT NOT NULL DEFAULT '';

UPDATE "User"
SET "normalizedDisplayName" = "displayName";

CREATE INDEX "User_workspaceId_status_normalizedUsername_id_idx"
ON "User"("workspaceId", "status", "normalizedUsername", "id");
CREATE INDEX "User_workspaceId_status_normalizedDisplayName_id_idx"
ON "User"("workspaceId", "status", "normalizedDisplayName", "id");
CREATE INDEX "UserCompanyAccess_companyId_status_userId_idx"
ON "UserCompanyAccess"("companyId", "status", "userId");
CREATE INDEX "MessageThread_workspaceId_companyId_lastMessageAt_createdAt_id_idx"
ON "MessageThread"("workspaceId", "companyId", "lastMessageAt", "createdAt", "id");
CREATE INDEX "Message_threadId_deletedAt_createdAt_id_idx"
ON "Message"("threadId", "deletedAt", "createdAt", "id");

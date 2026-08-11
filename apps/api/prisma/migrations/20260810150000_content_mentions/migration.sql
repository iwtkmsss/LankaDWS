-- CreateTable
CREATE TABLE "ContentMention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentMention_sourceType_sourceId_start_key" ON "ContentMention"("sourceType", "sourceId", "start");

-- CreateIndex
CREATE INDEX "ContentMention_workspaceId_sourceType_sourceId_start_idx" ON "ContentMention"("workspaceId", "sourceType", "sourceId", "start");

-- CreateIndex
CREATE INDEX "ContentMention_userId_createdAt_idx" ON "ContentMention"("userId", "createdAt");

CREATE TABLE "FeedbackTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "FeedbackTicket_workspaceId_status_createdAt_id_idx" ON "FeedbackTicket"("workspaceId", "status", "createdAt", "id");

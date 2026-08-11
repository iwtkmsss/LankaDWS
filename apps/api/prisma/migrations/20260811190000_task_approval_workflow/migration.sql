
PRAGMA foreign_keys = ON;

CREATE TABLE "TaskApprovalRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedTaskVersion" INTEGER NOT NULL,
    "resolutionTaskVersion" INTEGER,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decisionNote" TEXT,
    "decidedAt" DATETIME,
    "invalidatedAt" DATETIME,
    "invalidatedById" TEXT,
    CONSTRAINT "TaskApprovalRound_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskApprovalRound_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskApprovalRound_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskApprovalRound_invalidatedById_fkey" FOREIGN KEY ("invalidatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TaskApprovalRound_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'NEEDS_CHANGES', 'INVALIDATED')),
    CONSTRAINT "TaskApprovalRound_round_check" CHECK ("roundNumber" > 0),
    CONSTRAINT "TaskApprovalRound_version_check" CHECK ("requestedTaskVersion" > 0),
    CONSTRAINT "TaskApprovalRound_resolution_version_check" CHECK ("resolutionTaskVersion" IS NULL OR "resolutionTaskVersion" > 0)
);

CREATE UNIQUE INDEX "TaskApprovalRound_taskId_roundNumber_key" ON "TaskApprovalRound"("taskId", "roundNumber");
CREATE UNIQUE INDEX "TaskApprovalRound_one_pending_per_task" ON "TaskApprovalRound"("taskId") WHERE "status" = 'PENDING';
CREATE INDEX "TaskApprovalRound_taskId_status_requestedAt_idx" ON "TaskApprovalRound"("taskId", "status", "requestedAt");
CREATE INDEX "TaskApprovalRound_approverId_status_requestedAt_idx" ON "TaskApprovalRound"("approverId", "status", "requestedAt");
CREATE INDEX "TaskApprovalRound_requestedById_requestedAt_idx" ON "TaskApprovalRound"("requestedById", "requestedAt");

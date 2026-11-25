-- Calendar reads task deadlines by (workspaceId, dueAt range); without this
-- index SQLite scans the whole Task table (large after the Bitrix24 import).
-- CreateIndex
CREATE INDEX "Task_workspaceId_dueAt_idx" ON "Task"("workspaceId", "dueAt");

-- Replace Task(workspaceId, dueAt): without ANALYZE statistics SQLite preferred it
-- for every `workspaceId = ?` task query (task list, counters, overdue) and walked
-- all tasks. A plain dueAt index still serves calendar deadline ranges and leaves
-- the company/status indexes to the other queries.
-- DropIndex
DROP INDEX "Task_workspaceId_dueAt_idx";

-- CreateIndex
CREATE INDEX "Task_dueAt_idx" ON "Task"("dueAt");

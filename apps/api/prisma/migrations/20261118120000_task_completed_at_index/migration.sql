-- Dashboard "completed in the last 7 days" ranges over completedAt instead of
-- walking every DONE task of the company (large after the Bitrix24 import).
-- CreateIndex
CREATE INDEX "Task_companyId_status_completedAt_idx" ON "Task"("companyId", "status", "completedAt");

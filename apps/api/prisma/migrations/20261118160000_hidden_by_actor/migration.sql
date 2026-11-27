-- Who hid a record (decision 2026-11-18): lets the actor undo right away and
-- shows administrators who hid it. Additive nullable columns only.

ALTER TABLE "Task" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "Comment" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Message" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "FeedPost" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "KnowledgeArticle" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "KnowledgeArticle" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "FeedbackTicket" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "FeedbackTicket" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "Document" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "DriveFolder" ADD COLUMN "trashedById" TEXT;

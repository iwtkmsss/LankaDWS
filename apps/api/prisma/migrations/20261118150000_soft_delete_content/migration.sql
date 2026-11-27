-- Content is hidden, never deleted (decision 2026-11-18). Additive nullable
-- columns only: existing rows stay visible (NULL = not hidden).

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "Event" ADD COLUMN "deletedById" TEXT;

-- AlterTable
ALTER TABLE "TaskChecklistItem" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "TaskChecklistItem" ADD COLUMN "deletedById" TEXT;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "TimeEntry" ADD COLUMN "deletedById" TEXT;

-- AlterTable
ALTER TABLE "TaskRelation" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "TaskRelation" ADD COLUMN "deletedById" TEXT;

-- AlterTable
ALTER TABLE "FileLink" ADD COLUMN "removedAt" DATETIME;
ALTER TABLE "FileLink" ADD COLUMN "removedById" TEXT;

-- AlterTable
ALTER TABLE "DriveShare" ADD COLUMN "revokedAt" DATETIME;
ALTER TABLE "DriveShare" ADD COLUMN "revokedById" TEXT;

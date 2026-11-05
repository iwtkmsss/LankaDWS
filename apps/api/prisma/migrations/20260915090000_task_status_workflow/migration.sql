PRAGMA foreign_keys = OFF;

UPDATE "Task" SET "status" = 'NEW' WHERE "status" = 'PLANNED';
UPDATE "Task" SET "status" = 'IN_PROGRESS', "blockReason" = NULL WHERE "status" = 'BLOCKED';
UPDATE "Task" SET "status" = 'ARCHIVED', "archivedAt" = COALESCE("archivedAt", CURRENT_TIMESTAMP) WHERE "status" = 'CANCELLED';

ALTER TABLE "Task" ADD COLUMN "requiresAcceptance" BOOLEAN NOT NULL DEFAULT false;

PRAGMA foreign_keys = ON;

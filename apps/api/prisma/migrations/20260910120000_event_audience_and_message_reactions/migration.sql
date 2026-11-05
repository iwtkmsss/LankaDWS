-- Calendar events gain an optional free-text description.
ALTER TABLE "Event" ADD COLUMN "description" TEXT;

-- Calendar events become visible to an explicit set of companies instead of
-- only the single company that owns the row.
CREATE TABLE "EventAudience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    CONSTRAINT "EventAudience_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EventAudience_eventId_companyId_key" ON "EventAudience"("eventId", "companyId");
CREATE INDEX "EventAudience_companyId_idx" ON "EventAudience"("companyId");

-- Backfill: every existing event keeps exactly the reach it had before, namely
-- its owning company.
INSERT INTO "EventAudience" ("id", "eventId", "companyId")
SELECT 'evta_' || hex(randomblob(16)), "id", "companyId" FROM "Event";

-- Chat likes become reactions on the message instead of a separate 👍 reply.
CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LIKE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MessageReaction_messageId_userId_kind_key" ON "MessageReaction"("messageId", "userId", "kind");
CREATE INDEX "MessageReaction_messageId_createdAt_idx" ON "MessageReaction"("messageId", "createdAt");
CREATE INDEX "MessageReaction_userId_createdAt_idx" ON "MessageReaction"("userId", "createdAt");

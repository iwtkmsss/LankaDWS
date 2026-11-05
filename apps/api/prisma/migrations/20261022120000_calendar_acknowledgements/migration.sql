ALTER TABLE "Event" ADD COLUMN "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "EventAcknowledgement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventVersion" INTEGER NOT NULL,
  "acknowledgedAt" DATETIME,
  CONSTRAINT "EventAcknowledgement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EventAcknowledgement_eventId_userId_eventVersion_key" ON "EventAcknowledgement"("eventId", "userId", "eventVersion");
CREATE INDEX "EventAcknowledgement_eventId_eventVersion_acknowledgedAt_idx" ON "EventAcknowledgement"("eventId", "eventVersion", "acknowledgedAt");
CREATE INDEX "EventAcknowledgement_userId_eventId_idx" ON "EventAcknowledgement"("userId", "eventId");

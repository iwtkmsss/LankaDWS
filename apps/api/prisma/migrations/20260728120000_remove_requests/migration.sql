-- Remove the standalone requests/absence workflow and all of its materialized data.
-- AuditEvent is deliberately retained because it is append-only compliance history.

DELETE FROM "Event" WHERE "sourceRequestId" IS NOT NULL;
DELETE FROM "PresenceRecord" WHERE "sourceRequestId" IS NOT NULL;

DELETE FROM "Notification" WHERE "entityType" = 'REQUEST';
DELETE FROM "SavedView" WHERE "module" = 'REQUESTS';
DELETE FROM "OutboxEvent" WHERE "aggregateType" = 'REQUEST'
  OR "eventType" IN ('request.notify-approver', 'absence.calendar', 'absence.presence', 'absence.notifications');
DELETE FROM "BackgroundJob" WHERE "entityType" = 'REQUEST'
  OR "type" IN ('request.notify-approver', 'absence.calendar', 'absence.presence', 'absence.notifications');
DELETE FROM "FileLink" WHERE "entityType" = 'REQUEST';
DELETE FROM "Comment" WHERE "entityType" = 'REQUEST';
DELETE FROM "EntityLink" WHERE "sourceType" = 'REQUEST' OR "targetType" = 'REQUEST';
DELETE FROM "MessageThread" WHERE "entityType" = 'REQUEST';
DELETE FROM "SearchIndex" WHERE "entityType" = 'REQUEST';

DELETE FROM "RolePermission" WHERE "permissionCode" IN ('requests.read', 'requests.create', 'requests.approve');
DELETE FROM "Permission" WHERE "code" IN ('requests.read', 'requests.create', 'requests.approve');

DROP INDEX "Event_sourceRequestId_ownerId_key";
DROP INDEX "PresenceRecord_sourceRequestId_key";
ALTER TABLE "Event" DROP COLUMN "sourceRequestId";
ALTER TABLE "PresenceRecord" DROP COLUMN "sourceRequestId";

DROP TABLE "ApprovalEffect";
DROP TABLE "ApprovalAttempt";
DROP TABLE "RequestPrivateDetail";
DROP TABLE "RequestSnapshot";
DROP TABLE "Request";
DROP TABLE "RequestType";

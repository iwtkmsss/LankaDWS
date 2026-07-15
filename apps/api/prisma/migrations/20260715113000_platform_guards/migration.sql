-- FTS5 is isolated from Prisma models. Application jobs populate only permission-safe text.
CREATE VIRTUAL TABLE "SearchIndex" USING fts5(
  "entityType",
  "entityId" UNINDEXED,
  "workspaceId" UNINDEXED,
  "companyId" UNINDEXED,
  "title",
  "body",
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Audit is append-only at the database boundary. Approved archival exports records
-- before a restore/migration operation; ordinary application code cannot mutate it.
CREATE TRIGGER "AuditEvent_prevent_update"
BEFORE UPDATE ON "AuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'audit_event_is_append_only');
END;

CREATE TRIGGER "AuditEvent_prevent_delete"
BEFORE DELETE ON "AuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'audit_event_is_append_only');
END;

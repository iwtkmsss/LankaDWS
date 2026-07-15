# Rollback note

SQLite column removal requires a table rebuild. Keep `keyVersion` during application rollback; older code ignores it safely. A destructive table rebuild is not part of an incident rollback.

# Rollback note

Restore the pre-migration encrypted database snapshot. For a development-only reversal, drop the two audit triggers and the `SearchIndex` virtual table. Production rollback must use the restore runbook because append-only audit guarantees must not be weakened on a live database.

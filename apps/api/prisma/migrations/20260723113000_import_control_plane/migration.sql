CREATE TABLE "SourceCompanyMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceTenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sourceOrgUnitKey" TEXT NOT NULL,
    "targetCompanyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" DATETIME,
    CONSTRAINT "SourceCompanyMapping_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceCompanyMapping_targetCompanyId_fkey" FOREIGN KEY ("targetCompanyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceCompanyMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceCompanyMapping_version_check" CHECK ("version" > 0),
    CONSTRAINT "SourceCompanyMapping_source_check" CHECK (
        length(trim("sourceSystem")) > 0
        AND length(trim("sourceTenantId")) > 0
        AND length(trim("sourceOrgUnitKey")) > 0
    ),
    CONSTRAINT "SourceCompanyMapping_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    CONSTRAINT "SourceCompanyMapping_activation_check" CHECK (
        ("status" = 'DRAFT' AND "activatedAt" IS NULL)
        OR ("status" IN ('ACTIVE', 'RETIRED') AND "activatedAt" IS NOT NULL)
    )
);

CREATE INDEX "SourceCompanyMapping_workspaceId_sourceSystem_sourceTenantId_version_status_idx"
    ON "SourceCompanyMapping"("workspaceId", "sourceSystem", "sourceTenantId", "version", "status");
CREATE INDEX "SourceCompanyMapping_targetCompanyId_status_idx"
    ON "SourceCompanyMapping"("targetCompanyId", "status");
CREATE UNIQUE INDEX "SourceCompanyMapping_workspaceId_sourceSystem_sourceTenantId_version_sourceOrgUnitKey_key"
    ON "SourceCompanyMapping"("workspaceId", "sourceSystem", "sourceTenantId", "version", "sourceOrgUnitKey");

CREATE TABLE "ImportDataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceTenantId" TEXT NOT NULL,
    "sourceBuild" TEXT NOT NULL,
    "sourceSchemaFingerprint" TEXT NOT NULL,
    "companyMappingVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "parentDatasetId" TEXT,
    "sequence" INTEGER NOT NULL,
    "exportedAt" DATETIME NOT NULL,
    "watermarkFromJson" TEXT,
    "watermarkToJson" TEXT NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "encryptionKeyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INGESTING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" DATETIME,
    CONSTRAINT "ImportDataset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ImportDataset_parentDatasetId_fkey" FOREIGN KEY ("parentDatasetId") REFERENCES "ImportDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ImportDataset_kind_check" CHECK ("kind" IN ('SNAPSHOT', 'DELTA')),
    CONSTRAINT "ImportDataset_status_check" CHECK ("status" IN ('INGESTING', 'SEALED', 'INVALID')),
    CONSTRAINT "ImportDataset_versions_check" CHECK (
        "companyMappingVersion" > 0
        AND "sequence" >= 0
        AND "mappingVersion" > 0
        AND "schemaVersion" > 0
    ),
    CONSTRAINT "ImportDataset_source_check" CHECK (
        length(trim("sourceSystem")) > 0
        AND length(trim("sourceTenantId")) > 0
        AND length(trim("sourceBuild")) > 0
        AND length(trim("sourceSchemaFingerprint")) > 0
        AND length(trim("encryptionKeyId")) > 0
    ),
    CONSTRAINT "ImportDataset_manifest_hash_check" CHECK (
        length("manifestSha256") = 64
        AND "manifestSha256" NOT GLOB '*[^0-9A-Fa-f]*'
    ),
    CONSTRAINT "ImportDataset_watermarks_json_check" CHECK (
        json_valid("watermarkToJson")
        AND ("watermarkFromJson" IS NULL OR json_valid("watermarkFromJson"))
    ),
    CONSTRAINT "ImportDataset_chain_shape_check" CHECK (
        ("kind" = 'SNAPSHOT' AND "parentDatasetId" IS NULL AND "watermarkFromJson" IS NULL)
        OR ("kind" = 'DELTA' AND "parentDatasetId" IS NOT NULL AND "watermarkFromJson" IS NOT NULL)
    ),
    CONSTRAINT "ImportDataset_seal_shape_check" CHECK (
        ("status" = 'SEALED' AND "sealedAt" IS NOT NULL)
        OR ("status" <> 'SEALED' AND "sealedAt" IS NULL)
    )
);

CREATE INDEX "ImportDataset_workspaceId_sourceSystem_sourceTenantId_status_sequence_idx"
    ON "ImportDataset"("workspaceId", "sourceSystem", "sourceTenantId", "status", "sequence");
CREATE INDEX "ImportDataset_parentDatasetId_idx" ON "ImportDataset"("parentDatasetId");
CREATE INDEX "ImportDataset_companyMappingVersion_idx" ON "ImportDataset"("companyMappingVersion");
CREATE UNIQUE INDEX "ImportDataset_workspaceId_sourceSystem_sourceTenantId_sequence_key"
    ON "ImportDataset"("workspaceId", "sourceSystem", "sourceTenantId", "sequence");

CREATE TABLE "ImportFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "safeFilename" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "recordCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportFile_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ImportDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportFile_status_check" CHECK ("status" IN ('PENDING', 'VERIFIED', 'INVALID')),
    CONSTRAINT "ImportFile_size_check" CHECK ("bytes" >= 0 AND ("recordCount" IS NULL OR "recordCount" >= 0)),
    CONSTRAINT "ImportFile_source_check" CHECK (
        length(trim("sourceType")) > 0
        AND length(trim("safeFilename")) > 0
        AND instr("safeFilename", '/') = 0
        AND instr("safeFilename", char(92)) = 0
    ),
    CONSTRAINT "ImportFile_hash_check" CHECK (
        length("sha256") = 64
        AND "sha256" NOT GLOB '*[^0-9A-Fa-f]*'
    )
);

CREATE INDEX "ImportFile_datasetId_sourceType_status_idx" ON "ImportFile"("datasetId", "sourceType", "status");
CREATE UNIQUE INDEX "ImportFile_datasetId_safeFilename_key" ON "ImportFile"("datasetId", "safeFilename");

CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "checkpointJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "reconciliationStatus" TEXT NOT NULL DEFAULT 'NOT_RUN',
    "reconciledAt" DATETIME,
    "leaseOwner" TEXT,
    "leaseUntil" DATETIME,
    "heartbeatAt" DATETIME,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "countersJson" TEXT NOT NULL DEFAULT '{}',
    "safeErrorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ImportDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ImportRun_mode_check" CHECK ("mode" IN ('VALIDATE', 'DRY_RUN', 'APPLY')),
    CONSTRAINT "ImportRun_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    CONSTRAINT "ImportRun_reconciliation_check" CHECK (
        "reconciliationStatus" IN ('NOT_RUN', 'PASSED', 'FAILED')
        AND (
            ("reconciliationStatus" = 'NOT_RUN' AND "reconciledAt" IS NULL)
            OR ("reconciliationStatus" <> 'NOT_RUN' AND "reconciledAt" IS NOT NULL)
        )
    ),
    CONSTRAINT "ImportRun_json_check" CHECK (json_valid("checkpointJson") AND json_valid("countersJson")),
    CONSTRAINT "ImportRun_attempt_check" CHECK ("attempt" >= 0)
);

CREATE INDEX "ImportRun_datasetId_mode_status_createdAt_idx" ON "ImportRun"("datasetId", "mode", "status", "createdAt");
CREATE INDEX "ImportRun_status_leaseUntil_idx" ON "ImportRun"("status", "leaseUntil");

CREATE TABLE "ImportApplyLease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceTenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "leaseOwner" TEXT NOT NULL,
    "leaseUntil" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ImportApplyLease_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ImportApplyLease_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportApplyLease_shape_check" CHECK (
        length(trim("sourceSystem")) > 0
        AND length(trim("sourceTenantId")) > 0
        AND length(trim("leaseOwner")) > 0
        AND "version" > 0
    )
);

CREATE UNIQUE INDEX "ImportApplyLease_runId_key" ON "ImportApplyLease"("runId");
CREATE INDEX "ImportApplyLease_leaseUntil_idx" ON "ImportApplyLease"("leaseUntil");
CREATE UNIQUE INDEX "ImportApplyLease_workspaceId_sourceSystem_sourceTenantId_key"
    ON "ImportApplyLease"("workspaceId", "sourceSystem", "sourceTenantId");

CREATE TABLE "ImportIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "severity" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "safeDetailJson" TEXT NOT NULL DEFAULT '{}',
    "owner" TEXT,
    "resolvedAt" DATETIME,
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportIssue_severity_check" CHECK ("severity" IN ('WARNING', 'BLOCKING')),
    CONSTRAINT "ImportIssue_json_check" CHECK (json_valid("safeDetailJson")),
    CONSTRAINT "ImportIssue_resolution_check" CHECK (
        ("resolvedAt" IS NULL AND "resolution" IS NULL)
        OR ("resolvedAt" IS NOT NULL AND length(trim("resolution")) > 0)
    ),
    CONSTRAINT "ImportIssue_code_check" CHECK (length(trim("code")) > 0)
);

CREATE INDEX "ImportIssue_runId_severity_resolvedAt_createdAt_idx"
    ON "ImportIssue"("runId", "severity", "resolvedAt", "createdAt");
CREATE INDEX "ImportIssue_code_severity_idx" ON "ImportIssue"("code", "severity");

CREATE TABLE "ExternalIdMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceTenantId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "sourceRevision" TEXT,
    "sourceUpdatedAt" DATETIME,
    "sourceHash" TEXT NOT NULL,
    "lastAppliedTargetVersion" INTEGER,
    "lastAppliedTargetHash" TEXT,
    "lastAppliedRunId" TEXT,
    "lastSeenDatasetId" TEXT NOT NULL,
    "tombstonedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalIdMap_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExternalIdMap_lastAppliedRunId_fkey" FOREIGN KEY ("lastAppliedRunId") REFERENCES "ImportRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExternalIdMap_lastSeenDatasetId_fkey" FOREIGN KEY ("lastSeenDatasetId") REFERENCES "ImportDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExternalIdMap_source_check" CHECK (
        length(trim("sourceSystem")) > 0
        AND length(trim("sourceTenantId")) > 0
        AND length(trim("sourceType")) > 0
        AND length(trim("sourceId")) > 0
        AND length(trim("targetType")) > 0
        AND length(trim("targetId")) > 0
        AND length(trim("sourceHash")) > 0
    )
);

CREATE INDEX "ExternalIdMap_targetType_targetId_idx" ON "ExternalIdMap"("targetType", "targetId");
CREATE INDEX "ExternalIdMap_lastSeenDatasetId_idx" ON "ExternalIdMap"("lastSeenDatasetId");
CREATE INDEX "ExternalIdMap_lastAppliedRunId_idx" ON "ExternalIdMap"("lastAppliedRunId");
CREATE UNIQUE INDEX "ExternalIdMap_workspaceId_sourceSystem_sourceTenantId_sourceType_sourceId_key"
    ON "ExternalIdMap"("workspaceId", "sourceSystem", "sourceTenantId", "sourceType", "sourceId");

CREATE TABLE "ImportChangeJournal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "externalMapId" TEXT,
    "operation" TEXT NOT NULL,
    "beforeVersion" INTEGER,
    "afterVersion" INTEGER,
    "safeDiffJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportChangeJournal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportChangeJournal_externalMapId_fkey" FOREIGN KEY ("externalMapId") REFERENCES "ExternalIdMap" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ImportChangeJournal_operation_check" CHECK ("operation" IN ('CREATE', 'UPDATE', 'NOOP', 'TOMBSTONE', 'QUARANTINE')),
    CONSTRAINT "ImportChangeJournal_json_check" CHECK (json_valid("safeDiffJson"))
);

CREATE INDEX "ImportChangeJournal_runId_operation_createdAt_idx"
    ON "ImportChangeJournal"("runId", "operation", "createdAt");
CREATE INDEX "ImportChangeJournal_externalMapId_idx" ON "ImportChangeJournal"("externalMapId");

CREATE TABLE "ImportBinaryTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "expectedBytes" INTEGER NOT NULL,
    "transferredBytes" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT NOT NULL,
    "quarantineObjectKey" TEXT NOT NULL,
    "uploadStateJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "fileObjectId" TEXT,
    "documentVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportBinaryTransfer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportBinaryTransfer_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ImportDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ImportBinaryTransfer_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportFile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ImportBinaryTransfer_status_check" CHECK (
        "status" IN ('PENDING', 'UPLOADING', 'UPLOADED', 'SCANNING', 'CLEAN', 'PROMOTED', 'FAILED')
    ),
    CONSTRAINT "ImportBinaryTransfer_progress_check" CHECK (
        "expectedBytes" >= 0
        AND "transferredBytes" >= 0
        AND "transferredBytes" <= "expectedBytes"
        AND "attempt" >= 0
    ),
    CONSTRAINT "ImportBinaryTransfer_hash_check" CHECK (
        length("sha256") = 64
        AND "sha256" NOT GLOB '*[^0-9A-Fa-f]*'
    ),
    CONSTRAINT "ImportBinaryTransfer_json_check" CHECK ("uploadStateJson" IS NULL OR json_valid("uploadStateJson")),
    CONSTRAINT "ImportBinaryTransfer_promotion_check" CHECK (
        "status" <> 'PROMOTED' OR length(trim("fileObjectId")) > 0
    )
);

CREATE INDEX "ImportBinaryTransfer_runId_status_updatedAt_idx"
    ON "ImportBinaryTransfer"("runId", "status", "updatedAt");
CREATE INDEX "ImportBinaryTransfer_quarantineObjectKey_idx" ON "ImportBinaryTransfer"("quarantineObjectKey");
CREATE UNIQUE INDEX "ImportBinaryTransfer_datasetId_sourceFileId_key"
    ON "ImportBinaryTransfer"("datasetId", "sourceFileId");

CREATE TABLE "MigrationActivation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceTenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARING',
    "finalDatasetId" TEXT,
    "cutoverWatermarksJson" TEXT,
    "cutoverManifestSha256" TEXT,
    "signoffRef" TEXT,
    "feedCutoverAt" DATETIME,
    "preApplyBackupEvidenceRef" TEXT NOT NULL,
    "activationBaselineBackupEvidenceRef" TEXT,
    "preparedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" DATETIME,
    "activatedById" TEXT,
    "firstNativeWriteAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "MigrationActivation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MigrationActivation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MigrationActivation_finalDatasetId_fkey" FOREIGN KEY ("finalDatasetId") REFERENCES "ImportDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MigrationActivation_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MigrationActivation_status_check" CHECK (
        "status" IN ('PREPARING', 'READY', 'ACTIVE_PRE_WRITE', 'FORWARD_FIX_ONLY', 'ROLLED_BACK')
    ),
    CONSTRAINT "MigrationActivation_shape_check" CHECK (
        length(trim("sourceSystem")) > 0
        AND length(trim("sourceTenantId")) > 0
        AND length(trim("preApplyBackupEvidenceRef")) > 0
        AND "version" > 0
        AND ("cutoverWatermarksJson" IS NULL OR json_valid("cutoverWatermarksJson"))
    ),
    CONSTRAINT "MigrationActivation_ready_check" CHECK (
        "status" = 'PREPARING'
        OR (
            "finalDatasetId" IS NOT NULL
            AND "cutoverWatermarksJson" IS NOT NULL
            AND length(trim("cutoverManifestSha256")) = 64
            AND length(trim("signoffRef")) > 0
            AND length(trim("activationBaselineBackupEvidenceRef")) > 0
        )
    ),
    CONSTRAINT "MigrationActivation_active_check" CHECK (
        "status" NOT IN ('ACTIVE_PRE_WRITE', 'FORWARD_FIX_ONLY')
        OR ("activatedAt" IS NOT NULL AND "activatedById" IS NOT NULL)
    ),
    CONSTRAINT "MigrationActivation_forward_fix_check" CHECK (
        "status" <> 'FORWARD_FIX_ONLY' OR "firstNativeWriteAt" IS NOT NULL
    )
);

CREATE INDEX "MigrationActivation_workspaceId_status_idx" ON "MigrationActivation"("workspaceId", "status");
CREATE INDEX "MigrationActivation_finalDatasetId_idx" ON "MigrationActivation"("finalDatasetId");
CREATE INDEX "MigrationActivation_activatedById_idx" ON "MigrationActivation"("activatedById");
CREATE UNIQUE INDEX "MigrationActivation_companyId_sourceSystem_sourceTenantId_key"
    ON "MigrationActivation"("companyId", "sourceSystem", "sourceTenantId");

CREATE TRIGGER "SourceCompanyMapping_scope_guard_insert"
BEFORE INSERT ON "SourceCompanyMapping"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "Company" company
        JOIN "User" creator ON creator."id" = NEW."createdById" AND creator."workspaceId" = NEW."workspaceId"
        JOIN "UserCompanyAccess" access
          ON access."userId" = creator."id"
         AND access."companyId" = NEW."targetCompanyId"
         AND access."status" = 'ACTIVE'
        WHERE company."id" = NEW."targetCompanyId"
          AND company."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'source_company_mapping_scope_mismatch') END;
    SELECT CASE WHEN NEW."status" = 'ACTIVE' AND EXISTS (
        SELECT 1 FROM "SourceCompanyMapping" existing
        WHERE existing."workspaceId" = NEW."workspaceId"
          AND existing."sourceSystem" = NEW."sourceSystem"
          AND existing."sourceTenantId" = NEW."sourceTenantId"
          AND existing."status" = 'ACTIVE'
          AND existing."version" <> NEW."version"
    ) THEN RAISE(ABORT, 'source_company_mapping_active_version_conflict') END;
END;

CREATE TRIGGER "SourceCompanyMapping_scope_guard_update"
BEFORE UPDATE ON "SourceCompanyMapping"
BEGIN
    SELECT CASE WHEN OLD."status" IN ('ACTIVE', 'RETIRED') AND (
        NEW."workspaceId" IS NOT OLD."workspaceId"
        OR NEW."sourceSystem" IS NOT OLD."sourceSystem"
        OR NEW."sourceTenantId" IS NOT OLD."sourceTenantId"
        OR NEW."version" IS NOT OLD."version"
        OR NEW."sourceOrgUnitKey" IS NOT OLD."sourceOrgUnitKey"
        OR NEW."targetCompanyId" IS NOT OLD."targetCompanyId"
        OR NEW."createdById" IS NOT OLD."createdById"
        OR NEW."activatedAt" IS NOT OLD."activatedAt"
        OR (OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED')
        OR (OLD."status" = 'ACTIVE' AND NEW."status" NOT IN ('ACTIVE', 'RETIRED'))
    ) THEN RAISE(ABORT, 'source_company_mapping_immutable') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "Company" company
        JOIN "User" creator ON creator."id" = NEW."createdById" AND creator."workspaceId" = NEW."workspaceId"
        JOIN "UserCompanyAccess" access
          ON access."userId" = creator."id"
         AND access."companyId" = NEW."targetCompanyId"
         AND access."status" = 'ACTIVE'
        WHERE company."id" = NEW."targetCompanyId"
          AND company."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'source_company_mapping_scope_mismatch') END;
    SELECT CASE WHEN NEW."status" = 'ACTIVE' AND EXISTS (
        SELECT 1 FROM "SourceCompanyMapping" existing
        WHERE existing."workspaceId" = NEW."workspaceId"
          AND existing."sourceSystem" = NEW."sourceSystem"
          AND existing."sourceTenantId" = NEW."sourceTenantId"
          AND existing."status" = 'ACTIVE'
          AND existing."version" <> NEW."version"
          AND existing."id" <> NEW."id"
    ) THEN RAISE(ABORT, 'source_company_mapping_active_version_conflict') END;
END;

CREATE TRIGGER "ImportDataset_initial_state_guard"
BEFORE INSERT ON "ImportDataset"
WHEN NEW."status" <> 'INGESTING' OR NEW."sealedAt" IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'import_dataset_must_start_ingesting');
END;

CREATE TRIGGER "ImportDataset_chain_guard_insert"
BEFORE INSERT ON "ImportDataset"
WHEN NEW."kind" = 'DELTA'
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "ImportDataset" parent
        WHERE parent."id" = NEW."parentDatasetId"
          AND parent."status" = 'SEALED'
          AND parent."workspaceId" = NEW."workspaceId"
          AND parent."sourceSystem" = NEW."sourceSystem"
          AND parent."sourceTenantId" = NEW."sourceTenantId"
          AND parent."sequence" + 1 = NEW."sequence"
          AND parent."companyMappingVersion" = NEW."companyMappingVersion"
          AND parent."mappingVersion" = NEW."mappingVersion"
          AND parent."schemaVersion" = NEW."schemaVersion"
          AND parent."sourceSchemaFingerprint" = NEW."sourceSchemaFingerprint"
    ) THEN RAISE(ABORT, 'import_dataset_chain_mismatch') END;
END;

CREATE TRIGGER "ImportDataset_chain_guard_update"
BEFORE UPDATE ON "ImportDataset"
WHEN OLD."status" <> 'SEALED' AND NEW."kind" = 'DELTA'
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "ImportDataset" parent
        WHERE parent."id" = NEW."parentDatasetId"
          AND parent."status" = 'SEALED'
          AND parent."workspaceId" = NEW."workspaceId"
          AND parent."sourceSystem" = NEW."sourceSystem"
          AND parent."sourceTenantId" = NEW."sourceTenantId"
          AND parent."sequence" + 1 = NEW."sequence"
          AND parent."companyMappingVersion" = NEW."companyMappingVersion"
          AND parent."mappingVersion" = NEW."mappingVersion"
          AND parent."schemaVersion" = NEW."schemaVersion"
          AND parent."sourceSchemaFingerprint" = NEW."sourceSchemaFingerprint"
    ) THEN RAISE(ABORT, 'import_dataset_chain_mismatch') END;
END;

CREATE TRIGGER "ImportDataset_seal_guard"
BEFORE UPDATE OF "status" ON "ImportDataset"
WHEN OLD."status" <> 'SEALED' AND NEW."status" = 'SEALED'
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "ImportFile" file
        WHERE file."datasetId" = NEW."id"
    ) THEN RAISE(ABORT, 'import_dataset_has_no_files') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM "ImportFile" file
        WHERE file."datasetId" = NEW."id" AND file."status" <> 'VERIFIED'
    ) THEN RAISE(ABORT, 'import_dataset_has_unverified_files') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "SourceCompanyMapping" mapping
        WHERE mapping."workspaceId" = NEW."workspaceId"
          AND mapping."sourceSystem" = NEW."sourceSystem"
          AND mapping."sourceTenantId" = NEW."sourceTenantId"
          AND mapping."version" = NEW."companyMappingVersion"
          AND mapping."status" = 'ACTIVE'
    ) THEN RAISE(ABORT, 'import_dataset_mapping_not_active') END;
END;

CREATE TRIGGER "ImportDataset_sealed_immutable_update"
BEFORE UPDATE ON "ImportDataset"
WHEN OLD."status" = 'SEALED'
BEGIN
    SELECT RAISE(ABORT, 'import_dataset_sealed_immutable');
END;

CREATE TRIGGER "ImportDataset_sealed_immutable_delete"
BEFORE DELETE ON "ImportDataset"
WHEN OLD."status" = 'SEALED'
BEGIN
    SELECT RAISE(ABORT, 'import_dataset_sealed_immutable');
END;

CREATE TRIGGER "ImportFile_sealed_guard_insert"
BEFORE INSERT ON "ImportFile"
WHEN EXISTS (SELECT 1 FROM "ImportDataset" dataset WHERE dataset."id" = NEW."datasetId" AND dataset."status" = 'SEALED')
BEGIN
    SELECT RAISE(ABORT, 'import_dataset_sealed_immutable');
END;

CREATE TRIGGER "ImportFile_sealed_guard_update"
BEFORE UPDATE ON "ImportFile"
WHEN EXISTS (
    SELECT 1 FROM "ImportDataset" dataset
    WHERE dataset."id" IN (OLD."datasetId", NEW."datasetId") AND dataset."status" = 'SEALED'
)
BEGIN
    SELECT RAISE(ABORT, 'import_dataset_sealed_immutable');
END;

CREATE TRIGGER "ImportFile_sealed_guard_delete"
BEFORE DELETE ON "ImportFile"
WHEN EXISTS (SELECT 1 FROM "ImportDataset" dataset WHERE dataset."id" = OLD."datasetId" AND dataset."status" = 'SEALED')
BEGIN
    SELECT RAISE(ABORT, 'import_dataset_sealed_immutable');
END;

CREATE TRIGGER "ImportRun_initial_state_guard"
BEFORE INSERT ON "ImportRun"
WHEN NEW."status" <> 'QUEUED' OR NEW."reconciliationStatus" <> 'NOT_RUN' OR NEW."reconciledAt" IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'import_run_must_start_queued');
END;

CREATE TRIGGER "ImportRun_dataset_guard_insert"
BEFORE INSERT ON "ImportRun"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "ImportDataset" dataset
        WHERE dataset."id" = NEW."datasetId" AND dataset."status" = 'SEALED'
    ) THEN RAISE(ABORT, 'import_run_requires_sealed_dataset') END;
END;

CREATE TRIGGER "ImportRun_apply_start_guard"
BEFORE UPDATE OF "status" ON "ImportRun"
WHEN NEW."mode" = 'APPLY' AND OLD."status" <> 'RUNNING' AND NEW."status" = 'RUNNING'
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "ImportApplyLease" lease
        WHERE lease."runId" = NEW."id"
          AND lease."leaseUntil" > CURRENT_TIMESTAMP
    ) THEN RAISE(ABORT, 'import_apply_lease_required') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM "ImportIssue" issue
        WHERE issue."runId" = NEW."id"
          AND issue."severity" = 'BLOCKING'
          AND issue."resolvedAt" IS NULL
    ) THEN RAISE(ABORT, 'import_apply_has_blocking_issues') END;
END;

CREATE TRIGGER "ImportRun_reconciliation_guard"
BEFORE UPDATE OF "reconciliationStatus" ON "ImportRun"
WHEN NEW."reconciliationStatus" = 'PASSED'
BEGIN
    SELECT CASE WHEN NEW."status" <> 'SUCCEEDED' THEN RAISE(ABORT, 'import_reconciliation_requires_success') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM "ImportIssue" issue
        WHERE issue."runId" = NEW."id"
          AND issue."severity" = 'BLOCKING'
          AND issue."resolvedAt" IS NULL
    ) THEN RAISE(ABORT, 'import_reconciliation_has_blocking_issues') END;
END;

CREATE TRIGGER "ImportApplyLease_scope_guard_insert"
BEFORE INSERT ON "ImportApplyLease"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "ImportRun" run
        JOIN "ImportDataset" dataset ON dataset."id" = run."datasetId"
        WHERE run."id" = NEW."runId"
          AND run."mode" = 'APPLY'
          AND dataset."workspaceId" = NEW."workspaceId"
          AND dataset."sourceSystem" = NEW."sourceSystem"
          AND dataset."sourceTenantId" = NEW."sourceTenantId"
    ) THEN RAISE(ABORT, 'import_apply_lease_scope_mismatch') END;
END;

CREATE TRIGGER "ImportApplyLease_scope_guard_update"
BEFORE UPDATE ON "ImportApplyLease"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "ImportRun" run
        JOIN "ImportDataset" dataset ON dataset."id" = run."datasetId"
        WHERE run."id" = NEW."runId"
          AND run."mode" = 'APPLY'
          AND dataset."workspaceId" = NEW."workspaceId"
          AND dataset."sourceSystem" = NEW."sourceSystem"
          AND dataset."sourceTenantId" = NEW."sourceTenantId"
    ) THEN RAISE(ABORT, 'import_apply_lease_scope_mismatch') END;
END;

CREATE TRIGGER "ExternalIdMap_scope_guard_insert"
BEFORE INSERT ON "ExternalIdMap"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "ImportDataset" dataset
        WHERE dataset."id" = NEW."lastSeenDatasetId"
          AND dataset."workspaceId" = NEW."workspaceId"
          AND dataset."sourceSystem" = NEW."sourceSystem"
          AND dataset."sourceTenantId" = NEW."sourceTenantId"
    ) THEN RAISE(ABORT, 'external_id_map_dataset_scope_mismatch') END;
    SELECT CASE WHEN NEW."lastAppliedRunId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "ImportRun" run
        JOIN "ImportDataset" dataset ON dataset."id" = run."datasetId"
        WHERE run."id" = NEW."lastAppliedRunId"
          AND dataset."workspaceId" = NEW."workspaceId"
          AND dataset."sourceSystem" = NEW."sourceSystem"
          AND dataset."sourceTenantId" = NEW."sourceTenantId"
    ) THEN RAISE(ABORT, 'external_id_map_run_scope_mismatch') END;
END;

CREATE TRIGGER "ExternalIdMap_scope_guard_update"
BEFORE UPDATE ON "ExternalIdMap"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "ImportDataset" dataset
        WHERE dataset."id" = NEW."lastSeenDatasetId"
          AND dataset."workspaceId" = NEW."workspaceId"
          AND dataset."sourceSystem" = NEW."sourceSystem"
          AND dataset."sourceTenantId" = NEW."sourceTenantId"
    ) THEN RAISE(ABORT, 'external_id_map_dataset_scope_mismatch') END;
    SELECT CASE WHEN NEW."lastAppliedRunId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "ImportRun" run
        JOIN "ImportDataset" dataset ON dataset."id" = run."datasetId"
        WHERE run."id" = NEW."lastAppliedRunId"
          AND dataset."workspaceId" = NEW."workspaceId"
          AND dataset."sourceSystem" = NEW."sourceSystem"
          AND dataset."sourceTenantId" = NEW."sourceTenantId"
    ) THEN RAISE(ABORT, 'external_id_map_run_scope_mismatch') END;
END;

CREATE TRIGGER "ExternalIdMap_preserve_delete"
BEFORE DELETE ON "ExternalIdMap"
BEGIN
    SELECT RAISE(ABORT, 'external_id_map_is_preserved');
END;

CREATE TRIGGER "ImportChangeJournal_scope_guard_insert"
BEFORE INSERT ON "ImportChangeJournal"
WHEN NEW."externalMapId" IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "ImportRun" run
        JOIN "ImportDataset" dataset ON dataset."id" = run."datasetId"
        JOIN "ExternalIdMap" mapping
          ON mapping."id" = NEW."externalMapId"
         AND mapping."workspaceId" = dataset."workspaceId"
         AND mapping."sourceSystem" = dataset."sourceSystem"
         AND mapping."sourceTenantId" = dataset."sourceTenantId"
        WHERE run."id" = NEW."runId"
    ) THEN RAISE(ABORT, 'import_change_journal_scope_mismatch') END;
END;

CREATE TRIGGER "ImportChangeJournal_append_only_update"
BEFORE UPDATE ON "ImportChangeJournal"
BEGIN
    SELECT RAISE(ABORT, 'import_change_journal_append_only');
END;

CREATE TRIGGER "ImportChangeJournal_append_only_delete"
BEFORE DELETE ON "ImportChangeJournal"
BEGIN
    SELECT RAISE(ABORT, 'import_change_journal_append_only');
END;

CREATE TRIGGER "ImportBinaryTransfer_scope_guard_insert"
BEFORE INSERT ON "ImportBinaryTransfer"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "ImportRun" run
        JOIN "ImportFile" file ON file."id" = NEW."sourceFileId"
        WHERE run."id" = NEW."runId"
          AND run."datasetId" = NEW."datasetId"
          AND file."datasetId" = NEW."datasetId"
    ) THEN RAISE(ABORT, 'import_binary_transfer_scope_mismatch') END;
END;

CREATE TRIGGER "ImportBinaryTransfer_scope_guard_update"
BEFORE UPDATE OF "runId", "datasetId", "sourceFileId" ON "ImportBinaryTransfer"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "ImportRun" run
        JOIN "ImportFile" file ON file."id" = NEW."sourceFileId"
        WHERE run."id" = NEW."runId"
          AND run."datasetId" = NEW."datasetId"
          AND file."datasetId" = NEW."datasetId"
    ) THEN RAISE(ABORT, 'import_binary_transfer_scope_mismatch') END;
END;

CREATE TRIGGER "MigrationActivation_scope_guard_insert"
BEFORE INSERT ON "MigrationActivation"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "Company" company
        WHERE company."id" = NEW."companyId" AND company."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'migration_activation_company_scope_mismatch') END;
    SELECT CASE WHEN NEW."finalDatasetId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "ImportDataset" dataset
        WHERE dataset."id" = NEW."finalDatasetId"
          AND dataset."workspaceId" = NEW."workspaceId"
          AND dataset."sourceSystem" = NEW."sourceSystem"
          AND dataset."sourceTenantId" = NEW."sourceTenantId"
          AND dataset."status" = 'SEALED'
    ) THEN RAISE(ABORT, 'migration_activation_dataset_scope_mismatch') END;
    SELECT CASE WHEN NEW."activatedById" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "User" actor
        JOIN "UserCompanyAccess" access
          ON access."userId" = actor."id"
         AND access."companyId" = NEW."companyId"
         AND access."status" = 'ACTIVE'
        WHERE actor."id" = NEW."activatedById" AND actor."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'migration_activation_actor_scope_mismatch') END;
END;

CREATE TRIGGER "MigrationActivation_scope_guard_update"
BEFORE UPDATE ON "MigrationActivation"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "Company" company
        WHERE company."id" = NEW."companyId" AND company."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'migration_activation_company_scope_mismatch') END;
    SELECT CASE WHEN NEW."finalDatasetId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "ImportDataset" dataset
        WHERE dataset."id" = NEW."finalDatasetId"
          AND dataset."workspaceId" = NEW."workspaceId"
          AND dataset."sourceSystem" = NEW."sourceSystem"
          AND dataset."sourceTenantId" = NEW."sourceTenantId"
          AND dataset."status" = 'SEALED'
    ) THEN RAISE(ABORT, 'migration_activation_dataset_scope_mismatch') END;
    SELECT CASE WHEN NEW."activatedById" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "User" actor
        JOIN "UserCompanyAccess" access
          ON access."userId" = actor."id"
         AND access."companyId" = NEW."companyId"
         AND access."status" = 'ACTIVE'
        WHERE actor."id" = NEW."activatedById" AND actor."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'migration_activation_actor_scope_mismatch') END;
END;

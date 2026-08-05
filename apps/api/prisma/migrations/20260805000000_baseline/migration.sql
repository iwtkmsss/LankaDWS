-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "defaultTimezone" TEXT NOT NULL DEFAULT 'Europe/Kyiv',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Kyiv',
    "locale" TEXT NOT NULL DEFAULT 'uk-UA',
    "workingDaysJson" TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
    "holidayJson" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Company_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "primaryCompanyId" TEXT,
    "accountType" TEXT NOT NULL DEFAULT 'USER',
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "middleName" TEXT,
    "phone" TEXT,
    "displayName" TEXT NOT NULL,
    "normalizedDisplayName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "normalizedUsername" TEXT NOT NULL,
    "contactEmail" TEXT,
    "jobTitle" TEXT NOT NULL DEFAULT '',
    "approverId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Kyiv',
    "locale" TEXT NOT NULL DEFAULT 'uk-UA',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustEnroll2FA" BOOLEAN NOT NULL DEFAULT false,
    "authorizationVersion" INTEGER NOT NULL DEFAULT 1,
    "avatarAsset" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_primaryCompanyId_fkey" FOREIGN KEY ("primaryCompanyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UsernameReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "normalizedUsername" TEXT NOT NULL,
    "currentUserId" TEXT,
    "previousUserId" TEXT,
    "state" TEXT NOT NULL,
    "reservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CompanyCapability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledById" TEXT,
    "enabledAt" DATETIME,
    "disabledAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanyCapability_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompanyCapability_enabledById_fkey" FOREIGN KEY ("enabledById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discoverability" TEXT NOT NULL DEFAULT 'LISTED',
    "joinPolicy" TEXT NOT NULL DEFAULT 'REQUEST',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME,
    CONSTRAINT "Group_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Group_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Group_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "notificationMode" TEXT NOT NULL DEFAULT 'ALL',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    "lastSeenAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupJoinRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "activeKey" TEXT,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "GroupJoinRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupJoinRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupJoinRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgementVersion" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeedPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedPost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedPost_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedPostRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedPostRecipient_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedAcknowledgementRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acknowledgementVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedAcknowledgementRecipient_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedAcknowledgementRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedPostAcknowledgement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acknowledgementVersion" INTEGER NOT NULL,
    "acknowledgedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedPostAcknowledgement_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedPostAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "postId" TEXT,
    "fileShareId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "actorId" TEXT,
    "visibility" TEXT NOT NULL,
    "safePayload" TEXT NOT NULL,
    "countsAsUnread" BOOLEAN NOT NULL DEFAULT true,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedItem_fileShareId_fkey" FOREIGN KEY ("fileShareId") REFERENCES "FeedFileShare" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedItem_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedSourceHead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "countsAsUnread" BOOLEAN NOT NULL DEFAULT true,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeedSourceHead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedSourceHead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedSourceHead_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FeedItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedFileShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL,
    "audienceKey" TEXT NOT NULL,
    "groupId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "FeedFileShare_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShare_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedFileShareRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedFileShareRecipient_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "FeedFileShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedFileShareRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedUserItemState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "feedItemId" TEXT NOT NULL,
    "favoritedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeedUserItemState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedUserItemState_feedItemId_fkey" FOREIGN KEY ("feedItemId") REFERENCES "FeedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedItemRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedItemRecipient_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FeedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedItemRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedReadCursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lastReadOccurredAt" DATETIME NOT NULL,
    "lastReadItemId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeedReadCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedReadCursor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedReaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LIKE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ALL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeedSubscription_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedMention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "commentId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedMention_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrgUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceKey" TEXT,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "managerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrgUnit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrgUnit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrgUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgUnit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrgUnit_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserOrgAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "positionTitle" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserOrgAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserOrgAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserOrgAssignment_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "SourceCompanyMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "ImportDataset_parentDatasetId_fkey" FOREIGN KEY ("parentDatasetId") REFERENCES "ImportDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "ImportFile_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ImportDataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "ImportRun_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ImportDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "ImportApplyLease_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "ImportIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ImportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "ExternalIdMap_lastSeenDatasetId_fkey" FOREIGN KEY ("lastSeenDatasetId") REFERENCES "ImportDataset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "ImportChangeJournal_externalMapId_fkey" FOREIGN KEY ("externalMapId") REFERENCES "ExternalIdMap" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "ImportBinaryTransfer_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportFile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "MigrationActivation_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL DEFAULT 'argon2id-v1',
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "compromisedAt" DATETIME,
    CONSTRAINT "PasswordCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemporaryCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "invalidatedAt" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TotpCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" DATETIME,
    "disabledAt" DATETIME,
    CONSTRAINT "TotpCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" DATETIME,
    CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authAssurance" INTEGER NOT NULL DEFAULT 1,
    "authorizationVersion" INTEGER NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "deviceLabel" TEXT NOT NULL,
    "userAgentHash" TEXT,
    "ipHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "revokeReason" TEXT,
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usernameFingerprint" TEXT NOT NULL,
    "resolvedUserId" TEXT,
    "ipHash" TEXT,
    "result" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CredentialEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reasonCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CredentialResetApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "approverId" TEXT,
    "resetType" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReauthChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "assurance" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "satisfiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT,
    "projectId" TEXT,
    "parentTaskId" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "startsAt" DATETIME,
    "dueAt" DATETIME,
    "estimatedMinutes" INTEGER,
    "blockReason" TEXT,
    "completedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "recurrenceId" TEXT,
    "recurrenceOccurrenceAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "TaskRecurrence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "removedAt" DATETIME,
    CONSTRAINT "TaskParticipant_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskParticipant_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskFollower" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mutedAt" DATETIME,
    CONSTRAINT "TaskFollower_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskUserState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "favoritedAt" DATETIME,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskUserState_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskUserState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "triggerType" TEXT NOT NULL,
    "remindAt" DATETIME,
    "offsetMinutes" INTEGER,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sentAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskReminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskChecklistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "completedById" TEXT,
    "completedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Tag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskTag" (
    "taskId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("taskId", "tagId"),
    CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceTaskId" TEXT NOT NULL,
    "targetTaskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskRelation_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskRelation_targetTaskId_fkey" FOREIGN KEY ("targetTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskRelation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskRecurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateTaskId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "interval" INTEGER NOT NULL,
    "daysOfWeekJson" TEXT,
    "dayOfMonth" INTEGER,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "maxOccurrences" INTEGER,
    "generatedOccurrences" INTEGER NOT NULL DEFAULT 1,
    "nextRunAt" DATETIME,
    "timezone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskRecurrence_templateTaskId_fkey" FOREIGN KEY ("templateTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "durationSeconds" INTEGER,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntityLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "sourceTimezone" TEXT NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PresenceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC_SAFE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LifecycleProcess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "processType" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LifecycleStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "linkedTaskId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "blocker" TEXT,
    CONSTRAINT "LifecycleStep_processId_fkey" FOREIGN KEY ("processId") REFERENCES "LifecycleProcess" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT,
    "storageKey" TEXT NOT NULL,
    "safeFilename" TEXT NOT NULL,
    "declaredMime" TEXT NOT NULL,
    "detectedMime" TEXT,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'QUARANTINED',
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FileLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "aclMode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidentiality" TEXT NOT NULL DEFAULT 'INTERNAL',
    "currentVersionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentAcl" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "actionsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentVersionId" TEXT,
    "reviewAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "KnowledgeArticleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "publishedAt" DATETIME,
    CONSTRAINT "KnowledgeArticleVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArticleAudience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Acknowledgement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "openedAt" DATETIME,
    "confirmedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "publishAt" DATETIME,
    "expiresAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AnnouncementAudienceCompany" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "announcementId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    CONSTRAINT "AnnouncementAudienceCompany_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnnouncementAudienceUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "AnnouncementAudienceUser_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnnouncementReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deliveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME,
    "dismissedAt" DATETIME,
    "effectiveContentVersion" INTEGER NOT NULL,
    CONSTRAINT "AnnouncementReceipt_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "safeTitle" TEXT NOT NULL,
    "safeSnippet" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "requiresAction" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    "deliveredAt" DATETIME,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "digest" TEXT NOT NULL DEFAULT 'IMMEDIATE',
    "quietJson" TEXT NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "directKey" TEXT,
    "createdById" TEXT,
    "lastMessageAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ThreadParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "notificationMode" TEXT NOT NULL DEFAULT 'ALL',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    "lastReadMessageId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ThreadParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "replyToId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "replyToCommentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "queryState" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "safeDiffJson" TEXT NOT NULL DEFAULT '{}',
    "reasonCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateVersion" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "safePayload" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "safePayload" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseUntil" DATETIME,
    "lastErrorCode" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveAt" DATETIME NOT NULL,
    "changedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "placedBy" TEXT NOT NULL,
    "placedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedBy" TEXT,
    "releasedAt" DATETIME,
    "status" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "resultType" TEXT,
    "resultId" TEXT,
    "responseStatus" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");

-- CreateIndex
CREATE INDEX "Company_workspaceId_isActive_idx" ON "Company"("workspaceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Company_workspaceId_code_key" ON "Company"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "User_workspaceId_isActive_idx" ON "User"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "User_workspaceId_isActive_normalizedUsername_id_idx" ON "User"("workspaceId", "isActive", "normalizedUsername", "id");

-- CreateIndex
CREATE INDEX "User_workspaceId_isActive_normalizedDisplayName_id_idx" ON "User"("workspaceId", "isActive", "normalizedDisplayName", "id");

-- CreateIndex
CREATE INDEX "User_primaryCompanyId_isActive_idx" ON "User"("primaryCompanyId", "isActive");

-- CreateIndex
CREATE INDEX "User_approverId_idx" ON "User"("approverId");

-- CreateIndex
CREATE UNIQUE INDEX "User_workspaceId_normalizedUsername_key" ON "User"("workspaceId", "normalizedUsername");

-- CreateIndex
CREATE UNIQUE INDEX "UsernameReservation_workspaceId_normalizedUsername_key" ON "UsernameReservation"("workspaceId", "normalizedUsername");

-- CreateIndex
CREATE INDEX "CompanyCapability_code_enabled_companyId_idx" ON "CompanyCapability"("code", "enabled", "companyId");

-- CreateIndex
CREATE INDEX "CompanyCapability_enabledById_idx" ON "CompanyCapability"("enabledById");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCapability_companyId_code_key" ON "CompanyCapability"("companyId", "code");

-- CreateIndex
CREATE INDEX "Group_workspaceId_companyId_status_idx" ON "Group"("workspaceId", "companyId", "status");

-- CreateIndex
CREATE INDEX "Group_companyId_discoverability_status_updatedAt_idx" ON "Group"("companyId", "discoverability", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Group_ownerId_status_idx" ON "Group"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Group_companyId_key_key" ON "Group"("companyId", "key");

-- CreateIndex
CREATE INDEX "GroupMember_userId_leftAt_idx" ON "GroupMember"("userId", "leftAt");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_role_leftAt_idx" ON "GroupMember"("groupId", "role", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupJoinRequest_activeKey_key" ON "GroupJoinRequest"("activeKey");

-- CreateIndex
CREATE INDEX "GroupJoinRequest_groupId_status_createdAt_idx" ON "GroupJoinRequest"("groupId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GroupJoinRequest_requesterId_status_idx" ON "GroupJoinRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "GroupJoinRequest_decidedById_idx" ON "GroupJoinRequest"("decidedById");

-- CreateIndex
CREATE INDEX "FeedPost_workspaceId_companyId_status_publishedAt_id_idx" ON "FeedPost"("workspaceId", "companyId", "status", "publishedAt", "id");

-- CreateIndex
CREATE INDEX "FeedPost_authorId_status_publishedAt_idx" ON "FeedPost"("authorId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "FeedPost_groupId_status_publishedAt_idx" ON "FeedPost"("groupId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "FeedPostRecipient_type_recipientId_postId_idx" ON "FeedPostRecipient"("type", "recipientId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedPostRecipient_postId_type_recipientId_key" ON "FeedPostRecipient"("postId", "type", "recipientId");

-- CreateIndex
CREATE INDEX "FeedAcknowledgementRecipient_userId_acknowledgementVersion_postId_idx" ON "FeedAcknowledgementRecipient"("userId", "acknowledgementVersion", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedAcknowledgementRecipient_postId_userId_acknowledgementVersion_key" ON "FeedAcknowledgementRecipient"("postId", "userId", "acknowledgementVersion");

-- CreateIndex
CREATE INDEX "FeedPostAcknowledgement_userId_acknowledgedAt_idx" ON "FeedPostAcknowledgement"("userId", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedPostAcknowledgement_postId_userId_acknowledgementVersion_key" ON "FeedPostAcknowledgement"("postId", "userId", "acknowledgementVersion");

-- CreateIndex
CREATE UNIQUE INDEX "FeedItem_eventKey_key" ON "FeedItem"("eventKey");

-- CreateIndex
CREATE INDEX "FeedItem_workspaceId_companyId_occurredAt_id_idx" ON "FeedItem"("workspaceId", "companyId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "FeedItem_postId_sourceVersion_idx" ON "FeedItem"("postId", "sourceVersion");

-- CreateIndex
CREATE INDEX "FeedItem_fileShareId_sourceVersion_idx" ON "FeedItem"("fileShareId", "sourceVersion");

-- CreateIndex
CREATE INDEX "FeedItem_sourceType_sourceId_sourceVersion_idx" ON "FeedItem"("sourceType", "sourceId", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "FeedSourceHead_itemId_key" ON "FeedSourceHead"("itemId");

-- CreateIndex
CREATE INDEX "FeedSourceHead_workspaceId_companyId_occurredAt_itemId_idx" ON "FeedSourceHead"("workspaceId", "companyId", "occurredAt", "itemId");

-- CreateIndex
CREATE INDEX "FeedSourceHead_workspaceId_companyId_countsAsUnread_occurredAt_itemId_idx" ON "FeedSourceHead"("workspaceId", "companyId", "countsAsUnread", "occurredAt", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedSourceHead_workspaceId_companyId_sourceType_sourceId_key" ON "FeedSourceHead"("workspaceId", "companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "FeedFileShare_workspaceId_companyId_status_createdAt_idx" ON "FeedFileShare"("workspaceId", "companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedFileShare_fileId_status_createdAt_idx" ON "FeedFileShare"("fileId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedFileShare_ownerId_status_createdAt_idx" ON "FeedFileShare"("ownerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedFileShare_groupId_status_idx" ON "FeedFileShare"("groupId", "status");

-- CreateIndex
CREATE INDEX "FeedFileShareRecipient_userId_shareId_idx" ON "FeedFileShareRecipient"("userId", "shareId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedFileShareRecipient_shareId_userId_key" ON "FeedFileShareRecipient"("shareId", "userId");

-- CreateIndex
CREATE INDEX "FeedUserItemState_userId_favoritedAt_idx" ON "FeedUserItemState"("userId", "favoritedAt");

-- CreateIndex
CREATE INDEX "FeedUserItemState_feedItemId_idx" ON "FeedUserItemState"("feedItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedUserItemState_userId_feedItemId_key" ON "FeedUserItemState"("userId", "feedItemId");

-- CreateIndex
CREATE INDEX "FeedItemRecipient_userId_itemId_idx" ON "FeedItemRecipient"("userId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedItemRecipient_itemId_userId_key" ON "FeedItemRecipient"("itemId", "userId");

-- CreateIndex
CREATE INDEX "FeedReadCursor_companyId_lastReadOccurredAt_lastReadItemId_idx" ON "FeedReadCursor"("companyId", "lastReadOccurredAt", "lastReadItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedReadCursor_userId_companyId_key" ON "FeedReadCursor"("userId", "companyId");

-- CreateIndex
CREATE INDEX "FeedReaction_userId_createdAt_idx" ON "FeedReaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedReaction_postId_userId_kind_key" ON "FeedReaction"("postId", "userId", "kind");

-- CreateIndex
CREATE INDEX "FeedSubscription_userId_mode_idx" ON "FeedSubscription"("userId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "FeedSubscription_postId_userId_key" ON "FeedSubscription"("postId", "userId");

-- CreateIndex
CREATE INDEX "FeedMention_userId_createdAt_idx" ON "FeedMention"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedMention_postId_commentId_userId_key" ON "FeedMention"("postId", "commentId", "userId");

-- CreateIndex
CREATE INDEX "OrgUnit_companyId_parentId_status_sortOrder_idx" ON "OrgUnit"("companyId", "parentId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "OrgUnit_companyId_normalizedName_status_idx" ON "OrgUnit"("companyId", "normalizedName", "status");

-- CreateIndex
CREATE INDEX "OrgUnit_managerId_idx" ON "OrgUnit"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUnit_companyId_sourceKey_key" ON "OrgUnit"("companyId", "sourceKey");

-- CreateIndex
CREATE INDEX "UserOrgAssignment_orgUnitId_endedAt_isPrimary_idx" ON "UserOrgAssignment"("orgUnitId", "endedAt", "isPrimary");

-- CreateIndex
CREATE INDEX "UserOrgAssignment_companyId_userId_endedAt_idx" ON "UserOrgAssignment"("companyId", "userId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserOrgAssignment_userId_orgUnitId_startedAt_key" ON "UserOrgAssignment"("userId", "orgUnitId", "startedAt");

-- CreateIndex
CREATE INDEX "SourceCompanyMapping_workspaceId_sourceSystem_sourceTenantId_version_status_idx" ON "SourceCompanyMapping"("workspaceId", "sourceSystem", "sourceTenantId", "version", "status");

-- CreateIndex
CREATE INDEX "SourceCompanyMapping_targetCompanyId_status_idx" ON "SourceCompanyMapping"("targetCompanyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceCompanyMapping_workspaceId_sourceSystem_sourceTenantId_version_sourceOrgUnitKey_key" ON "SourceCompanyMapping"("workspaceId", "sourceSystem", "sourceTenantId", "version", "sourceOrgUnitKey");

-- CreateIndex
CREATE INDEX "ImportDataset_workspaceId_sourceSystem_sourceTenantId_status_sequence_idx" ON "ImportDataset"("workspaceId", "sourceSystem", "sourceTenantId", "status", "sequence");

-- CreateIndex
CREATE INDEX "ImportDataset_parentDatasetId_idx" ON "ImportDataset"("parentDatasetId");

-- CreateIndex
CREATE INDEX "ImportDataset_companyMappingVersion_idx" ON "ImportDataset"("companyMappingVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ImportDataset_workspaceId_sourceSystem_sourceTenantId_sequence_key" ON "ImportDataset"("workspaceId", "sourceSystem", "sourceTenantId", "sequence");

-- CreateIndex
CREATE INDEX "ImportFile_datasetId_sourceType_status_idx" ON "ImportFile"("datasetId", "sourceType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportFile_datasetId_safeFilename_key" ON "ImportFile"("datasetId", "safeFilename");

-- CreateIndex
CREATE INDEX "ImportRun_datasetId_mode_status_createdAt_idx" ON "ImportRun"("datasetId", "mode", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRun_status_leaseUntil_idx" ON "ImportRun"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ImportApplyLease_runId_key" ON "ImportApplyLease"("runId");

-- CreateIndex
CREATE INDEX "ImportApplyLease_leaseUntil_idx" ON "ImportApplyLease"("leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ImportApplyLease_workspaceId_sourceSystem_sourceTenantId_key" ON "ImportApplyLease"("workspaceId", "sourceSystem", "sourceTenantId");

-- CreateIndex
CREATE INDEX "ImportIssue_runId_severity_resolvedAt_createdAt_idx" ON "ImportIssue"("runId", "severity", "resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ImportIssue_code_severity_idx" ON "ImportIssue"("code", "severity");

-- CreateIndex
CREATE INDEX "ExternalIdMap_targetType_targetId_idx" ON "ExternalIdMap"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ExternalIdMap_lastSeenDatasetId_idx" ON "ExternalIdMap"("lastSeenDatasetId");

-- CreateIndex
CREATE INDEX "ExternalIdMap_lastAppliedRunId_idx" ON "ExternalIdMap"("lastAppliedRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdMap_workspaceId_sourceSystem_sourceTenantId_sourceType_sourceId_key" ON "ExternalIdMap"("workspaceId", "sourceSystem", "sourceTenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ImportChangeJournal_runId_operation_createdAt_idx" ON "ImportChangeJournal"("runId", "operation", "createdAt");

-- CreateIndex
CREATE INDEX "ImportChangeJournal_externalMapId_idx" ON "ImportChangeJournal"("externalMapId");

-- CreateIndex
CREATE INDEX "ImportBinaryTransfer_runId_status_updatedAt_idx" ON "ImportBinaryTransfer"("runId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ImportBinaryTransfer_quarantineObjectKey_idx" ON "ImportBinaryTransfer"("quarantineObjectKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBinaryTransfer_datasetId_sourceFileId_key" ON "ImportBinaryTransfer"("datasetId", "sourceFileId");

-- CreateIndex
CREATE INDEX "MigrationActivation_workspaceId_status_idx" ON "MigrationActivation"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "MigrationActivation_finalDatasetId_idx" ON "MigrationActivation"("finalDatasetId");

-- CreateIndex
CREATE INDEX "MigrationActivation_activatedById_idx" ON "MigrationActivation"("activatedById");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationActivation_companyId_sourceSystem_sourceTenantId_key" ON "MigrationActivation"("companyId", "sourceSystem", "sourceTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordCredential_userId_key" ON "PasswordCredential"("userId");

-- CreateIndex
CREATE INDEX "TemporaryCredential_userId_expiresAt_idx" ON "TemporaryCredential"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TotpCredential_userId_key" ON "TotpCredential"("userId");

-- CreateIndex
CREATE INDEX "RecoveryCode_userId_consumedAt_idx" ON "RecoveryCode"("userId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_sessionHash_key" ON "UserSession"("sessionHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_revokedAt_expiresAt_idx" ON "UserSession"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_usernameFingerprint_createdAt_idx" ON "LoginAttempt"("usernameFingerprint", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ipHash_createdAt_idx" ON "LoginAttempt"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "CredentialEvent_userId_createdAt_idx" ON "CredentialEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CredentialResetApproval_targetId_state_expiresAt_idx" ON "CredentialResetApproval"("targetId", "state", "expiresAt");

-- CreateIndex
CREATE INDEX "ReauthChallenge_sessionId_purpose_expiresAt_idx" ON "ReauthChallenge"("sessionId", "purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_number_key" ON "Task"("number");

-- CreateIndex
CREATE INDEX "Task_companyId_status_dueAt_id_idx" ON "Task"("companyId", "status", "dueAt", "id");

-- CreateIndex
CREATE INDEX "Task_groupId_status_dueAt_id_idx" ON "Task"("groupId", "status", "dueAt", "id");

-- CreateIndex
CREATE INDEX "Task_projectId_status_dueAt_id_idx" ON "Task"("projectId", "status", "dueAt", "id");

-- CreateIndex
CREATE INDEX "Task_parentTaskId_status_dueAt_id_idx" ON "Task"("parentTaskId", "status", "dueAt", "id");

-- CreateIndex
CREATE INDEX "Task_reporterId_status_dueAt_idx" ON "Task"("reporterId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_createdById_updatedAt_idx" ON "Task"("createdById", "updatedAt");

-- CreateIndex
CREATE INDEX "Task_recurrenceId_recurrenceOccurrenceAt_idx" ON "Task"("recurrenceId", "recurrenceOccurrenceAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_recurrenceId_recurrenceOccurrenceAt_key" ON "Task"("recurrenceId", "recurrenceOccurrenceAt");

-- CreateIndex
CREATE INDEX "TaskParticipant_taskId_role_removedAt_userId_idx" ON "TaskParticipant"("taskId", "role", "removedAt", "userId");

-- CreateIndex
CREATE INDEX "TaskParticipant_userId_role_removedAt_taskId_idx" ON "TaskParticipant"("userId", "role", "removedAt", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskParticipant_taskId_userId_key" ON "TaskParticipant"("taskId", "userId");

-- CreateIndex
CREATE INDEX "TaskFollower_userId_mutedAt_taskId_idx" ON "TaskFollower"("userId", "mutedAt", "taskId");

-- CreateIndex
CREATE INDEX "TaskFollower_taskId_mutedAt_userId_idx" ON "TaskFollower"("taskId", "mutedAt", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskFollower_taskId_userId_key" ON "TaskFollower"("taskId", "userId");

-- CreateIndex
CREATE INDEX "TaskUserState_userId_favoritedAt_taskId_idx" ON "TaskUserState"("userId", "favoritedAt", "taskId");

-- CreateIndex
CREATE INDEX "TaskUserState_userId_important_taskId_idx" ON "TaskUserState"("userId", "important", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskUserState_taskId_userId_key" ON "TaskUserState"("taskId", "userId");

-- CreateIndex
CREATE INDEX "TaskReminder_userId_status_remindAt_idx" ON "TaskReminder"("userId", "status", "remindAt");

-- CreateIndex
CREATE INDEX "TaskReminder_taskId_status_remindAt_idx" ON "TaskReminder"("taskId", "status", "remindAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskChecklistItem_taskId_position_key" ON "TaskChecklistItem"("taskId", "position");

-- CreateIndex
CREATE INDEX "Project_workspaceId_companyId_status_name_idx" ON "Project"("workspaceId", "companyId", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Project_companyId_normalizedName_key" ON "Project"("companyId", "normalizedName");

-- CreateIndex
CREATE INDEX "Tag_workspaceId_companyId_name_idx" ON "Tag"("workspaceId", "companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_companyId_normalizedName_key" ON "Tag"("companyId", "normalizedName");

-- CreateIndex
CREATE INDEX "TaskTag_tagId_taskId_idx" ON "TaskTag"("tagId", "taskId");

-- CreateIndex
CREATE INDEX "TaskRelation_targetTaskId_type_sourceTaskId_idx" ON "TaskRelation"("targetTaskId", "type", "sourceTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRelation_sourceTaskId_targetTaskId_key" ON "TaskRelation"("sourceTaskId", "targetTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRecurrence_templateTaskId_key" ON "TaskRecurrence"("templateTaskId");

-- CreateIndex
CREATE INDEX "TaskRecurrence_isActive_nextRunAt_id_idx" ON "TaskRecurrence"("isActive", "nextRunAt", "id");

-- CreateIndex
CREATE INDEX "TimeEntry_taskId_startedAt_id_idx" ON "TimeEntry"("taskId", "startedAt", "id");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_endedAt_startedAt_idx" ON "TimeEntry"("userId", "endedAt", "startedAt");

-- CreateIndex
CREATE INDEX "EntityLink_targetType_targetId_idx" ON "EntityLink"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityLink_sourceType_sourceId_targetType_targetId_relation_key" ON "EntityLink"("sourceType", "sourceId", "targetType", "targetId", "relation");

-- CreateIndex
CREATE INDEX "Event_companyId_startAt_endAt_idx" ON "Event"("companyId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "Event_ownerId_startAt_idx" ON "Event"("ownerId", "startAt");

-- CreateIndex
CREATE INDEX "PresenceRecord_companyId_startAt_endAt_idx" ON "PresenceRecord"("companyId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "PresenceRecord_userId_startAt_idx" ON "PresenceRecord"("userId", "startAt");

-- CreateIndex
CREATE INDEX "LifecycleProcess_companyId_processType_status_idx" ON "LifecycleProcess"("companyId", "processType", "status");

-- CreateIndex
CREATE INDEX "LifecycleProcess_employeeId_status_idx" ON "LifecycleProcess"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleStep_processId_sourceKey_key" ON "LifecycleStep"("processId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE INDEX "FileObject_companyId_scanStatus_createdAt_idx" ON "FileObject"("companyId", "scanStatus", "createdAt");

-- CreateIndex
CREATE INDEX "FileObject_ownerId_createdAt_idx" ON "FileObject"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "FileLink_entityType_entityId_idx" ON "FileLink"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "FileLink_fileId_entityType_entityId_purpose_key" ON "FileLink"("fileId", "entityType", "entityId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Document_number_key" ON "Document"("number");

-- CreateIndex
CREATE INDEX "Document_companyId_status_updatedAt_id_idx" ON "Document"("companyId", "status", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "Document_ownerId_updatedAt_idx" ON "Document"("ownerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAcl_documentId_principalType_principalId_key" ON "DocumentAcl"("documentId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_workspaceId_status_updatedAt_idx" ON "KnowledgeArticle"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticle_workspaceId_slug_key" ON "KnowledgeArticle"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticleVersion_articleId_version_key" ON "KnowledgeArticleVersion"("articleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleAudience_articleId_principalType_principalId_key" ON "ArticleAudience"("articleId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "Acknowledgement_userId_confirmedAt_dueAt_idx" ON "Acknowledgement"("userId", "confirmedAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Acknowledgement_entityType_entityId_version_userId_key" ON "Acknowledgement"("entityType", "entityId", "version", "userId");

-- CreateIndex
CREATE INDEX "Announcement_workspaceId_status_publishAt_idx" ON "Announcement"("workspaceId", "status", "publishAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementAudienceCompany_announcementId_companyId_key" ON "AnnouncementAudienceCompany"("announcementId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementAudienceUser_announcementId_userId_key" ON "AnnouncementAudienceUser"("announcementId", "userId");

-- CreateIndex
CREATE INDEX "AnnouncementReceipt_userId_readAt_deliveredAt_idx" ON "AnnouncementReceipt"("userId", "readAt", "deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementReceipt_announcementId_userId_key" ON "AnnouncementReceipt"("announcementId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_requiresAction_createdAt_idx" ON "Notification"("recipientId", "requiresAction", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_category_channel_key" ON "NotificationPreference"("userId", "category", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_directKey_key" ON "MessageThread"("directKey");

-- CreateIndex
CREATE INDEX "MessageThread_companyId_lastMessageAt_idx" ON "MessageThread"("companyId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MessageThread_workspaceId_companyId_kind_idx" ON "MessageThread"("workspaceId", "companyId", "kind");

-- CreateIndex
CREATE INDEX "MessageThread_workspaceId_companyId_lastMessageAt_createdAt_id_idx" ON "MessageThread"("workspaceId", "companyId", "lastMessageAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ThreadParticipant_userId_leftAt_idx" ON "ThreadParticipant"("userId", "leftAt");

-- CreateIndex
CREATE INDEX "ThreadParticipant_threadId_leftAt_notificationMode_idx" ON "ThreadParticipant"("threadId", "leftAt", "notificationMode");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadParticipant_threadId_userId_key" ON "ThreadParticipant"("threadId", "userId");

-- CreateIndex
CREATE INDEX "Message_threadId_createdAt_id_idx" ON "Message"("threadId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Message_threadId_deletedAt_createdAt_id_idx" ON "Message"("threadId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Comment_entityType_entityId_createdAt_idx" ON "Comment"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_replyToCommentId_idx" ON "Comment"("replyToCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_userId_module_name_key" ON "SavedView"("userId", "module", "name");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_createdAt_id_idx" ON "AuditEvent"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_companyId_createdAt_idx" ON "AuditEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_state_nextRunAt_idx" ON "OutboxEvent"("state", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_aggregateType_aggregateId_aggregateVersion_eventType_key" ON "OutboxEvent"("aggregateType", "aggregateId", "aggregateVersion", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_idempotencyKey_key" ON "BackgroundJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_state_runAt_id_idx" ON "BackgroundJob"("state", "runAt", "id");

-- CreateIndex
CREATE INDEX "BackgroundJob_leaseUntil_idx" ON "BackgroundJob"("leaseUntil");

-- CreateIndex
CREATE INDEX "RetentionPolicy_effectiveAt_idx" ON "RetentionPolicy"("effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_category_version_key" ON "RetentionPolicy"("category", "version");

-- CreateIndex
CREATE INDEX "SystemSetting_key_effectiveAt_idx" ON "SystemSetting"("key", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_version_key" ON "SystemSetting"("key", "version");

-- CreateIndex
CREATE INDEX "LegalHold_entityType_entityId_status_idx" ON "LegalHold"("entityType", "entityId", "status");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_key_operation_key" ON "IdempotencyRecord"("userId", "key", "operation");

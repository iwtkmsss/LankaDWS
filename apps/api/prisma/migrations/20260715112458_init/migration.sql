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
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
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
    "primaryCompanyId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "normalizedUsername" TEXT NOT NULL,
    "contactEmail" TEXT,
    "jobTitle" TEXT NOT NULL DEFAULT '',
    "displayRole" TEXT NOT NULL,
    "approverId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Kyiv',
    "locale" TEXT NOT NULL DEFAULT 'uk-UA',
    "status" TEXT NOT NULL DEFAULT 'PENDING_FIRST_LOGIN',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
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
CREATE TABLE "UserCompanyAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "grantedBy" TEXT,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserCompanyAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserCompanyAccess_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isFullAdmin" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Role_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Permission" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "risk" TEXT NOT NULL DEFAULT 'NORMAL',
    "description" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roleId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'OWN',
    "companyIdsJson" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "Permission" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedBy" TEXT,
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "delegatorId" TEXT NOT NULL,
    "substituteId" TEXT NOT NULL,
    "companyIdsJson" TEXT NOT NULL,
    "actionsJson" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "deadline" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "recurrenceKey" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaskChecklistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "completedById" TEXT,
    "completedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "TaskChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE TABLE "RequestType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "schemaJson" TEXT NOT NULL,
    "effectsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "typeVersion" INTEGER NOT NULL,
    "routeVersion" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "decisionStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "executionStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "currentApproverId" TEXT,
    "confidentiality" TEXT NOT NULL DEFAULT 'INTERNAL',
    "slaDueAt" DATETIME,
    "idempotencyKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RequestSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "valuesJson" TEXT NOT NULL,
    "safeSummary" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestSnapshot_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RequestPrivateDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "encryptedJson" TEXT NOT NULL,
    CONSTRAINT "RequestPrivateDetail_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApprovalAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "requestVersion" INTEGER NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "approverId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "comment" TEXT,
    "decidedAt" DATETIME,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalAttempt_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApprovalEffect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "requestVersion" INTEGER NOT NULL,
    "effectType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "resultRef" TEXT,
    "lastErrorCode" TEXT,
    CONSTRAINT "ApprovalEffect_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "sourceRequestId" TEXT,
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
    "sourceRequestId" TEXT,
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
    "companyId" TEXT NOT NULL,
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
CREATE TABLE "AnnouncementAudienceRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "announcementId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "AnnouncementAudienceRole_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    "lastReadMessageId" TEXT,
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
CREATE INDEX "Company_workspaceId_status_idx" ON "Company"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Company_workspaceId_code_key" ON "Company"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "User_workspaceId_status_idx" ON "User"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "User_primaryCompanyId_status_idx" ON "User"("primaryCompanyId", "status");

-- CreateIndex
CREATE INDEX "User_approverId_idx" ON "User"("approverId");

-- CreateIndex
CREATE UNIQUE INDEX "User_workspaceId_normalizedUsername_key" ON "User"("workspaceId", "normalizedUsername");

-- CreateIndex
CREATE UNIQUE INDEX "UsernameReservation_workspaceId_normalizedUsername_key" ON "UsernameReservation"("workspaceId", "normalizedUsername");

-- CreateIndex
CREATE INDEX "UserCompanyAccess_companyId_status_idx" ON "UserCompanyAccess"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UserCompanyAccess_userId_companyId_key" ON "UserCompanyAccess"("userId", "companyId");

-- CreateIndex
CREATE INDEX "Role_workspaceId_status_idx" ON "Role"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Role_workspaceId_normalizedName_key" ON "Role"("workspaceId", "normalizedName");

-- CreateIndex
CREATE INDEX "RolePermission_permissionCode_idx" ON "RolePermission"("permissionCode");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionCode_key" ON "RolePermission"("roleId", "permissionCode");

-- CreateIndex
CREATE INDEX "UserRole_roleId_status_idx" ON "UserRole"("roleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "Delegation_delegatorId_startsAt_endsAt_idx" ON "Delegation"("delegatorId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Delegation_substituteId_startsAt_endsAt_idx" ON "Delegation"("substituteId", "startsAt", "endsAt");

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
CREATE UNIQUE INDEX "Task_recurrenceKey_key" ON "Task"("recurrenceKey");

-- CreateIndex
CREATE INDEX "Task_companyId_status_deadline_id_idx" ON "Task"("companyId", "status", "deadline", "id");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_deadline_idx" ON "Task"("assigneeId", "status", "deadline");

-- CreateIndex
CREATE INDEX "Task_creatorId_updatedAt_idx" ON "Task"("creatorId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskChecklistItem_taskId_position_key" ON "TaskChecklistItem"("taskId", "position");

-- CreateIndex
CREATE INDEX "EntityLink_targetType_targetId_idx" ON "EntityLink"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityLink_sourceType_sourceId_targetType_targetId_relation_key" ON "EntityLink"("sourceType", "sourceId", "targetType", "targetId", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "RequestType_workspaceId_name_key" ON "RequestType"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Request_number_key" ON "Request"("number");

-- CreateIndex
CREATE INDEX "Request_companyId_decisionStatus_updatedAt_id_idx" ON "Request"("companyId", "decisionStatus", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "Request_currentApproverId_decisionStatus_slaDueAt_idx" ON "Request"("currentApproverId", "decisionStatus", "slaDueAt");

-- CreateIndex
CREATE INDEX "Request_authorId_updatedAt_idx" ON "Request"("authorId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Request_authorId_idempotencyKey_key" ON "Request"("authorId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RequestSnapshot_requestId_version_key" ON "RequestSnapshot"("requestId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RequestPrivateDetail_requestId_version_key" ON "RequestPrivateDetail"("requestId", "version");

-- CreateIndex
CREATE INDEX "ApprovalAttempt_approverId_state_createdAt_idx" ON "ApprovalAttempt"("approverId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalAttempt_requestId_requestVersion_approverId_idempotencyKey_key" ON "ApprovalAttempt"("requestId", "requestVersion", "approverId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalEffect_idempotencyKey_key" ON "ApprovalEffect"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ApprovalEffect_requestId_state_idx" ON "ApprovalEffect"("requestId", "state");

-- CreateIndex
CREATE INDEX "Event_companyId_startAt_endAt_idx" ON "Event"("companyId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "Event_ownerId_startAt_idx" ON "Event"("ownerId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_sourceRequestId_ownerId_key" ON "Event"("sourceRequestId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PresenceRecord_sourceRequestId_key" ON "PresenceRecord"("sourceRequestId");

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
CREATE UNIQUE INDEX "AnnouncementAudienceRole_announcementId_roleId_key" ON "AnnouncementAudienceRole"("announcementId", "roleId");

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
CREATE INDEX "MessageThread_companyId_lastMessageAt_idx" ON "MessageThread"("companyId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ThreadParticipant_userId_leftAt_idx" ON "ThreadParticipant"("userId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadParticipant_threadId_userId_key" ON "ThreadParticipant"("threadId", "userId");

-- CreateIndex
CREATE INDEX "Message_threadId_createdAt_id_idx" ON "Message"("threadId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Comment_entityType_entityId_createdAt_idx" ON "Comment"("entityType", "entityId", "createdAt");

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

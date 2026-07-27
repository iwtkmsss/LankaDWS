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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME,
    CONSTRAINT "Group_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Group_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Group_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Group_privacy_pair_check" CHECK (
        ("discoverability" = 'LISTED' AND "joinPolicy" IN ('OPEN', 'REQUEST'))
        OR ("discoverability" = 'HIDDEN' AND "joinPolicy" = 'INVITE_ONLY')
    )
);

CREATE UNIQUE INDEX "Group_companyId_key_key" ON "Group"("companyId", "key");
CREATE INDEX "Group_workspaceId_companyId_status_idx" ON "Group"("workspaceId", "companyId", "status");
CREATE INDEX "Group_companyId_discoverability_status_updatedAt_idx" ON "Group"("companyId", "discoverability", "status", "updatedAt");
CREATE INDEX "Group_ownerId_status_idx" ON "Group"("ownerId", "status");

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

CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");
CREATE UNIQUE INDEX "GroupMember_one_active_owner_key" ON "GroupMember"("groupId") WHERE "role" = 'OWNER' AND "leftAt" IS NULL;
CREATE INDEX "GroupMember_userId_leftAt_idx" ON "GroupMember"("userId", "leftAt");
CREATE INDEX "GroupMember_groupId_role_leftAt_idx" ON "GroupMember"("groupId", "role", "leftAt");

CREATE TABLE "GroupJoinRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "activeKey" TEXT,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "GroupJoinRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupJoinRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupJoinRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GroupJoinRequest_activeKey_key" ON "GroupJoinRequest"("activeKey");
CREATE INDEX "GroupJoinRequest_groupId_status_createdAt_idx" ON "GroupJoinRequest"("groupId", "status", "createdAt");
CREATE INDEX "GroupJoinRequest_requesterId_status_idx" ON "GroupJoinRequest"("requesterId", "status");
CREATE INDEX "GroupJoinRequest_decidedById_idx" ON "GroupJoinRequest"("decidedById");

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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgUnit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrgUnit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrgUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgUnit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrgUnit_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrgUnit_companyId_sourceKey_key" ON "OrgUnit"("companyId", "sourceKey");
CREATE INDEX "OrgUnit_companyId_parentId_status_sortOrder_idx" ON "OrgUnit"("companyId", "parentId", "status", "sortOrder");
CREATE INDEX "OrgUnit_companyId_normalizedName_status_idx" ON "OrgUnit"("companyId", "normalizedName", "status");
CREATE INDEX "OrgUnit_managerId_idx" ON "OrgUnit"("managerId");

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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserOrgAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserOrgAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserOrgAssignment_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserOrgAssignment_userId_orgUnitId_startedAt_key" ON "UserOrgAssignment"("userId", "orgUnitId", "startedAt");
CREATE UNIQUE INDEX "UserOrgAssignment_one_active_primary_key" ON "UserOrgAssignment"("userId", "companyId") WHERE "isPrimary" = true AND "endedAt" IS NULL;
CREATE INDEX "UserOrgAssignment_orgUnitId_endedAt_isPrimary_idx" ON "UserOrgAssignment"("orgUnitId", "endedAt", "isPrimary");
CREATE INDEX "UserOrgAssignment_companyId_userId_endedAt_idx" ON "UserOrgAssignment"("companyId", "userId", "endedAt");

CREATE TRIGGER "Group_scope_guard_insert"
BEFORE INSERT ON "Group"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "Company" c
        JOIN "User" u ON u."id" = NEW."ownerId" AND u."workspaceId" = NEW."workspaceId"
        JOIN "UserCompanyAccess" access ON access."userId" = u."id" AND access."companyId" = NEW."companyId" AND access."status" = 'ACTIVE'
        WHERE c."id" = NEW."companyId" AND c."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'group_scope_mismatch') END;
END;

CREATE TRIGGER "Group_scope_guard_update"
BEFORE UPDATE OF "workspaceId", "companyId", "ownerId" ON "Group"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "Company" c
        JOIN "User" u ON u."id" = NEW."ownerId" AND u."workspaceId" = NEW."workspaceId"
        JOIN "UserCompanyAccess" access ON access."userId" = u."id" AND access."companyId" = NEW."companyId" AND access."status" = 'ACTIVE'
        WHERE c."id" = NEW."companyId" AND c."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'group_scope_mismatch') END;
END;

CREATE TRIGGER "GroupMember_scope_guard_insert"
BEFORE INSERT ON "GroupMember"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "Group" g
        JOIN "UserCompanyAccess" access ON access."userId" = NEW."userId" AND access."companyId" = g."companyId" AND access."status" = 'ACTIVE'
        WHERE g."id" = NEW."groupId"
    ) THEN RAISE(ABORT, 'group_member_scope_mismatch') END;
END;

CREATE TRIGGER "GroupMember_scope_guard_update"
BEFORE UPDATE OF "groupId", "userId" ON "GroupMember"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "Group" g
        JOIN "UserCompanyAccess" access ON access."userId" = NEW."userId" AND access."companyId" = g."companyId" AND access."status" = 'ACTIVE'
        WHERE g."id" = NEW."groupId"
    ) THEN RAISE(ABORT, 'group_member_scope_mismatch') END;
END;

CREATE TRIGGER "GroupJoinRequest_scope_guard_insert"
BEFORE INSERT ON "GroupJoinRequest"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "Group" g
        JOIN "UserCompanyAccess" requesterAccess ON requesterAccess."userId" = NEW."requesterId" AND requesterAccess."companyId" = g."companyId" AND requesterAccess."status" = 'ACTIVE'
        WHERE g."id" = NEW."groupId"
          AND (
            NEW."decidedById" IS NULL
            OR EXISTS (
                SELECT 1 FROM "UserCompanyAccess" deciderAccess
                WHERE deciderAccess."userId" = NEW."decidedById" AND deciderAccess."companyId" = g."companyId" AND deciderAccess."status" = 'ACTIVE'
            )
          )
    ) THEN RAISE(ABORT, 'group_join_request_scope_mismatch') END;
END;

CREATE TRIGGER "GroupJoinRequest_scope_guard_update"
BEFORE UPDATE OF "groupId", "requesterId", "decidedById" ON "GroupJoinRequest"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "Group" g
        JOIN "UserCompanyAccess" requesterAccess ON requesterAccess."userId" = NEW."requesterId" AND requesterAccess."companyId" = g."companyId" AND requesterAccess."status" = 'ACTIVE'
        WHERE g."id" = NEW."groupId"
          AND (
            NEW."decidedById" IS NULL
            OR EXISTS (
                SELECT 1 FROM "UserCompanyAccess" deciderAccess
                WHERE deciderAccess."userId" = NEW."decidedById" AND deciderAccess."companyId" = g."companyId" AND deciderAccess."status" = 'ACTIVE'
            )
          )
    ) THEN RAISE(ABORT, 'group_join_request_scope_mismatch') END;
END;

CREATE TRIGGER "OrgUnit_scope_guard_insert"
BEFORE INSERT ON "OrgUnit"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "Company" c
        WHERE c."id" = NEW."companyId" AND c."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'org_unit_company_scope_mismatch') END;
    SELECT CASE WHEN NEW."parentId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "OrgUnit" parent
        WHERE parent."id" = NEW."parentId" AND parent."companyId" = NEW."companyId" AND parent."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'org_unit_parent_scope_mismatch') END;
    SELECT CASE WHEN NEW."managerId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "User" manager
        JOIN "UserCompanyAccess" access ON access."userId" = manager."id" AND access."companyId" = NEW."companyId" AND access."status" = 'ACTIVE'
        WHERE manager."id" = NEW."managerId" AND manager."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'org_unit_manager_scope_mismatch') END;
END;

CREATE TRIGGER "OrgUnit_scope_guard_update"
BEFORE UPDATE OF "workspaceId", "companyId", "parentId", "managerId" ON "OrgUnit"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM "Company" c
        WHERE c."id" = NEW."companyId" AND c."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'org_unit_company_scope_mismatch') END;
    SELECT CASE WHEN NEW."parentId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "OrgUnit" parent
        WHERE parent."id" = NEW."parentId" AND parent."companyId" = NEW."companyId" AND parent."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'org_unit_parent_scope_mismatch') END;
    SELECT CASE WHEN NEW."managerId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "User" manager
        JOIN "UserCompanyAccess" access ON access."userId" = manager."id" AND access."companyId" = NEW."companyId" AND access."status" = 'ACTIVE'
        WHERE manager."id" = NEW."managerId" AND manager."workspaceId" = NEW."workspaceId"
    ) THEN RAISE(ABORT, 'org_unit_manager_scope_mismatch') END;
END;

CREATE TRIGGER "OrgUnit_cycle_guard_update"
BEFORE UPDATE OF "parentId" ON "OrgUnit"
WHEN NEW."parentId" IS NOT NULL
BEGIN
    SELECT CASE WHEN NEW."parentId" = NEW."id" THEN RAISE(ABORT, 'org_unit_cycle') END;
    SELECT CASE WHEN EXISTS (
        WITH RECURSIVE descendants("id") AS (
            SELECT child."id" FROM "OrgUnit" child WHERE child."parentId" = OLD."id"
            UNION ALL
            SELECT child."id" FROM "OrgUnit" child JOIN descendants d ON child."parentId" = d."id"
        )
        SELECT 1 FROM descendants WHERE "id" = NEW."parentId"
    ) THEN RAISE(ABORT, 'org_unit_cycle') END;
END;

CREATE TRIGGER "UserOrgAssignment_scope_guard_insert"
BEFORE INSERT ON "UserOrgAssignment"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "OrgUnit" unit
        JOIN "UserCompanyAccess" access ON access."userId" = NEW."userId" AND access."companyId" = NEW."companyId" AND access."status" = 'ACTIVE'
        WHERE unit."id" = NEW."orgUnitId" AND unit."companyId" = NEW."companyId"
    ) THEN RAISE(ABORT, 'org_assignment_scope_mismatch') END;
END;

CREATE TRIGGER "UserOrgAssignment_scope_guard_update"
BEFORE UPDATE OF "companyId", "userId", "orgUnitId" ON "UserOrgAssignment"
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM "OrgUnit" unit
        JOIN "UserCompanyAccess" access ON access."userId" = NEW."userId" AND access."companyId" = NEW."companyId" AND access."status" = 'ACTIVE'
        WHERE unit."id" = NEW."orgUnitId" AND unit."companyId" = NEW."companyId"
    ) THEN RAISE(ABORT, 'org_assignment_scope_mismatch') END;
END;

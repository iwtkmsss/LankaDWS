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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyCapability_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompanyCapability_enabledById_fkey" FOREIGN KEY ("enabledById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CompanyCapability_companyId_code_key" ON "CompanyCapability"("companyId", "code");
CREATE INDEX "CompanyCapability_code_enabled_companyId_idx" ON "CompanyCapability"("code", "enabled", "companyId");
CREATE INDEX "CompanyCapability_enabledById_idx" ON "CompanyCapability"("enabledById");

INSERT INTO "CompanyCapability" ("id", "companyId", "code")
SELECT 'cap_' || c."id" || '_' || lower(codes."code"), c."id", codes."code"
FROM "Company" c
CROSS JOIN (
    SELECT 'FEED' AS "code"
    UNION ALL SELECT 'GROUPS_UI'
    UNION ALL SELECT 'DRIVE'
    UNION ALL SELECT 'CALENDAR_WRITE'
    UNION ALL SELECT 'CALLS'
    UNION ALL SELECT 'ABSENCES'
) codes;

INSERT OR IGNORE INTO "Permission" ("code", "domain", "risk", "description") VALUES
('feed.read', 'feed', 'NORMAL', 'Read authorized feed items'),
('feed.create', 'feed', 'NORMAL', 'Create feed posts'),
('feed.moderate', 'feed', 'HIGH', 'Moderate feed and acknowledgement details'),
('groups.read', 'groups', 'NORMAL', 'Discover and read authorized groups'),
('groups.create', 'groups', 'NORMAL', 'Create working groups'),
('groups.manage', 'groups', 'HIGH', 'Manage group settings'),
('groups.members.manage', 'groups', 'HIGH', 'Manage group members and join requests'),
('messages.write', 'messages', 'NORMAL', 'Write messages'),
('messages.manage', 'messages', 'HIGH', 'Manage messages and threads'),
('calls.read', 'calls', 'NORMAL', 'Read owned or participated call records'),
('calls.create', 'calls', 'NORMAL', 'Create call records'),
('calls.manage', 'calls', 'HIGH', 'Manage call records'),
('employees.org.read', 'employees', 'NORMAL', 'Read the safe organization structure'),
('absences.read.self', 'absences', 'NORMAL', 'Read personal absence records'),
('absences.read.company', 'absences', 'HIGH', 'Read company-scoped absence records'),
('absences.manage', 'absences', 'HIGH', 'Manage absence records'),
('documents.share', 'documents', 'HIGH', 'Manage internal document access');

-- Conservative role backfill. Conditional Calls/Absences grants stay disabled until their product gates close.
INSERT OR IGNORE INTO "RolePermission" ("id", "roleId", "permissionCode", "scope", "companyIdsJson")
SELECT 'rp_cap_' || r."id" || '_' || replace(p."code", '.', '_'), r."id", p."code",
       CASE WHEN r."normalizedName" IN ('працівник', 'керівник', 'hr') THEN 'OWN' ELSE 'ALL_COMPANIES' END,
       '[]'
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('feed.read', 'groups.read', 'employees.org.read')
WHERE r."isFullAdmin" = true OR r."normalizedName" IN ('перегляд', 'працівник', 'керівник', 'hr');

INSERT OR IGNORE INTO "RolePermission" ("id", "roleId", "permissionCode", "scope", "companyIdsJson")
SELECT 'rp_cap_' || r."id" || '_' || replace(p."code", '.', '_'), r."id", p."code",
       CASE WHEN r."normalizedName" IN ('працівник', 'керівник', 'hr') THEN 'OWN' ELSE 'ALL_COMPANIES' END,
       '[]'
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('feed.create', 'messages.write')
WHERE r."isFullAdmin" = true OR r."normalizedName" IN ('працівник', 'керівник', 'hr');

INSERT OR IGNORE INTO "RolePermission" ("id", "roleId", "permissionCode", "scope", "companyIdsJson")
SELECT 'rp_cap_' || r."id" || '_' || replace(p."code", '.', '_'), r."id", p."code", 'ALL_COMPANIES', '[]'
FROM "Role" r
JOIN "Permission" p ON p."code" IN (
    'feed.moderate', 'groups.create', 'groups.manage', 'groups.members.manage',
    'messages.manage', 'calls.read', 'calls.create', 'calls.manage',
    'absences.read.self', 'absences.read.company', 'absences.manage', 'documents.share'
)
WHERE r."isFullAdmin" = true;

UPDATE "User"
SET "authorizationVersion" = "authorizationVersion" + 1
WHERE "id" IN (
    SELECT DISTINCT ur."userId"
    FROM "UserRole" ur
    JOIN "RolePermission" rp ON rp."roleId" = ur."roleId"
    WHERE ur."status" = 'ACTIVE' AND rp."id" LIKE 'rp_cap_%'
);

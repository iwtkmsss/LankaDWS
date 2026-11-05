-- CreateTable
CREATE TABLE "DriveFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "ownerId" TEXT NOT NULL,
    "trashedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DriveFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DriveFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DriveShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidentiality" TEXT NOT NULL DEFAULT 'INTERNAL',
    "currentVersionId" TEXT,
    "folderId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DriveFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("archivedAt", "companyId", "confidentiality", "createdAt", "currentVersionId", "id", "name", "number", "ownerId", "status", "updatedAt", "version", "workspaceId") SELECT "archivedAt", "companyId", "confidentiality", "createdAt", "currentVersionId", "id", "name", "number", "ownerId", "status", "updatedAt", "version", "workspaceId" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE UNIQUE INDEX "Document_number_key" ON "Document"("number");
CREATE INDEX "Document_companyId_status_updatedAt_id_idx" ON "Document"("companyId", "status", "updatedAt", "id");
CREATE INDEX "Document_ownerId_updatedAt_idx" ON "Document"("ownerId", "updatedAt");
CREATE INDEX "Document_companyId_folderId_updatedAt_idx" ON "Document"("companyId", "folderId", "updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DriveFolder_companyId_parentId_name_idx" ON "DriveFolder"("companyId", "parentId", "name");

-- CreateIndex
CREATE INDEX "DriveFolder_ownerId_updatedAt_idx" ON "DriveFolder"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "DriveShare_principalType_principalId_idx" ON "DriveShare"("principalType", "principalId");

-- CreateIndex
CREATE INDEX "DriveShare_targetType_targetId_idx" ON "DriveShare"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveShare_targetType_targetId_principalType_principalId_key" ON "DriveShare"("targetType", "targetId", "principalType", "principalId");

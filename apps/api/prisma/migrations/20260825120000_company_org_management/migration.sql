ALTER TABLE "Company" ADD COLUMN "managerId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Company_managerId_idx" ON "Company"("managerId");

CREATE UNIQUE INDEX "OrgUnit_active_sibling_name_key"
ON "OrgUnit"("companyId", COALESCE("parentId", ''), "normalizedName")
WHERE "status" = 'ACTIVE';

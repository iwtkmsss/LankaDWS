-- CreateTable
CREATE TABLE "UserUiPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "valueJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserUiPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "UserUiPreference_userId_module_key_key" ON "UserUiPreference"("userId", "module", "key");

-- CreateIndex
CREATE INDEX "UserUiPreference_userId_updatedAt_idx" ON "UserUiPreference"("userId", "updatedAt");

PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

-- Preserve every pre-S11 display number before replacing non-numeric values.
CREATE TABLE "TaskNumberAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "legacyNumber" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskNumberAlias_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TaskNumberAlias_legacyNumber_key" ON "TaskNumberAlias"("legacyNumber");
CREATE UNIQUE INDEX "TaskNumberAlias_taskId_legacyNumber_key" ON "TaskNumberAlias"("taskId", "legacyNumber");
CREATE INDEX "TaskNumberAlias_taskId_idx" ON "TaskNumberAlias"("taskId");

INSERT INTO "TaskNumberAlias" ("id", "taskId", "legacyNumber")
SELECT 'tnum_alias_' || "id", "id", "number"
FROM "Task"
WHERE "number" = '' OR "number" GLOB '*[^0-9]*';

-- Keep an unambiguous canonical TSK-<digits> suffix when it is free. This
-- retains familiar seeded numbers such as TSK-2401 -> 2401 without risking a
-- collision with an already numeric task or another legacy representation.
WITH "Candidate" AS (
    SELECT
        "id",
        CAST(substr("number", 5) AS INTEGER) AS "candidateNumber"
    FROM "Task"
    WHERE substr("number", 1, 4) = 'TSK-'
      AND substr("number", 5) <> ''
      AND substr("number", 5) NOT GLOB '*[^0-9]*'
      AND CAST(CAST(substr("number", 5) AS INTEGER) AS TEXT) = substr("number", 5)
      AND CAST(substr("number", 5) AS INTEGER) > 0
),
"SafeCandidate" AS (
    SELECT "candidate"."id", "candidate"."candidateNumber"
    FROM "Candidate" AS "candidate"
    WHERE NOT EXISTS (
        SELECT 1
        FROM "Task" AS "existing"
        WHERE "existing"."id" <> "candidate"."id"
          AND "existing"."number" = CAST("candidate"."candidateNumber" AS TEXT)
    )
      AND 1 = (
        SELECT COUNT(*)
        FROM "Candidate" AS "duplicate"
        WHERE "duplicate"."candidateNumber" = "candidate"."candidateNumber"
      )
)
UPDATE "Task"
SET "number" = CAST((
    SELECT "candidateNumber"
    FROM "SafeCandidate"
    WHERE "SafeCandidate"."id" = "Task"."id"
) AS TEXT)
WHERE "id" IN (SELECT "id" FROM "SafeCandidate");

-- Assign all remaining legacy forms deterministically after the greatest
-- numeric number. Ordering is stable across retries and restored backups.
WITH "CurrentMaximum" AS (
    SELECT COALESCE(MAX(CAST("number" AS INTEGER)), 0) AS "value"
    FROM "Task"
    WHERE "number" <> '' AND "number" NOT GLOB '*[^0-9]*'
),
"LegacyRank" AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS "ordinal"
    FROM "Task"
    WHERE "number" = '' OR "number" GLOB '*[^0-9]*'
)
UPDATE "Task"
SET "number" = CAST(
    (SELECT "value" FROM "CurrentMaximum")
    + (SELECT "ordinal" FROM "LegacyRank" WHERE "LegacyRank"."id" = "Task"."id")
    AS TEXT
)
WHERE "id" IN (SELECT "id" FROM "LegacyRank");

CREATE TABLE "TaskNumberSequence" (
    "scope" TEXT NOT NULL PRIMARY KEY,
    "lastNumber" BIGINT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "TaskNumberSequence" ("scope", "lastNumber", "updatedAt")
SELECT
    'global',
    COALESCE(MAX(CAST("number" AS INTEGER)), 0),
    CURRENT_TIMESTAMP
FROM "Task";

-- Persistence-level guards keep Task.number numeric and immutable even when a
-- future background path bypasses the application allocator.
CREATE TRIGGER "Task_number_digits_insert"
BEFORE INSERT ON "Task"
FOR EACH ROW
WHEN NEW."number" = '' OR NEW."number" GLOB '*[^0-9]*'
BEGIN
    SELECT RAISE(ABORT, 'Task.number must contain only digits');
END;

CREATE TRIGGER "Task_number_immutable_update"
BEFORE UPDATE OF "number" ON "Task"
FOR EACH ROW
WHEN NEW."number" <> OLD."number"
BEGIN
    SELECT RAISE(ABORT, 'Task.number is immutable');
END;

COMMIT;

-- Documents now refer directly to their file. Keep the latest file used by Drive.
ALTER TABLE "Document" ADD COLUMN "fileId" TEXT;
UPDATE "Document"
SET "fileId" = (
  SELECT "fileId" FROM "DocumentVersion"
  WHERE "documentId" = "Document"."id"
  ORDER BY "version" DESC LIMIT 1
);

-- Remove historical document grants to files, preserving any other attachment links.
DELETE FROM "FileLink"
WHERE "entityType" = 'DOCUMENT'
  AND ("purpose" = 'VERSION' OR "purpose" GLOB 'VERSION_[0-9]*')
  AND NOT EXISTS (
    SELECT 1 FROM "Document"
    WHERE "Document"."id" = "FileLink"."entityId"
      AND "Document"."fileId" = "FileLink"."fileId"
  );

-- Collapse duplicate links for the surviving file before changing their purpose.
DELETE FROM "FileLink" AS "link"
WHERE "link"."entityType" = 'DOCUMENT'
  AND ("link"."purpose" = 'VERSION' OR "link"."purpose" GLOB 'VERSION_[0-9]*')
  AND EXISTS (
    SELECT 1 FROM "FileLink" AS "other"
    WHERE "other"."fileId" = "link"."fileId"
      AND "other"."entityType" = "link"."entityType"
      AND "other"."entityId" = "link"."entityId"
      AND ("other"."purpose" = 'CONTENT' OR (
        ("other"."purpose" = 'VERSION' OR "other"."purpose" GLOB 'VERSION_[0-9]*')
        AND "other"."id" < "link"."id"
      ))
  );
UPDATE "FileLink" SET "purpose" = 'CONTENT'
WHERE "entityType" = 'DOCUMENT'
  AND ("purpose" = 'VERSION' OR "purpose" GLOB 'VERSION_[0-9]*');

DROP TABLE "DocumentVersion";
ALTER TABLE "Document" DROP COLUMN "currentVersionId";
ALTER TABLE "ImportBinaryTransfer" DROP COLUMN "documentVersionId";

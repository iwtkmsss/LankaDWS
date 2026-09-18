PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS "AnnouncementReceipt";
DROP TABLE IF EXISTS "AnnouncementAudienceUser";
DROP TABLE IF EXISTS "AnnouncementAudienceCompany";
DROP TABLE IF EXISTS "Announcement";

DELETE FROM "FeedItemRecipient"
WHERE "itemId" IN (SELECT "id" FROM "FeedItem" WHERE "sourceType" = 'ANNOUNCEMENT');
DELETE FROM "FeedUserItemState"
WHERE "feedItemId" IN (SELECT "id" FROM "FeedItem" WHERE "sourceType" = 'ANNOUNCEMENT');
DELETE FROM "FeedSourceHead" WHERE "sourceType" = 'ANNOUNCEMENT';
DELETE FROM "FeedItem" WHERE "sourceType" = 'ANNOUNCEMENT';

PRAGMA foreign_keys=ON;

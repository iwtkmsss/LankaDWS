-- Task notification recipients now come only from canonical task roles.
DELETE FROM "IdempotencyRecord"
WHERE "resultType" = 'TASK_FOLLOWER'
   OR "operation" GLOB 'task.follower.*';

DROP TABLE "TaskFollower";

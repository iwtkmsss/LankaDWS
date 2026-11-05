-- Likes on task-discussion messages use the same one-like-per-user behavior as chat messages.
CREATE TABLE "TaskCommentReaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LIKE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskCommentReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TaskCommentReaction_commentId_userId_kind_key"
ON "TaskCommentReaction"("commentId", "userId", "kind");
CREATE INDEX "TaskCommentReaction_commentId_createdAt_idx"
ON "TaskCommentReaction"("commentId", "createdAt");
CREATE INDEX "TaskCommentReaction_userId_createdAt_idx"
ON "TaskCommentReaction"("userId", "createdAt");

import type { ReactionUsersPage, ReactionUsersQuery } from '@lankadws/contracts'
import type { PrismaService } from '../prisma/prisma.service.js'

// Call only after checking access to the parent message or task comment.
export async function listReactionUsers(
  prisma: PrismaService,
  workspaceId: string,
  parent: { messageId: string } | { commentId: string },
  query: ReactionUsersQuery,
): Promise<ReactionUsersPage> {
  const skip = Number(query.cursor ?? 0)
  const options = {
    take: query.limit,
    skip,
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: { userId: true },
  }
  const [rows, total] = 'messageId' in parent
    ? await Promise.all([
        prisma.messageReaction.findMany({ ...options, where: { ...parent, kind: 'LIKE' } }),
        prisma.messageReaction.count({ where: { ...parent, kind: 'LIKE' } }),
      ])
    : await Promise.all([
        prisma.taskCommentReaction.findMany({ ...options, where: { ...parent, kind: 'LIKE' } }),
        prisma.taskCommentReaction.count({ where: { ...parent, kind: 'LIKE' } }),
      ])
  const users = rows.length ? await prisma.user.findMany({
    where: { workspaceId, id: { in: rows.map((row) => row.userId) } },
    select: { id: true, displayName: true },
  }) : []
  const byId = new Map(users.map((user) => [user.id, user]))
  return {
    items: rows.map((row) => byId.get(row.userId) ?? { id: row.userId, displayName: 'Користувач недоступний' }),
    total,
    nextCursor: skip + rows.length < total && rows.length > 0 ? String(skip + rows.length) : null,
  }
}

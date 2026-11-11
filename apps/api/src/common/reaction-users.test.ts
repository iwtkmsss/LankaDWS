import { describe, expect, it, vi } from 'vitest'
import { reactionUsersQuerySchema } from '@lankadws/contracts'
import type { AuthPrincipal } from './request-context.js'
import { listReactionUsers } from './reaction-users.js'
import { MessagesService } from '../modules/communication/messages.service.js'
import { TasksService } from '../modules/tasks/tasks.service.js'

const principal = { userId: 'me', workspaceId: 'workspace' } as AuthPrincipal
function setup() {
  const rows = Array.from({ length: 5 }, (_, index) => ({ userId: `user-${index}` }))
  const model = { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn().mockResolvedValue(60) }
  const prisma = {
    messageReaction: model,
    taskCommentReaction: { ...model, findMany: vi.fn().mockResolvedValue(rows) },
    user: { findMany: vi.fn().mockResolvedValue(rows.map(({ userId }) => ({ id: userId, displayName: userId }))) },
    comment: { findFirst: vi.fn().mockResolvedValue({ id: 'comment' }) },
  }
  return { prisma, model }
}

describe('reaction user lists', () => {
  it('validates pagination and defaults to five users', () => {
    expect(reactionUsersQuerySchema.parse({})).toEqual({ limit: 5 })
    for (const input of [{ limit: 51 }, { limit: 0 }, { cursor: '-1' }, { cursor: 'wrong' }]) {
      expect(reactionUsersQuerySchema.safeParse(input).success).toBe(false)
    }
  })

  it.each([{ messageId: 'message' }, { commentId: 'comment' }])('bounds the database page and scopes the user projection for %o', async (parent) => {
    const { prisma } = setup()
    const result = await listReactionUsers(prisma as never, 'workspace', parent, { limit: 5 })
    const model = 'messageId' in parent ? prisma.messageReaction : prisma.taskCommentReaction
    expect(model.findMany).toHaveBeenCalledWith({
      take: 5, skip: 0, where: { ...parent, kind: 'LIKE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { userId: true },
    })
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace', id: { in: result.items.map((user) => user.id) } },
      select: { id: true, displayName: true },
    })
    expect(result).toMatchObject({ total: 60, nextCursor: '5' })
    expect(result.items).toHaveLength(5)
    await listReactionUsers(prisma as never, 'workspace', parent, { limit: 50, cursor: '5' })
    expect(model.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 50, skip: 5 }))
  })

  it('checks message access and hides reactions of deleted messages', async () => {
    const { prisma, model } = setup()
    const service = new MessagesService(prisma as never, {} as never, {} as never, {} as never)
    const readableMessage = vi.fn().mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ id: 'message', deletedAt: new Date() })
    Object.assign(service, { readableMessage })
    await expect(service.reactionUsers(principal, 'message', { limit: 5 })).rejects.toThrow()
    await expect(service.reactionUsers(principal, 'message', { limit: 5 })).rejects.toThrow()
    expect(readableMessage).toHaveBeenCalledWith(principal, 'message')
    expect(model.findMany).not.toHaveBeenCalled()
  })

  it('checks task access and binds the comment to that exact task', async () => {
    const { prisma } = setup()
    const readableTask = vi.fn().mockRejectedValueOnce(new Error('not found')).mockResolvedValue({ id: 'task', companyId: 'company' })
    const service = new TasksService(prisma as never, {} as never, { readableTask } as never,
      {} as never, {} as never, {} as never, {} as never)
    await expect(service.commentReactionUsers(principal, 'task', 'comment', { limit: 5 })).rejects.toThrow()
    expect(prisma.taskCommentReaction.findMany).not.toHaveBeenCalled()
    prisma.comment.findFirst.mockResolvedValueOnce(null)
    await expect(service.commentReactionUsers(principal, 'task', 'foreign-comment', { limit: 5 })).rejects.toThrow()
    expect(prisma.taskCommentReaction.findMany).not.toHaveBeenCalled()
    await service.commentReactionUsers(principal, 'task', 'comment', { limit: 5 })
    expect(prisma.comment.findFirst).toHaveBeenLastCalledWith({
      where: { id: 'comment', workspaceId: 'workspace', companyId: 'company', entityType: 'TASK', entityId: 'task', deletedAt: null },
      select: { id: true },
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { TaskRecurrenceService } from '../tasks/task-recurrence.service.js'
import { JobsService } from './jobs.service.js'

describe('task comment outbox delivery', () => {
  it.each(['feed_1', null, undefined])('does not duplicate synchronous comment notifications with projection %s', async (feedItemId) => {
    const transaction = vi.fn()
    const findUnique = vi.fn()
    const service = new JobsService(
      { task: { findUnique }, $transaction: transaction } as unknown as PrismaService,
      {} as TaskRecurrenceService,
    )
    const worker = service as unknown as {
      projectTaskEvent(taskId: string, type: string, payload: Record<string, unknown>): Promise<void>
    }
    // This is the actual recordEvent envelope, including a retry where the
    // idempotent projection writer returned null for an existing item.
    await worker.projectTaskEvent('task_1', 'task.comment_created', {
      taskId: 'task_1', actorId: 'author', aggregateVersion: 2,
      notificationDiff: { commentId: 'comment_1', feedItemId },
    })
    expect(findUnique).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})

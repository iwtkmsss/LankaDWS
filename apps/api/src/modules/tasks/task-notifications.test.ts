import { describe, expect, it, vi } from 'vitest'
import { notifyTaskParticipants, taskNotificationTitle } from './task-notifications.js'
import type { TaskTransaction } from './task-types.js'

describe('task notifications', () => {
  it.each(['task.reminder_changed', 'task.timer_started', 'task.timer_stopped', 'task.time_added', 'task.time_updated', 'task.time_deleted'])('stays silent for %s', async (action) => {
    const tx = { task: { findUnique: vi.fn() }, feedItem: { create: vi.fn() }, notification: { upsert: vi.fn() } }
    expect(await notifyTaskParticipants(tx as unknown as TaskTransaction, 'task', 'actor', 2, action)).toEqual([])
    expect(tx.feedItem.create).not.toHaveBeenCalled()
    expect(tx.notification.upsert).not.toHaveBeenCalled()
  })

  it('adds no alert of its own when a mention makes someone a watcher', async () => {
    const tx = { task: { findUnique: vi.fn() }, feedItem: { create: vi.fn() }, notification: { upsert: vi.fn() } }
    expect(await notifyTaskParticipants(tx as unknown as TaskTransaction, 'task', 'actor', 2, 'task.participant_added', { userIds: ['mentioned'], role: 'WATCHER', change: 'MENTION_ADDED' })).toEqual([])
    expect(tx.notification.upsert).not.toHaveBeenCalled()
  })

  it('tells only the comment author about a like and leaves the feed card in place', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const create = vi.fn()
    const tx = {
      task: { findUnique: vi.fn().mockResolvedValue({ id: 'task', number: '42', title: 'Task', workspaceId: 'workspace', companyId: 'company', createdById: 'poster', reporterId: 'poster', updatedAt: new Date(), participants: [{ userId: 'author', role: 'WATCHER' }, { userId: 'other', role: 'WATCHER' }] }) },
      feedItem: { findUnique: vi.fn(), create },
      user: { findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) => Promise.resolve(where.id.in.map((id) => ({ id })))) },
      notification: { upsert },
    } as unknown as TaskTransaction
    expect(await notifyTaskParticipants(tx, 'task', 'liker', 3, 'task.reaction_changed', { commentAuthorId: 'author' })).toEqual(['author'])
    expect(create).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledOnce()
    expect(await notifyTaskParticipants(tx, 'task', 'author', 4, 'task.reaction_changed', { commentAuthorId: 'author' })).toEqual([])
  })

  it.each([
    ['task.status_changed', { status: { from: 'IN_PROGRESS', to: 'IN_REVIEW' } }, { in: ['task-review:task:5', 'task-returned:task:5'] }],
    ['task.status_changed', { status: { from: 'IN_REVIEW', to: 'IN_PROGRESS' } }, { in: ['task-review:task:5', 'task-returned:task:5'] }],
    ['task.comment_updated', { commentId: 'comment', commentVersion: 2 }, { startsWith: 'task-comment-edited:comment:2:' }],
  ])('sends one alert per person for %s %j', async (action, diff, dedupeKey) => {
    const upsert = vi.fn().mockResolvedValue({})
    const findMany = vi.fn().mockResolvedValue([{ recipientId: 'alerted' }])
    const tx = {
      task: { findUnique: vi.fn().mockResolvedValue({ id: 'task', number: '42', title: 'Task', workspaceId: 'workspace', companyId: 'company', createdById: 'actor', reporterId: 'alerted', updatedAt: new Date(), participants: [{ userId: 'other', role: 'WATCHER' }] }) },
      feedItem: { findUnique: vi.fn().mockResolvedValue({ id: 'existing_projection' }) },
      user: { findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) => Promise.resolve(where.id.in.map((id) => ({ id })))) },
      notification: { upsert, findMany },
    } as unknown as TaskTransaction
    expect(await notifyTaskParticipants(tx, 'task', 'actor', 5, action, diff)).toEqual(['other'])
    expect(findMany).toHaveBeenCalledWith({ where: { dedupeKey }, select: { recipientId: true } })
  })

  it.each(['task.checklist_changed', 'task.relation_changed', 'task.recurrence_changed', 'task.comment_updated', 'task.comment_deleted', 'task.future_change'])('advances the task card and deduplicates delivery for %s', async (action) => {
    const projections = new Map<string, { id: string }>()
    const notifications = new Map<string, unknown>()
    const upsertHead = vi.fn().mockResolvedValue({})
    const now = new Date('2026-10-22T12:00:00Z')
    const tx = {
      task: { findUnique: vi.fn().mockResolvedValue({
        id: 'task', workspaceId: 'workspace', companyId: 'company', number: '42', title: 'Task',
        createdById: 'actor', reporterId: 'poster', participants: [], updatedAt: now,
      }) },
      feedItem: {
        findUnique: vi.fn(({ where }: { where: { eventKey: string } }) => Promise.resolve(projections.get(where.eventKey) ?? null)),
        create: vi.fn(({ data }: { data: { id: string; eventKey: string } }) => { projections.set(data.eventKey, { id: data.id }); return Promise.resolve(data) }),
      },
      feedSourceHead: {
        findUnique: vi.fn().mockResolvedValue({ itemId: 'old', sourceVersion: 1, occurredAt: new Date('2026-10-21T12:00:00Z') }),
        upsert: upsertHead,
      },
      user: { findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) => Promise.resolve(where.id.in.map((id) => ({ id })))) },
      feedItemRecipient: { createMany: vi.fn().mockResolvedValue({}) },
      notification: { upsert: vi.fn(({ where, create }: { where: { dedupeKey: string }; create: unknown }) => { notifications.set(where.dedupeKey, create); return Promise.resolve(create) }) },
    } as unknown as TaskTransaction
    await notifyTaskParticipants(tx, 'task', 'actor', 2, action)
    await notifyTaskParticipants(tx, 'task', 'actor', 2, action)
    expect(projections.size).toBe(1)
    expect(notifications.size).toBe(1)
    expect(upsertHead).toHaveBeenCalledOnce()
    const calls = upsertHead.mock.calls as Array<[{ update: { sourceVersion: number; occurredAt: Date } }]>
    expect(calls[0][0].update.sourceVersion).toBe(2)
    expect(calls[0][0].update.occurredAt).toEqual(now)
  })

  it('delivers once to every other active role and poster, with action only for responsible', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const findMany = vi.fn().mockResolvedValue([{ id: 'responsible' }, { id: 'collaborator' }, { id: 'watcher' }, { id: 'poster' }])
    const tx = {
      feedItem: { findUnique: vi.fn().mockResolvedValue({ id: 'existing_projection' }) },
      task: { findUnique: vi.fn().mockResolvedValue({
        number: '42', title: 'Підготувати звіт', workspaceId: 'workspace', createdById: 'actor', reporterId: 'poster',
        participants: [
          { userId: 'actor', role: 'WATCHER' }, { userId: 'responsible', role: 'RESPONSIBLE' },
          { userId: 'collaborator', role: 'COLLABORATOR' }, { userId: 'watcher', role: 'WATCHER' },
          { userId: 'poster', role: 'WATCHER' },
        ],
      }) }, user: { findMany }, notification: { upsert },
    } as unknown as TaskTransaction
    await notifyTaskParticipants(tx, 'task', 'actor', 1, 'task.created')
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace', isActive: true, id: { in: ['poster', 'responsible', 'collaborator', 'watcher'] } } }))
    expect(upsert).toHaveBeenCalledTimes(4)
    const creates = upsert.mock.calls.map(([input]) => (input as { create: { recipientId: string; requiresAction: boolean; safeSnippet: string; dedupeKey: string } }).create)
    expect(creates.filter((item) => item.requiresAction).map((item) => item.recipientId)).toEqual(['responsible'])
    expect(creates.every((item) => item.safeSnippet === '№42 · Підготувати звіт')).toBe(true)
    await notifyTaskParticipants(tx, 'task', 'actor', 1, 'task.created')
    expect((upsert.mock.calls[0][0] as { where: unknown }).where).toEqual((upsert.mock.calls[4][0] as { where: unknown }).where)
    await notifyTaskParticipants(tx, 'task', 'actor', 2, 'task.status_changed', { status: { from: 'DONE', to: 'IN_PROGRESS' } })
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace', isActive: true, id: { in: ['actor', 'poster', 'responsible', 'collaborator', 'watcher'] } } }))
  })

  it('explains status transitions and changed fields compactly', () => {
    expect(taskNotificationTitle('task.status_changed', { status: { from: 'NEW', to: 'IN_PROGRESS' } })).toBe('Статус: Нове → В роботі')
    expect(taskNotificationTitle('task.status_changed', { status: { from: 'DONE', to: 'IN_PROGRESS' } })).toBe('Завдання відновлено — в роботі')
    expect(taskNotificationTitle('task.updated', { changedFields: ['title', 'description', 'priority'], changes: { title: 'Звіт', priority: 'HIGH' } })).toBe('Зміни: назва: «Звіт»; опис; пріоритет: високий')
    expect(taskNotificationTitle('task.updated', { changedFields: [] })).toBe('Завдання оновлено')
    expect(taskNotificationTitle('task.comment_created')).toBe('Нове повідомлення у завданні')
    expect(taskNotificationTitle('task.future_change')).toBe('Завдання оновлено')
  })
})

describe('delegation notifications', () => {
  it.each(['former', 'poster'])('notifies the replaced responsible when delegation is performed by %s', async (actorId) => {
    const upsert = vi.fn().mockResolvedValue({})
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const tx = {
      feedItem: { findUnique: vi.fn().mockResolvedValue({ id: 'existing_projection' }) },
      task: { findUnique: vi.fn().mockResolvedValue({ number: '42', title: 'Task', workspaceId: 'workspace', createdById: 'poster', reporterId: 'poster', participants: [{ userId: 'former', role: 'WATCHER' }, { userId: 'new', role: 'RESPONSIBLE' }] }) },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Новий виконавець' }), findMany: vi.fn().mockImplementation((input: { where: { id: { in: string[] } } }) => Promise.resolve(input.where.id.in.map((id) => ({ id })))) },
      notification: { upsert, updateMany },
    } as unknown as TaskTransaction
    await notifyTaskParticipants(tx, 'task', actorId, 4, 'task.participant_changed', { change: 'DELEGATED', userId: 'new', role: 'RESPONSIBLE', previousResponsibleId: 'former' })
    const notifications = upsert.mock.calls.map(([input]) => (input as { create: { recipientId: string; safeTitle: string; requiresAction: boolean } }).create)
    expect(notifications.find((item) => item.recipientId === 'former')).toMatchObject({ safeTitle: 'Завдання делеговано — ви тепер спостерігач', requiresAction: false })
    expect(notifications.find((item) => item.recipientId === 'new')).toMatchObject({ requiresAction: true })
    expect(updateMany).toHaveBeenCalledWith({
      where: { entityType: 'TASK', entityId: 'task', requiresAction: true, recipientId: 'former' },
      data: { requiresAction: false },
    })
  })
})

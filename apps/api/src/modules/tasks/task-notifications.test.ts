import { describe, expect, it, vi } from 'vitest'
import { notifyTaskParticipants, taskNotificationTitle } from './task-notifications.js'
import type { TaskTransaction } from './task-types.js'

describe('task notifications', () => {
  it('delivers once to every other active role and poster, with action only for responsible', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const findMany = vi.fn().mockResolvedValue([{ id: 'responsible' }, { id: 'collaborator' }, { id: 'watcher' }, { id: 'poster' }])
    const tx = {
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
    expect(taskNotificationTitle('task.updated', { changedFields: [] })).toBeNull()
    expect(taskNotificationTitle('task.comment_created')).toBeNull()
  })
})

describe('delegation notifications', () => {
  it.each(['former', 'poster'])('notifies the replaced responsible when delegation is performed by %s', async (actorId) => {
    const upsert = vi.fn().mockResolvedValue({})
    const tx = {
      task: { findUnique: vi.fn().mockResolvedValue({ number: '42', title: 'Task', workspaceId: 'workspace', createdById: 'poster', reporterId: 'poster', participants: [{ userId: 'former', role: 'WATCHER' }, { userId: 'new', role: 'RESPONSIBLE' }] }) },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Новий виконавець' }), findMany: vi.fn().mockImplementation((input: { where: { id: { in: string[] } } }) => Promise.resolve(input.where.id.in.map((id) => ({ id })))) },
      notification: { upsert },
    } as unknown as TaskTransaction
    await notifyTaskParticipants(tx, 'task', actorId, 4, 'task.participant_changed', { change: 'DELEGATED', userId: 'new', role: 'RESPONSIBLE', previousResponsibleId: 'former' })
    const notifications = upsert.mock.calls.map(([input]) => (input as { create: { recipientId: string; safeTitle: string; requiresAction: boolean } }).create)
    expect(notifications.find((item) => item.recipientId === 'former')).toMatchObject({ safeTitle: 'Завдання делеговано — ви тепер спостерігач', requiresAction: false })
    expect(notifications.find((item) => item.recipientId === 'new')).toMatchObject({ requiresAction: true })
  })
})

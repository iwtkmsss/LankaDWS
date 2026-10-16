import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { MessagesService } from './messages.service.js'

const principal = { userId: 'me', workspaceId: 'workspace' } as AuthPrincipal

function setup() {
  const preferences = {
    findMany: vi.fn().mockResolvedValue([{ key: 'PIN:old' }]),
    upsert: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  }
  const findMany = vi.fn().mockResolvedValue([])
  const publishSummary = vi.fn()
  const service = new MessagesService({ userUiPreference: preferences, messageThread: { findMany } } as never,
    { allowedCompanies: () => ['company'] } as never, {} as never, { publishSummary } as never)
  const readableThread = vi.fn().mockResolvedValue({ participants: [{ userId: 'me', leftAt: null }] })
  Object.assign(service, {
    readableThread,
    safeUsers: vi.fn().mockResolvedValue(new Map()),
    unreadCounts: vi.fn().mockResolvedValue(new Map([['new', 1]])),
    threadSummary: vi.fn().mockResolvedValue({ all: 3, unread: 1 }),
    threadListItem: (_: unknown, thread: { id: string }, __: unknown, unread: number) => ({ id: thread.id, unread: unread > 0 }),
    encodeThreadCursor: (thread: { id: string }) => thread.id,
  })
  return { service, preferences, findMany, publishSummary, readableThread }
}

describe('personal chat pins', () => {
  it('stores a pin idempotently for the actor and publishes only to that user', async () => {
    const { service, preferences, publishSummary } = setup()
    expect(await service.setPin(principal, 'old', true)).toEqual({ pinned: true })
    expect(preferences.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_module_key: { userId: 'me', module: 'MESSAGES', key: 'PIN:old' } }, update: {},
    }))
    expect(publishSummary).toHaveBeenCalledWith(['me'], ['messages'])
    await service.setPin(principal, 'old', false)
    expect(preferences.deleteMany).toHaveBeenCalledWith({ where: { userId: 'me', module: 'MESSAGES', key: 'PIN:old' } })
  })

  it('rejects nonmembers and former members before writing', async () => {
    const { service, preferences, readableThread } = setup()
    readableThread.mockResolvedValue({ participants: [{ userId: 'me', leftAt: new Date() }] })
    await expect(service.setPin(principal, 'old', true)).rejects.toThrow()
    expect(preferences.upsert).not.toHaveBeenCalled()
    readableThread.mockRejectedValue(new Error('not found'))
    await expect(service.setPin(principal, 'foreign', false)).rejects.toThrow('not found')
    expect(preferences.deleteMany).not.toHaveBeenCalled()
  })

  it('includes old pins on the first page without moving the regular pagination cursor', async () => {
    const { service, findMany } = setup()
    findMany.mockResolvedValueOnce([{ id: 'new', participants: [], messages: [] }, { id: 'next', participants: [], messages: [] }])
      .mockResolvedValueOnce([{ id: 'old', participants: [], messages: [] }])
    const result = await service.threads(principal, { company: 'all', limit: 1, unread: false })
    expect(result.items).toEqual([{ id: 'old', unread: false, pinned: true }, { id: 'new', unread: true, pinned: false }])
    expect(result.nextCursor).toBe('new')
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({ where: {
      workspaceId: 'workspace', companyId: { in: ['company'] },
      participants: { some: { userId: 'me', leftAt: null } }, id: { in: ['old'] },
    } })
  })

  it('keeps read pins out of the unread filter', async () => {
    const { service, findMany } = setup()
    Object.assign(service, { unreadThreadPageIds: vi.fn().mockResolvedValue(['new']) })
    findMany.mockResolvedValueOnce([{ id: 'new', participants: [], messages: [] }])
      .mockResolvedValueOnce([{ id: 'old', participants: [], messages: [] }])
    expect((await service.threads(principal, { company: 'all', limit: 1, unread: true })).items)
      .toEqual([{ id: 'new', unread: true, pinned: false }])
  })
})

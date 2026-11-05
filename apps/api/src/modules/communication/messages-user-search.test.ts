import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { MessagesService } from './messages.service.js'

const principal = { workspaceId: 'workspace', userId: 'me' } as AuthPrincipal

function setup() {
  const findMany = vi.fn().mockResolvedValue([])
  const service = new MessagesService({ user: { findMany } } as never, {} as never, {} as never, {} as never)
  const directThreadsForUsers = vi.fn().mockResolvedValue(new Map([['admin', 'direct-thread']]))
  const readableThread = vi.fn().mockResolvedValue({ companyId: 'company', participants: [
    { userId: 'me', leftAt: null }, { userId: 'admin', leftAt: null }, { userId: 'former', leftAt: new Date() },
  ] })
  Object.assign(service, { directThreadsForUsers, readableThread })
  return { service, findMany, directThreadsForUsers, readableThread }
}

describe('chat adapters for shared user search', () => {
  it('excludes self and selected people before the cap and retains canonical direct-thread IDs', async () => {
    const { service, findMany, directThreadsForUsers } = setup()
    findMany.mockResolvedValueOnce([{ id: 'admin', displayName: 'Адміністратор', username: 'admin', jobTitle: '', avatarAsset: 'file_avatar', accountType: 'ADMIN' }])
    expect((await service.searchUsers(principal, { company: 'all', q: 'а', limit: 1000, exclude: 'selected' })).items)
      .toEqual([{ id: 'admin', displayName: 'Адміністратор', username: 'admin', jobTitle: '', avatarAsset: 'file_avatar', directThreadId: 'direct-thread' }])
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { workspaceId: 'workspace', isActive: true,
      AND: [{}, expect.any(Object), { id: { notIn: ['me', 'selected'] } }] }, take: 5 })
    expect(directThreadsForUsers).toHaveBeenCalledWith(principal, ['admin'])
  })

  it('searches mentions within active participants after checking chat access', async () => {
    const { service, findMany, readableThread } = setup()
    await service.mentionCandidates(principal, 'private-chat', { q: 'а', limit: 1000 })
    expect(readableThread).toHaveBeenCalledWith(principal, 'private-chat')
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { AND: [{ id: { in: ['me', 'admin'] } }, expect.any(Object), expect.any(Object)] }, take: 5 })
    findMany.mockClear()
    readableThread.mockRejectedValueOnce(new Error('Forbidden'))
    await expect(service.mentionCandidates(principal, 'private-chat', { q: 'а', limit: 5 })).rejects.toThrow('Forbidden')
    expect(findMany).not.toHaveBeenCalled()
  })
})

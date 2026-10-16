import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { ScopeService } from '../authorization/scope.service.js'
import { FeedService } from './feed.service.js'

const principal = { workspaceId: 'workspace', userId: 'me', allowedCompanyIds: ['company'], accountType: 'USER' } as AuthPrincipal

function setup() {
  const findMany = vi.fn().mockResolvedValue([])
  const service = new FeedService({ user: { findMany } } as never, new ScopeService(), {} as never)
  const accessiblePost = vi.fn().mockResolvedValue({ companyId: 'company', authorId: 'author', recipients: [
    { type: 'COMPANY', recipientId: 'company' }, { type: 'USER', recipientId: 'explicit-recipient' },
  ] })
  Object.assign(service, { accessiblePost })
  return { service, findMany, accessiblePost }
}

describe('feed adapters for shared user search', () => {
  it('searches a company audience in SQL without loading all its users', async () => {
    const { service, findMany } = setup()
    await service.mentionCandidates(principal, { company: 'company', audienceType: 'COMPANY', q: 'а', limit: 1000 })
    expect(findMany).toHaveBeenCalledTimes(3)
    for (const [query] of findMany.mock.calls) {
      expect(query).toMatchObject({ where: { workspaceId: 'workspace', isActive: true, AND: [
        { AND: [{ OR: [{ primaryCompanyId: 'company' }, { id: 'me' }] }, { OR: [{ primaryCompanyId: 'company' }, { accountType: 'ADMIN' }] }] },
        expect.any(Object), expect.any(Object),
      ] }, take: 5, select: { avatarAsset: true } })
    }
  })

  it('keeps stored company and explicit-recipient eligibility after checking access', async () => {
    const { service, findMany, accessiblePost } = setup()
    await service.postMentionCandidates(principal, 'private-post', { q: 'а', limit: 5 })
    expect(accessiblePost).toHaveBeenCalledWith(principal, 'private-post')
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { AND: [{ AND: [
      { OR: [{ primaryCompanyId: { in: ['company'] } }, { id: { in: ['author', 'explicit-recipient'] } }] },
      { OR: [{ primaryCompanyId: 'company' }, { accountType: 'ADMIN' }] },
    ] }, expect.any(Object), expect.any(Object)] }, take: 5 })
    findMany.mockClear()
    accessiblePost.mockRejectedValueOnce(new Error('Forbidden'))
    await expect(service.postMentionCandidates(principal, 'private-post', { q: 'а', limit: 5 })).rejects.toThrow('Forbidden')
    expect(findMany).not.toHaveBeenCalled()
  })

  it('does not query users for a blank mention search', async () => {
    const { service, findMany } = setup()
    expect(await service.mentionCandidates(principal, { company: 'company', audienceType: 'COMPANY', q: '', limit: 5 })).toEqual({ items: [] })
    expect(findMany).not.toHaveBeenCalled()
  })
})

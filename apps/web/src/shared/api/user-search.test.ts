import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchUsers } from './user-search'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./client', () => ({ api: request }))
beforeEach(() => { request.mockReset().mockResolvedValue({ items: [] }) })

describe('shared user search request', () => {
  it('does not request an empty query', async () => {
    expect(await searchUsers(' \t ')).toEqual({ items: [] })
    expect(request).not.toHaveBeenCalled()
  })

  it('normalizes names and asks for five results including administrators by default', async () => {
    const controller = new AbortController()
    await searchUsers('  ОЛЕНА’  ', { signal: controller.signal })
    expect(request).toHaveBeenCalledWith('/employees?search=%D0%BE%D0%BB%D0%B5%D0%BD%D0%B0%27&limit=5&accountType=ALL', { signal: controller.signal })
  })

  it('preserves context and exclusions for employee and chat selectors', async () => {
    await searchUsers('a', { companyId: 'company', includeAdmins: false, excludeIds: ['selected'], managersOnly: true })
    expect(request).toHaveBeenLastCalledWith('/employees?search=a&limit=5&accountType=USER&managersOnly=true&company=company&exclude=selected', { signal: undefined })
    await searchUsers('a', { endpoint: '/messages/users/search', params: { company: 'all' }, excludeIds: ['selected'] })
    expect(request).toHaveBeenLastCalledWith('/messages/users/search?company=all&q=a&limit=5&exclude=selected', { signal: undefined })
  })

  it('keeps mention audience parameters while using the same user search policy', async () => {
    await searchUsers('М', { endpoint: '/feed/mention-candidates?company=company&audienceType=COMPANY' })
    expect(request).toHaveBeenLastCalledWith('/feed/mention-candidates?company=company&audienceType=COMPANY&q=%D0%BC&limit=5', { signal: undefined })
  })

  it('passes a large exclusion list in the request body without truncation', async () => {
    const excludeIds = Array.from({ length: 1000 }, (_, index) => `user-${index}`)
    await searchUsers('а', { excludeIds })
    expect(request).toHaveBeenLastCalledWith('/employees/search', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(request.mock.calls[0]![1].body)
    expect(body).toMatchObject({ q: 'а', limit: 5, accountType: 'ALL' })
    expect(body.excludeIds).toEqual(excludeIds)
  })
})

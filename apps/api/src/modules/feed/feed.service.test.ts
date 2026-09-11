import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { ScopeService } from '../authorization/scope.service.js'
import type { FilesService } from '../files/files.service.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { FeedService } from './feed.service.js'

function principal(overrides: Partial<AuthPrincipal> = {}): AuthPrincipal {
  return {
    userId: 'usr_maria',
    workspaceId: 'ws_lankadws',
    username: 'maria',
    displayName: 'Maria',
    primaryCompanyId: 'cmp_a',
    accountType: 'USER',
    allowedCompanyIds: ['cmp_a', 'cmp_b', 'cmp_c'],
    authorizationVersion: 1,
    sessionId: 'sess_1',
    authAssurance: 1,
    restricted: false,
    ...overrides,
  }
}

interface PrismaMock {
  user: { findMany: ReturnType<typeof vi.fn> }
  group: { findFirst: ReturnType<typeof vi.fn> }
  feedReadCursor: { findMany: ReturnType<typeof vi.fn> }
  feedSourceHead: { count: ReturnType<typeof vi.fn> }
}

function makeService(prisma: PrismaMock) {
  const service = new FeedService(
    prisma as unknown as PrismaService,
    new ScopeService(),
    null as unknown as FilesService,
  )
  const internal = service as unknown as {
    resolveAudience(
      principal: AuthPrincipal,
      companyId: string,
      audience: unknown,
    ): Promise<{
      groupId: string | null
      recipients: Array<{ type: string; recipientId: string }>
      userIds: string[]
      companyIds: string[]
    }>
    unreadCount(
      principal: AuthPrincipal,
      companyIds: string[],
      access: Record<string, unknown>,
    ): Promise<number>
  }
  return { service, internal }
}

describe('FeedService.resolveAudience', () => {
  it('expands a single-company audience to that company only', async () => {
    const prisma: PrismaMock = {
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
      group: { findFirst: vi.fn() },
      feedReadCursor: { findMany: vi.fn() },
      feedSourceHead: { count: vi.fn() },
    }
    const { internal } = makeService(prisma)

    const resolved = await internal.resolveAudience(principal(), 'cmp_a', { type: 'COMPANY' })

    expect(resolved).toEqual({
      groupId: null,
      recipients: [{ type: 'COMPANY', recipientId: 'cmp_a' }],
      userIds: ['u1', 'u2'],
      companyIds: ['cmp_a'],
    })
  })

  it('expands a multi-company audience to one recipient and a de-duplicated user union per company', async () => {
    const prisma: PrismaMock = {
      user: {
        findMany: vi.fn().mockImplementation(({ where }: { where: { primaryCompanyId: string } }) =>
          where.primaryCompanyId === 'cmp_a'
            ? Promise.resolve([{ id: 'u1' }, { id: 'u2' }])
            : Promise.resolve([{ id: 'u2' }, { id: 'u3' }])),
      },
      group: { findFirst: vi.fn() },
      feedReadCursor: { findMany: vi.fn() },
      feedSourceHead: { count: vi.fn() },
    }
    const { internal } = makeService(prisma)

    const resolved = await internal.resolveAudience(principal(), 'cmp_a', {
      type: 'COMPANIES',
      companyIds: ['cmp_a', 'cmp_b', 'cmp_b'],
    })

    expect(resolved.companyIds).toEqual(['cmp_a', 'cmp_b'])
    expect(resolved.recipients).toEqual([
      { type: 'COMPANY', recipientId: 'cmp_a' },
      { type: 'COMPANY', recipientId: 'cmp_b' },
    ])
    expect([...resolved.userIds].sort()).toEqual(['u1', 'u2', 'u3'])
    expect(resolved.groupId).toBeNull()
  })

  it('rejects a multi-company audience that omits the primary company', async () => {
    const { internal } = makeService({
      user: { findMany: vi.fn() },
      group: { findFirst: vi.fn() },
      feedReadCursor: { findMany: vi.fn() },
      feedSourceHead: { count: vi.fn() },
    })

    await expect(internal.resolveAudience(principal(), 'cmp_a', {
      type: 'COMPANIES',
      companyIds: ['cmp_b', 'cmp_c'],
    })).rejects.toMatchObject({ status: 400, code: 'feed_company_audience' })
  })

  it('rejects a multi-company audience that reaches outside the caller scope', async () => {
    const { internal } = makeService({
      user: { findMany: vi.fn() },
      group: { findFirst: vi.fn() },
      feedReadCursor: { findMany: vi.fn() },
      feedSourceHead: { count: vi.fn() },
    })

    await expect(internal.resolveAudience(principal(), 'cmp_a', {
      type: 'COMPANIES',
      companyIds: ['cmp_a', 'cmp_x'],
    })).rejects.toMatchObject({ status: 400, code: 'feed_company_audience' })
  })
})

describe('FeedService.audienceLabel', () => {
  type AudienceLabelPost = {
    group: { name: string } | null
    recipients: Array<{ type: 'COMPANY' | 'GROUP' | 'USER'; recipientId: string }>
  }
  function label(
    post: AudienceLabelPost,
    directNameById: Map<string, string>,
    companyNameById: Map<string, string>,
    totalActiveCompanies: number,
  ): string {
    const { service } = makeService({
      user: { findMany: vi.fn() },
      group: { findFirst: vi.fn() },
      feedReadCursor: { findMany: vi.fn() },
      feedSourceHead: { count: vi.fn() },
    })
    const internal = service as unknown as {
      audienceLabel(
        post: AudienceLabelPost,
        directNameById: Map<string, string>,
        companyNameById: Map<string, string>,
        totalActiveCompanies: number,
      ): string
    }
    return internal.audienceLabel(post, directNameById, companyNameById, totalActiveCompanies)
  }

  it('names every employee when the post reaches all active companies', () => {
    const post: AudienceLabelPost = {
      group: null,
      recipients: [
        { type: 'COMPANY', recipientId: 'cmp_a' },
        { type: 'COMPANY', recipientId: 'cmp_b' },
      ],
    }
    expect(label(post, new Map(), new Map([['cmp_a', 'A'], ['cmp_b', 'B']]), 2)).toBe('Всім співробітникам')
  })

  it('lists the addressed companies inline when it does not reach everyone', () => {
    const post: AudienceLabelPost = {
      group: null,
      recipients: [
        { type: 'COMPANY', recipientId: 'cmp_a' },
        { type: 'COMPANY', recipientId: 'cmp_b' },
      ],
    }
    expect(label(post, new Map(), new Map([['cmp_a', 'БЕРТ Україна'], ['cmp_b', 'БЕРТ Сервіс']]), 3))
      .toBe('БЕРТ Україна, БЕРТ Сервіс')
  })

  it('keeps the whole-organization label for a single-company audience', () => {
    const post: AudienceLabelPost = { group: null, recipients: [{ type: 'COMPANY', recipientId: 'cmp_a' }] }
    expect(label(post, new Map(), new Map(), 4)).toBe('Вся організація')
  })

  it('lists every direct recipient by name without truncation', () => {
    const post: AudienceLabelPost = {
      group: null,
      recipients: [
        { type: 'USER', recipientId: 'u1' },
        { type: 'USER', recipientId: 'u2' },
        { type: 'USER', recipientId: 'u3' },
      ],
    }
    const names = new Map([['u1', 'Олена'], ['u2', 'Андрій'], ['u3', 'Дмитро']])
    expect(label(post, names, new Map(), 4)).toBe('Олена, Андрій, Дмитро')
  })
})

describe('FeedService.unreadCount', () => {
  it('counts every unread head for a company with no read cursor', async () => {
    const count = vi.fn().mockResolvedValue(4)
    const { internal } = makeService({
      user: { findMany: vi.fn() },
      group: { findFirst: vi.fn() },
      feedReadCursor: { findMany: vi.fn().mockResolvedValue([]) },
      feedSourceHead: { count },
    })

    const total = await internal.unreadCount(principal(), ['cmp_a', 'cmp_b'], {})

    expect(total).toBe(4)
    const calls = count.mock.calls as Array<[{ where: {
      countsAsUnread: boolean
      AND: Array<{ OR?: Array<Record<string, unknown>> }>
    } }]>
    const where = calls[0][0].where
    expect(where.countsAsUnread).toBe(true)
    const positionFilters = where.AND.find((clause) => clause.OR)?.OR
    expect(positionFilters).toEqual([{ companyId: 'cmp_a' }, { companyId: 'cmp_b' }])
  })

  it('only counts heads after the stored cursor position for a company that has one', async () => {
    const readAt = new Date('2026-09-01T00:00:00.000Z')
    const count = vi.fn().mockResolvedValue(1)
    const { internal } = makeService({
      user: { findMany: vi.fn() },
      group: { findFirst: vi.fn() },
      feedReadCursor: {
        findMany: vi.fn().mockResolvedValue([
          { companyId: 'cmp_a', lastReadOccurredAt: readAt, lastReadItemId: 'fitem_10' },
        ]),
      },
      feedSourceHead: { count },
    })

    await internal.unreadCount(principal(), ['cmp_a', 'cmp_b'], {})

    const calls = count.mock.calls as Array<[{ where: {
      AND: Array<{ OR?: Array<Record<string, unknown>> }>
    } }]>
    const positionFilters = calls[0][0].where.AND.find((clause) => clause.OR)?.OR
    expect(positionFilters).toEqual([
      {
        companyId: 'cmp_a',
        OR: [
          { occurredAt: { gt: readAt } },
          { occurredAt: readAt, itemId: { gt: 'fitem_10' } },
        ],
      },
      { companyId: 'cmp_b' },
    ])
  })
})

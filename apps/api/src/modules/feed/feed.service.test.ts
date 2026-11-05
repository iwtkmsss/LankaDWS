import { describe, expect, it, vi } from 'vitest'
import type { FeedSourceView } from '@lankadws/contracts'
import { feedListQuerySchema, type FeedEntryView, type FeedPostView } from '@lankadws/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import { ScopeService } from '../authorization/scope.service.js'
import type { FilesService } from '../files/files.service.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { FeedService } from './feed.service.js'
import { writeFeedProjection } from './feed-projection.service.js'

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

describe('FeedService acknowledgement priority', () => {
  function setup() {
    const viewer = principal()
    const head = (id: string, date: string, pending = false) => ({
      companyId: 'cmp_a', itemId: id, occurredAt: new Date(date),
      item: {
        id, companyId: 'cmp_a', occurredAt: new Date(date), postId: pending ? id : null,
        post: pending ? {
          id, requiresAcknowledgement: true, acknowledgementVersion: 1,
          acknowledgementRecipients: [{ userId: viewer.userId, acknowledgementVersion: 1 }], acknowledgements: [],
        } : null,
      },
    })
    const newer = head('new_task', '2026-10-22T12:00:00Z')
    const pinned = [head('mandatory_1', '2026-10-02T12:00:00Z', true), head('mandatory_2', '2026-10-01T12:00:00Z', true)]
    const recipients = vi.fn().mockResolvedValue(pinned.map((row) => ({ postId: row.itemId, acknowledgementVersion: 1, post: { acknowledgementVersion: 1 } })))
    const acknowledgements = vi.fn().mockResolvedValue([])
    const findMany = vi.fn().mockResolvedValueOnce(pinned).mockResolvedValueOnce([newer])
    const prisma = {
      feedUserItemState: { findMany: vi.fn().mockResolvedValue([]) },
      feedSourceHead: { findMany, count: vi.fn().mockResolvedValue(0) },
      feedReadCursor: { findMany: vi.fn().mockResolvedValue([]) },
      notification: { findMany: vi.fn().mockResolvedValue([]) },
      feedAcknowledgementRecipient: { findMany: recipients },
      feedPostAcknowledgement: { findMany: acknowledgements },
      event: { findMany: vi.fn().mockResolvedValue([]) },
      task: { count: vi.fn().mockResolvedValue(0) },
    }
    const service = new FeedService(prisma as unknown as PrismaService, new ScopeService(), null as unknown as FilesService)
    type Item = (typeof newer)['item']
    vi.spyOn(service as unknown as { toEntries(user: AuthPrincipal, items: Item[]): Promise<FeedEntryView[]> }, 'toEntries')
      .mockImplementation((_user, items) => Promise.resolve(items.map((item) => item.post ? {
        kind: 'POST', id: item.id, itemId: item.id, acknowledgementRequiredForMe: true, hasAcknowledged: false,
      } as FeedPostView : { kind: 'SOURCE', id: item.id, itemId: item.id } as FeedSourceView)))
    return { service, findMany, recipients, acknowledgements, pinned, newer, viewer, events: prisma.event.findMany, personalPins: prisma.feedUserItemState.findMany }
  }

  it('puts old mandatory posts before newer task updates and continues both sections without losing the timeline', async () => {
    const { service, findMany, pinned, newer, viewer } = setup()
    const first = await service.list(viewer, feedListQuerySchema.parse({ limit: 1 }))
    expect(first.items.map((item) => item.id)).toEqual(['mandatory_1'])
    expect(first.readMarkers).toEqual([{ companyId: 'cmp_a', lastItemId: 'new_task' }])
    expect(first.attention.pendingAcknowledgements).toBe(2)
    findMany.mockResolvedValueOnce([pinned[1]]).mockResolvedValueOnce([newer])
    const second = await service.list(viewer, feedListQuerySchema.parse({ limit: 1, cursor: first.nextCursor }))
    expect(second.items.map((item) => item.id)).toEqual(['mandatory_2'])
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([newer])
    const third = await service.list(viewer, feedListQuerySchema.parse({ limit: 1, cursor: second.nextCursor }))
    expect(third.items.map((item) => item.id)).toEqual(['new_task'])
    expect(third.nextCursor).toBeNull()
    const calls = findMany.mock.calls as Array<[{ where: { AND: unknown[] } }]>
    // While leaving the priority section, the normal timeline starts at its top.
    expect(calls[5][0].where.AND).toHaveLength(1)
  })

  it('returns acknowledged posts to the normal timeline, using only current-version receipts', async () => {
    const { service, findMany, acknowledgements, pinned, newer, viewer } = setup()
    acknowledgements.mockResolvedValue([{ postId: 'mandatory_1', acknowledgementVersion: 1 }, { postId: 'mandatory_2', acknowledgementVersion: 1 }])
    findMany.mockReset().mockResolvedValueOnce([newer, ...pinned])
    const result = await service.list(viewer, feedListQuerySchema.parse({ limit: 20 }))
    expect(result.items.map((item) => item.id)).toEqual(['new_task', 'mandatory_1', 'mandatory_2'])
    expect(result.attention.pendingAcknowledgements).toBe(0)
    expect(findMany).toHaveBeenCalledOnce()
    expect((findMany.mock.calls[0][0] as { where: { AND: Array<{ item: { is: { AND: unknown[] } } }> } }).where.AND[0].item.is.AND).toContainEqual({ AND: [
      { OR: [{ postId: null }, { postId: { notIn: [] } }] },
      { NOT: { sourceType: 'EVENT', sourceId: { in: [] } } },
    ] })
  })

  it('pins current pending calendar revisions ahead of the timeline and excludes stale receipts', async () => {
    const { service, findMany, events, acknowledgements, pinned, newer, viewer } = setup()
    acknowledgements.mockResolvedValue(pinned.map((row) => ({ postId: row.itemId, acknowledgementVersion: 1 })))
    events.mockResolvedValue([
      { id: 'event_1', version: 2, acknowledgements: [{ eventVersion: 2 }] },
      { id: 'stale_event', version: 3, acknowledgements: [{ eventVersion: 2 }] },
    ])
    const eventItem = { ...newer, itemId: 'event_head', occurredAt: new Date('2026-09-01'), item: {
      ...newer.item, id: 'event_head', sourceType: 'EVENT', sourceId: 'event_1', occurredAt: new Date('2026-09-01'),
    } }
    findMany.mockReset().mockResolvedValueOnce([eventItem]).mockResolvedValueOnce([newer])
    const first = await service.list(viewer, feedListQuerySchema.parse({ limit: 1 }))
    expect(first.items[0].itemId).toBe('event_head')
    expect(first.attention.pendingAcknowledgements).toBe(1)
    expect((findMany.mock.calls[0][0] as { where: { AND: Array<{ item: { is: { OR: unknown[] } } }> } }).where.AND[0].item.is.OR).toContainEqual({ sourceType: 'EVENT', sourceId: { in: ['event_1'] } })
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([newer])
    const next = await service.list(viewer, feedListQuerySchema.parse({ limit: 1, cursor: first.nextCursor }))
    expect(next.items[0].itemId).toBe('new_task')
    expect((findMany.mock.calls[2][0] as { where: { AND: unknown[] } }).where.AND).toHaveLength(2)
    events.mockResolvedValue([])
    findMany.mockResolvedValueOnce([newer, eventItem])
    const confirmed = await service.list(viewer, feedListQuerySchema.parse({ limit: 20 }))
    expect(confirmed.items.map((item) => item.itemId)).toEqual(['new_task', 'event_head'])
    expect(confirmed.attention.pendingAcknowledgements).toBe(0)
  })

  it('paginates personal pins after acknowledgements and before the regular timeline', async () => {
    const { service, findMany, acknowledgements, viewer, personalPins, newer } = setup()
    acknowledgements.mockResolvedValue([{ postId: 'mandatory_1', acknowledgementVersion: 1 }, { postId: 'mandatory_2', acknowledgementVersion: 1 }])
    personalPins.mockResolvedValue([{ feedItem: { sourceId: 'personal_1', sourceType: 'TASK' } }, { feedItem: { sourceId: 'personal_2', sourceType: 'TASK' } }])
    const personal = ['personal_1', 'personal_2'].map((id, index) => ({
      ...newer, itemId: id, occurredAt: new Date(`2026-09-0${2 - index}`),
      item: { ...newer.item, id, sourceType: 'TASK', sourceId: id, occurredAt: new Date(`2026-09-0${2 - index}`) },
    }))
    findMany.mockReset().mockResolvedValueOnce(personal).mockResolvedValueOnce([newer])
    const first = await service.list(viewer, feedListQuerySchema.parse({ limit: 1 }))
    expect(first.items.map((item) => item.itemId)).toEqual(['personal_1'])
    expect((JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString()) as { section: string }).section).toBe('PIN')
    const pinQuery: unknown = findMany.mock.calls[0][0]
    expect(JSON.stringify(pinQuery)).toContain(viewer.userId)
    expect(JSON.stringify(pinQuery)).toContain('personal_1')
    findMany.mockResolvedValueOnce([personal[1]]).mockResolvedValueOnce([newer])
    const second = await service.list(viewer, feedListQuerySchema.parse({ limit: 1, cursor: first.nextCursor }))
    expect(second.items.map((item) => item.itemId)).toEqual(['personal_2'])
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([newer])
    const third = await service.list(viewer, feedListQuerySchema.parse({ limit: 1, cursor: second.nextCursor }))
    expect(third.items.map((item) => item.itemId)).toEqual(['new_task'])
    expect(third.nextCursor).toBeNull()
    expect((findMany.mock.calls[5][0] as { where: { AND: unknown[] } }).where.AND).toHaveLength(1)
  })

  it('pins a new revision again when only an older revision was acknowledged', async () => {
    const { service, recipients, acknowledgements, viewer } = setup()
    recipients.mockResolvedValue([{ postId: 'mandatory_1', acknowledgementVersion: 2, post: { acknowledgementVersion: 2 } }])
    acknowledgements.mockResolvedValue([{ postId: 'mandatory_1', acknowledgementVersion: 1 }])
    const result = await service.list(viewer, feedListQuerySchema.parse({ limit: 1 }))
    expect(result.items[0].id).toBe('mandatory_1')
    expect(result.attention.pendingAcknowledgements).toBe(1)
  })
})

interface PrismaMock {
  user: { findMany: ReturnType<typeof vi.fn> }
  feedReadCursor: { findMany: ReturnType<typeof vi.fn> }
  feedSourceHead: { count: ReturnType<typeof vi.fn> }
  notification?: { findMany: ReturnType<typeof vi.fn> }
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
      feedReadCursor: { findMany: vi.fn() },
      feedSourceHead: { count: vi.fn() },
    }
    const { internal } = makeService(prisma)

    const resolved = await internal.resolveAudience(principal(), 'cmp_a', { type: 'COMPANY' })

    expect(resolved).toEqual({
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
  })

  it('rejects a multi-company audience that omits the primary company', async () => {
    const { internal } = makeService({
      user: { findMany: vi.fn() },
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
      recipients: [
        { type: 'COMPANY', recipientId: 'cmp_a' },
        { type: 'COMPANY', recipientId: 'cmp_b' },
      ],
    }
    expect(label(post, new Map(), new Map([['cmp_a', 'A'], ['cmp_b', 'B']]), 2)).toBe('Всім співробітникам')
  })

  it('lists the addressed companies inline when it does not reach everyone', () => {
    const post: AudienceLabelPost = {
      recipients: [
        { type: 'COMPANY', recipientId: 'cmp_a' },
        { type: 'COMPANY', recipientId: 'cmp_b' },
      ],
    }
    expect(label(post, new Map(), new Map([['cmp_a', 'БЕРТ Україна'], ['cmp_b', 'БЕРТ Сервіс']]), 3))
      .toBe('БЕРТ Україна, БЕРТ Сервіс')
  })

  it('keeps the whole-organization label for a single-company audience', () => {
    const post: AudienceLabelPost = { recipients: [{ type: 'COMPANY', recipientId: 'cmp_a' }] }
    expect(label(post, new Map(), new Map(), 4)).toBe('Вся організація')
  })

  it('lists every direct recipient by name without truncation', () => {
    const post: AudienceLabelPost = {
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
  it('counts a task card only while the viewer has unread notifications about that task', async () => {
    const count = vi.fn().mockResolvedValue(1)
    const findMany = vi.fn().mockResolvedValue([{ entityId: 'tsk_unseen' }])
    const { internal } = makeService({
      user: { findMany: vi.fn() },
      feedReadCursor: { findMany: vi.fn().mockResolvedValue([]) },
      feedSourceHead: { count },
      notification: { findMany },
    })

    await internal.unreadCount(principal(), ['cmp_a'], {})

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recipientId: principal().userId, entityType: 'TASK', readAt: null },
    }))
    const where = (count.mock.calls as Array<[{ where: { AND: unknown[] } }]>)[0][0].where
    expect(where.AND).toContainEqual({
      OR: [{ sourceType: { not: 'TASK' } }, { sourceId: { in: ['tsk_unseen'] } }],
    })
  })

  it('counts every unread head for a company with no read cursor', async () => {
    const count = vi.fn().mockResolvedValue(4)
    const { internal } = makeService({
      user: { findMany: vi.fn() },
      feedReadCursor: { findMany: vi.fn().mockResolvedValue([]) },
      feedSourceHead: { count },
      notification: { findMany: vi.fn().mockResolvedValue([]) },
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
      feedReadCursor: {
        findMany: vi.fn().mockResolvedValue([
          { companyId: 'cmp_a', lastReadOccurredAt: readAt, lastReadItemId: 'fitem_10' },
        ]),
      },
      feedSourceHead: { count },
      notification: { findMany: vi.fn().mockResolvedValue([]) },
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


describe('task feed event labels', () => {
  const service = new FeedService({} as PrismaService, new ScopeService(), null as unknown as FilesService)
  const internal = service as unknown as {
    taskProjectionLabel(action: string, historical: boolean, payload?: string): string
  }

  it.each([
    ['ASSIGNED', {}, 'Нове призначення'],
    ['CREATED', {}, 'Нове завдання'],
    ['COMMENT_CREATED', {}, 'Нове повідомлення'],
    ['COMMENT_CREATED', { watchersAdded: true }, 'Нове повідомлення · Додано спостерігачів'],
    ['PARTICIPANT_CHANGED', { role: 'RESPONSIBLE', change: 'ADDED' }, 'Новий відповідальний'],
    ['PARTICIPANT_CHANGED', { role: 'COLLABORATOR', change: 'ROLE_CHANGED' }, 'Новий співвиконавець'],
    ['PARTICIPANT_CHANGED', { role: 'WATCHER', change: 'ADDED' }, 'Новий спостерігач'],
    ['PARTICIPANT_CHANGED', { role: 'WATCHER', change: 'REMOVED' }, 'Спостерігача вилучено'],
    ['UPDATED', { changedFields: ['title', 'dueAt'] }, 'Змінено назву, строк'],
    ['STATUS_CHANGED', { status: 'IN_PROGRESS' }, 'Статус змінено: У роботі'],
    ['APPROVAL_REQUESTED', {}, 'Завдання передано на перевірку'],
    ['APPROVAL_APPROVED', {}, 'Результат завдання прийнято'],
    ['APPROVAL_NEEDS_CHANGES', {}, 'Завдання повернуто на доопрацювання'],
    ['SUBTASK_CREATED', {}, 'Нове підзавдання'],
    ['ATTACHMENT_ADDED', {}, 'Нове вкладення'],
    ['ARCHIVED', {}, 'Завдання архівовано'],
  ])('describes %s from its recorded event details', (action, taskDetails, label) => {
    expect(internal.taskProjectionLabel(action, false, JSON.stringify({ taskDetails }))).toBe(label)
  })

  it('handles legacy and malformed events without inventing a new assignment', () => {
    expect(internal.taskProjectionLabel('UPDATED', false, '{')).toBe('Завдання оновлено')
    expect(internal.taskProjectionLabel('PARTICIPANT_CHANGED', false)).toBe('Учасників завдання оновлено')
    expect(internal.taskProjectionLabel('UNKNOWN', false)).toBe('Завдання оновлено')
    expect(internal.taskProjectionLabel('ASSIGNED', true)).toBe('Історичне завдання')
  })
})


it('addresses a task card to its participants from any company of the workspace', async () => {
  const findMany = vi.fn().mockResolvedValue([{ id: 'usr_elsewhere' }])
  const createMany = vi.fn()
  const tx = {
    feedItem: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    feedSourceHead: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    user: { findMany },
    feedItemRecipient: { createMany },
  }
  await writeFeedProjection(tx as never, {
    workspaceId: 'ws_1', companyId: 'cmp_1', sourceType: 'TASK', sourceId: 'tsk_1',
    sourceVersion: 2, action: 'UPDATED', actorId: 'usr_1', recipientIds: ['usr_elsewhere'],
    visibility: 'PARTICIPANTS', occurredAt: new Date('2026-10-06T10:00:00Z'),
  })
  expect(findMany).toHaveBeenCalledWith({
    where: { id: { in: ['usr_elsewhere'] }, workspaceId: 'ws_1', isActive: true },
    select: { id: true },
  })
  expect(createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: 'usr_elsewhere' })] })
})

it('stores immutable task change details and deduplicates projection retries', async () => {
  const tx = {
    feedItem: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing' }), create: vi.fn() },
    feedSourceHead: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
  }
  const input = {
    workspaceId: 'ws_1', companyId: 'cmp_1', sourceType: 'TASK' as const, sourceId: 'tsk_1',
    sourceVersion: 2, action: 'UPDATED', actorId: 'usr_1', recipientIds: [],
    visibility: 'PARTICIPANTS' as const, occurredAt: new Date('2026-10-06T10:00:00Z'),
    taskDetails: { changedFields: ['dueAt', 'priority'] },
  }
  await writeFeedProjection(tx as never, input)
  const written = tx.feedItem.create.mock.calls[0][0] as { data: { safePayload: string } }
  const payload = JSON.parse(written.data.safePayload) as { taskDetails: unknown }
  expect(payload.taskDetails).toEqual(input.taskDetails)
  expect(await writeFeedProjection(tx as never, input)).toBeNull()
  expect(tx.feedItem.create).toHaveBeenCalledOnce()
})


it('renders a calendar creation reference and rechecks the canonical event audience', async () => {
  const event = { id: 'event', companyId: 'cmp_a', title: 'Зустріч', allDay: false,
    startAt: new Date('2026-10-20T09:00:00Z'), endAt: new Date('2026-10-20T10:00:00Z'), sourceTimezone: 'Europe/Kyiv', version: 3, requiresAcknowledgement: true,
    acknowledgements: [
      { eventVersion: 2, userId: principal().userId, acknowledgedAt: new Date() },
      { eventVersion: 3, userId: principal().userId, acknowledgedAt: null },
      { eventVersion: 3, userId: 'another_user', acknowledgedAt: new Date() },
    ] }
  const prisma = { event: { findMany: vi.fn().mockResolvedValue([event]) }, user: { findMany: vi.fn().mockResolvedValue([]) }, feedUserItemState: { findMany: vi.fn().mockResolvedValue([]) } }
  const service = new FeedService(prisma as unknown as PrismaService, new ScopeService(), null as unknown as FilesService)
  const internal = service as unknown as { toSourceViews(principal: AuthPrincipal, items: unknown[]): Promise<FeedSourceView[]> }
  const items = [{ id: 'feed', sourceType: 'EVENT', sourceId: 'event', sourceVersion: 1,
    action: 'CREATED', actorId: null, safePayload: '{}', occurredAt: new Date() }]
  const [view] = await internal.toSourceViews(principal(), items)
  expect(view.label).toBe('Створено подію календаря')
  expect(view.eventVersion).toBe(3)
  expect(view.eventAcknowledgement).toEqual({ requiredForMe: true, acknowledgedAt: null, recipientCount: 2, acknowledgedCount: 1 })
  expect(view.href).toContain('/calendar/events/event?')
  expect(prisma.event.findMany.mock.calls[0][0]).toMatchObject({ where: {
    workspaceId: principal().workspaceId,
    audiences: { some: { companyId: { in: principal().allowedCompanyIds } } },
    OR: [{ ownerId: principal().userId }, { visibility: { in: ['INTERNAL', 'PUBLIC_SAFE'] } }],
  } })
  prisma.event.findMany.mockResolvedValue([])
  expect(await internal.toSourceViews(principal(), items)).toEqual([])
})

it('shows the task reporter before the responsible person even when someone else changed the task', async () => {
  const reporter = { id: 'reporter', displayName: 'Андрій Коваль', avatarAsset: null }
  const actor = { id: 'actor', displayName: 'Автор зміни', avatarAsset: null }
  const responsible = { id: 'responsible', displayName: 'Марія Іваненко', avatarAsset: null }
  const prisma = {
    feedUserItemState: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn().mockResolvedValue([{
      id: 'task', companyId: 'cmp_a', createdById: 'actor', reporterId: 'reporter',
      number: '2401', title: 'Звіт', description: '', status: 'DONE', dueAt: null,
      participants: [{ userId: 'responsible', user: responsible }],
    }]) },
    user: { findMany: vi.fn().mockResolvedValue([reporter, actor, responsible]) },
    notification: { findMany: vi.fn().mockResolvedValue([
      { entityId: 'task', dedupeKey: 'task-comment:c1:usr_maria' },
      { entityId: 'task', dedupeKey: 'task-event:task:1:task.comment_created:usr_maria' },
      { entityId: 'task', dedupeKey: 'task-comment-edited:c1:2:usr_maria' },
      { entityId: 'task', dedupeKey: 'task-event:task:3:task.participant_changed:usr_maria' },
      { entityId: 'task', dedupeKey: 'task-event:task:4:task.checklist_changed:usr_maria' },
      { entityId: 'task', dedupeKey: 'future-change' },
    ]) },
  }
  const service = new FeedService(prisma as unknown as PrismaService, new ScopeService(), null as unknown as FilesService)
  const internal = service as unknown as {
    toSourceViews(principal: AuthPrincipal, items: unknown[]): Promise<FeedSourceView[]>
  }
  const [view] = await internal.toSourceViews(principal(), [{
    id: 'feed', sourceType: 'TASK', sourceId: 'task', sourceVersion: 2,
    action: 'STATUS_CHANGED', actorId: 'actor', safePayload: '{}', occurredAt: new Date(),
  }])
  expect(view.taskChanges).toEqual({ messages: 2, participants: 1, status: 2 })
  expect(prisma.notification.findMany).toHaveBeenCalledWith({
    where: { recipientId: 'usr_maria', entityType: 'TASK', readAt: null, entityId: { in: ['task'] } },
    select: { entityId: true, dedupeKey: true },
  })
  prisma.notification.findMany.mockResolvedValueOnce([])
  const [readView] = await internal.toSourceViews(principal(), [{
    id: 'feed', sourceType: 'TASK', sourceId: 'task', sourceVersion: 2,
    action: 'STATUS_CHANGED', actorId: 'actor', safePayload: '{}', occurredAt: new Date(),
  }])
  expect(readView.taskChanges).toEqual({ messages: 0, participants: 0, status: 0 })
  expect(view.actor).toEqual(actor)
  expect(view.taskReporter).toEqual(reporter)
  expect(view.taskAssignee).toEqual(responsible)
  expect(view.metadata).toEqual([
    'Завдання: 2401',
    'Постановник: Андрій Коваль', 'Відповідальний: Марія Іваненко',
  ])
})


describe('FeedService private task pins', () => {
  function setup() {
    const state = { upsert: vi.fn(), deleteMany: vi.fn() }
    const tx = {
      task: { findFirst: vi.fn().mockResolvedValue({ id: 'task' }) },
      feedItem: { findFirst: vi.fn().mockResolvedValue({ id: 'current_projection' }) },
      feedUserItemState: state,
    }
    const prisma = { $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)) }
    const service = new FeedService(prisma as unknown as PrismaService, new ScopeService(), null as unknown as FilesService)
    return { service, tx, state }
  }

  it('saves only the current reader state and removes all revisions on unpin', async () => {
    const { service, tx, state } = setup()
    await expect(service.setTaskPinned(principal(), 'task', true)).resolves.toEqual({ pinnedByMe: true })
    expect(tx.task.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({
      workspaceId: 'ws_lankadws', id: 'task', OR: expect.any(Array) as unknown,
    }) as unknown })
    expect(state.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_feedItemId: { userId: 'usr_maria', feedItemId: 'current_projection' } },
      create: expect.objectContaining({ userId: 'usr_maria', favoritedAt: expect.any(Date) as unknown }) as unknown,
    }))
    await expect(service.setTaskPinned(principal(), 'task', false)).resolves.toEqual({ pinnedByMe: false })
    expect(state.deleteMany).toHaveBeenCalledWith({ where: { userId: 'usr_maria', feedItem: { workspaceId: 'ws_lankadws', sourceType: 'TASK', sourceId: 'task' } } })
  })

  it('rejects inaccessible tasks before reading or writing personal state', async () => {
    const { service, tx, state } = setup()
    tx.task.findFirst.mockResolvedValue(null)
    await expect(service.setTaskPinned(principal(), 'hidden', true)).rejects.toThrow()
    await expect(service.setTaskPinned(principal(), 'hidden', false)).rejects.toThrow()
    expect(tx.feedItem.findFirst).not.toHaveBeenCalled()
    expect(state.upsert).not.toHaveBeenCalled()
    expect(state.deleteMany).not.toHaveBeenCalled()
  })
})


describe('FeedService mention audience', () => {
  it('searches the selected companies and workspace administrators with the shared limit', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new FeedService({ user: { findMany } } as unknown as PrismaService, new ScopeService(), null as unknown as FilesService)
    await service.mentionCandidates(principal(), { company: 'cmp_a', companyIds: ['cmp_a', 'cmp_b'], audienceType: 'COMPANY', q: 'а', limit: 5 })
    const calls = findMany.mock.calls as unknown as Array<[{ take: number; where: { workspaceId: string; isActive: boolean; AND: unknown[] } }]>
    expect(calls[0][0].take).toBe(5)
    expect(calls[0][0].where.workspaceId).toBe('ws_lankadws')
    expect(calls[0][0].where.isActive).toBe(true)
    expect(calls[0][0].where.AND).toContainEqual({ OR: [
      { OR: [{ primaryCompanyId: { in: ['cmp_a', 'cmp_b'] } }, { id: 'usr_maria' }] },
      { accountType: 'ADMIN' },
    ] })
    findMany.mockClear()
    await expect(service.mentionCandidates(principal(), { company: 'cmp_a', companyIds: ['cmp_foreign'], audienceType: 'COMPANY', q: 'а', limit: 5 })).rejects.toThrow()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('allows an active workspace administrator outside the company audience and rejects other outsiders', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'admin' }])
    const service = new FeedService({ user: { findMany } } as unknown as PrismaService, new ScopeService(), null as unknown as FilesService)
    const policy = service as unknown as { assertMentions(ids: string[], audience: string[], author: string, viewer: AuthPrincipal): Promise<void> }
    await expect(policy.assertMentions(['admin'], ['employee'], 'author', principal())).resolves.toBeUndefined()
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ['admin'] }, workspaceId: 'ws_lankadws', accountType: 'ADMIN', isActive: true }, select: { id: true } })
    findMany.mockResolvedValue([])
    await expect(policy.assertMentions(['outsider'], ['employee'], 'author', principal())).rejects.toThrow()
  })
})

describe('FeedService event and post pins', () => {
  it.each(['EVENT', 'POST'] as const)('checks access and saves private %s pins across revisions', async (sourceType) => {
    const state = { upsert: vi.fn(), deleteMany: vi.fn() }
    const tx = { event: { findFirst: vi.fn().mockResolvedValue({ id: 'entry' }) },
      feedPost: { findFirst: vi.fn().mockResolvedValue({ id: 'entry' }) },
      feedItem: { findFirst: vi.fn().mockResolvedValue({ id: 'current' }) }, feedUserItemState: state }
    const prisma = { $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)) }
    const service = new FeedService(prisma as unknown as PrismaService, new ScopeService(), null as unknown as FilesService)
    await expect(service.setOtherPinned(principal(), sourceType, 'entry', true)).resolves.toEqual({ pinnedByMe: true })
    expect(state.upsert).toHaveBeenCalledOnce()
    await service.setOtherPinned(principal(), sourceType, 'entry', false)
    expect(state.deleteMany).toHaveBeenCalledWith({ where: { userId: principal().userId, feedItem: { workspaceId: principal().workspaceId, sourceType, sourceId: 'entry' } } })
    const lookup = sourceType === 'EVENT' ? tx.event.findFirst : tx.feedPost.findFirst
    lookup.mockResolvedValue(null)
    await expect(service.setOtherPinned(principal(), sourceType, 'entry', true)).rejects.toThrow()
    expect(state.upsert).toHaveBeenCalledOnce()
  })
})

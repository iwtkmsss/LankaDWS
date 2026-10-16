import { describe, expect, it, vi } from 'vitest'
import type { FeedSourceView } from '@lankadws/contracts'
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

interface PrismaMock {
  user: { findMany: ReturnType<typeof vi.fn> }
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
  it('counts every unread head for a company with no read cursor', async () => {
    const count = vi.fn().mockResolvedValue(4)
    const { internal } = makeService({
      user: { findMany: vi.fn() },
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
    startAt: new Date('2026-10-20T09:00:00Z'), endAt: new Date('2026-10-20T10:00:00Z'), sourceTimezone: 'Europe/Kyiv' }
  const prisma = { event: { findMany: vi.fn().mockResolvedValue([event]) }, user: { findMany: vi.fn().mockResolvedValue([]) } }
  const service = new FeedService(prisma as unknown as PrismaService, new ScopeService(), null as unknown as FilesService)
  const internal = service as unknown as { toSourceViews(principal: AuthPrincipal, items: unknown[]): Promise<FeedSourceView[]> }
  const items = [{ id: 'feed', sourceType: 'EVENT', sourceId: 'event', sourceVersion: 1,
    action: 'CREATED', actorId: null, safePayload: '{}', occurredAt: new Date() }]
  const [view] = await internal.toSourceViews(principal(), items)
  expect(view.label).toBe('Створено подію календаря')
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
    task: { findMany: vi.fn().mockResolvedValue([{
      id: 'task', companyId: 'cmp_a', createdById: 'actor', reporterId: 'reporter',
      number: '2401', title: 'Звіт', description: '', status: 'DONE', dueAt: null,
      participants: [{ userId: 'responsible', user: responsible }],
    }]) },
    user: { findMany: vi.fn().mockResolvedValue([reporter, actor, responsible]) },
  }
  const service = new FeedService(prisma as unknown as PrismaService, new ScopeService(), null as unknown as FilesService)
  const internal = service as unknown as {
    toSourceViews(principal: AuthPrincipal, items: unknown[]): Promise<FeedSourceView[]>
  }
  const [view] = await internal.toSourceViews(principal(), [{
    id: 'feed', sourceType: 'TASK', sourceId: 'task', sourceVersion: 2,
    action: 'STATUS_CHANGED', actorId: 'actor', safePayload: '{}', occurredAt: new Date(),
  }])
  expect(view.actor).toEqual(actor)
  expect(view.taskReporter).toEqual(reporter)
  expect(view.taskAssignee).toEqual(responsible)
  expect(view.metadata).toEqual([
    'Завдання: 2401',
    'Постановник: Андрій Коваль', 'Виконавець: Марія Іваненко',
  ])
})

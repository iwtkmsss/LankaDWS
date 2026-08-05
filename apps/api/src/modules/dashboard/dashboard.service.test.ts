import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { DashboardService } from './dashboard.service.js'

function principal(accountType: 'ADMIN' | 'USER' = 'USER'): AuthPrincipal {
  return {
    userId: 'usr_test',
    workspaceId: 'wrk_test',
    username: 'test',
    displayName: 'Тест Користувач',
    accountType,
    primaryCompanyId: 'cmp_test',
    allowedCompanyIds: ['cmp_test'],
    authorizationVersion: 1,
    sessionId: 'ses_test',
    authAssurance: 1,
    restricted: false,
  }
}

function setup() {
  const prisma = {
    company: { findFirst: vi.fn().mockResolvedValue({
      timezone: 'Europe/Kyiv',
      capabilities: [{ enabled: true }],
    }) },
    event: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    announcementReceipt: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    notification: { count: vi.fn().mockResolvedValue(0) },
    lifecycleProcess: { findMany: vi.fn().mockResolvedValue([]) },
  }
  const tasks = { dashboardSummary: vi.fn().mockResolvedValue({ items: [], active: 0, overdue: 0, attention: 0, completedLast7Days: 0, byStatus: [] }) }
  const messages = { summary: vi.fn().mockResolvedValue({ all: 0, unread: 0 }) }
  const feed = { list: vi.fn().mockResolvedValue({ items: [], nextCursor: null, unreadCount: 0, attention: { pendingAcknowledgements: 0, overdueTasks: 0 }, readMarkers: [] }) }
  const service = new DashboardService(
    prisma as never,
    tasks as never,
    messages as never,
    feed as never,
  )
  return { service, prisma, tasks, messages, feed }
}

describe('DashboardService', () => {
  it('exposes standard workspace blocks without an RBAC permission matrix', async () => {
    const { service, prisma, tasks, messages, feed } = setup()
    const result = await service.get(principal())

    expect(result.availability).toEqual({
      tasks: true,
      calendar: true,
      announcements: true,
      messages: true,
      notifications: true,
      activity: true,
      lifecycle: true,
    })
    expect(result.tasks).toEqual([])
    expect(result.activity).toEqual([])
    expect(result.taskAnalytics).not.toBeNull()
    expect(result.kpis.activeTasks).not.toBeNull()
    expect(tasks.dashboardSummary).toHaveBeenCalled()
    expect(messages.summary).toHaveBeenCalled()
    expect(feed.list).toHaveBeenCalled()
    expect(prisma.event.findMany).toHaveBeenCalled()
    expect(prisma.notification.count).toHaveBeenCalled()
  })

  it('keeps employee lifecycle visibility scoped to the current user', async () => {
    const { service, prisma } = setup()

    const result = await service.get(principal())

    expect(result.availability.lifecycle).toBe(true)
    const lifecycleQuery = prisma.lifecycleProcess.findMany.mock.calls[0]?.[0] as {
      where?: { employeeId?: string }
    } | undefined
    expect(lifecycleQuery?.where?.employeeId).toBe('usr_test')
  })

  it('combines authorized attention and chooses the task-first next step', async () => {
    const { service, prisma, tasks, messages, feed } = setup()
    tasks.dashboardSummary.mockResolvedValue({
      items: [{
        id: 'tsk_1',
        number: 'TASK-1',
        companyId: 'cmp_test',
        parentTaskId: null,
        title: 'Усунути блокер',
        assignee: { id: 'usr_test', displayName: 'Тест Користувач', avatarAsset: null },
        status: 'BLOCKED',
        priority: 'HIGH',
        deadline: null,
        version: 1,
        commentCount: 0,
        attachmentCount: 0,
        subtaskProgress: { done: 0, total: 0 },
        viewerRoles: ['RESPONSIBLE'],
      }],
      active: 3,
      overdue: 1,
      attention: 2,
      completedLast7Days: 4,
      byStatus: [{ status: 'BLOCKED', count: 1 }],
    })
    messages.summary.mockResolvedValue({ all: 8, unread: 4 })
    prisma.notification.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
    feed.list.mockResolvedValue({
      items: [],
      nextCursor: null,
      unreadCount: 0,
      attention: { pendingAcknowledgements: 1, overdueTasks: 0 },
      readMarkers: [],
    })

    const result = await service.get(principal())

    expect(result.attentionCount).toBe(9)
    expect(result.focus.nextStep).toMatchObject({
      kind: 'TASK',
      href: '/tasks/tsk_1',
    })
    expect(result.kpis).toMatchObject({
      activeTasks: { value: 3 },
      overdueTasks: { value: 1 },
      unreadMessages: { value: 4 },
      unreadNotifications: { value: 3 },
    })
    expect(result.taskAnalytics).toEqual({
      byStatus: [{ status: 'BLOCKED', count: 1 }],
      completedLast7Days: 4,
      overdue: 1,
    })
  })

  it('uses IANA timezone boundaries across daylight-saving changes', () => {
    const { service } = setup()
    const start = service['zonedDateBoundary']('2026-03-29', 'Europe/Kyiv', false)
    const end = service['zonedDateBoundary']('2026-03-29', 'Europe/Kyiv', true)

    expect(start.toISOString()).toBe('2026-03-28T22:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-29T20:59:59.999Z')
  })
})

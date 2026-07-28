import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { DashboardService } from './dashboard.service.js'

function principal(permissions: string[] = []): AuthPrincipal {
  return {
    userId: 'usr_test',
    workspaceId: 'wrk_test',
    username: 'test',
    displayName: 'Тест Користувач',
    displayRole: 'EMPLOYEE',
    primaryCompanyId: 'cmp_test',
    allowedCompanyIds: ['cmp_test'],
    permissions: new Set(permissions),
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
  const tasks = { dashboardSummary: vi.fn() }
  const messages = { summary: vi.fn() }
  const feed = { list: vi.fn() }
  const service = new DashboardService(
    prisma as never,
    tasks as never,
    messages as never,
    feed as never,
  )
  return { service, prisma, tasks, messages, feed }
}

describe('DashboardService', () => {
  it('does not execute or expose blocks without their read permissions', async () => {
    const { service, prisma, tasks, messages, feed } = setup()
    const result = await service.get(principal())

    expect(result.availability).toEqual({
      tasks: false,
      calendar: false,
      announcements: false,
      messages: false,
      notifications: false,
      activity: false,
      lifecycle: false,
    })
    expect(result.tasks).toEqual([])
    expect(result.activity).toEqual([])
    expect(result.taskAnalytics).toBeNull()
    expect(result.kpis.activeTasks).toBeNull()
    expect(tasks.dashboardSummary).not.toHaveBeenCalled()
    expect(messages.summary).not.toHaveBeenCalled()
    expect(feed.list).not.toHaveBeenCalled()
    expect(prisma.event.findMany).not.toHaveBeenCalled()
    expect(prisma.notification.count).not.toHaveBeenCalled()
  })

  it('keeps employee lifecycle visibility scoped to the current user', async () => {
    const { service, prisma } = setup()

    const result = await service.get(principal(['employees.read']))

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

    const result = await service.get(principal([
      'tasks.read',
      'messages.read',
      'notifications.read',
      'feed.read',
    ]))

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

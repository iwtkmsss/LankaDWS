import { Injectable } from '@nestjs/common'
import {
  type AnnouncementListItem,
  type DashboardActivityItem,
  type DashboardLifecycleItem,
  type DashboardNextStep,
  type DashboardView,
  type EventListItem,
  type FeedEntryView,
} from '@lankadws/contracts'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { MessagesService } from '../communication/messages.service.js'
import { FeedService } from '../feed/feed.service.js'
import { TasksService, type DashboardTaskSummary } from '../tasks/tasks.service.js'

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly messages: MessagesService,
    private readonly feed: FeedService,
  ) {}

  async get(principal: AuthPrincipal): Promise<DashboardView> {
    const generatedAt = new Date()
    const companyId = principal.primaryCompanyId ?? principal.allowedCompanyIds[0]
    const organization = await this.prisma.company.findFirst({
      where: {
        id: companyId,
        workspaceId: principal.workspaceId,
        isActive: true,
      },
      select: {
        timezone: true,
      },
    })
    const timezone = organization?.timezone ?? 'Europe/Kyiv'
    const localDate = this.localDate(generatedAt, timezone)
    const todayStart = this.zonedDateBoundary(localDate, timezone, false)
    const todayEnd = this.zonedDateBoundary(localDate, timezone, true)
    const completedSince = this.zonedDateBoundary(this.shiftDate(localDate, -6), timezone, false)

    const availability = {
      tasks: true,
      calendar: true,
      announcements: true,
      messages: true,
      notifications: true,
      activity: true,
      lifecycle: true,
    }

    const [
      taskSummary,
      eventData,
      announcements,
      messageSummary,
      notificationSummary,
      feedData,
      lifecycle,
    ] = await Promise.all([
      availability.tasks
        ? this.tasks.dashboardSummary(principal, undefined, completedSince)
        : Promise.resolve<DashboardTaskSummary | null>(null),
      availability.calendar
        ? this.events(principal, generatedAt, todayStart, todayEnd)
        : Promise.resolve<{ items: EventListItem[]; todayCount: number } | null>(null),
      availability.announcements
        ? this.announcements(principal)
        : Promise.resolve<AnnouncementListItem[]>([]),
      availability.messages
        ? this.messages.summary(principal)
        : Promise.resolve<{ all: number; unread: number } | null>(null),
      availability.notifications
        ? this.notificationSummary(principal.userId)
        : Promise.resolve<{ action: number; unread: number } | null>(null),
      availability.activity
        ? this.feed.list(principal, {
            company: 'all',
            filter: 'ALL',
            type: 'ALL',
            limit: 5,
          })
        : Promise.resolve(null),
      availability.lifecycle
        ? this.lifecycle(principal)
        : Promise.resolve<DashboardLifecycleItem[]>([]),
    ])

    const activity = feedData?.items.map((item) => this.activityItem(item)) ?? []
    const attentionCount = (taskSummary?.attention ?? 0)
      + (messageSummary?.unread ?? 0)
      + (notificationSummary?.action ?? 0)
      + (feedData?.attention.pendingAcknowledgements ?? 0)
    const nextStep = this.nextStep({
      taskSummary,
      eventData,
      announcements,
      notificationActions: notificationSummary?.action ?? 0,
      pendingAcknowledgements: feedData?.attention.pendingAcknowledgements ?? 0,
      lifecycle,
      todayEnd,
    })

    return {
      attentionCount,
      tasks: taskSummary?.items ?? [],
      events: eventData?.items ?? [],
      announcements,
      lifecycle,
      meta: {
        generatedAt: generatedAt.toISOString(),
        timezone,
        localDate,
      },
      availability,
      focus: {
        nextStep,
        primaryAction: nextStep
          ? { label: this.actionLabel(nextStep.kind), href: nextStep.href }
          : this.fallbackAction(),
      },
      kpis: {
        activeTasks: taskSummary
          ? { value: taskSummary.active, href: '/tasks?preset=ACTIVE' }
          : null,
        overdueTasks: taskSummary
          ? { value: taskSummary.overdue, href: '/tasks?preset=OVERDUE' }
          : null,
        events: eventData
          ? {
              todayCount: eventData.todayCount,
              nextAt: eventData.items[0]?.startAt ?? null,
              href: '/calendar',
            }
          : null,
        unreadMessages: messageSummary
          ? { value: messageSummary.unread, href: '/messages?unread=1' }
          : null,
        unreadNotifications: notificationSummary
          ? { value: notificationSummary.unread, href: '/notifications?tab=unread' }
          : null,
      },
      taskAnalytics: taskSummary
        ? {
            byStatus: taskSummary.byStatus,
            completedLast7Days: taskSummary.completedLast7Days,
            overdue: taskSummary.overdue,
          }
        : null,
      activity,
    }
  }

  private async events(
    principal: AuthPrincipal,
    now: Date,
    todayStart: Date,
    todayEnd: Date,
  ): Promise<{ items: EventListItem[]; todayCount: number }> {
    const where = {
      workspaceId: principal.workspaceId,
      companyId: { in: principal.allowedCompanyIds },
      ownerId: principal.userId,
    }
    const [rows, todayCount] = await Promise.all([
      this.prisma.event.findMany({
        where: { ...where, endAt: { gte: now } },
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        take: 5,
      }),
      this.prisma.event.count({
        where: {
          ...where,
          startAt: { lte: todayEnd },
          endAt: { gte: todayStart },
        },
      }),
    ])
    return {
      items: rows.map((event) => ({
        id: event.id,
        companyId: event.companyId,
        title: event.title,
        description: event.description,
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
        allDay: event.allDay,
        visibility: event.visibility,
      })),
      todayCount,
    }
  }

  private async announcements(principal: AuthPrincipal): Promise<AnnouncementListItem[]> {
    const receipts = await this.prisma.announcementReceipt.findMany({
      where: {
        userId: principal.userId,
        announcement: {
          workspaceId: principal.workspaceId,
          status: 'PUBLISHED',
          archivedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          companies: { some: { companyId: { in: principal.allowedCompanyIds } } },
        },
      },
      include: {
        announcement: {
          include: { companies: { select: { companyId: true } } },
        },
      },
      orderBy: [
        { announcement: { isPinned: 'desc' } },
        { deliveredAt: 'desc' },
      ],
      take: 3,
    })
    const authorIds = [...new Set(receipts.map((receipt) => receipt.announcement.authorId))]
    const authors = authorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: authorIds }, workspaceId: principal.workspaceId },
          select: { id: true, displayName: true },
        })
      : []
    const authorById = new Map(authors.map((author) => [author.id, author.displayName]))
    return receipts.map((receipt) => ({
      id: receipt.announcement.id,
      title: receipt.announcement.title,
      safeSnippet: receipt.announcement.body.slice(0, 180),
      authorName: authorById.get(receipt.announcement.authorId) ?? 'LankaDWS',
      companyIds: receipt.announcement.companies.map((entry) => entry.companyId),
      status: receipt.announcement.status,
      isPinned: receipt.announcement.isPinned,
      publishedAt: receipt.announcement.publishAt?.toISOString() ?? null,
      readAt: receipt.readAt?.toISOString() ?? null,
    }))
  }

  private async notificationSummary(userId: string) {
    const [action, unread] = await Promise.all([
      this.prisma.notification.count({
        where: { recipientId: userId, requiresAction: true, readAt: null },
      }),
      this.prisma.notification.count({
        where: { recipientId: userId, readAt: null },
      }),
    ])
    return { action, unread }
  }

  private async lifecycle(principal: AuthPrincipal): Promise<DashboardLifecycleItem[]> {
    const rows = await this.prisma.lifecycleProcess.findMany({
      where: {
        companyId: { in: principal.allowedCompanyIds },
        processType: { in: ['ONBOARDING', 'OFFBOARDING'] },
        status: { notIn: ['DONE', 'CANCELLED'] },
        ...(isGlobalAdmin(principal)
          ? {}
          : { employeeId: principal.userId }),
      },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    })
    const employeeIds = [...new Set(rows.map((process) => process.employeeId))]
    const employees = employeeIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: employeeIds }, workspaceId: principal.workspaceId },
          select: { id: true, displayName: true },
        })
      : []
    const employeeById = new Map(employees.map((user) => [user.id, user.displayName]))
    return rows.map((process) => ({
      id: process.id,
      type: process.processType === 'OFFBOARDING' ? 'OFFBOARDING' : 'ONBOARDING',
      employeeName: employeeById.get(process.employeeId) ?? 'Працівник',
      progress: process.progress,
      status: process.status,
    }))
  }

  private activityItem(item: FeedEntryView): DashboardActivityItem {
    if (item.kind === 'POST') {
      return {
        id: item.itemId,
        kind: 'POST',
        title: item.author.displayName,
        summary: item.body.slice(0, 180),
        occurredAt: item.publishedAt,
        href: '/feed',
      }
    }
    return {
      id: item.itemId,
      kind: item.sourceType,
      title: item.title,
      summary: item.summary,
      occurredAt: item.occurredAt,
      href: item.href,
    }
  }

  private nextStep(input: {
    taskSummary: DashboardTaskSummary | null
    eventData: { items: EventListItem[]; todayCount: number } | null
    announcements: AnnouncementListItem[]
    notificationActions: number
    pendingAcknowledgements: number
    lifecycle: DashboardLifecycleItem[]
    todayEnd: Date
  }): DashboardNextStep | null {
    const task = input.taskSummary?.items.find((item) =>
      item.status === 'BLOCKED'
      || Boolean(item.deadline && new Date(item.deadline) < new Date()),
    )
    if (task) {
      return {
        kind: 'TASK',
        title: task.title,
        detail: task.status === 'BLOCKED'
          ? `${task.number} · заблоковано`
          : `${task.number} · прострочено`,
        href: `/tasks/${task.id}`,
      }
    }
    if (input.notificationActions > 0) {
      return {
        kind: 'NOTIFICATION',
        title: `${input.notificationActions} сповіщень потребують дії`,
        detail: 'Перегляньте запити та системні нагадування.',
        href: '/notifications?tab=action',
      }
    }
    if (input.pendingAcknowledgements > 0) {
      return {
        kind: 'ACKNOWLEDGEMENT',
        title: `${input.pendingAcknowledgements} публікацій очікують підтвердження`,
        detail: 'Підтвердьте ознайомлення у живій стрічці.',
        href: '/feed?filter=ACK_REQUIRED',
      }
    }
    const event = input.eventData?.items.find((item) => new Date(item.startAt) <= input.todayEnd)
    if (event) {
      return {
        kind: 'EVENT',
        title: event.title,
        detail: event.allDay ? 'Сьогодні · увесь день' : event.startAt,
        href: `/calendar/events/${event.id}`,
      }
    }
    const activeTask = input.taskSummary?.items[0]
    if (activeTask) {
      return {
        kind: 'TASK',
        title: activeTask.title,
        detail: activeTask.deadline
          ? `${activeTask.number} · ${activeTask.deadline}`
          : `${activeTask.number} · без строку`,
        href: `/tasks/${activeTask.id}`,
      }
    }
    const lifecycle = input.lifecycle[0]
    if (lifecycle) {
      return {
        kind: 'LIFECYCLE',
        title: `${lifecycle.type === 'ONBOARDING' ? 'Онбординг' : 'Офбординг'} · ${lifecycle.employeeName}`,
        detail: `${lifecycle.progress}% процесу завершено`,
        href: `/${lifecycle.type === 'ONBOARDING' ? 'onboarding' : 'offboarding'}/${lifecycle.id}`,
      }
    }
    const announcement = input.announcements[0]
    if (announcement) {
      return {
        kind: 'ANNOUNCEMENT',
        title: announcement.title,
        detail: announcement.safeSnippet,
        href: `/announcements/${announcement.id}`,
      }
    }
    return null
  }

  private actionLabel(kind: DashboardNextStep['kind']): string {
    if (kind === 'TASK') return 'Відкрити завдання'
    if (kind === 'NOTIFICATION') return 'Переглянути сповіщення'
    if (kind === 'ACKNOWLEDGEMENT') return 'Відкрити стрічку'
    if (kind === 'EVENT') return 'Відкрити подію'
    if (kind === 'LIFECYCLE') return 'Відкрити процес'
    return 'Прочитати оголошення'
  }

  private fallbackAction() {
    return { label: 'Створити завдання', href: '/tasks/new' }
  }

  private localDate(value: Date, timeZone: string): string {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(value)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    )
    return `${parts.year}-${parts.month}-${parts.day}`
  }

  private shiftDate(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number]
    const shifted = new Date(Date.UTC(year, month - 1, day + days))
    return shifted.toISOString().slice(0, 10)
  }

  private zonedDateBoundary(date: string, timeZone: string, endOfDay: boolean): Date {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number]
    const hour = endOfDay ? 23 : 0
    const minute = endOfDay ? 59 : 0
    const second = endOfDay ? 59 : 0
    const desired = Date.UTC(year, month - 1, day, hour, minute, second)
    let candidate = desired
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(candidate))
          .filter((part) => part.type !== 'literal')
          .map((part) => [part.type, Number(part.value)]),
      ) as Record<string, number>
      const represented = Date.UTC(
        parts.year ?? year,
        (parts.month ?? month) - 1,
        parts.day ?? day,
        parts.hour ?? hour,
        parts.minute ?? minute,
        parts.second ?? second,
      )
      const adjustment = desired - represented
      candidate += adjustment
      if (adjustment === 0) break
    }
    return new Date(candidate + (endOfDay ? 999 : 0))
  }
}

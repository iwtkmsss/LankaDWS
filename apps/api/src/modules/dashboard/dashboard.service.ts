import { Injectable } from '@nestjs/common'
import type { DashboardView } from '@bert-crm/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TasksService } from '../tasks/tasks.service.js'
import { RequestsService } from '../requests/requests.service.js'

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService, private readonly tasks: TasksService, private readonly requests: RequestsService) {}

  async get(principal: AuthPrincipal): Promise<DashboardView> {
    const [tasks, requests, decisions, eventRows, receipts, lifecycle] = await Promise.all([
      this.tasks.list(principal, principal.primaryCompanyId, 'mine', 1, 5),
      this.requests.list(principal, principal.primaryCompanyId, 'mine', 1, 3),
      principal.permissions.has('requests.approve') ? this.requests.list(principal, 'all', 'approval', 1, 5) : Promise.resolve({ items: [], page: 1, pageSize: 5, total: 0 }),
      this.prisma.event.findMany({ where: { ownerId: principal.userId, endAt: { gte: new Date() } }, orderBy: { startAt: 'asc' }, take: 5 }),
      this.prisma.announcementReceipt.findMany({ where: { userId: principal.userId }, include: { announcement: true }, orderBy: [{ announcement: { isPinned: 'desc' } }, { deliveredAt: 'desc' }], take: 2 }),
      this.prisma.lifecycleProcess.findMany({ where: {
        companyId: { in: principal.allowedCompanyIds }, status: { notIn: ['DONE', 'CANCELLED'] },
        ...(principal.displayRole === 'HR' || principal.permissions.has('lifecycle.manage') ? {} : { employeeId: principal.userId }),
      }, orderBy: { updatedAt: 'desc' }, take: 6 }),
    ])
    const employeeIds = [...new Set(lifecycle.map((process) => process.employeeId))]
    const employees = await this.prisma.user.findMany({ where: { id: { in: employeeIds } }, select: { id: true, displayName: true } })
    const employeeById = new Map(employees.map((user) => [user.id, user.displayName]))
    return {
      attentionCount: tasks.items.filter((task) => task.status === 'BLOCKED' || (task.deadline && new Date(task.deadline) < new Date())).length + decisions.total,
      tasks: tasks.items,
      requests: requests.items,
      decisions: decisions.items,
      events: eventRows.map((event) => ({ id: event.id, companyId: event.companyId, title: event.title, startAt: event.startAt.toISOString(), endAt: event.endAt.toISOString(), allDay: event.allDay, visibility: event.visibility })),
      announcements: receipts.map((receipt) => ({ id: receipt.announcement.id, title: receipt.announcement.title, safeSnippet: receipt.announcement.body.slice(0, 140), authorName: 'BERT CRM', companyIds: [], status: receipt.announcement.status, isPinned: receipt.announcement.isPinned, publishedAt: receipt.announcement.publishAt?.toISOString() ?? null, readAt: receipt.readAt?.toISOString() ?? null })),
      lifecycle: lifecycle.map((process) => ({ id: process.id, type: process.processType, employeeName: employeeById.get(process.employeeId) ?? 'Працівник', progress: process.progress, status: process.status })),
    }
  }
}

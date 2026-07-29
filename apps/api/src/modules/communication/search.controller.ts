import { Controller, Get, Query, Req } from '@nestjs/common'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  @Get()
  async search(@Req() request: BertRequest, @Query('q') query = '', @Query('company') company?: string) {
    const principal = principalFrom(request)
    const q = query.trim().slice(0, 120)
    if (q.length < 2) return { items: [] }
    const companyIds = this.scope.allowedCompanies(principal, company)
    const documentAclIds = principal.permissions.has('documents.read')
      ? (await this.prisma.documentAcl.findMany({
          where: {
            OR: [
              { principalType: 'USER', principalId: principal.userId },
              { principalType: 'ROLE', principalId: { in: [...principal.permissions] } },
            ],
          },
          select: { documentId: true },
        })).map((entry) => entry.documentId)
      : []
    const articleIds = principal.permissions.has('knowledge.read')
      ? (await this.prisma.articleAudience.findMany({
          where: {
            OR: [
              { principalType: 'COMPANY', principalId: { in: companyIds } },
              { principalType: 'USER', principalId: principal.userId },
              { principalType: 'ROLE', principalId: principal.displayRole },
            ],
          },
          select: { articleId: true },
        })).map((entry) => entry.articleId)
      : []
    const [tasks, documents, users, articles, groups, events, threads] = await Promise.all([
      principal.permissions.has('tasks.read') ? this.prisma.task.findMany({
        where: {
          companyId: { in: companyIds },
          title: { contains: q },
          AND: [
            {
              OR: [
                { groupId: null },
                { group: { members: { some: { userId: principal.userId, leftAt: null } } } },
              ],
            },
            ...(principal.permissions.has('tasks.manage')
              ? []
              : [{
                  OR: [
                    { createdById: principal.userId },
                    { reporterId: principal.userId },
                    {
                      participants: {
                        some: { userId: principal.userId, removedAt: null },
                      },
                    },
                  ],
                }]),
          ],
        },
        select: { id: true, title: true, companyId: true, status: true },
        take: 6,
      }) : [],
      principal.permissions.has('documents.read') ? this.prisma.document.findMany({
        where: {
          companyId: { in: companyIds },
          name: { contains: q },
          OR: [
            { ownerId: principal.userId },
            { confidentiality: { in: ['GENERAL', 'INTERNAL'] } },
            { id: { in: documentAclIds } },
          ],
        },
        select: { id: true, name: true, companyId: true, status: true, archivedAt: true },
        take: 6,
      }) : [],
      principal.permissions.has('employees.read') ? this.prisma.user.findMany({ where: { workspaceId: principal.workspaceId, status: 'ACTIVE', displayName: { contains: q }, companyAccess: { some: { companyId: { in: companyIds }, status: 'ACTIVE' } } }, select: { id: true, displayName: true, primaryCompanyId: true, jobTitle: true }, take: 6 }) : [],
      principal.permissions.has('knowledge.read') ? this.prisma.knowledgeArticle.findMany({ where: { id: { in: articleIds }, workspaceId: principal.workspaceId, status: 'ACTIVE', versions: { some: { title: { contains: q } } } }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } }, take: 6 }) : [],
      principal.permissions.has('groups.read') ? this.prisma.group.findMany({
        where: {
          workspaceId: principal.workspaceId,
          companyId: { in: companyIds },
          status: 'ACTIVE',
          AND: [
            { OR: [{ name: { contains: q } }, { description: { contains: q } }] },
            {
              OR: [
                { discoverability: 'LISTED' },
                { members: { some: { userId: principal.userId, leftAt: null } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          name: true,
          companyId: true,
          _count: { select: { members: { where: { leftAt: null } } } },
        },
        take: 6,
      }) : [],
      principal.permissions.has('calendar.read') ? this.prisma.event.findMany({
        where: {
          companyId: { in: companyIds },
          title: { contains: q },
          OR: [{ ownerId: principal.userId }, { visibility: { in: ['INTERNAL', 'PUBLIC_SAFE'] } }],
        },
        select: { id: true, title: true, companyId: true, startAt: true },
        orderBy: { startAt: 'desc' },
        take: 6,
      }) : [],
      principal.permissions.has('messages.read') ? this.prisma.messageThread.findMany({
        where: {
          workspaceId: principal.workspaceId,
          companyId: { in: companyIds },
          participants: { some: { userId: principal.userId, leftAt: null } },
          OR: [
            { title: { contains: q } },
            { messages: { some: { body: { contains: q }, deletedAt: null } } },
          ],
        },
        select: {
          id: true,
          title: true,
          companyId: true,
          entityType: true,
          entityId: true,
          _count: { select: { participants: { where: { leftAt: null } } } },
        },
        take: 6,
      }) : [],
    ])
    const groupContextIds = threads
      .filter((thread) => thread.entityType === 'GROUP' && thread.entityId)
      .map((thread) => thread.entityId!)
    const memberships = groupContextIds.length ? await this.prisma.groupMember.findMany({
      where: {
        groupId: { in: groupContextIds },
        userId: principal.userId,
        leftAt: null,
        group: { status: 'ACTIVE' },
      },
      select: { groupId: true },
    }) : []
    const allowedGroupContexts = new Set(memberships.map((membership) => membership.groupId))
    const visibleThreads = threads.filter((thread) =>
      thread.entityType !== 'GROUP'
      || Boolean(thread.entityId && allowedGroupContexts.has(thread.entityId)),
    )
    return { items: [
      ...tasks.map((item) => ({ type: 'TASK', id: item.id, title: item.title, safeSnippet: item.status, companyId: item.companyId, route: `/tasks/${item.id}` })),
      ...groups.map((item) => ({ type: 'GROUP', id: item.id, title: item.name, safeSnippet: `${item._count.members} учасн.`, companyId: item.companyId, route: `/groups/${item.id}` })),
      ...visibleThreads.map((item) => ({ type: 'CHAT', id: item.id, title: item.title ?? 'Особистий діалог', safeSnippet: `${item._count.participants} учасн.`, companyId: item.companyId, route: `/messages/${item.id}` })),
      ...documents.map((item) => ({ type: 'DOCUMENT', id: item.id, title: item.name, safeSnippet: item.archivedAt ? 'ARCHIVED' : item.status, companyId: item.companyId, route: `/drive/${item.id}` })),
      ...users.map((item) => ({ type: 'EMPLOYEE', id: item.id, title: item.displayName, safeSnippet: item.jobTitle, companyId: item.primaryCompanyId, route: `/employees/${item.id}` })),
      ...events.map((item) => ({ type: 'EVENT', id: item.id, title: item.title, safeSnippet: item.startAt.toISOString(), companyId: item.companyId, route: `/calendar/events/${item.id}` })),
      ...articles.map((item) => ({ type: 'ARTICLE', id: item.id, title: item.versions[0]?.title ?? item.slug, safeSnippet: '', companyId: null, route: `/knowledge/${item.slug}` })),
    ] }
  }
}

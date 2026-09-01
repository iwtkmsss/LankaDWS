import { Controller, Get, Query, Req } from '@nestjs/common'
import type { BertRequest } from '../../common/request-context.js'
import { isGlobalAdmin, principalFrom } from '../../common/request-context.js'
import { normalizeUserSearchValue } from '../../common/user-search.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  @Get()
  async search(@Req() request: BertRequest, @Query('q') query = '', @Query('company') company?: string) {
    const principal = principalFrom(request)
    const q = [...query.trim()].slice(0, 120).join('')
    if (!q) return { items: [] }

    const companyIds = this.scope.allowedCompanies(principal, company)
    const normalizedUserQuery = normalizeUserSearchValue(q)
    const [tasks, users] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          workspaceId: principal.workspaceId,
          companyId: { in: companyIds },
          archivedAt: null,
          OR: [
            { title: { contains: q } },
            { number: { contains: q } },
            { legacyNumbers: { some: { legacyNumber: { contains: q } } } },
          ],
          ...(isGlobalAdmin(principal) ? {} : {
            AND: [{
              OR: [
                { createdById: principal.userId },
                { reporterId: principal.userId },
                { participants: { some: { userId: principal.userId, removedAt: null } } },
              ],
            }],
          }),
        },
        select: { id: true, number: true, title: true, companyId: true, status: true },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
      this.prisma.user.findMany({
        where: {
          workspaceId: principal.workspaceId,
          id: { not: principal.userId },
          isActive: true,
          AND: [
            {
              OR: [
                { accountType: 'ADMIN' },
                { primaryCompanyId: { in: companyIds } },
              ],
            },
            {
              OR: [
                { normalizedDisplayName: { contains: normalizedUserQuery } },
                { normalizedUsername: { contains: normalizedUserQuery } },
              ],
            },
          ],
        },
        select: {
          id: true,
          displayName: true,
          username: true,
          accountType: true,
          primaryCompanyId: true,
          jobTitle: true,
        },
        orderBy: { displayName: 'asc' },
        take: 8,
      }),
    ])

    return {
      items: [
        ...tasks.map((item) => ({
          type: 'TASK',
          id: item.id,
          title: item.title,
          safeSnippet: `№${item.number} · ${item.status}`,
          companyId: item.companyId,
          route: `/tasks/${item.id}`,
        })),
        ...users.map((item) => ({
          type: 'EMPLOYEE',
          id: item.id,
          title: item.displayName,
          safeSnippet: [
            `@${item.username}`,
            item.accountType === 'ADMIN' ? 'Адміністратор' : item.jobTitle,
          ].filter(Boolean).join(' · '),
          companyId: item.primaryCompanyId,
          route: `/messages?new=1&to=${encodeURIComponent(item.id)}`,
        })),
      ],
    }
  }
}

import { Controller, Get, Query, Req } from '@nestjs/common'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { isGlobalAdmin, principalFrom } from '../../common/request-context.js'
import { searchUsers } from '../../common/search-users.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'

@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  @Get()
  async search(@Req() request: LankaDWSRequest, @Query('q') query = '', @Query('company') company?: string) {
    const principal = principalFrom(request)
    const q = [...query.trim()].slice(0, 120).join('')
    if (!q) return { items: [] }

    const companyIds = this.scope.allowedCompanies(principal, company)
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
      searchUsers(this.prisma, principal, q, {
        excludeIds: [principal.userId],
        where: { OR: [{ accountType: 'ADMIN' }, { primaryCompanyId: { in: companyIds } }] },
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
          avatarAsset: item.avatarAsset,
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

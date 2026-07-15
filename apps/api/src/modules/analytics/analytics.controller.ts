import { Controller, Get, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { RequirePermissions } from '../auth/auth.decorators.js'

@Controller('analytics')
@RequirePermissions(Permission.AnalyticsRead)
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  @Get()
  async summary(@Req() request: BertRequest, @Query('company') company?: string) {
    const principal = principalFrom(request)
    const companyIds = this.scope.allowedCompanies(principal, company)
    const [taskTotal, taskDone, taskOverdue, requests, lifecycle, acknowledgements] = await Promise.all([
      this.prisma.task.count({ where: { companyId: { in: companyIds }, archivedAt: null } }),
      this.prisma.task.count({ where: { companyId: { in: companyIds }, status: 'DONE' } }),
      this.prisma.task.count({ where: { companyId: { in: companyIds }, deadline: { lt: new Date() }, status: { notIn: ['DONE', 'ARCHIVED', 'CANCELLED'] } } }),
      this.prisma.request.groupBy({ by: ['decisionStatus'], where: { companyId: { in: companyIds } }, _count: { id: true } }),
      this.prisma.lifecycleProcess.groupBy({ by: ['processType', 'status'], where: { companyId: { in: companyIds } }, _count: { id: true }, _avg: { progress: true } }),
      this.prisma.acknowledgement.groupBy({ by: ['confirmedAt'], where: { entityType: 'ARTICLE' }, _count: { id: true } }),
    ])
    return { kpis: { taskCompletion: taskTotal ? Math.round(taskDone / taskTotal * 100) : 0, taskOverdue, requestTotal: requests.reduce((sum, item) => sum + item._count.id, 0), activeLifecycle: lifecycle.filter((item) => item.status !== 'DONE').reduce((sum, item) => sum + item._count.id, 0) }, requests, lifecycle, acknowledgements }
  }
}

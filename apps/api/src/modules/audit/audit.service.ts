import { Injectable } from '@nestjs/common'
import { id } from '../../common/crypto.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

export interface AuditInput {
  action: string
  entityType: string
  entityId: string
  companyId?: string
  result?: string
  risk?: string
  safeDiff?: Record<string, unknown>
  reasonCode?: string
  correlationId?: string
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(principal: AuthPrincipal | null, input: AuditInput): Promise<void> {
    await this.prisma.auditEvent.create({ data: {
      id: id('aud'), workspaceId: principal?.workspaceId ?? 'system', companyId: input.companyId,
      actorType: principal ? 'USER' : 'SYSTEM', actorId: principal?.userId,
      action: input.action, entityType: input.entityType, entityId: input.entityId,
      result: input.result ?? 'SUCCESS', risk: input.risk ?? 'NORMAL',
      safeDiffJson: JSON.stringify(input.safeDiff ?? {}), reasonCode: input.reasonCode,
      correlationId: input.correlationId ?? id('corr'),
    } })
  }
}

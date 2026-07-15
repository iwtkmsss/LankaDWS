import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Response } from 'express'
import { getConfig } from '../../config/config.js'
import { fingerprint, secureEqual } from '../../common/crypto.js'
import { forbidden, unauthorized } from '../../common/errors.js'
import type { BertRequest } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { PUBLIC_ROUTE, REQUIRED_PERMISSIONS, RESTRICTED_ROUTE } from './auth.decorators.js'

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true
    const request = context.switchToHttp().getRequest<BertRequest>()
    const token = request.cookies?.[getConfig().SESSION_COOKIE_NAME] as string | undefined
    if (!token) throw unauthorized()
    const session = await this.prisma.userSession.findUnique({
      where: { sessionHash: fingerprint(token, 'session') },
      include: {
        user: {
          include: {
            companyAccess: { where: { status: 'ACTIVE' } },
            roles: {
              where: { status: 'ACTIVE' },
              include: { role: { include: { permissions: { include: { permission: true } } } } },
            },
            totpCredential: true,
          },
        },
      },
    })
    const now = Date.now()
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now) throw unauthorized()
    const idleLimit = getConfig().SESSION_IDLE_MINUTES * 60_000
    if (session.lastSeenAt.getTime() + idleLimit <= now) {
      await this.prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: 'idle_timeout' } })
      throw unauthorized()
    }
    if (session.authorizationVersion !== session.user.authorizationVersion) throw unauthorized()

    const restricted = session.user.status !== 'ACTIVE' || session.user.mustChangePassword ||
      (Boolean(session.user.totpCredential?.confirmedAt) && session.authAssurance < 2) ||
      (session.user.mustEnroll2FA && session.authAssurance < 2)
    const allowsRestricted = this.reflector.getAllAndOverride<boolean>(RESTRICTED_ROUTE, [context.getHandler(), context.getClass()])
    if (restricted && !allowsRestricted) throw unauthorized('credential_step_required')

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const cookieToken = request.cookies?.bert_csrf as string | undefined
      const headerToken = request.header('x-csrf-token')
      if (!cookieToken || !headerToken || !secureEqual(cookieToken, headerToken) ||
        !secureEqual(session.csrfHash, fingerprint(cookieToken, 'csrf'))) {
        throw forbidden('Не вдалося підтвердити безпечне походження запиту.')
      }
    }

    request.principal = {
      userId: session.user.id,
      workspaceId: session.user.workspaceId,
      username: session.user.username,
      displayName: session.user.displayName,
      displayRole: session.user.displayRole,
      primaryCompanyId: session.user.primaryCompanyId,
      allowedCompanyIds: session.user.companyAccess.map((item) => item.companyId),
      permissions: new Set(session.user.roles.flatMap((item) => item.role.permissions.map((entry) => entry.permission.code))),
      authorizationVersion: session.user.authorizationVersion,
      sessionId: session.id,
      authAssurance: session.authAssurance,
      restricted,
    }
    if (now - session.lastSeenAt.getTime() > 60_000) {
      void this.prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    }
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store')
    return true
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, [context.getHandler(), context.getClass()]) ?? []
    if (required.length === 0) return true
    const request = context.switchToHttp().getRequest<BertRequest>()
    if (!request.principal || !required.every((permission) => request.principal?.permissions.has(permission))) throw forbidden()
    return true
  }
}

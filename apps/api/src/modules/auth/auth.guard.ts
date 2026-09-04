import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Response } from 'express'
import { getConfig } from '../../config/config.js'
import { fingerprint, secureEqual } from '../../common/crypto.js'
import { forbidden, unauthorized } from '../../common/errors.js'
import type { BertRequest } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ADMIN_ONLY, PUBLIC_ROUTE, RESTRICTED_ROUTE } from './auth.decorators.js'

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
          include: { primaryCompany: true, totpCredential: true },
        },
      },
    })
    const now = Date.now()
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now) throw unauthorized()
    if (!session.user.isActive) throw unauthorized('account_inactive')
    if (session.user.accountType === 'USER' && (!session.user.primaryCompanyId || !session.user.primaryCompany?.isActive)) throw unauthorized('company_inactive')
    const idleLimit = getConfig().SESSION_IDLE_MINUTES * 60_000
    if (session.lastSeenAt.getTime() + idleLimit <= now) {
      await this.prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: 'idle_timeout' } })
      throw unauthorized()
    }
    if (session.authorizationVersion !== session.user.authorizationVersion) throw unauthorized()

    const restricted = session.authAssurance === 0 || (Boolean(session.user.totpCredential?.confirmedAt) && session.authAssurance < 2) ||
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

    const allowedCompanyIds = (await this.prisma.company.findMany({
      where: { workspaceId: session.user.workspaceId, isActive: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    })).map((company) => company.id)

    request.principal = {
      userId: session.user.id,
      workspaceId: session.user.workspaceId,
      username: session.user.username,
      displayName: session.user.displayName,
      primaryCompanyId: session.user.primaryCompanyId,
      allowedCompanyIds,
      accountType: session.user.accountType,
      authorizationVersion: session.user.authorizationVersion,
      sessionId: session.id,
      authAssurance: session.authAssurance,
      restricted,
    }
    if (request.header('x-session-check') !== '1' && now - session.lastSeenAt.getTime() > 60_000) {
      const lastSeenAt = new Date()
      const expiresAt = new Date(now + idleLimit)
      await this.prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt, expiresAt } })
      const response = context.switchToHttp().getResponse<Response>()
      const cookieOptions = { secure: getConfig().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/', expires: expiresAt }
      response.cookie(getConfig().SESSION_COOKIE_NAME, token, { ...cookieOptions, httpOnly: true })
      const csrfToken = request.cookies?.bert_csrf as string | undefined
      if (csrfToken) response.cookie('bert_csrf', csrfToken, { ...cookieOptions, httpOnly: false })
    }
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store')
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, [context.getHandler(), context.getClass()]) && session.user.accountType !== 'ADMIN') throw forbidden()
    return true
  }
}

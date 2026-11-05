import type { Request } from 'express'

export interface AuthPrincipal {
  userId: string
  workspaceId: string
  username: string
  displayName: string
  primaryCompanyId: string | null
  accountType: 'ADMIN' | 'USER'
  allowedCompanyIds: string[]
  authorizationVersion: number
  sessionId: string
  authAssurance: number
  restricted: boolean
}

export interface LankaDWSRequest extends Request {
  principal?: AuthPrincipal
  correlationId?: string
}

export function principalFrom(request: LankaDWSRequest): AuthPrincipal {
  if (!request.principal) throw new Error('Principal missing after auth guard')
  return request.principal
}

export function isGlobalAdmin(principal: AuthPrincipal): boolean {
  return principal.accountType === 'ADMIN'
}

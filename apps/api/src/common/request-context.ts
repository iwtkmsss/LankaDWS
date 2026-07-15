import type { Request } from 'express'

export interface AuthPrincipal {
  userId: string
  workspaceId: string
  username: string
  displayName: string
  displayRole: string
  primaryCompanyId: string
  allowedCompanyIds: string[]
  permissions: Set<string>
  authorizationVersion: number
  sessionId: string
  authAssurance: number
  restricted: boolean
}

export interface BertRequest extends Request {
  principal?: AuthPrincipal
  correlationId?: string
}

export function principalFrom(request: BertRequest): AuthPrincipal {
  if (!request.principal) throw new Error('Principal missing after auth guard')
  return request.principal
}

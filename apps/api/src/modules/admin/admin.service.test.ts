import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { AdminService } from './admin.service.js'

const principal: AuthPrincipal = {
  userId: 'usr_admin',
  workspaceId: 'ws_test',
  username: 'admin',
  displayName: 'Administrator',
  accountType: 'ADMIN',
  primaryCompanyId: null,
  allowedCompanyIds: [],
  authorizationVersion: 1,
  sessionId: 'ses_admin',
  authAssurance: 1,
  restricted: false,
}

const update = {
  firstName: 'Admin',
  lastName: 'Global',
  username: 'admin',
  accountType: 'ADMIN' as const,
  isActive: false,
}

describe('AdminService administrator safeguards', () => {
  it('does not deactivate the last active global administrator through updateUser', async () => {
    const user = {
      id: principal.userId,
      workspaceId: principal.workspaceId,
      accountType: 'ADMIN',
      isActive: true,
      jobTitle: '',
    }
    const prisma = {
      user: {
        findFirst: vi.fn((query: { where: { id?: string; normalizedUsername?: string } }) =>
          Promise.resolve(query.where.id === principal.userId ? user : null)),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn(),
      },
    }
    const service = new AdminService(prisma as never, {} as never, {} as never)

    await expect(service.updateUser(principal, principal.userId, update)).rejects.toMatchObject({
      status: 403,
      safeDetail: 'last_admin',
    })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { workspaceId: principal.workspaceId, accountType: 'ADMIN', isActive: true },
    })
  })
})

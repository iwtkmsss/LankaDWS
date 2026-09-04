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

describe('AdminService user creation', () => {
  it('creates a company user without an organization unit assignment', async () => {
    const createUser = vi.fn((input: { data: { primaryCompanyId: string | null; accountType: 'ADMIN' | 'USER' } }) => {
      void input
      return Promise.resolve(undefined)
    })
    const transaction = {
      user: { create: createUser },
      usernameReservation: { create: vi.fn().mockResolvedValue(undefined) },
      passwordCredential: { create: vi.fn().mockResolvedValue(undefined) },
      userOrgAssignment: { create: vi.fn().mockResolvedValue(undefined) },
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
    }
    const prisma = {
      usernameReservation: { findUnique: vi.fn().mockResolvedValue(null) },
      company: { findFirst: vi.fn().mockResolvedValue({ id: 'cmp_test' }) },
      orgUnit: { findFirst: vi.fn() },
      $transaction: vi.fn((callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    }
    const service = new AdminService(prisma as never, {} as never, {} as never)

    await expect(service.createUser(principal, {
      firstName: 'Test',
      lastName: 'User',
      username: 'test.user',
      password: 'Correct-Horse-9!',
      contactEmail: 'test.user@example.com',
      accountType: 'USER',
      companyId: 'cmp_test',
      isActive: true,
    })).resolves.toMatchObject({ username: 'test.user' })

    expect(prisma.orgUnit.findFirst).not.toHaveBeenCalled()
    expect(transaction.userOrgAssignment.create).not.toHaveBeenCalled()
    expect(createUser.mock.calls[0]?.[0].data).toMatchObject({ primaryCompanyId: 'cmp_test', accountType: 'USER' })
  })
})


describe('AdminService deactivation', () => {
  it('revokes all sessions and invalidates authorization when disabling a user', async () => {
    const user = { id: 'usr_target', accountType: 'USER', isActive: true, primaryCompanyId: 'cmp_test', jobTitle: '' }
    const tx = {
      user: { update: vi.fn().mockResolvedValue(user) },
      company: { updateMany: vi.fn() }, orgUnit: { updateMany: vi.fn() },
      userSession: { updateMany: vi.fn() }, auditEvent: { create: vi.fn() },
    }
    const prisma = {
      user: { findFirst: vi.fn(({ where }: { where: { id: unknown } }) => Promise.resolve(where.id === user.id ? user : null)) },
      company: { findFirst: vi.fn().mockResolvedValue({ id: 'cmp_test' }) },
      $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    }
    const service = new AdminService(prisma as never, {} as never, {} as never)
    await service.updateUser(principal, user.id, { ...update, accountType: 'USER', companyId: 'cmp_test' })
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false, authorizationVersion: { increment: 1 } }) as unknown }))
    expect(tx.userSession.updateMany).toHaveBeenCalledWith({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: expect.any(Date) as unknown, revokeReason: 'deactivated' } })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { DomainError, forbidden } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthService } from '../auth/auth.service.js'
import type { JobsService } from '../jobs/jobs.service.js'
import { AdminService } from './admin.service.js'
import { AdminController } from './admin.controller.js'
import type { FilesService } from '../files/files.service.js'

vi.mock('../../common/crypto.js', () => ({
  id: vi.fn((prefix: string) => `${prefix}_test`), hashPassword: vi.fn(() => Promise.resolve('hashed')),
  randomTemporaryPassword: vi.fn(() => 'temporary-secret'),
}))

const principal = { userId: 'admin', workspaceId: 'workspace', accountType: 'ADMIN' } as AuthPrincipal
type Update = Parameters<AdminService['updateUser']>[2]
const input: Update = { firstName: 'Іван', lastName: 'Коваль', username: 'ivan', accountType: 'USER', companyId: 'company', isActive: true }

function setup() {
  const target = { id: 'target', normalizedUsername: 'ivan', accountType: 'USER', isActive: true, primaryCompanyId: 'company', jobTitle: '', phone: null, gender: null, birthDate: null }
  const approval = { id: 'approval', targetId: 'target', initiatorId: 'admin', approverId: 'approver', state: 'APPROVED' }
  const tx = {
    user: {
      findFirst: vi.fn((args: { where: { id?: unknown; normalizedUsername?: string } }): Promise<typeof target | null> => {
        if (args.where.normalizedUsername) return Promise.resolve(null)
        if (args.where.id === 'successor' || args.where.id === 'approver') return Promise.resolve({ ...target, id: args.where.id, accountType: 'ADMIN' })
        return Promise.resolve(target)
      }),
      create: vi.fn().mockResolvedValue(target), update: vi.fn().mockResolvedValue(target), count: vi.fn().mockResolvedValue(3), findMany: vi.fn().mockResolvedValue([]),
    },
    company: { findFirst: vi.fn((args: { where: { id: string } }) => Promise.resolve({ id: args.where.id })), updateMany: vi.fn() },
    orgUnit: { findFirst: vi.fn().mockResolvedValue({ id: 'unit' }), updateMany: vi.fn() },
    userOrgAssignment: { updateMany: vi.fn(), create: vi.fn() },
    usernameReservation: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    task: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([{ id: 'task', reporterId: 'target' }]), updateMany: vi.fn() },
    document: { count: vi.fn().mockResolvedValue(0), updateMany: vi.fn() },
    taskParticipant: { findUnique: vi.fn().mockResolvedValue({ id: 'participant', role: 'RESPONSIBLE', removedAt: null }), upsert: vi.fn(), update: vi.fn() },
    passwordCredential: { upsert: vi.fn(), create: vi.fn() }, temporaryCredential: { updateMany: vi.fn() },
    userSession: { updateMany: vi.fn() }, auditEvent: { create: vi.fn() }, credentialEvent: { create: vi.fn() },
    credentialResetApproval: {
      findFirst: vi.fn((args: { where: { state: string } }) => Promise.resolve(approval.state === args.where.state ? approval : null)),
      update: vi.fn(() => { approval.state = 'COMPLETED'; return Promise.resolve() }),
    },
  }
  const prisma = { ...tx, $transaction: vi.fn((operation: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[]) =>
    typeof operation === 'function' ? operation(tx) : Promise.all(operation)) }
  const auth = { assertRecentReauth: vi.fn((_principal: AuthPrincipal, challenge?: string) => {
    if (!challenge) return Promise.reject(forbidden())
    return Promise.resolve()
  }) }
  const service = new AdminService(prisma as unknown as PrismaService, auth as unknown as AuthService, {} as JobsService)
  return { service, prisma, tx, target, auth, approval }
}

describe('admin account updates', () => {
  it('creates a user in the selected company without requiring a department', async () => {
    const { service, tx } = setup()
    await service.createUser(principal, { firstName: 'Іван', lastName: 'Коваль', username: 'new-user', accountType: 'USER', companyId: 'company', contactEmail: 'new@example.com', password: 'Lake-49!', isActive: true })
    expect(tx.user.create.mock.calls[0]?.[0] as unknown).toMatchObject({ data: { primaryCompanyId: 'company', accountType: 'USER' } })
    expect(tx.userOrgAssignment.create).not.toHaveBeenCalled()
  })
  it.each(['USER', 'ADMIN'])('sets a permanent %s password directly with audit and session revocation', async (accountType) => {
    const { service, tx, auth, target } = setup()
    target.accountType = accountType
    await service.updateUser(principal, 'target', {
      ...input, accountType: accountType as 'USER' | 'ADMIN',
      companyId: accountType === 'ADMIN' ? undefined : 'company', password: 'Lake-49!',
    })
    expect(auth.assertRecentReauth).not.toHaveBeenCalled()
    expect(tx.credentialResetApproval.findFirst).not.toHaveBeenCalled()
    expect(tx.credentialResetApproval.update).not.toHaveBeenCalled()
    expect(tx.passwordCredential.upsert).toHaveBeenCalledOnce()
    expect(tx.temporaryCredential.updateMany).toHaveBeenCalledOnce()
    expect(tx.userSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revokeReason: 'admin_password_changed' }) as unknown }) as unknown)
    expect(tx.credentialEvent.create).toHaveBeenCalledOnce()
  })

  it('allows the last admin to change their own password directly', async () => {
    const { service, target, tx } = setup()
    target.id = 'admin'; target.accountType = 'ADMIN'; tx.user.count.mockResolvedValue(1)
    await service.updateUser(principal, 'admin', { ...input, accountType: 'ADMIN', companyId: undefined, password: 'CopperMeadowLantern47!' })
    expect(tx.passwordCredential.upsert).toHaveBeenCalledOnce()
    expect(tx.credentialResetApproval.findFirst).not.toHaveBeenCalled()
  })

  it('rejects self deactivation through PATCH', async () => {
    const { service, tx } = setup()
    await expect(service.updateUser(principal, 'admin', { ...input, isActive: false })).rejects.toMatchObject({ status: 403 })
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it('requires a successor when active tasks or documents remain', async () => {
    const { service, tx } = setup()
    tx.task.count.mockResolvedValue(2); tx.document.count.mockResolvedValue(1)
    await expect(service.updateUser(principal, 'target', { ...input, isActive: false })).rejects.toMatchObject({ status: 409, safeDetail: expect.stringContaining('задачі — 2') as unknown })
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it('transfers task responsibility and documents before deactivating', async () => {
    const { service, tx } = setup()
    tx.task.count.mockResolvedValue(1); tx.document.count.mockResolvedValue(1)
    await service.updateUser(principal, 'target', { ...input, isActive: false, newOwnerId: 'successor' })
    expect(tx.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { reporterId: 'successor', version: { increment: 1 } } }) as unknown)
    expect(tx.taskParticipant.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: 'successor', role: 'RESPONSIBLE' }) as unknown }) as unknown)
    expect(tx.document.updateMany).toHaveBeenCalledWith({ where: { ownerId: 'target', archivedAt: null }, data: { ownerId: 'successor' } })
    expect(tx.userSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revokeReason: 'deactivated' }) as unknown }) as unknown)
  })

  it('rejects a missing or inactive successor', async () => {
    const { service, tx, target } = setup()
    tx.user.findFirst.mockImplementation((args) => Promise.resolve(args.where.id === 'missing' ? null : args.where.normalizedUsername ? null : target))
    await expect(service.updateUser(principal, 'target', { ...input, isActive: false, newOwnerId: 'missing' })).rejects.toMatchObject({ status: 400 })
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it('checks the last admin inside the update transaction', async () => {
    const { service, target, tx } = setup()
    target.accountType = 'ADMIN'; tx.user.count.mockResolvedValue(1)
    await expect(service.updateUser(principal, 'target', input)).rejects.toMatchObject({ status: 403 })
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it.each([
    { orgUnitId: null },
    { companyId: 'another-company' },
    { accountType: 'ADMIN' as const, companyId: undefined },
  ])('closes old assignments on clear, company transfer or promotion: %j', async (change) => {
    const { service, tx } = setup()
    await service.updateUser(principal, 'target', { ...input, ...change })
    expect(tx.userOrgAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'target', endedAt: null }, data: { endedAt: expect.any(Date) as unknown, isPrimary: false } }) as unknown)
    expect(tx.userOrgAssignment.create).not.toHaveBeenCalled()
  })

  it('preserves the existing assignment when omitted from an unchanged account', async () => {
    const { service, tx } = setup()
    await service.updateUser(principal, 'target', input)
    expect(tx.userOrgAssignment.updateMany).not.toHaveBeenCalled()
  })

  it('rejects an invalid or inaccessible department without changing the account', async () => {
    const { service, tx } = setup()
    tx.orgUnit.findFirst.mockResolvedValue(null)
    await expect(service.updateUser(principal, 'target', { ...input, orgUnitId: 'foreign-unit' })).rejects.toMatchObject({ status: 400 })
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it('reserves the new login and preserves the old login reservation during rename', async () => {
    const { service, tx } = setup()
    await service.updateUser(principal, 'target', { ...input, username: 'new-login' })
    expect(tx.usernameReservation.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { currentUserId: null, previousUserId: 'target', state: 'RESERVED' } }) as unknown)
    expect(tx.usernameReservation.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ normalizedUsername: 'new-login', currentUserId: 'target', state: 'ACTIVE' }) as unknown }) as unknown)
  })

  it('rejects a login reserved for someone else', async () => {
    const { service, tx } = setup()
    tx.usernameReservation.findUnique.mockResolvedValue({ currentUserId: null, previousUserId: 'another' })
    await expect(service.updateUser(principal, 'target', { ...input, username: 'reserved' })).rejects.toMatchObject({ status: 409 })
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it('returns a conflict for concurrent duplicate login creation', async () => {
    const { service, tx } = setup()
    tx.user.create.mockRejectedValue({ code: 'P2002' })
    await expect(service.createUser(principal, { firstName: 'Іван', lastName: 'Коваль', username: 'ivan', accountType: 'USER', companyId: 'company', isActive: true, contactEmail: 'ivan@example.com', password: 'CopperMeadowLantern47!' })).rejects.toMatchObject({ status: 409 })
  })

  it('paginates in SQL with safe projections and stable sorting', async () => {
    const { service, tx } = setup()
    tx.user.count.mockResolvedValue(123)
    await expect(service.users(principal, 'Іван', 'true', 'company', 'USER', 2)).resolves.toMatchObject({ page: 2, pageSize: 50, total: 123 })
    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50, skip: 50, orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: expect.objectContaining({ totpCredential: { select: { confirmedAt: true } }, _count: expect.any(Object) as unknown }) as unknown }) as unknown)
    expect(tx.user.count).toHaveBeenCalledWith({ where: (tx.user.findMany.mock.calls[0]?.[0] as { where: unknown }).where })
  })

  it.each(['asc', 'desc'] as const)('sorts users before pagination in %s direction', async (direction) => {
    const { service, tx } = setup()
    for (const sort of ['displayName', 'accountType', 'isActive'] as const) {
      await service.users(principal, undefined, 'true', 'company', undefined, 2, sort, direction)
      expect(tx.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
        skip: 50, take: 50, where: expect.objectContaining({ workspaceId: 'workspace', primaryCompanyId: 'company', isActive: true }) as unknown,
        orderBy: sort === 'accountType'
          ? [{ accountType: direction }, { primaryCompany: { displayName: direction } }, { displayName: 'asc' }, { id: 'asc' }]
          : sort === 'isActive' ? [{ isActive: direction }, { displayName: 'asc' }, { id: 'asc' }]
            : [{ displayName: direction }, { id: 'asc' }],
      }))
    }
  })

  it.each(['asc', 'desc'] as const)('paginates across the confirmed 2FA boundary in %s direction', async (direction) => {
    const { service, tx } = setup()
    tx.user.count.mockResolvedValueOnce(123).mockResolvedValueOnce(60)
    await service.users(principal, undefined, 'true', undefined, undefined, 2, 'twoFactor', direction)
    const enabled = { totpCredential: { is: { confirmedAt: { not: null } } } }
    const disabled = { OR: [{ totpCredential: { is: null } }, { totpCredential: { is: { confirmedAt: null } } }] }
    expect(tx.user.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ skip: 50, take: 10,
      where: { AND: [{ workspaceId: 'workspace', isActive: true }, direction === 'asc' ? disabled : enabled] },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    }))
    expect(tx.user.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ skip: 0, take: 40,
      where: { AND: [{ workspaceId: 'workspace', isActive: true }, direction === 'asc' ? enabled : disabled] },
    }))
  })

  it.each([['passwordHash', 'asc'], ['displayName', 'invalid']])('rejects invalid sorting %s/%s', (sort, direction) => {
    const { service } = setup()
    const controller = new AdminController(service, {} as FilesService)
    expect(() => controller.users({ principal } as never, undefined, undefined, undefined, undefined, '1', sort, direction)).toThrow()
  })

  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740991'])('rejects invalid page %s at the controller', (page) => {
    const { service } = setup()
    const controller = new AdminController(service, {} as FilesService)
    expect(() => controller.users({ principal } as never, undefined, undefined, undefined, undefined, page)).toThrow()
  })

  it.each(['create', 'update'])('returns safe field-specific validation messages for %s', (action) => {
    const { service } = setup()
    const create = vi.spyOn(service, 'createUser')
    const update = vi.spyOn(service, 'updateUser')
    const controller = new AdminController(service, {} as FilesService)
    const body = { ...input, contactEmail: 'bad-email', password: 'short', passwordConfirmation: 'short' }
    let failure: unknown
    try {
      if (action === 'create') void controller.createUser({ principal } as never, body)
      else void controller.updateUser({ principal } as never, 'target', body)
    } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(DomainError)
    expect(failure).toMatchObject({ status: 400, code: 'validation_failed', fieldErrors: {
      contactEmail: [expect.stringContaining('коректну email-адресу')],
      password: ['Введіть щонайменше 8 символів без пробілів.'],
    } })
    expect(JSON.stringify(failure)).not.toContain('short')
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})

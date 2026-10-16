import { describe, expect, it, vi } from 'vitest'
import { archiveOrgUnitSchema } from '@lankadws/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { ScopeService } from '../authorization/scope.service.js'
import { OrgService } from './org.service.js'

const principal = { userId: 'usr_admin', workspaceId: 'wrk_one', accountType: 'ADMIN', allowedCompanyIds: ['cmp_one'] } as AuthPrincipal

describe('organization branch archival', () => {
  const branch = [
    { id: 'root', parentId: null, status: 'ACTIVE', version: 2, sortOrder: 10 },
    { id: 'child', parentId: 'root', status: 'ACTIVE', version: 3, sortOrder: 20 },
    { id: 'grandchild', parentId: 'child', status: 'ACTIVE', version: 1, sortOrder: 30 },
    { id: 'old', parentId: 'root', status: 'ARCHIVED', version: 4, sortOrder: 40 },
    { id: 'sibling', parentId: null, status: 'ACTIVE', version: 1, sortOrder: 30 },
  ]
  function setup() {
    type ArchiveUpdate = { where: { id: string; workspaceId: string; companyId: string; status: string; version: number }; data: { status: string; version: { increment: number } } }
    const tx = {
      orgUnit: { findMany: vi.fn().mockResolvedValue(branch), updateMany: vi.fn<(input: ArchiveUpdate) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: vi.fn<(input: { data: { safeDiffJson: string } }) => Promise<object>>().mockResolvedValue({}) },
      userOrgAssignment: { updateMany: vi.fn(), create: vi.fn() },
    }
    const prisma = {
      orgUnit: { findFirst: vi.fn().mockResolvedValue({ ...branch[0], children: [], assignments: [] }) },
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    }
    return { tx, prisma, service: new OrgService(prisma as unknown as PrismaService, {} as ScopeService) }
  }

  it('archives every active descendant and leaves employees at company level', async () => {
    const { service, tx } = setup()
    await expect(service.archiveUnit(principal, 'cmp_one', 'root', { expectedVersion: 2, archiveBranch: true }))
      .resolves.toMatchObject({ archivedUnits: 3, version: 3 })
    expect(tx.orgUnit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'wrk_one', companyId: 'cmp_one' } }))
    expect(tx.orgUnit.updateMany.mock.calls.map(([input]) => input.where.id)).toEqual(['root', 'child', 'grandchild'])
    for (const [input] of tx.orgUnit.updateMany.mock.calls) {
      expect(input.data).toEqual({ status: 'ARCHIVED', version: { increment: 1 } })
      expect(input.where).toMatchObject({ companyId: 'cmp_one', workspaceId: 'wrk_one', status: 'ACTIVE' })
    }
    expect(tx.userOrgAssignment.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { companyId: 'cmp_one', orgUnitId: { in: ['root', 'child', 'grandchild'] }, endedAt: null },
      data: { endedAt: expect.any(Date) as unknown, isPrimary: false },
    })
    expect(tx.userOrgAssignment.create).not.toHaveBeenCalled()
    expect(tx.auditEvent.create).toHaveBeenCalledOnce()
    const archive: unknown = JSON.parse(tx.auditEvent.create.mock.calls[0][0].data.safeDiffJson)
    expect(archive).toMatchObject({ structure: branch.slice(0, 3).map((unit) => ({ ...unit, version: unit.version + 1, status: 'ARCHIVED' })) })
  })

  it('rejects a stale root without archiving any descendants', async () => {
    const { service, tx } = setup()
    tx.orgUnit.findMany.mockResolvedValueOnce(branch.map((unit) => unit.id === 'root' ? { ...unit, version: 3 } : unit))
    await expect(service.archiveUnit(principal, 'cmp_one', 'root', { expectedVersion: 2, archiveBranch: true })).rejects.toMatchObject({ status: 409 })
    expect(tx.orgUnit.updateMany).not.toHaveBeenCalled()
  })

  it('fails the transaction when a descendant changed and does not record success', async () => {
    const { service, tx } = setup()
    tx.orgUnit.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    await expect(service.archiveUnit(principal, 'cmp_one', 'root', { expectedVersion: 2, archiveBranch: true })).rejects.toMatchObject({ status: 409 })
    expect(tx.auditEvent.create).not.toHaveBeenCalled()
  })

  it('archives a root without a target and leaves employees in the company without assignments', async () => {
    const { service, tx, prisma } = setup()
    prisma.orgUnit.findFirst.mockResolvedValueOnce({ ...branch[0], children: [], assignments: [{ userId: 'usr_one', positionTitle: 'Дизайнер' }] })
    Object.assign(prisma.orgUnit, { findMany: vi.fn().mockResolvedValue([]) })
    await expect(service.archiveUnit(principal, 'cmp_one', 'root', { expectedVersion: 2 }))
      .resolves.toMatchObject({ archived: true, destinationId: null })
    expect(tx.userOrgAssignment.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { companyId: 'cmp_one', orgUnitId: 'root', endedAt: null },
      data: { endedAt: expect.any(Date) as unknown, isPrimary: false },
    })
    expect(tx.userOrgAssignment.create).not.toHaveBeenCalled()
    expect(tx.auditEvent.create).toHaveBeenCalledOnce()
    expect(archiveOrgUnitSchema.safeParse({ expectedVersion: 2, archiveBranch: true, targetUnitId: 'sibling' }).success).toBe(false)
  })

  it('promotes child departments to the company level when archiving their root', async () => {
    const { service, tx, prisma } = setup()
    prisma.orgUnit.findFirst.mockResolvedValueOnce({ ...branch[0], children: [{ id: 'child', name: 'Дизайн', normalizedName: 'дизайн', sortOrder: 10, version: 3 }], assignments: [] })
    Object.assign(prisma.orgUnit, { findMany: vi.fn().mockResolvedValue([]) })
    await service.archiveUnit(principal, 'cmp_one', 'root', { expectedVersion: 2 })
    expect(tx.orgUnit.updateMany.mock.calls[0]?.[0]).toMatchObject({ where: { id: 'child', companyId: 'cmp_one', status: 'ACTIVE' }, data: { parentId: null, version: { increment: 1 } } })
    expect(tx.userOrgAssignment.create).not.toHaveBeenCalled()
  })

  it('rejects a child name collision before changing assignments or hierarchy', async () => {
    const { service, tx, prisma } = setup()
    prisma.orgUnit.findFirst.mockResolvedValueOnce({ ...branch[0], children: [{ id: 'child', name: 'Дизайн', normalizedName: 'дизайн', sortOrder: 10, version: 3 }], assignments: [] })
    Object.assign(prisma.orgUnit, { findMany: vi.fn().mockResolvedValue([{ normalizedName: 'дизайн' }]) })
    await expect(service.archiveUnit(principal, 'cmp_one', 'root', { expectedVersion: 2 })).rejects.toMatchObject({ status: 409 })
    expect(tx.orgUnit.updateMany).not.toHaveBeenCalled()
    expect(tx.userOrgAssignment.updateMany).not.toHaveBeenCalled()
  })

})

describe('organization company projection', () => {
  it('persists icon-only changes with the existing version check and projects the chosen icon', async () => {
    const unit = { id: 'unit', companyId: 'cmp_one', parentId: null, name: 'Відділ', normalizedName: 'відділ', icon: 'scales', description: null, status: 'ACTIVE', sortOrder: 10, version: 2, manager: null, _count: { assignments: 0, children: 0 } }
    const tx = { orgUnit: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, auditEvent: { create: vi.fn() } }
    const prisma = {
      company: { findFirst: vi.fn().mockResolvedValue({ id: 'cmp_one', displayName: 'Компанія', logoFileId: 'file_logo', description: null, manager: null, version: 1 }) },
      orgUnit: { findFirst: vi.fn().mockResolvedValueOnce(unit).mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([unit]) },
      $transaction: vi.fn(async (run: (value: typeof tx) => unknown) => await run(tx)),
    }
    const service = new OrgService(prisma as unknown as PrismaService, {} as ScopeService)
    await service.updateUnit(principal, 'cmp_one', 'unit', { icon: 'computer', expectedVersion: 2 })
    expect(tx.orgUnit.updateMany.mock.calls[0]?.[0]).toMatchObject({ where: { version: 2 }, data: { icon: 'computer', version: { increment: 1 } } })
    const result = await service.listAdminUnits(principal, 'cmp_one', { status: 'ALL' })
    expect(result.items[0]?.icon).toBe('scales')
    expect(result.company.logoAsset).toBe('/api/v1/companies/cmp_one/logo/file_logo')
  })

  it('includes the company description in the administrative structure response', async () => {
    const prisma = {
      company: { findFirst: vi.fn().mockResolvedValue({ id: 'cmp_one', displayName: 'Компанія', description: 'Опис для карти', version: 3, manager: null }) },
      orgUnit: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const service = new OrgService(prisma as unknown as PrismaService, {} as ScopeService)

    await expect(service.listAdminUnits(principal, 'cmp_one', { status: 'ALL' })).resolves.toEqual({
      company: { id: 'cmp_one', name: 'Компанія', description: 'Опис для карти', logoAsset: null, manager: null, version: 3 },
      items: [],
    })
  })

  it('renders a manager who is an active member of the company but not a global admin', async () => {
    const prisma = {
      company: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cmp_one', displayName: 'Компанія', description: null, version: 1,
          manager: { id: 'usr_member', displayName: 'Учасник', jobTitle: 'Керівник', isActive: true, primaryCompanyId: 'cmp_one' },
        }),
      },
      orgUnit: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const service = new OrgService(prisma as unknown as PrismaService, {} as ScopeService)

    const first = await service.listAdminUnits(principal, 'cmp_one', { status: 'ALL' })
    expect(first.company.manager).toEqual({ id: 'usr_member', displayName: 'Учасник', jobTitle: 'Керівник', avatarAsset: null })

    prisma.company.findFirst.mockResolvedValueOnce({
      id: 'cmp_one', displayName: 'Компанія', description: null, version: 1,
      manager: { id: 'usr_admin', displayName: 'Адмін', jobTitle: '', isActive: true, primaryCompanyId: null },
    })
    const second = await service.listAdminUnits(principal, 'cmp_one', { status: 'ALL' })
    expect(second.company.manager).toBeNull()
  })

  it('rejects a manager assignment that relies only on global admin status', async () => {
    const userFindFirst = vi.fn().mockResolvedValue(null)
    const prisma = {
      company: { findFirst: vi.fn().mockResolvedValue({ id: 'cmp_one', displayName: 'Компанія', description: null, version: 1, manager: null }) },
      user: { findFirst: userFindFirst },
    }
    const service = new OrgService(prisma as unknown as PrismaService, {} as ScopeService)

    await expect(service.createUnit(principal, 'cmp_one', { name: 'Відділ', description: '', managerId: 'usr_admin' }))
      .rejects.toMatchObject({ status: 404 })
    expect(userFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'usr_admin', accountType: 'USER', primaryCompanyId: 'cmp_one', isActive: true },
    })
  })

  it('includes a department description in the administrative structure response', async () => {
    const prisma = {
      company: { findFirst: vi.fn().mockResolvedValue({ id: 'cmp_one', displayName: 'Компанія', description: null, version: 3, manager: null }) },
      orgUnit: { findMany: vi.fn().mockResolvedValue([{
        id: 'unit_sales', companyId: 'cmp_one', parentId: null, name: 'Продажі', description: 'Робота з клієнтами', status: 'ACTIVE', sortOrder: 10, version: 2, manager: null,
        _count: { children: 0, assignments: 4 },
      }]) },
    }
    const service = new OrgService(prisma as unknown as PrismaService, {} as ScopeService)

    const response = await service.listAdminUnits(principal, 'cmp_one', { status: 'ALL' })

    expect(response.items[0]).toMatchObject({
      id: 'unit_sales', name: 'Продажі', description: 'Робота з клієнтами', activeEmployeeCount: 4,
    })
  })
})

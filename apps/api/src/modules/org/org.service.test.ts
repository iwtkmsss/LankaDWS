import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { ScopeService } from '../authorization/scope.service.js'
import { OrgService } from './org.service.js'

const principal = { userId: 'usr_admin', workspaceId: 'wrk_one', accountType: 'ADMIN', allowedCompanyIds: ['cmp_one'] } as AuthPrincipal

describe('organization company projection', () => {
  it('includes the company description in the administrative structure response', async () => {
    const prisma = {
      company: { findFirst: vi.fn().mockResolvedValue({ id: 'cmp_one', displayName: 'Компанія', description: 'Опис для карти', version: 3, manager: null }) },
      orgUnit: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const service = new OrgService(prisma as unknown as PrismaService, {} as ScopeService)

    await expect(service.listAdminUnits(principal, 'cmp_one', { status: 'ALL' })).resolves.toEqual({
      company: { id: 'cmp_one', name: 'Компанія', description: 'Опис для карти', manager: null, version: 3 },
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
    expect(first.company.manager).toEqual({ id: 'usr_member', displayName: 'Учасник', jobTitle: 'Керівник' })

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

import { describe, expect, it, vi } from 'vitest'
import type { LankaDWSRequest } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { ScopeService } from '../authorization/scope.service.js'
import { EmployeesController } from './employees.controller.js'

function setup() {
  const findMany = vi.fn().mockResolvedValue([])
  const controller = new EmployeesController(
    { user: { findMany } } as unknown as PrismaService,
    { allowedCompanies: vi.fn().mockReturnValue(['company-a', 'company-b']) } as unknown as ScopeService,
  )
  const request = { principal: { workspaceId: 'workspace-a', userId: 'me' } } as LankaDWSRequest
  return {
    findMany,
    controller,
    request,
    search: (value: string, limit = '5', accountType?: string, exclude?: string) =>
      controller.list(request, undefined, value, undefined, undefined, undefined, limit, accountType, exclude),
  }
}

describe('bounded employee selector search', () => {
  it('does not query users for an empty or whitespace-only search', async () => {
    const { search, findMany } = setup()
    expect(await search('')).toEqual({ items: [] })
    expect(await search('  \t ')).toEqual({ items: [] })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('searches from one Unicode character, caps SQL results and retains scope', async () => {
    const { search, findMany } = setup()
    await search(' А ', '1000', undefined, 'selected-user')
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        workspaceId: 'workspace-a', isActive: true,
        AND: [
          { AND: [{ OR: [{ accountType: 'USER', primaryCompanyId: { in: ['company-a', 'company-b'] } }, { accountType: 'ADMIN' }] }] },
          { OR: [{ normalizedDisplayName: 'а' }, { normalizedUsername: 'а' }] },
          { id: { notIn: ['selected-user'] } },
        ],
      },
      select: { id: true, displayName: true, username: true, jobTitle: true, avatarAsset: true, accountType: true, primaryCompanyId: true },
      orderBy: [{ normalizedDisplayName: 'asc' }, { id: 'asc' }],
      take: 5,
    })
  })

  it('can explicitly restrict selectors to employee accounts', async () => {
    const { search, findMany } = setup()
    await search('a', '5', 'USER')
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { workspaceId: 'workspace-a', AND: [{ AND: [{ OR: [
        { accountType: 'USER', primaryCompanyId: { in: ['company-a', 'company-b'] } },
      ] }] }, { OR: [{ normalizedDisplayName: 'a' }, { normalizedUsername: 'a' }] }, { id: { notIn: [] } }] }, take: 5,
    })
  })

  it.each(['0', '-1', '1.5', 'bad'])('rejects invalid limit %s', async (limit) => {
    const { search, findMany } = setup()
    await expect(search('a', limit)).rejects.toMatchObject({ status: 400 })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('uses the same bounded search for large exclusion bodies and excludes membership in SQL', async () => {
    const { controller, request, findMany } = setup()
    const excludeIds = Array.from({ length: 1000 }, (_, index) => `user-${index}`)
    await controller.search(request, { q: 'а', excludeIds, excludeOrgUnitId: 'large-unit', limit: 1000 })
    expect(findMany.mock.calls[0]?.[0] as unknown).toMatchObject({ take: 5, where: { AND: [
      { AND: [expect.any(Object), { orgAssignments: { none: { orgUnitId: 'large-unit', endedAt: null } } }] },
      expect.any(Object), { id: { notIn: excludeIds } },
    ] } })
  })
})

describe('employee department projection', () => {
  it('reads only active primary assignments and keeps users without a department in their company', async () => {
    const { request, findMany } = setup()
    const employee = { id: 'employee', displayName: 'Марія', primaryCompanyId: 'company-a', jobTitle: 'Дизайнерка', orgAssignments: [], approver: null }
    findMany.mockResolvedValueOnce([employee])
    const presence = { findMany: vi.fn().mockResolvedValue([]) }
    // The directory's presence query is independent of department membership.
    const prisma = { user: { findMany }, presenceRecord: presence }
    const directory = new EmployeesController(prisma as unknown as PrismaService, { allowedCompanies: () => ['company-a'] } as unknown as ScopeService)
    const result = await directory.list(request, 'company-a')
    expect(result.items).toEqual([expect.objectContaining({ primaryCompanyId: 'company-a', jobTitle: 'Дизайнерка', positionTitle: 'Дизайнерка', orgUnit: null })])
    expect(result).toMatchObject({ counts: { all: 1 } })
    expect(findMany.mock.calls[0]?.[0] as unknown).toMatchObject({
      where: { primaryCompanyId: { in: ['company-a'] } },
      select: { orgAssignments: {
        where: { companyId: { in: ['company-a'] }, endedAt: null, isPrimary: true, orgUnit: { status: 'ACTIVE' } },
      } },
    })
  })

  it('does not show an assignment from another company in the employee profile', async () => {
    const user = { id: 'employee', primaryCompanyId: 'company-a', jobTitle: 'Дизайнерка', orgAssignments: [
      { positionTitle: 'Інша посада', orgUnit: { id: 'other-unit', companyId: 'company-b', name: 'Інший відділ', parent: null, manager: null } },
    ] }
    const findFirst = vi.fn().mockResolvedValue(user)
    const controller = new EmployeesController({ user: { findFirst }, presenceRecord: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as PrismaService,
      { allowedCompanies: () => ['company-a', 'company-b'] } as unknown as ScopeService)
    const { request } = setup()
    const result = await controller.detail(request, user.id)
    expect(result).toMatchObject({ primaryCompanyId: 'company-a', jobTitle: 'Дизайнерка', positionTitle: 'Дизайнерка', orgUnit: null })
    expect(findFirst.mock.calls[0]?.[0] as unknown).toMatchObject({ select: {
      orgAssignments: { where: { companyId: { in: ['company-a', 'company-b'] }, endedAt: null, isPrimary: true, orgUnit: { status: 'ACTIVE' } } },
    } })
  })
})

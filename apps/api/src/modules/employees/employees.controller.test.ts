import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal, LankaDWSRequest } from '../../common/request-context.js'
import { EmployeesController } from './employees.controller.js'

function principal(): AuthPrincipal {
  return {
    userId: 'usr_viewer',
    workspaceId: 'wrk_test',
    username: 'viewer',
    displayName: 'Viewer',
    primaryCompanyId: 'cmp_test',
    accountType: 'USER',
    allowedCompanyIds: ['cmp_test'],
    authorizationVersion: 1,
    sessionId: 'ses_test',
    authAssurance: 1,
    restricted: false,
  }
}

function setup() {
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'usr_admin',
        displayName: 'Адміністратор',
        username: 'admin',
        jobTitle: 'Адміністратор системи',
        primaryCompanyId: null,
        timezone: 'Europe/Kyiv',
        locale: 'uk',
        avatarAsset: null,
        approverId: null,
        contactEmail: null,
        orgAssignments: [],
      }),
      findUnique: vi.fn(),
    },
    presenceRecord: { findMany: vi.fn().mockResolvedValue([]) },
  }
  const scope = { allowedCompanies: vi.fn().mockReturnValue(['cmp_test']) }
  const controller = new EmployeesController(prisma as never, scope as never)
  const request = { principal: principal() } as LankaDWSRequest
  return { controller, prisma, request }
}

describe('EmployeesController.detail', () => {
  it('allows an active workspace administrator without a primary company', async () => {
    const { controller, prisma, request } = setup()

    const result = await controller.detail(request, 'usr_admin')

    expect(result).toMatchObject({
      id: 'usr_admin',
      primaryCompanyId: null,
      positionTitle: 'Адміністратор системи',
      orgUnit: null,
    })
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'usr_admin',
        workspaceId: 'wrk_test',
        isActive: true,
        OR: [
          { accountType: 'USER', primaryCompanyId: { in: ['cmp_test'] } },
          { accountType: 'ADMIN' },
        ],
      },
    }))
  })

  it('keeps regular employee profiles restricted to allowed companies', async () => {
    const { controller, prisma, request } = setup()

    await controller.detail(request, 'usr_employee')

    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'usr_employee',
        workspaceId: 'wrk_test',
        isActive: true,
        OR: [
          { accountType: 'USER', primaryCompanyId: { in: ['cmp_test'] } },
          { accountType: 'ADMIN' },
        ],
      },
    }))
  })
})

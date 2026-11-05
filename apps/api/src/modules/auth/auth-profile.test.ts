import { expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { CapabilitiesService } from '../authorization/capabilities.service.js'
import { AuthService } from './auth.service.js'

it('keeps company and job data when the profile has no active primary department', async () => {
  const user = {
    id: 'employee', primaryCompanyId: 'company', accountType: 'USER',
    jobTitle: 'Дизайнерка', isActive: true, orgAssignments: [], managedOrgUnits: [],
    primaryCompany: { id: 'company', displayName: 'Компанія', isActive: true },
  }
  const findUnique = vi.fn().mockResolvedValue(user)
  const findMany = vi.fn()
  const service = new AuthService({ user: { findUnique }, orgUnit: { findMany } } as unknown as PrismaService,
    { forOrganizations: vi.fn().mockResolvedValue([]) } as unknown as CapabilitiesService)
  const profile = await service.me({ userId: user.id, allowedCompanyIds: ['company'] } as AuthPrincipal, 'csrf')
  expect(profile).toMatchObject({ company: { id: 'company' }, jobTitle: 'Дизайнерка', positionTitle: 'Дизайнерка', orgUnitPath: [] })
  expect(findUnique.mock.calls[0]?.[0] as unknown).toMatchObject({ include: { orgAssignments: {
    where: { endedAt: null, isPrimary: true, orgUnit: { status: 'ACTIVE' } },
  } } })
  expect(findMany).not.toHaveBeenCalled()
})

it('places a manager without an assignment in the unit they manage in their own company', async () => {
  const user = {
    id: 'manager', primaryCompanyId: 'company', accountType: 'USER',
    jobTitle: 'Керівник', isActive: true, orgAssignments: [],
    managedOrgUnits: [{ id: 'foreign', companyId: 'other' }, { id: 'child', companyId: 'company' }],
    primaryCompany: { id: 'company', displayName: 'Компанія', isActive: true },
  }
  const findMany = vi.fn().mockResolvedValue([{ id: 'root', name: 'Головний', parentId: null }, { id: 'child', name: 'Відділ', parentId: 'root' }])
  const service = new AuthService({ user: { findUnique: vi.fn().mockResolvedValue(user) }, orgUnit: { findMany } } as unknown as PrismaService,
    { forOrganizations: vi.fn().mockResolvedValue([]) } as unknown as CapabilitiesService)
  const profile = await service.me({ userId: user.id, allowedCompanyIds: ['company'] } as AuthPrincipal, 'csrf')
  expect(profile).toMatchObject({ orgUnitPath: [{ id: 'root', name: 'Головний' }, { id: 'child', name: 'Відділ' }] })
})

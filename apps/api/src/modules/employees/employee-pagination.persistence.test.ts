import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { AuthPrincipal, LankaDWSRequest } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { ScopeService } from '../authorization/scope.service.js'
import { OrgService } from '../org/org.service.js'
import { EmployeesController } from './employees.controller.js'

const principal: AuthPrincipal = {
  userId: 'me', workspaceId: 'workspace', username: 'me', displayName: 'Me', primaryCompanyId: 'company',
  accountType: 'USER', allowedCompanyIds: ['company'], authorizationVersion: 1, sessionId: 'session', authAssurance: 1, restricted: false,
}
const request = { principal } as LankaDWSRequest
const scope = { allowedCompanies: () => ['company'], assertCompany: (_: unknown, id: string) => id } as unknown as ScopeService
let prisma: PrismaClient
let controller: EmployeesController
let org: OrgService

interface Filters { search?: string; orgUnit?: string; manager?: string; presence?: string; cursor?: string }
type DirectoryPage = { items: Array<{ id: string; orgUnit: { id: string } | null; manager: { id: string } | null; presence: string }>; total: number; nextCursor: string | null; counts: { all: number; available: number; away: number }; filters: { orgUnits: Array<{ id: string }>; managers: Array<{ id: string }> } }
const page = async ({ search, orgUnit, manager, presence, cursor }: Filters = {}) => await controller.list(
  request, 'company', search, orgUnit, manager, presence, undefined, undefined, undefined, undefined, undefined, cursor,
) as DirectoryPage

async function allPages(filters: Filters = {}) {
  const pages: DirectoryPage[] = []
  let cursor: string | undefined
  do {
    const current = await page({ ...filters, cursor })
    pages.push(current)
    cursor = current.nextCursor ?? undefined
  } while (cursor)
  return pages
}

async function addUser(id: string, displayName: string, extra: { approverId?: string; primaryCompanyId?: string; isActive?: number; accountType?: string } = {}) {
  await prisma.$executeRawUnsafe(
    'INSERT INTO User (id, workspaceId, isActive, accountType, primaryCompanyId, displayName, jobTitle, timezone, approverId, normalizedDisplayName, normalizedUsername) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, 'workspace', extra.isActive ?? 1, extra.accountType ?? 'USER', extra.primaryCompanyId ?? 'company', displayName, 'Role', 'UTC', extra.approverId ?? null, displayName.toLowerCase(), id,
  )
}
const assign = (userId: string, orgUnitId: string, endedAt: Date | null = null) => prisma.userOrgAssignment.create({ data: {
  id: `${userId}-${orgUnitId}`, companyId: 'company', userId, orgUnitId, isPrimary: endedAt === null, endedAt, positionTitle: 'Position',
} })
const away = (userId: string, state = 'VACATION', startAt = new Date(Date.now() - 1000)) => prisma.presenceRecord.create({ data: {
  id: `${userId}-${state}`, workspaceId: 'workspace', companyId: 'company', userId, state, startAt, endAt: new Date(Date.now() + 60_000),
} })

beforeEach(async () => {
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: ':memory:' }) })
  await prisma.$executeRawUnsafe(`CREATE TABLE User (
    id TEXT PRIMARY KEY, workspaceId TEXT, isActive BOOLEAN, accountType TEXT, primaryCompanyId TEXT, displayName TEXT, jobTitle TEXT,
    timezone TEXT, avatarAsset TEXT, approverId TEXT, normalizedDisplayName TEXT, normalizedUsername TEXT
  )`)
  await prisma.$executeRawUnsafe('CREATE TABLE OrgUnit (id TEXT PRIMARY KEY, workspaceId TEXT, companyId TEXT, parentId TEXT, name TEXT, status TEXT, managerId TEXT, sortOrder INTEGER)')
  await prisma.$executeRawUnsafe(`CREATE TABLE UserOrgAssignment (
    id TEXT PRIMARY KEY, companyId TEXT, userId TEXT, orgUnitId TEXT, isPrimary BOOLEAN, positionTitle TEXT,
    startedAt DATETIME DEFAULT CURRENT_TIMESTAMP, endedAt DATETIME, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)
  await prisma.$executeRawUnsafe(`CREATE TABLE PresenceRecord (
    id TEXT PRIMARY KEY, workspaceId TEXT, companyId TEXT, userId TEXT, state TEXT, startAt DATETIME, endAt DATETIME,
    visibility TEXT DEFAULT 'PUBLIC_SAFE', version INTEGER DEFAULT 1, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)
  await prisma.$executeRawUnsafe(`INSERT INTO OrgUnit (id, workspaceId, companyId, name, status, managerId, sortOrder) VALUES
    ('design', 'workspace', 'company', 'Дизайн', 'ACTIVE', 'boss', 10),
    ('sales', 'workspace', 'company', 'Продажі', 'ACTIVE', 'other-boss', 20),
    ('empty', 'workspace', 'company', 'Без керівника', 'ACTIVE', NULL, 30),
    ('old', 'workspace', 'company', 'Архів', 'ARCHIVED', 'boss', 40)`)
  await addUser('boss', 'A Boss')
  await addUser('other-boss', 'A Other Boss')
  // 22 assigned people, all sharing a display name, so only the id can order them.
  for (let index = 0; index < 22; index += 1) {
    const id = `member-${String(index).padStart(2, '0')}`
    await addUser(id, 'Same Name')
    await assign(id, 'design')
  }
  await addUser('seller', 'Seller', { approverId: 'boss' })
  await assign('seller', 'sales')
  await addUser('approved', 'Approved', { approverId: 'boss' })
  await addUser('approved-in-empty-unit', 'Approved Empty', { approverId: 'boss' })
  await assign('approved-in-empty-unit', 'empty')
  await addUser('ex-member', 'Ex Member')
  await assign('ex-member', 'design', new Date('2026-01-01T00:00:00Z'))
  await addUser('inactive', 'Inactive', { isActive: 0 })
  await assign('inactive', 'design')
  await addUser('foreign', 'Foreign', { primaryCompanyId: 'other-company' })
  const db = prisma as unknown as PrismaService
  controller = new EmployeesController(db, scope)
  org = new OrgService(db, scope)
})
afterEach(async () => { await prisma.$disconnect() })

describe('employee directory pagination against SQLite', () => {
  it('pages the whole company without repeats, ordering equal names by id', async () => {
    const pages = await allPages()
    expect(pages.map((current) => current.items.length)).toEqual([20, 8])
    const ids = pages.flatMap((current) => current.items.map((item) => item.id))
    expect(new Set(ids).size).toBe(28)
    expect(ids).not.toEqual(expect.arrayContaining(['inactive', 'foreign']))
    const members = ids.filter((id) => id.startsWith('member-'))
    expect(members).toEqual([...members].sort())
    expect(pages.every((current) => current.total === 28 && current.counts.all === 28)).toBe(true)
  })

  it('treats a unit manager as a member once, whether or not they are also assigned', async () => {
    const before = await allPages({ orgUnit: 'design' })
    expect(before.map((current) => current.items.length)).toEqual([20, 3])
    expect(before[0].total).toBe(23)
    const boss = before[0].items.find((item) => item.id === 'boss')
    expect(boss?.orgUnit?.id).toBe('design')
    expect(before.flatMap((current) => current.items.map((item) => item.id))).not.toContain('ex-member')
    await assign('boss', 'design')
    expect((await page({ orgUnit: 'design' })).total).toBe(23)
  })

  it('does not treat a manager of an archived unit as its member', async () => {
    const result = await page({ orgUnit: 'old' })
    expect(result).toMatchObject({ items: [], total: 0, nextCursor: null })
  })

  it('shows the managed unit in its own list even for a manager assigned elsewhere', async () => {
    await assign('boss', 'sales')
    const row = async (orgUnit?: string) => (await page({ orgUnit, search: 'A Boss' })).items[0]?.orgUnit?.id
    expect(await row()).toBe('sales')
    expect(await row('design')).toBe('design')
  })

  it('does not match a managed unit in a company other than the manager\'s own', async () => {
    await prisma.$executeRawUnsafe("INSERT INTO OrgUnit (id, workspaceId, companyId, name, status, managerId, sortOrder) VALUES ('foreign-unit', 'workspace', 'other-company', 'Інша', 'ACTIVE', 'boss', 10)")
    const bothCompanies = new EmployeesController(prisma as unknown as PrismaService, { allowedCompanies: () => ['company', 'other-company'] } as unknown as ScopeService)
    const result = await bothCompanies.list(request, undefined, undefined, 'foreign-unit') as DirectoryPage
    expect(result).toMatchObject({ items: [], total: 0 })
  })

  it('applies orgUnit and presence together across pages and keeps facet counts unfiltered', async () => {
    await away('member-01')
    await away('member-02')
    await away('seller')
    const result = await page({ orgUnit: 'design', presence: 'AWAY' })
    expect(result.items.map((item) => item.id)).toEqual(['member-01', 'member-02'])
    expect(result.items.every((item) => item.presence === 'VACATION')).toBe(true)
    expect(result.total).toBe(2)
    expect(result.counts).toEqual({ all: 28, available: 25, away: 3 })
    const available = await allPages({ orgUnit: 'design', presence: 'AVAILABLE' })
    expect(available[0].total).toBe(21)
    expect(available.flatMap((current) => current.items).map((item) => item.id)).not.toContain('member-01')
  })

  it('uses the latest active presence record, as the row does', async () => {
    await away('member-01', 'VACATION', new Date(Date.now() - 5000))
    await away('member-01', 'AVAILABLE', new Date(Date.now() - 1000))
    expect((await page({ presence: 'AWAY' })).total).toBe(0)
    expect((await page()).counts.away).toBe(0)
  })

  it('filters by the unit manager, falling back to the approver only without one', async () => {
    const pages = await allPages({ manager: 'boss' })
    const ids = pages.flatMap((current) => current.items.map((item) => item.id))
    expect(pages[0].total).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(['member-00', 'approved', 'approved-in-empty-unit']))
    expect(ids).not.toContain('seller')
    expect(pages[0].items.every((item) => item.manager?.id === 'boss')).toBe(true)
  })

  it('combines search with paging and scopes counts and filter options to the search', async () => {
    const result = await page({ search: 'seller' })
    expect(result.items.map((item) => item.id)).toEqual(['seller'])
    expect(result.total).toBe(1)
    expect(result.counts.all).toBe(1)
    expect(result.filters.managers.map((item) => item.id)).toEqual(['other-boss'])
    expect(result.filters.orgUnits.map((item) => item.id)).toEqual(['sales'])
  })

  it('lists filter options from every employee, not only the current page', async () => {
    const { filters } = await page()
    expect(filters.orgUnits.map((item) => item.id).sort()).toEqual(['design', 'empty', 'sales'])
    expect(filters.managers.map((item) => item.id).sort()).toEqual(['boss', 'other-boss'])
  })

  it('rejects an oversized cursor', async () => {
    await expect(page({ cursor: 'x'.repeat(121) })).rejects.toMatchObject({ status: 400 })
  })
})

describe('unit employee list pagination against SQLite', () => {
  async function allUnitPages(options: { excludeManager?: boolean } = {}) {
    const pages = []
    let cursor: string | undefined
    do {
      const current = await org.listEmployees(principal, 'design', 'company', { ...options, cursor })
      pages.push(current)
      cursor = current.nextCursor ?? undefined
    } while (cursor)
    return pages
  }

  it('pages assignments with a stable order and ignores ended or inactive ones', async () => {
    const pages = await allUnitPages()
    expect(pages.map((current) => current.items.length)).toEqual([20, 2])
    expect(pages[0].total).toBe(22)
    const ids = pages.flatMap((current) => current.items.map((item) => item.id))
    expect(ids).toEqual([...ids].sort())
    expect(ids).not.toEqual(expect.arrayContaining(['ex-member', 'inactive', 'boss']))
    expect(pages[0].items[0]).toEqual({ id: 'member-00', displayName: 'Same Name', jobTitle: 'Role', avatarAsset: null, positionTitle: 'Position', isPrimary: true })
  })

  it('leaves the manager out of items and total only when asked', async () => {
    await assign('boss', 'design')
    expect((await allUnitPages())[0].total).toBe(23)
    const pages = await allUnitPages({ excludeManager: true })
    expect(pages[0].total).toBe(22)
    expect(pages[0].items).toHaveLength(20)
    expect(pages.flatMap((current) => current.items.map((item) => item.id))).not.toContain('boss')
  })

  it('hides a unit outside the allowed companies', async () => {
    await expect(org.listEmployees({ ...principal, workspaceId: 'other' }, 'design', 'company')).rejects.toMatchObject({ status: 404 })
  })
})

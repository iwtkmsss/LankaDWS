import { LankaSqliteAdapter } from '../prisma/sqlite-adapter.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '../generated/prisma/client.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { AuthPrincipal } from './request-context.js'
import { parseUserSearchExcludedIds, searchUsers } from './search-users.js'

const principal = { workspaceId: 'workspace', userId: 'me' } as AuthPrincipal
let prisma: PrismaClient

beforeEach(async () => {
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: ':memory:' }) })
  await prisma.$executeRawUnsafe(`CREATE TABLE User (
    id TEXT PRIMARY KEY, workspaceId TEXT, isActive BOOLEAN, primaryCompanyId TEXT,
    displayName TEXT, normalizedDisplayName TEXT, username TEXT, normalizedUsername TEXT,
    jobTitle TEXT, avatarAsset TEXT, accountType TEXT
  )`)
  const row = (id: string, name: string, workspace = 'workspace', active = 1, type = 'USER') =>
    [id, workspace, active, type === 'ADMIN' ? null : 'company', name, name.toLowerCase(), id, id, '', null, type]
  const rows = [
    ...Array.from({ length: 1000 }, (_, index) => row(`user-${index}`, `A has needle ${String(index).padStart(4, '0')}`)),
    row('exact', 'Needle'), row('prefix', 'Needle prefix'), row('admin', 'Needle admin', 'workspace', 1, 'ADMIN'),
    row('foreign', 'Needle foreign', 'other-workspace'), row('inactive', 'Needle inactive', 'workspace', 0),
    row('uk', 'Ярослав'), row('username-match', 'Z username match'),
  ]
  await prisma.$executeRawUnsafe(`INSERT INTO User VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',')}`, ...rows.flat())
})

afterEach(async () => { await prisma.$disconnect() })

describe('shared user search against SQLite', () => {
  const search = (query: string, options?: Parameters<typeof searchUsers>[3]) =>
    searchUsers(prisma as PrismaService, principal, query, options)

  it('finds exact and prefix matches across 1000 users before substring matches and returns at most five', async () => {
    const findMany = vi.spyOn(prisma.user, 'findMany')
    const users = await search(' NEEDLE ', { limit: 1000 })
    expect(users.map((user) => user.id)).toEqual(['exact', 'admin', 'prefix', 'user-0', 'user-1'])
    expect(users[1]).toMatchObject({ accountType: 'ADMIN', primaryCompanyId: null })
    expect(findMany.mock.calls.map(([args]) => args?.take)).toEqual([5, 4, 2])
    expect(users.every((user) => !('passwordHash' in user))).toBe(true)
  })

  it('excludes selected people before applying the result cap', async () => {
    expect((await search('needle', { excludeIds: ['exact', 'admin', 'prefix'] })).map((user) => user.id))
      .toEqual(['user-0', 'user-1', 'user-2', 'user-3', 'user-4'])
  })

  it('supports large explicit exclusion lists without SQL parameter errors', async () => {
    const excludeIds = Array.from({ length: 1000 }, (_, index) => `user-${index}`)
    expect((await search('needle', { excludeIds })).map((user) => user.id)).toEqual(['exact', 'admin', 'prefix'])
  })

  it('keeps workspace, active-account and caller eligibility restrictions through every search tier', async () => {
    const users = await search('needle', { where: { id: { in: ['prefix', 'user-999', 'foreign', 'inactive'] } } })
    expect(users.map((user) => user.id)).toEqual(['prefix', 'user-999'])
    expect(await search('needle', { where: { workspaceId: 'other-workspace' } })).toEqual([])
  })

  it('starts at one Unicode character and also matches usernames', async () => {
    expect((await search(' Я ')).map((user) => user.id)).toEqual(['uk'])
    expect((await search('username-m')).map((user) => user.id)).toEqual(['username-match'])
  })

  it('does not fetch an empty query and rejects oversized search input', async () => {
    const findMany = vi.spyOn(prisma.user, 'findMany')
    expect(await search(' \t ')).toEqual([])
    await expect(search('a'.repeat(121))).rejects.toMatchObject({ status: 400 })
    expect(findMany).not.toHaveBeenCalled()
    expect(parseUserSearchExcludedIds('one,one,two')).toEqual(['one', 'two'])
    expect(() => parseUserSearchExcludedIds(Array.from({ length: 201 }, (_, index) => String(index)).join(','))).toThrow()
  })

  it('excludes a department with 1000 members using a SQL relationship predicate', async () => {
    await prisma.$executeRawUnsafe('CREATE TABLE UserOrgAssignment (id TEXT, userId TEXT, orgUnitId TEXT, endedAt DATETIME)')
    const assignments = Array.from({ length: 1000 }, (_, index) => [`assignment-${index}`, `user-${index}`, 'large-unit', null])
    await prisma.$executeRawUnsafe(`INSERT INTO UserOrgAssignment VALUES ${assignments.map(() => '(?, ?, ?, ?)').join(',')}`, ...assignments.flat())
    expect((await search('needle', { where: { orgAssignments: { none: { orgUnitId: 'large-unit', endedAt: null } } } })).map((user) => user.id))
      .toEqual(['exact', 'admin', 'prefix'])
  })
})

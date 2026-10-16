import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { OrgService } from './org.service.js'

const principal = { userId: 'admin', workspaceId: 'workspace', accountType: 'ADMIN', allowedCompanyIds: ['company'] } as AuthPrincipal
const original = [
  { id: 'root', parentId: null, name: 'Корінь', status: 'ARCHIVED', version: 3, sortOrder: 10 },
  { id: 'child', parentId: 'root', name: 'Відділ', status: 'ARCHIVED', version: 4, sortOrder: 20 },
  { id: 'grandchild', parentId: 'child', name: 'Команда', status: 'ARCHIVED', version: 2, sortOrder: 30 },
]

function setup(rows = original, snapshot: unknown = { structure: rows }) {
  type Update = { where: { id: string; version: number }; data: { parentId: string | null } }
  const tx = {
    orgUnit: { findMany: vi.fn().mockResolvedValue(rows), updateMany: vi.fn<(input: Update) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 }) },
    auditEvent: { findFirst: vi.fn().mockResolvedValue({ safeDiffJson: JSON.stringify(snapshot) }), create: vi.fn() },
    userOrgAssignment: { create: vi.fn(), updateMany: vi.fn() },
  }
  const prisma = {
    orgUnit: { findFirst: vi.fn().mockResolvedValue(rows[0]), findMany: vi.fn().mockResolvedValue(rows) },
    company: { findFirst: vi.fn().mockResolvedValue({ id: 'company' }) },
    user: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
  }
  return { tx, prisma, service: new OrgService(prisma as unknown as PrismaService, new ScopeService()) }
}

describe('organization structure restoration', () => {
  it('restores the archived branch with its original parents and order without assigning users', async () => {
    const { service, tx } = setup()
    await service.restoreUnit(principal, 'company', 'root', { expectedVersion: 3 })
    expect(tx.orgUnit.updateMany.mock.calls.map(([input]) => input.data)).toEqual(original.map((row) => ({
      status: 'ACTIVE', parentId: row.parentId, name: row.name, normalizedName: row.name.toLocaleLowerCase('uk'), sortOrder: row.sortOrder, version: { increment: 1 },
    })))
    expect(tx.userOrgAssignment.create).not.toHaveBeenCalled()
    expect(tx.userOrgAssignment.updateMany).not.toHaveBeenCalled()
  })

  it('reattaches children promoted by a single-department archive', async () => {
    const snapshot = { structure: original.slice(0, 2).map((row, index) => ({ ...row, status: index ? 'ACTIVE' : 'ARCHIVED' })) }
    const rows = snapshot.structure.map((row) => ({ ...row, parentId: null }))
    const { service, tx } = setup(rows, snapshot)
    await service.restoreUnit(principal, 'company', 'root', { expectedVersion: 3 })
    expect(tx.orgUnit.updateMany.mock.calls[0]?.[0]).toMatchObject({ where: { id: 'child', version: 4 }, data: { parentId: 'root', sortOrder: 20 } })
  })

  it('does not overwrite a child changed after archiving', async () => {
    const rows = original.map((row) => row.id === 'child' ? { ...row, version: 5 } : row)
    const { service, tx } = setup(rows, { structure: original })
    await expect(service.restoreUnit(principal, 'company', 'root', { expectedVersion: 3 })).rejects.toMatchObject({ status: 409 })
    expect(tx.orgUnit.updateMany).not.toHaveBeenCalled()
    expect(tx.auditEvent.create).not.toHaveBeenCalled()
  })

  it('rejects a name collision before restoring any part of the branch', async () => {
    const { service, tx } = setup([...original, { ...original[0], id: 'other', status: 'ACTIVE' }], { structure: original })
    await expect(service.restoreUnit(principal, 'company', 'root', { expectedVersion: 3 })).rejects.toMatchObject({ status: 409 })
    expect(tx.orgUnit.updateMany).not.toHaveBeenCalled()
  })

  it('preserves the archived hierarchy from older archives without a snapshot', async () => {
    const { service, tx } = setup(original, {})
    await service.restoreUnit(principal, 'company', 'root', { expectedVersion: 3 })
    expect(tx.orgUnit.updateMany.mock.calls[2]?.[0].data.parentId).toBe('child')
  })

  it('rejects a changed root inside the transaction even without a snapshot', async () => {
    const { service, tx } = setup(original, {})
    tx.orgUnit.findMany.mockResolvedValueOnce(original.map((row) => ({ ...row, version: 99 })))
    await expect(service.restoreUnit(principal, 'company', 'root', { expectedVersion: 3 })).rejects.toMatchObject({ status: 409 })
    expect(tx.orgUnit.updateMany).not.toHaveBeenCalled()
  })

  it('rolls back when a descendant changes during restoration', async () => {
    const { service, tx } = setup()
    tx.orgUnit.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    await expect(service.restoreUnit(principal, 'company', 'root', { expectedVersion: 3 })).rejects.toMatchObject({ status: 409 })
    expect(tx.auditEvent.create).not.toHaveBeenCalled()
  })
})

describe('company users without a department', () => {
  it('queries unassigned active company users with database pagination', async () => {
    const { service, prisma } = setup()
    prisma.user.findMany.mockResolvedValueOnce(Array.from({ length: 21 }, (_, index) => ({ id: `user-${index}`, displayName: `User ${index}`, jobTitle: '', avatarAsset: null })))
    prisma.user.count.mockResolvedValueOnce(35)
    const page = await service.listUnassignedEmployees(principal, 'company', 'previous')
    expect(page.items).toHaveLength(20)
    expect(page.nextCursor).toBe('user-19')
    expect(page.total).toBe(35)
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 21, where: {
      workspaceId: 'workspace', primaryCompanyId: 'company', accountType: 'USER', isActive: true, id: { gt: 'previous' },
      orgAssignments: { none: { companyId: 'company', endedAt: null, isPrimary: true, orgUnit: { status: 'ACTIVE' } } },
    } }))
  })

  it('checks company access before querying users', async () => {
    const { service, prisma } = setup()
    await expect(service.listUnassignedEmployees(principal, 'private')).rejects.toMatchObject({ status: 403 })
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { driveDestinationsQuerySchema, driveListQuerySchema, driveOwnersQuerySchema } from '@lankadws/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import { DriveService } from './drive.service.js'

const principal: AuthPrincipal = {
  userId: 'me', workspaceId: 'workspace', username: 'me', displayName: 'Me',
  primaryCompanyId: 'company', accountType: 'USER', allowedCompanyIds: ['company'],
  authorizationVersion: 1, sessionId: 'session', authAssurance: 1, restricted: false,
}
const admin = { ...principal, accountType: 'ADMIN' as const }
const date = new Date('2026-10-14T10:00:00Z')
const owner = { id: 'colleague', displayName: 'Колега', username: 'colleague.tag' }
const folder = { id: 'root', name: 'Folder', parentId: null, companyId: 'company', ownerId: owner.id, updatedAt: date, trashedAt: null }
const file = { id: 'doc', name: 'Report', number: 'DOC-1', companyId: 'company', ownerId: owner.id, folderId: null, fileId: null, confidentiality: 'CONFIDENTIAL', updatedAt: date, archivedAt: null, version: 1 }

function setup(role: 'VIEWER' | 'EDITOR' = 'VIEWER') {
  const prisma = {
    driveFolder: { findFirst: vi.fn().mockResolvedValue(folder), findMany: vi.fn().mockResolvedValue([folder]), groupBy: vi.fn().mockResolvedValue([]) },
    document: { findFirst: vi.fn().mockResolvedValue({ ...file, folderId: null as string | null }), findMany: vi.fn().mockResolvedValue([file]), groupBy: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([owner]), findFirst: vi.fn().mockResolvedValue(owner) },
    fileObject: { findMany: vi.fn().mockResolvedValue([]) },
    driveShare: { groupBy: vi.fn().mockResolvedValue([]) },
  }
  const grants = { folderIds: new Set(['root']), documentIds: new Set(['doc']), roleOf: () => role }
  const folders = { detail: vi.fn().mockResolvedValue(folder), sizes: vi.fn().mockResolvedValue(new Map()), breadcrumbs: vi.fn().mockResolvedValue([{ id: 'root', name: 'Folder' }]) }
  const sharing = { grantsFor: () => Promise.resolve(grants), canEditFolder: vi.fn().mockResolvedValue(true), expandSubtree: vi.fn().mockResolvedValue(new Set(['root', 'descendant'])) }
  const service = new DriveService(prisma as never, { allowedCompanies: () => ['company'] } as never, folders as never, sharing as never, {} as never)
  return { prisma, service, grants }
}

describe('Drive owner directories and access indicators', () => {
  it('filters and paginates writable destinations in the database', async () => {
    const { service, prisma } = setup('EDITOR')
    prisma.driveFolder.findMany.mockResolvedValue([{ ...folder, id: 'dest' }, { ...folder, id: 'next' }])
    prisma.driveFolder.groupBy.mockResolvedValue([{ parentId: 'dest', _count: { _all: 1 } }] as never)
    const result = await service.destinations(principal, driveDestinationsQuerySchema.parse({ targetType: 'DOCUMENT', targetId: 'doc', limit: 1, cursor: 'previous' }))
    expect(result.items[0]).toMatchObject({ id: 'dest', hasChildren: true })
    expect(result.nextCursor).toBe('dest')
    const args = prisma.driveFolder.findMany.mock.calls[0]?.[0] as { where: { AND: unknown[] }; take: number; cursor: { id: string }; skip: number }
    expect(args.take).toBe(2)
    expect(args.cursor).toEqual({ id: 'previous' })
    expect(args.skip).toBe(1)
    expect(args.where.AND[0]).toEqual({ workspaceId: 'workspace', companyId: { in: principal.allowedCompanyIds }, trashedAt: null, OR: [{ ownerId: 'me' }, { id: { in: ['root'] } }] })
    expect(driveDestinationsQuerySchema.safeParse({ targetType: 'DOCUMENT', targetId: 'doc', limit: 1000 }).success).toBe(false)
  })

  it('rejects a forged destination directory outside the writable scope', async () => {
    const { service, prisma } = setup('EDITOR')
    prisma.driveFolder.findFirst.mockResolvedValue(null)
    await expect(service.destinations(principal, driveDestinationsQuerySchema.parse({ targetType: 'DOCUMENT', targetId: 'doc', folderId: 'private' }))).rejects.toMatchObject({ status: 404 })
    expect(prisma.driveFolder.findMany).not.toHaveBeenCalled()
  })

  it('does not expose destinations when the source is read-only', async () => {
    const { service, prisma } = setup('VIEWER')
    await expect(service.destinations(principal, driveDestinationsQuerySchema.parse({ targetType: 'DOCUMENT', targetId: 'doc' }))).rejects.toMatchObject({ status: 403 })
    expect(prisma.driveFolder.findMany).not.toHaveBeenCalled()
  })

  it('excludes a moved folder and its full subtree from eligible destinations', async () => {
    const { service, prisma } = setup()
    await service.destinations(admin, driveDestinationsQuerySchema.parse({ targetType: 'FOLDER', targetId: 'root' }))
    const args = prisma.driveFolder.findMany.mock.calls[0]?.[0] as { where: { AND: unknown[] } }
    expect(args.where.AND[0]).toEqual({ workspaceId: 'workspace', companyId: { in: admin.allowedCompanyIds }, trashedAt: null, id: { notIn: ['root', 'descendant'] } })
  })

  it('hides the current parent when there are no valid deeper destinations', async () => {
    const { service, prisma } = setup('EDITOR')
    prisma.document.findFirst.mockResolvedValue({ ...file, folderId: 'root' })
    const result = await service.destinations(principal, driveDestinationsQuerySchema.parse({ targetType: 'DOCUMENT', targetId: 'doc' }))
    expect(result.items).toEqual([])
  })
  it('denies the owner directory and forged owner filters to ordinary users before reading data', async () => {
    const { service, prisma } = setup()
    await expect(service.owners(principal, driveOwnersQuerySchema.parse({}))).rejects.toMatchObject({ status: 403 })
    await expect(service.list(principal, driveListQuerySchema.parse({ view: 'USERS', ownerId: owner.id }))).rejects.toMatchObject({ status: 403 })
    await expect(service.list(principal, driveListQuerySchema.parse({ ownerId: owner.id }))).rejects.toMatchObject({ status: 403 })
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it('paginates only owners of active scoped Drive items and searches their names or tags', async () => {
    const { service, prisma } = setup()
    prisma.driveFolder.groupBy.mockResolvedValue([{ ownerId: owner.id, _count: { _all: 2 } }] as never)
    prisma.document.groupBy.mockResolvedValue([{ ownerId: owner.id, _count: { _all: 3 } }, { ownerId: 'second', _count: { _all: 1 } }] as never)
    prisma.user.findMany.mockResolvedValue([owner, { ...owner, id: 'second' }])
    const result = await service.owners(admin, driveOwnersQuerySchema.parse({ limit: 1, search: 'tag', cursor: 'previous' }))
    expect(result).toEqual({ items: [{ ...owner, itemCount: 5 }], nextCursor: owner.id })
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace', id: { in: ['colleague', 'second'] }, OR: [{ displayName: { contains: 'tag' } }, { username: { contains: 'tag' } }] },
      select: { id: true, displayName: true, username: true }, orderBy: { id: 'asc' }, take: 2, cursor: { id: 'previous' }, skip: 1,
    })
    expect(prisma.document.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace', companyId: { in: ['company'] }, archivedAt: null } }))
    expect(driveOwnersQuerySchema.safeParse({ limit: 1000 }).success).toBe(false)
  })

  it('filters admin browsing by owner and keeps navigation within that owner’s folders', async () => {
    const { service, prisma } = setup()
    prisma.document.findMany.mockResolvedValue([{ ...file, folderId: 'root' }])
    const root = await service.list(admin, driveListQuerySchema.parse({ view: 'USERS', ownerId: owner.id }))
    expect(root.owner).toEqual(owner)
    expect(root.files).toHaveLength(0)
    expect(root.folders).toHaveLength(1)
    const inside = await service.list(admin, driveListQuerySchema.parse({ view: 'USERS', ownerId: owner.id, folderId: 'root' }))
    expect(inside.files).toHaveLength(1)
    expect(inside.breadcrumbs).toEqual([{ id: 'root', name: 'Folder' }])
    expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: { in: ['company'] }, ownerId: owner.id } }))
    expect(prisma.driveFolder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: { in: ['company'] }, ownerId: owner.id } }))
  })

  it.each(['VIEWER', 'EDITOR'] as const)('reports effective %s access including an inherited share', async (role) => {
    const { service } = setup(role)
    const result = await service.list(principal, driveListQuerySchema.parse({}))
    expect(result.files[0]).toMatchObject({ accessRole: role, isShared: true })
    expect(result.folders[0]).toMatchObject({ accessRole: role, isShared: true })
  })

  it('marks files shared through an ancestor even when the current owner has no incoming grant', async () => {
    const { service, prisma, grants } = setup()
    grants.folderIds.clear()
    grants.documentIds.clear()
    prisma.driveShare.groupBy.mockImplementation(({ where }: { where: { targetType: string } }) => Promise.resolve(where.targetType === 'FOLDER'
      ? [{ targetId: 'root', _count: { targetId: 1 } }] as never : []))
    prisma.document.findMany.mockResolvedValue([{ ...file, folderId: 'root' }])
    const result = await service.list(admin, driveListQuerySchema.parse({ view: 'USERS', ownerId: owner.id, folderId: 'root' }))
    expect(result.files[0]).toMatchObject({ accessRole: 'EDITOR', isShared: true, sharedWithCount: 0 })
  })
})

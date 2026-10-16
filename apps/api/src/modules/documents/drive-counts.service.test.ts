import { describe, expect, it, vi } from 'vitest'
import { driveListQuerySchema } from '@lankadws/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import { DriveService } from './drive.service.js'
import { DriveFoldersService } from './drive-folders.service.js'

const principal: AuthPrincipal = {
  userId: 'usr_me', workspaceId: 'workspace-1', username: 'me', displayName: 'Me',
  primaryCompanyId: 'company-1', accountType: 'USER', allowedCompanyIds: ['company-1'],
  authorizationVersion: 1, sessionId: 'session-1', authAssurance: 1, restricted: false,
}
const folder = {
  id: 'folder-1', name: 'Folder', parentId: null, companyId: 'company-1',
  ownerId: principal.userId, updatedAt: new Date('2026-10-05T00:00:00Z'), trashedAt: null,
}
const grants = { folderIds: new Set<string>(), documentIds: new Set(['shared-document']) }
const sharing = { grantsFor: vi.fn().mockResolvedValue(grants) }

describe('Drive folder contents count', () => {
  it('creates a subfolder in the parent company even when it differs from the primary company', async () => {
    const parent = { ...folder, companyId: 'company-2' }
    const prisma = { driveFolder: { findFirst: vi.fn().mockResolvedValue(parent), create: vi.fn() }, auditEvent: { create: vi.fn() } }
    const scope = { assertCompany: vi.fn((_principal: AuthPrincipal, companyId?: string) => companyId ?? 'company-1') }
    const permissions = { canEditFolder: vi.fn().mockResolvedValue(true) }
    const service = new DriveFoldersService(prisma as never, scope as never, permissions as never)
    vi.spyOn(service, 'breadcrumbs').mockResolvedValue([{ id: parent.id, name: parent.name }])
    vi.spyOn(service, 'detail').mockResolvedValue({ ...parent, accessRole: 'EDITOR', isShared: false } as never)
    await service.create({ ...principal, allowedCompanyIds: ['company-1', 'company-2'] }, { name: 'Nested', parentId: parent.id })
    expect(scope.assertCompany).toHaveBeenCalledWith(expect.objectContaining({ userId: principal.userId }), 'company-2')
    expect(prisma.driveFolder.create.mock.calls[0]?.[0]).toMatchObject({ data: { companyId: 'company-2', parentId: parent.id, name: 'Nested' } })
  })

  it('rejects creating a subfolder in a read-only parent', async () => {
    const prisma = { driveFolder: { findFirst: vi.fn().mockResolvedValue(folder), create: vi.fn() } }
    const service = new DriveFoldersService(prisma as never, { assertCompany: () => 'company-1' } as never, { canEditFolder: () => Promise.resolve(false) } as never)
    await expect(service.create(principal, { name: 'Nested', parentId: folder.id })).rejects.toMatchObject({ status: 403 })
    expect(prisma.driveFolder.create).not.toHaveBeenCalled()
  })
  it.each([0, 2])('adds files to %i subfolders even while searching only for the folder name', async (subfolders) => {
    const prisma = {
      driveFolder: {
        findMany: vi.fn().mockResolvedValue([folder]),
        groupBy: vi.fn().mockResolvedValue([{ parentId: folder.id, _count: { parentId: subfolders } }]),
      },
      document: {
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([{ folderId: folder.id, _count: { folderId: 1 } }]),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      fileObject: { findMany: vi.fn().mockResolvedValue([]) },
      driveShare: { groupBy: vi.fn().mockResolvedValue([]) },
    }
    const service = new DriveService(prisma as never, {
      allowedCompanies: () => principal.allowedCompanyIds,
    } as never, { sizes: vi.fn().mockResolvedValue(new Map([[folder.id, 2048]])) } as never, sharing as never, {} as never)

    const result = await service.list(principal, driveListQuerySchema.parse({ search: 'Folder' }))

    expect(result.folders[0]?.childCount).toBe(subfolders + 1)
    expect(result.folders[0]?.sizeBytes).toBe(2048)
    expect(prisma.document.groupBy).toHaveBeenCalledWith({
      by: ['folderId'],
      where: {
        companyId: { in: principal.allowedCompanyIds }, folderId: { in: [folder.id] }, archivedAt: null,
        OR: [
          { ownerId: principal.userId },
          { id: { in: ['shared-document'] } },
        ],
      },
      _count: { folderId: true },
    })
  })

  it('returns the same combined count in folder details', async () => {
    const prisma = {
      driveFolder: { findFirst: vi.fn().mockResolvedValue(folder), findMany: vi.fn().mockResolvedValue([folder]), count: vi.fn().mockResolvedValue(2) },
      document: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
      fileObject: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findFirst: vi.fn().mockResolvedValue({ displayName: 'Me' }) },
      driveShare: { count: vi.fn().mockResolvedValue(0) },
    }
    const service = new DriveFoldersService(prisma as never, {} as never, sharing as never)

    expect((await service.detail(principal, folder.id)).childCount).toBe(3)
    expect(prisma.document.count).toHaveBeenCalledWith({ where: {
      folderId: folder.id, companyId: { in: principal.allowedCompanyIds }, archivedAt: null,
      OR: [
        { ownerId: principal.userId },
        { id: { in: ['shared-document'] } },
      ],
    } })
  })

  it('sums document files in nested folders without cycling', async () => {
    const prisma = {
      driveFolder: { findMany: vi.fn().mockResolvedValue([
        { id: 'root', parentId: null }, { id: 'child', parentId: 'root' },
        { id: 'deep', parentId: 'child' }, { id: 'empty', parentId: null },
        { id: 'cycle-a', parentId: 'cycle-b' }, { id: 'cycle-b', parentId: 'cycle-a' },
      ]) },
      document: { findMany: vi.fn().mockResolvedValue([
        { folderId: 'root', fileId: 'current' },
        { folderId: 'child', fileId: 'child-file' },
        { folderId: 'deep', fileId: 'deep-file' },
        { folderId: 'cycle-b', fileId: 'cycle-file' },
      ]) },
      fileObject: { findMany: vi.fn().mockResolvedValue([
        { id: 'current', bytes: 100 },
        { id: 'child-file', bytes: 200 }, { id: 'deep-file', bytes: 300 }, { id: 'cycle-file', bytes: 50 },
      ]) },
    }
    const service = new DriveFoldersService(prisma as never, {} as never, sharing as never)

    const sizes = await service.sizes(principal, ['root', 'child', 'deep', 'empty', 'cycle-a', 'cycle-b'])

    expect(Object.fromEntries(sizes)).toEqual({ root: 600, child: 500, deep: 300, empty: 0, 'cycle-a': 50, 'cycle-b': 50 })
    expect(prisma.driveFolder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      companyId: { in: principal.allowedCompanyIds }, trashedAt: null,
      OR: [{ ownerId: principal.userId }, { id: { in: [] } }],
    } }))
    expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        companyId: { in: principal.allowedCompanyIds }, archivedAt: null,
        folderId: { in: ['root', 'child', 'deep', 'empty', 'cycle-a', 'cycle-b'] },
        OR: [
          { ownerId: principal.userId },
          { id: { in: ['shared-document'] } },
        ],
      },
      select: { folderId: true, fileId: true },
    }))
  })

  it('marks totals unknown when file metadata is unavailable', async () => {
    const prisma = {
      driveFolder: { findMany: vi.fn().mockResolvedValue([{ id: 'root', parentId: null }, { id: 'child', parentId: 'root' }]) },
      document: { findMany: vi.fn().mockResolvedValue([{ folderId: 'child', fileId: 'missing' }]) },
      fileObject: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const service = new DriveFoldersService(prisma as never, {} as never, sharing as never)
    expect(Object.fromEntries(await service.sizes(principal, ['root', 'child', 'unreadable']))).toEqual({ root: null, child: null, unreadable: null })
  })
})

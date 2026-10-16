import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { driveDestinationsQuerySchema, driveListQuerySchema, drivePickerQuerySchema } from '@lankadws/contracts'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { DriveService } from './drive.service.js'
import { DriveFoldersService } from './drive-folders.service.js'
import { DriveSharingService } from './drive-sharing.service.js'

const principal: AuthPrincipal = {
  userId: 'me', workspaceId: 'workspace', username: 'me', displayName: 'Me', primaryCompanyId: 'company',
  accountType: 'USER', allowedCompanyIds: ['company'], authorizationVersion: 1, sessionId: 'session', authAssurance: 1, restricted: false,
}
let prisma: PrismaClient
let service: DriveService
let folders: DriveFoldersService
let copyForPrincipal: ReturnType<typeof vi.fn>

beforeEach(async () => {
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: ':memory:' }) })
  await prisma.$executeRawUnsafe(`CREATE TABLE DriveFolder (
    id TEXT PRIMARY KEY, workspaceId TEXT, companyId TEXT, name TEXT, parentId TEXT, ownerId TEXT,
    trashedAt DATETIME, createdAt DATETIME, updatedAt DATETIME
  )`)
  await prisma.$executeRawUnsafe('CREATE TABLE Document (id TEXT PRIMARY KEY, workspaceId TEXT, companyId TEXT, ownerId TEXT, version INTEGER, folderId TEXT, name TEXT, archivedAt DATETIME, fileId TEXT, confidentiality TEXT, updatedAt DATETIME)')
  await prisma.$executeRawUnsafe('CREATE TABLE FileObject (id TEXT PRIMARY KEY, workspaceId TEXT, detectedMime TEXT, declaredMime TEXT, bytes INTEGER)')
  await prisma.$executeRawUnsafe('CREATE TABLE DriveShare (id TEXT PRIMARY KEY, workspaceId TEXT, principalType TEXT, principalId TEXT, targetType TEXT, targetId TEXT, role TEXT, createdBy TEXT, createdAt DATETIME)')
  const date = new Date('2026-10-15T10:00:00Z')
  await prisma.driveFolder.createMany({ data: [
    { id: 'source', name: 'Source', parentId: null },
    { id: 'source-child', name: 'Source child', parentId: 'source' },
    { id: 'destination', name: 'Destination', parentId: null },
    { id: 'destination-child', name: 'Destination child', parentId: 'destination' },
  ].map((folder) => ({ ...folder, workspaceId: 'workspace', companyId: 'company', ownerId: 'me', createdAt: date, updatedAt: date })) })
  await prisma.$executeRawUnsafe("INSERT INTO Document VALUES ('document', 'workspace', 'company', 'me', 1, NULL, 'Root file', NULL, 'root-file', 'CONFIDENTIAL', 1000)")
  await prisma.$executeRawUnsafe("INSERT INTO Document VALUES ('contents', 'workspace', 'company', 'me', 1, 'source', 'Nested file', NULL, 'nested-file', 'CONFIDENTIAL', 1000)")
  await prisma.$executeRawUnsafe("INSERT INTO FileObject VALUES ('root-file', 'workspace', 'application/pdf', 'application/pdf', 123), ('nested-file', 'workspace', 'text/plain', 'text/plain', 456)")
  const db = prisma as PrismaService
  const sharing = new DriveSharingService(db)
  folders = new DriveFoldersService(db, {} as never, sharing)
  vi.spyOn(folders, 'detail').mockResolvedValue({} as never)
  vi.spyOn(prisma.auditEvent, 'create').mockResolvedValue({} as never)
  copyForPrincipal = vi.fn().mockResolvedValue({ id: 'copy' })
  service = new DriveService(db, { allowedCompanies: (user: AuthPrincipal) => user.allowedCompanyIds } as never, folders, sharing, { copyForPrincipal } as never)
})
afterEach(async () => { await prisma.$disconnect() })

describe('Drive destinations against SQLite', () => {
  it.each(['USER', 'ADMIN'] as const)('keeps %s personal Drive limited to owned and explicitly shared items', async (accountType) => {
    const user = { ...principal, accountType }
    await prisma.$executeRawUnsafe("UPDATE DriveFolder SET ownerId = 'other' WHERE id IN ('destination', 'destination-child')")
    await prisma.$executeRawUnsafe(`INSERT INTO Document VALUES
      ('public', 'workspace', 'company', 'other', 1, NULL, 'Unshared general', NULL, 'root-file', 'GENERAL', 1000),
      ('internal', 'workspace', 'company', 'other', 1, NULL, 'Unshared internal', NULL, 'root-file', 'INTERNAL', 1000),
      ('shared', 'workspace', 'company', 'other', 1, 'destination', 'Direct share', NULL, 'root-file', 'INTERNAL', 1000),
      ('inherited', 'workspace', 'company', 'other', 1, 'destination-child', 'Inherited share', NULL, 'root-file', 'CONFIDENTIAL', 1000)`)
    await prisma.$executeRawUnsafe(`INSERT INTO DriveShare (id, workspaceId, principalType, principalId, targetType, targetId, role) VALUES
      ('direct', 'workspace', 'USER', 'me', 'DOCUMENT', 'shared', 'VIEWER'),
      ('folder', 'workspace', 'USER', 'me', 'FOLDER', 'destination-child', 'VIEWER')`)
    // Complete the minimal picker fixture for full list projections; no persistent database is used.
    await prisma.$executeRawUnsafe("ALTER TABLE Document ADD COLUMN number TEXT DEFAULT 'DOC-1'")
    await prisma.$executeRawUnsafe("ALTER TABLE Document ADD COLUMN status TEXT DEFAULT 'DRAFT'")
    await prisma.$executeRawUnsafe('ALTER TABLE Document ADD COLUMN createdAt DATETIME DEFAULT 1000')
    await prisma.$executeRawUnsafe("ALTER TABLE FileObject ADD COLUMN safeFilename TEXT DEFAULT 'file.txt'")
    await prisma.$executeRawUnsafe('CREATE TABLE User (id TEXT PRIMARY KEY, workspaceId TEXT, displayName TEXT, username TEXT)')
    await prisma.$executeRawUnsafe("INSERT INTO User VALUES ('me', 'workspace', 'Me', 'me'), ('other', 'workspace', 'Other', 'other')")

    const root = await service.list(user, driveListQuerySchema.parse({}))
    expect(root.files.map((file) => file.id).sort()).toEqual(['document', 'shared'])
    expect(root.folders.map((folder) => folder.id).sort()).toEqual(['destination-child', 'source'])
    expect(root.counts).toEqual({ MY_DRIVE: 4, SHARED: 2, RECENT: 4, TRASH: 0 })
    const recent = await service.list(user, driveListQuerySchema.parse({ view: 'RECENT' }))
    expect(recent.files.map((file) => file.id).sort()).toEqual(['contents', 'document', 'inherited', 'shared'])
    const hidden = await service.list(user, driveListQuerySchema.parse({ search: 'Unshared' }))
    expect(hidden.files).toEqual([])
    const sharedFolder = await service.list(user, driveListQuerySchema.parse({ folderId: 'destination-child' }))
    expect(sharedFolder.files.map((file) => file.id)).toEqual(['inherited'])
    expect(sharedFolder.breadcrumbs).toEqual([{ id: 'destination-child', name: 'Destination child' }])
    await expect(service.list(user, driveListQuerySchema.parse({ folderId: 'destination' }))).rejects.toMatchObject({ status: 404 })
    const picker = await service.picker(user, drivePickerQuerySchema.parse({}))
    expect(picker.items.map((file) => file.id).sort()).toEqual(['document', 'shared'])
    expect(picker.folders.map((folder) => folder.id).sort()).toEqual(['destination-child', 'source'])

    if (accountType === 'ADMIN') {
      const directory = await service.list(user, driveListQuerySchema.parse({ view: 'USERS', ownerId: 'other', search: 'Unshared' }))
      expect(directory.files.map((file) => file.id).sort()).toEqual(['internal', 'public'])
    }
    await prisma.$executeRawUnsafe("DELETE FROM DriveShare WHERE principalId = 'me'")
    expect((await service.list(user, driveListQuerySchema.parse({}))).files.map((file) => file.id)).toEqual(['document'])
    expect((await service.picker(user, drivePickerQuerySchema.parse({}))).items.map((file) => file.id)).toEqual(['document'])
  })

  it('browses folders before root files and searches nested files across the disk', async () => {
    const first = await service.picker(principal, drivePickerQuerySchema.parse({ limit: 1 }))
    expect(first.folders).toEqual([{ id: 'destination', name: 'Destination' }])
    expect(first.items).toEqual([])
    const second = await service.picker(principal, drivePickerQuerySchema.parse({ limit: 1, cursor: first.nextCursor }))
    expect(second.folders).toEqual([{ id: 'source', name: 'Source' }])
    const third = await service.picker(principal, drivePickerQuerySchema.parse({ limit: 1, cursor: second.nextCursor }))
    expect(third.items).toEqual([{ id: 'document', name: 'Root file', fileType: 'PDF', sizeBytes: 123 }])
    expect(third.nextCursor).toBeNull()
    const source = await service.picker(principal, drivePickerQuerySchema.parse({ folderId: 'source' }))
    expect(source.folders).toEqual([{ id: 'source-child', name: 'Source child' }])
    expect(source.items).toEqual([{ id: 'contents', name: 'Nested file', fileType: 'DOCUMENT', sizeBytes: 456 }])
    const empty = await service.picker(principal, drivePickerQuerySchema.parse({ folderId: 'source-child' }))
    expect(empty).toEqual({ folders: [], items: [], nextCursor: null })
    const search = await service.picker(principal, drivePickerQuerySchema.parse({ search: 'Nested' }))
    expect(search.items.map((file) => file.id)).toEqual(['contents'])
    expect(search.items[0]?.folderPath).toEqual(['Мій диск', 'Source'])
  })

  it('does not reveal a private parent name in search results for an individually shared file', async () => {
    await prisma.driveFolder.update({ where: { id: 'source' }, data: { ownerId: 'other', name: 'Private directory name' } })
    const search = await service.picker(principal, drivePickerQuerySchema.parse({ search: 'Nested' }))
    expect(search.items[0]?.folderPath).toEqual(['Спільні файли'])
  })

  it('rechecks access on attachment selection after a share has been revoked or a file archived', async () => {
    await prisma.$executeRawUnsafe("UPDATE Document SET ownerId = 'other' WHERE id = 'document'")
    await prisma.$executeRawUnsafe("INSERT INTO DriveShare (id, workspaceId, principalType, principalId, targetType, targetId, role) VALUES ('selected-share', 'workspace', 'USER', 'me', 'DOCUMENT', 'document', 'VIEWER')")
    expect((await service.picker(principal, drivePickerQuerySchema.parse({}))).items).toHaveLength(1)
    await prisma.$executeRawUnsafe("DELETE FROM DriveShare WHERE id = 'selected-share'")
    await expect(service.attachmentFromDocument(principal, 'document')).rejects.toMatchObject({ status: 404 })
    await prisma.$executeRawUnsafe("UPDATE Document SET archivedAt = 1000 WHERE id = 'contents'")
    await expect(service.attachmentFromDocument(principal, 'contents')).rejects.toMatchObject({ status: 404 })
    expect(copyForPrincipal).not.toHaveBeenCalled()
  })

  it('excludes private unshared, archived, and empty documents from the picker', async () => {
    await prisma.$executeRawUnsafe("INSERT INTO Document VALUES ('private', 'workspace', 'company', 'other', 1, NULL, 'Private', NULL, 'root-file', 'CONFIDENTIAL', 1000), ('archived', 'workspace', 'company', 'me', 1, NULL, 'Archived', 1000, 'root-file', 'CONFIDENTIAL', 1000), ('empty', 'workspace', 'company', 'me', 1, NULL, 'Empty', NULL, NULL, 'CONFIDENTIAL', 1000)")
    expect((await service.picker(principal, drivePickerQuerySchema.parse({}))).items.map((file) => file.id)).toEqual(['document'])
    await prisma.$executeRawUnsafe("INSERT INTO DriveShare (id, workspaceId, principalType, principalId, targetType, targetId, role) VALUES ('document-share', 'workspace', 'USER', 'me', 'DOCUMENT', 'private', 'VIEWER')")
    expect((await service.picker(principal, drivePickerQuerySchema.parse({}))).items.map((file) => file.id)).toContain('private')
  })

  it('does not list or open folders the principal cannot read', async () => {
    await prisma.driveFolder.update({ where: { id: 'destination' }, data: { ownerId: 'other' } })
    const root = await service.picker(principal, drivePickerQuerySchema.parse({}))
    expect(root.folders.map((folder) => folder.id)).toEqual(['destination-child', 'source'])
    await expect(service.picker(principal, drivePickerQuerySchema.parse({ folderId: 'destination' }))).rejects.toMatchObject({ status: 404 })
  })

  it('lists root and nested folders directly from storage without opening them in the Drive interface', async () => {
    const root = await service.destinations(principal, driveDestinationsQuerySchema.parse({ targetType: 'DOCUMENT', targetId: 'document' }))
    expect(root.items).toEqual([
      { id: 'destination', name: 'Destination', hasChildren: true },
      { id: 'source', name: 'Source', hasChildren: true },
    ])
    const nested = await service.destinations(principal, driveDestinationsQuerySchema.parse({ targetType: 'DOCUMENT', targetId: 'document', folderId: 'destination' }))
    expect(nested.items).toEqual([{ id: 'destination-child', name: 'Destination child', hasChildren: false }])
  })

  it('moves a folder and its contents into another nested folder', async () => {
    const root = await service.destinations(principal, driveDestinationsQuerySchema.parse({ targetType: 'FOLDER', targetId: 'source' }))
    expect(root.items).toEqual([{ id: 'destination', name: 'Destination', hasChildren: true }])
    await folders.move(principal, 'source', 'destination-child')
    expect(await prisma.driveFolder.findUnique({ where: { id: 'source' }, select: { parentId: true } })).toEqual({ parentId: 'destination-child' })
    expect(await prisma.driveFolder.findUnique({ where: { id: 'source-child' }, select: { parentId: true } })).toEqual({ parentId: 'source' })
    expect(await prisma.document.findUnique({ where: { id: 'contents' }, select: { folderId: true } })).toEqual({ folderId: 'source' })
  })

  it('offers the same three root folders for files from different companies and moves into each', async () => {
    const actor = { ...principal, allowedCompanyIds: ['company', 'second-company'] }
    await prisma.driveFolder.updateMany({ where: { id: { in: ['destination', 'destination-child'] } }, data: { companyId: 'second-company' } })
    await prisma.driveFolder.create({ data: { id: 'third', name: 'Third', workspaceId: 'workspace', companyId: 'second-company', ownerId: 'me' } })
    await prisma.document.update({ where: { id: 'contents' }, data: { companyId: 'second-company', folderId: null }, select: { id: true } })
    for (const documentId of ['document', 'contents']) {
      const destinations = await service.destinations(actor, driveDestinationsQuerySchema.parse({ targetType: 'DOCUMENT', targetId: documentId }))
      expect(destinations.items.map((folder) => folder.id)).toEqual(['destination', 'source', 'third'])
      let version = 1
      for (const folderId of ['destination', 'source', 'third', 'destination-child', null]) {
        await service.moveDocument(actor, documentId, folderId, version++)
        expect(await prisma.document.findUnique({ where: { id: documentId }, select: { folderId: true } })).toEqual({ folderId })
      }
    }
  })

  it('moves a folder across companies while retaining its contents and company keys', async () => {
    const actor = { ...principal, allowedCompanyIds: ['company', 'second-company'] }
    await prisma.driveFolder.updateMany({ where: { id: { in: ['destination', 'destination-child'] } }, data: { companyId: 'second-company' } })
    const destinations = await service.destinations(actor, driveDestinationsQuerySchema.parse({ targetType: 'FOLDER', targetId: 'source' }))
    expect(destinations.items.map((folder) => folder.id)).toEqual(['destination'])
    await folders.move(actor, 'source', 'destination-child')
    expect(await prisma.driveFolder.findUnique({ where: { id: 'source' }, select: { parentId: true, companyId: true } })).toEqual({ parentId: 'destination-child', companyId: 'company' })
    expect(await prisma.document.findUnique({ where: { id: 'contents' }, select: { folderId: true, companyId: true } })).toEqual({ folderId: 'source', companyId: 'company' })
    await folders.move(actor, 'source', null)
    expect(await prisma.driveFolder.findUnique({ where: { id: 'source' }, select: { parentId: true } })).toEqual({ parentId: null })
  })

  it('still excludes and rejects inaccessible, read-only, trashed and foreign workspace destinations', async () => {
    const actor = { ...principal, allowedCompanyIds: ['company', 'second-company'] }
    for (const [id, companyId, workspaceId, ownerId, trashedAt] of [
      ['private', 'second-company', 'workspace', 'other', null],
      ['read-only', 'second-company', 'workspace', 'other', null],
      ['trashed', 'second-company', 'workspace', 'me', new Date()],
      ['foreign', 'second-company', 'other-workspace', 'me', null],
      ['unavailable-company', 'unavailable', 'workspace', 'me', null],
    ] as const) {
      await prisma.driveFolder.create({ data: { id, name: id, companyId, workspaceId, ownerId, trashedAt } })
    }
    await prisma.$executeRawUnsafe("INSERT INTO DriveShare (id, workspaceId, principalType, principalId, targetType, targetId, role) VALUES ('readonly-share', 'workspace', 'USER', 'me', 'FOLDER', 'read-only', 'VIEWER')")
    const destinations = await service.destinations(actor, driveDestinationsQuerySchema.parse({ targetType: 'DOCUMENT', targetId: 'document' }))
    expect(destinations.items.map((folder) => folder.id)).toEqual(['destination', 'source'])
    for (const folderId of ['private', 'read-only', 'trashed', 'foreign', 'unavailable-company']) {
      await expect(service.moveDocument(actor, 'document', folderId, 1)).rejects.toBeDefined()
    }
    expect(await prisma.document.findUnique({ where: { id: 'document' }, select: { folderId: true, version: true } })).toEqual({ folderId: null, version: 1 })
  })

  it('rejects self and descendant destinations without changing the tree', async () => {
    for (const parentId of ['source', 'source-child']) {
      await expect(folders.move(principal, 'source', parentId)).rejects.toMatchObject({ code: 'drive_folder_cycle' })
      await expect(service.destinations(principal, driveDestinationsQuerySchema.parse({ targetType: 'FOLDER', targetId: 'source', folderId: parentId }))).rejects.toMatchObject({ status: 404 })
    }
    expect(await prisma.driveFolder.findUnique({ where: { id: 'source' }, select: { parentId: true } })).toEqual({ parentId: null })
  })

  it('rejects moving a folder into a read-only shared destination', async () => {
    await prisma.driveFolder.update({ where: { id: 'destination' }, data: { ownerId: 'colleague' } })
    await prisma.$executeRawUnsafe("INSERT INTO DriveShare (id, workspaceId, principalType, principalId, targetType, targetId, role) VALUES ('share', 'workspace', 'USER', 'me', 'FOLDER', 'destination', 'VIEWER')")
    await expect(folders.move(principal, 'source', 'destination')).rejects.toMatchObject({ status: 403 })
    expect(await prisma.driveFolder.findUnique({ where: { id: 'source' }, select: { parentId: true } })).toEqual({ parentId: null })
  })
})

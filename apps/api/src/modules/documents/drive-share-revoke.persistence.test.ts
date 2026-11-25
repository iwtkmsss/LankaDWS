import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { FilesService } from '../files/files.service.js'
import { DriveSharingService } from './drive-sharing.service.js'

// A revoked Drive share is kept (decision 2026-11-18) but grants nothing.

let prisma: PrismaClient
let directory: string
let sharing: DriveSharingService
let files: FilesService
const owner = { userId: 'owner', workspaceId: 'workspace', allowedCompanyIds: ['company'], accountType: 'USER', displayName: 'Owner' } as AuthPrincipal
const reader: AuthPrincipal = { ...owner, userId: 'reader', displayName: 'Reader' }
const share = { targetType: 'DOCUMENT', targetId: 'document', principalType: 'USER', principalId: 'reader', role: 'VIEWER' } as const

const authorized = (principal: AuthPrincipal) => (files as unknown as {
  authorizedFile: (principal: AuthPrincipal, fileId: string) => Promise<{ id: string }>
}).authorizedFile(principal, 'file')

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-drive-revoke-'))
  const path = join(directory, 'test.db')
  const db = new Database(path)
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const migration of readdirSync(migrations).sort()) {
    if (migration === 'migration_lock.toml') continue
    db.exec(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
  }
  db.close()
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: `file:${path}` }) })
  sharing = new DriveSharingService(prisma as PrismaService)
  files = new FilesService(prisma as PrismaService, {} as never, {} as never, new TaskAccessService(prisma as PrismaService), sharing)
  await prisma.workspace.create({ data: { id: 'workspace', displayName: 'Workspace' } })
  await prisma.company.create({ data: { id: 'company', workspaceId: 'workspace', displayName: 'Company', legalName: 'Company', code: 'company' } })
  for (const userId of ['owner', 'reader']) {
    await prisma.user.create({ data: {
      id: userId, workspaceId: 'workspace', displayName: userId, normalizedDisplayName: userId,
      username: userId, normalizedUsername: userId, primaryCompanyId: 'company',
    } })
  }
  await prisma.fileObject.create({ data: {
    id: 'file', workspaceId: 'workspace', companyId: 'company', ownerId: 'owner', storageKey: 'company/file',
    safeFilename: 'report.pdf', declaredMime: 'application/pdf', detectedMime: 'application/pdf', bytes: 10,
    sha256: 'hash', scanStatus: 'CLEAN',
  } })
  await prisma.document.create({ data: {
    id: 'document', workspaceId: 'workspace', companyId: 'company', number: 'D-1', name: 'Report',
    ownerId: 'owner', status: 'ACTIVE', fileId: 'file',
  } })
  await prisma.fileLink.create({ data: {
    id: 'content', fileId: 'file', entityType: 'DOCUMENT', entityId: 'document', purpose: 'CONTENT', aclMode: 'INHERIT',
  } })
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it('revokes a share without deleting it, grants nothing afterwards and revives the row on re-grant', async () => {
  const [granted] = await sharing.create(owner, share)
  expect((await sharing.grantsFor(reader)).roleOf('DOCUMENT', 'document')).toBe('VIEWER')
  await expect(authorized(reader)).resolves.toMatchObject({ id: 'file' })

  expect(await sharing.revoke(owner, granted.id)).toEqual([])
  expect(await prisma.driveShare.findUniqueOrThrow({ where: { id: granted.id } })).toMatchObject({
    revokedAt: expect.any(Date) as unknown, revokedById: 'owner',
  })
  const grants = await sharing.grantsFor(reader)
  expect(grants.roleOf('DOCUMENT', 'document')).toBeNull()
  expect(grants.documentIds.size).toBe(0)
  await expect(authorized(reader)).rejects.toMatchObject({ status: 404 })
  // The reader can no longer even inspect the sharing metadata, and a second revoke finds nothing.
  await expect(sharing.list(reader, 'DOCUMENT', 'document')).rejects.toMatchObject({ status: 404 })
  await expect(sharing.revoke(owner, granted.id)).rejects.toMatchObject({ status: 404 })

  const notificationsBefore = await prisma.notification.count({ where: { recipientId: 'reader' } })
  const [regranted] = await sharing.create(owner, { ...share, role: 'EDITOR' })
  expect(regranted).toMatchObject({ id: granted.id, role: 'EDITOR' })
  expect(await prisma.driveShare.count()).toBe(1)
  expect(await prisma.driveShare.findUniqueOrThrow({ where: { id: granted.id } })).toMatchObject({ revokedAt: null, revokedById: null })
  expect((await sharing.grantsFor(reader)).roleOf('DOCUMENT', 'document')).toBe('EDITOR')
  await expect(authorized(reader)).resolves.toMatchObject({ id: 'file' })
  // A revived share is announced like a new grant.
  const notifications = await prisma.notification.findMany({ where: { recipientId: 'reader' }, orderBy: { createdAt: 'asc' } })
  expect(notifications).toHaveLength(notificationsBefore + 1)
  expect(notifications.at(-1)?.safeTitle).toContain('Вам відкрито доступ')
})

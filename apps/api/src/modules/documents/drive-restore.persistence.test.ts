import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { driveListQuerySchema } from '@lankadws/contracts'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { ACTOR_RESTORE_WINDOW_MS } from '../../common/restore-window.js'
import { ScopeService } from '../authorization/scope.service.js'
import { DocumentsService } from './documents.service.js'
import { DriveService } from './drive.service.js'
import { DriveFoldersService } from './drive-folders.service.js'
import { DriveSharingService } from './drive-sharing.service.js'

// Decision 2026-11-18: Drive trash and share revoke are undoable; restore only
// brings back what that operation hid and never announces "new" access.

let prisma: PrismaClient
let directory: string
let sharing: DriveSharingService
let folders: DriveFoldersService
let documents: DocumentsService
let drive: DriveService
const base = { workspaceId: 'workspace', allowedCompanyIds: ['company'], accountType: 'USER' as const }
const owner = { ...base, userId: 'owner', displayName: 'Власник' } as AuthPrincipal
const editor = { ...base, userId: 'editor', displayName: 'Редактор' } as AuthPrincipal
const reader = { ...base, userId: 'reader', displayName: 'Читач' } as AuthPrincipal
const other = { ...base, userId: 'other', displayName: 'Інший' } as AuthPrincipal
const admin = { ...base, userId: 'admin', displayName: 'Адмін', accountType: 'ADMIN' } as AuthPrincipal
const start = new Date('2026-11-18T10:00:00Z')
const afterWindow = () => vi.setSystemTime(new Date(start.getTime() + ACTOR_RESTORE_WINDOW_MS + 1_000))

async function document(id: string, folderId: string | null) {
  await prisma.document.create({ data: {
    id, workspaceId: 'workspace', companyId: 'company', number: id, name: id, ownerId: 'owner', status: 'DRAFT', folderId,
  } })
}
const state = async () => ({
  folders: Object.fromEntries((await prisma.driveFolder.findMany({ orderBy: { id: 'asc' } })).map((row) => [row.id, Boolean(row.trashedAt)])),
  documents: Object.fromEntries((await prisma.document.findMany({ orderBy: { id: 'asc' } })).map((row) => [row.id, Boolean(row.archivedAt)])),
})

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(start)
  directory = mkdtempSync(join(tmpdir(), 'lankadws-drive-restore-'))
  const path = join(directory, 'test.db')
  const db = new Database(path)
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const migration of readdirSync(migrations).sort()) {
    if (migration !== 'migration_lock.toml') db.exec(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
  }
  db.close()
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: `file:${path}` }) })
  const service = prisma as PrismaService
  const scope = new ScopeService()
  sharing = new DriveSharingService(service)
  folders = new DriveFoldersService(service, scope, sharing)
  documents = new DocumentsService(service, scope, sharing)
  drive = new DriveService(service, scope, folders, sharing, {} as never)
  await prisma.workspace.create({ data: { id: 'workspace', displayName: 'Workspace' } })
  await prisma.company.create({ data: { id: 'company', workspaceId: 'workspace', displayName: 'Company', legalName: 'Company', code: 'company' } })
  for (const user of [owner, editor, reader, other, admin]) {
    await prisma.user.create({ data: { id: user.userId, workspaceId: 'workspace', displayName: user.displayName,
      normalizedDisplayName: user.displayName, username: user.userId, normalizedUsername: user.userId, primaryCompanyId: 'company',
      accountType: user.accountType } })
  }
  for (const [id, parentId] of [['root', null], ['child', 'root'], ['early', 'root']] as const) {
    await prisma.driveFolder.create({ data: { id, workspaceId: 'workspace', companyId: 'company', name: id, parentId, ownerId: 'owner' } })
  }
  await document('d_root', 'root')
  await document('d_child', 'child')
  await document('d_old', 'child')
  await document('d_early', 'early')
})

afterEach(async () => {
  vi.useRealTimers()
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

describe('Drive folder restore', () => {
  it('revives only what the folder trash hid, not items trashed separately before', async () => {
    await folders.trash(owner, 'early')
    await documents.archive(owner, 'd_old', 1)
    vi.setSystemTime(new Date(start.getTime() + 1_000))
    await folders.trash(owner, 'root')
    expect(await state()).toEqual({
      folders: { child: true, early: true, root: true },
      documents: { d_child: true, d_early: true, d_old: true, d_root: true },
    })
    expect(await prisma.driveFolder.findUniqueOrThrow({ where: { id: 'root' } })).toMatchObject({ trashedById: 'owner' })
    expect(await prisma.document.findUniqueOrThrow({ where: { id: 'd_root' } })).toMatchObject({ archivedById: 'owner', version: 2 })

    await expect(folders.restore(owner, 'root')).resolves.toEqual({ restored: true, folders: 2 })
    expect(await state()).toEqual({
      folders: { child: false, early: true, root: false },
      documents: { d_child: false, d_early: true, d_old: true, d_root: false },
    })
    // Restoring again changes nothing.
    await expect(folders.restore(owner, 'root')).resolves.toEqual({ restored: true, folders: 0 })
  })

  it('lets the actor undo within 10 minutes; afterwards only the owner or an administrator', async () => {
    await sharing.create(owner, { targetType: 'FOLDER', targetId: 'root', principalType: 'USER', principalId: 'editor', role: 'EDITOR' })
    await folders.trash(editor, 'root')
    await expect(folders.restore(other, 'root')).rejects.toMatchObject({ status: 404 })
    await expect(folders.restore(editor, 'root')).resolves.toMatchObject({ restored: true })

    await folders.trash(editor, 'root')
    afterWindow()
    await expect(folders.restore(editor, 'root')).rejects.toMatchObject({ status: 403 })
    await expect(folders.restore(admin, 'root')).resolves.toMatchObject({ restored: true })
    await folders.trash(editor, 'root')
    await expect(folders.restore(owner, 'root')).resolves.toMatchObject({ restored: true })
  })
})

describe('Drive document restore', () => {
  it('applies the owner/actor/admin rule with an optimistic version', async () => {
    // Archiving needs edit access (owner, administrator or an EDITOR share).
    await sharing.create(owner, { targetType: 'DOCUMENT', targetId: 'd_root', principalType: 'USER', principalId: 'other', role: 'EDITOR' })
    await documents.archive(other, 'd_root', 1)
    expect(await prisma.document.findUniqueOrThrow({ where: { id: 'd_root' } })).toMatchObject({ archivedById: 'other', version: 2 })
    await expect(documents.restore(other, 'd_root', 1)).rejects.toMatchObject({ status: 409 })
    await expect(documents.restore(reader, 'd_root', 2)).rejects.toMatchObject({ status: 403 })
    await expect(documents.restore(other, 'd_root', 2)).resolves.toEqual({ restored: true, version: 3 })

    await documents.archive(other, 'd_root', 3)
    afterWindow()
    await expect(documents.restore(other, 'd_root', 4)).rejects.toMatchObject({ status: 403 })
    await expect(documents.restore(owner, 'd_root', 4)).resolves.toEqual({ restored: true, version: 5 })
  })
})

describe('Drive share restore', () => {
  it('revives the revoked share unchanged and sends no new-access notification', async () => {
    const [granted] = await sharing.create(owner, { targetType: 'DOCUMENT', targetId: 'd_root', principalType: 'USER', principalId: 'reader', role: 'EDITOR' })
    const before = await prisma.driveShare.findUniqueOrThrow({ where: { id: granted.id } })
    const notifications = await prisma.notification.count({ where: { recipientId: 'reader' } })
    vi.setSystemTime(new Date(start.getTime() + 60_000))
    await sharing.revoke(owner, granted.id)
    // The former recipient cannot restore their own access.
    await expect(sharing.restore(reader, granted.id)).rejects.toMatchObject({ status: 404 })

    const restored = await sharing.restore(owner, granted.id)
    expect(restored).toEqual([expect.objectContaining({ id: granted.id, role: 'EDITOR', createdAt: before.createdAt.toISOString() })])
    expect(await prisma.driveShare.findUniqueOrThrow({ where: { id: granted.id } })).toMatchObject({
      revokedAt: null, revokedById: null, createdAt: before.createdAt, createdBy: 'owner',
    })
    expect(await prisma.notification.count({ where: { recipientId: 'reader' } })).toBe(notifications)
    expect((await sharing.grantsFor(reader)).roleOf('DOCUMENT', 'd_root')).toBe('EDITOR')
    expect(await prisma.auditEvent.count({ where: { action: 'drive.share_restored' } })).toBe(1)

    await sharing.revoke(owner, granted.id)
    afterWindow()
    await expect(sharing.restore(other, granted.id)).rejects.toMatchObject({ status: 404 })
    await expect(sharing.restore(admin, granted.id)).resolves.toHaveLength(1)
  })
})

describe('Administrator Drive trash', () => {
  it('lists one user\'s trash for an administrator only', async () => {
    await folders.trash(owner, 'early')
    const query = driveListQuerySchema.parse({ view: 'TRASH', ownerId: 'owner' })
    const result = await drive.list(admin, query)
    expect(result.folders.map((folder) => folder.id)).toEqual(['early'])
    expect(result.files.map((file) => file.id)).toEqual(['d_early'])
    await expect(drive.list(other, query)).rejects.toMatchObject({ status: 403 })
    // Without an owner the administrator's own trash stays personal.
    expect((await drive.list(admin, driveListQuerySchema.parse({ view: 'TRASH' }))).folders).toEqual([])
  })
})

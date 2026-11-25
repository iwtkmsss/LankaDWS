import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatMessagePageQuerySchema } from '@lankadws/contracts'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { ACTOR_RESTORE_WINDOW_MS } from '../../common/restore-window.js'
import type { FilesService } from '../files/files.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import type { ChatRealtimeService } from './chat-realtime.service.js'
import { MessagesService } from './messages.service.js'

// Decision 2026-11-18: a deleted message is hidden, the actor may undo for 10
// minutes, an administrator sees it in place and may always restore it.

let prisma: PrismaClient
let directory: string
let service: MessagesService
let publish: ReturnType<typeof vi.fn>
const base = { workspaceId: 'workspace', allowedCompanyIds: ['company'], accountType: 'USER' as const }
const author = { ...base, userId: 'author', displayName: 'Автор' } as AuthPrincipal
const peer = { ...base, userId: 'peer', displayName: 'Колега' } as AuthPrincipal
const third = { ...base, userId: 'third', displayName: 'Третій' } as AuthPrincipal
const fourth = { ...base, userId: 'fourth', displayName: 'Четвертий' } as AuthPrincipal
const outsider = { ...base, userId: 'outsider', displayName: 'Сторонній' } as AuthPrincipal
const admin = { ...base, userId: 'admin', displayName: 'Адмін', accountType: 'ADMIN' } as AuthPrincipal

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-message-restore-'))
  const path = join(directory, 'test.db')
  const db = new Database(path)
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const migration of readdirSync(migrations).sort()) {
    if (migration !== 'migration_lock.toml') db.exec(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
  }
  db.close()
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: `file:${path}` }) })
  publish = vi.fn().mockResolvedValue(undefined)
  service = new MessagesService(prisma as PrismaService, new ScopeService(),
    null as unknown as FilesService, { publish } as unknown as ChatRealtimeService)
  await prisma.workspace.create({ data: { id: 'workspace', displayName: 'Workspace' } })
  await prisma.company.create({ data: { id: 'company', workspaceId: 'workspace', displayName: 'Company', legalName: 'Company', code: 'company' } })
  for (const user of [author, peer, third, fourth, outsider, admin]) {
    await prisma.user.create({ data: { id: user.userId, workspaceId: 'workspace', displayName: user.displayName,
      normalizedDisplayName: user.displayName, username: user.userId, normalizedUsername: user.userId, primaryCompanyId: 'company',
      accountType: user.accountType } })
  }
  await prisma.messageThread.create({ data: {
    id: 'thread', workspaceId: 'workspace', companyId: 'company', kind: 'GROUP', title: 'Група',
    participants: { create: [
      { id: 'p_author', userId: 'author', role: 'OWNER' },
      { id: 'p_peer', userId: 'peer', role: 'MEMBER' },
      { id: 'p_third', userId: 'third', role: 'MEMBER' },
      { id: 'p_fourth', userId: 'fourth', role: 'MEMBER' },
    ] },
  } })
  await prisma.message.create({ data: { id: 'message', threadId: 'thread', authorId: 'author', body: 'Секретний текст' } })
  await prisma.fileObject.create({ data: {
    id: 'file', workspaceId: 'workspace', companyId: 'company', ownerId: 'author', storageKey: 'company/file',
    safeFilename: 'report.pdf', declaredMime: 'application/pdf', detectedMime: 'application/pdf', bytes: 10,
    sha256: 'hash', scanStatus: 'CLEAN',
  } })
  await prisma.fileLink.create({ data: {
    id: 'link', fileId: 'file', entityType: 'MESSAGE', entityId: 'message', purpose: 'ATTACHMENT', aclMode: 'INHERIT',
  } })
})

afterEach(async () => {
  vi.useRealTimers()
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

const page = (principal: AuthPrincipal) => service.messagesPage(principal, 'thread', chatMessagePageQuerySchema.parse({}))

describe('restoring a deleted message', () => {
  it('records the actor, lets the author undo within 10 minutes and revives the same content', async () => {
    const deleted = await service.deleteMessage(author, 'message', { expectedVersion: 1 })
    expect(await prisma.message.findUniqueOrThrow({ where: { id: 'message' } })).toMatchObject({ deletedById: 'author', version: 2 })
    // Deletion keeps the attachment link, so there is nothing to revive there.
    expect(await prisma.fileLink.findUniqueOrThrow({ where: { id: 'link' } })).toMatchObject({ removedAt: null })

    const restored = await service.restoreMessage(author, 'message', { expectedVersion: deleted.version })
    expect(restored).toMatchObject({ id: 'message', body: 'Секретний текст', deletedAt: null, version: 3 })
    expect(restored.attachments.map((attachment) => attachment.id)).toEqual(['file'])
    expect(await prisma.message.findUniqueOrThrow({ where: { id: 'message' } })).toMatchObject({ deletedAt: null, deletedById: null })
    expect(await prisma.auditEvent.count({ where: { action: 'message.restored', entityId: 'message' } })).toBe(1)
    expect(await prisma.outboxEvent.count({ where: { eventType: 'message.restored' } })).toBe(1)
    expect(publish).toHaveBeenLastCalledWith('thread', 'message.edited', 'message')
  })

  it('refuses the author after 10 minutes, other participants and non-participants, and stale versions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'))
    await service.deleteMessage(author, 'message', { expectedVersion: 1 })
    await expect(service.restoreMessage(peer, 'message', { expectedVersion: 2 })).rejects.toMatchObject({ status: 403 })
    await expect(service.restoreMessage(outsider, 'message', { expectedVersion: 2 })).rejects.toMatchObject({ status: 404 })
    await expect(service.restoreMessage(author, 'message', { expectedVersion: 1 })).rejects.toMatchObject({ status: 409 })
    vi.setSystemTime(new Date(Date.parse('2026-11-18T10:00:00Z') + ACTOR_RESTORE_WINDOW_MS + 1_000))
    await expect(service.restoreMessage(author, 'message', { expectedVersion: 2 })).rejects.toMatchObject({ status: 403 })
    expect(await prisma.message.findUniqueOrThrow({ where: { id: 'message' } })).toMatchObject({ deletedById: 'author' })
    // An administrator restores at any time, even without being in the chat.
    await expect(service.restoreMessage(admin, 'message', { expectedVersion: 2 })).resolves.toMatchObject({ deletedAt: null, version: 3 })
  })

  it('shows the deleted content in place to an administrator only', async () => {
    await service.deleteMessage(author, 'message', { expectedVersion: 1 })
    const [forPeer] = (await page(peer)).items
    expect(forPeer).toMatchObject({ body: '', attachments: [], mentions: [], canDelete: false })
    expect(forPeer?.deletedAt).toEqual(expect.any(String))
    expect(forPeer).not.toHaveProperty('deletedBy')
    expect(forPeer).not.toHaveProperty('canRestore')

    const [forAdmin] = (await page(admin)).items
    expect(forAdmin).toMatchObject({
      body: 'Секретний текст', deletedBy: { id: 'author', displayName: 'Автор' }, canRestore: true, canEdit: false, canDelete: false,
    })
    expect(forAdmin?.attachments.map((attachment) => attachment.id)).toEqual(['file'])
  })
})

describe('undoing leaving a group chat', () => {
  it('lets the person who left rejoin within 10 minutes', async () => {
    await service.removeParticipant(peer, 'thread', 'peer', { expectedVersion: 1, expectedThreadVersion: 1 })
    await expect(service.rejoinThread(peer, 'thread', { expectedVersion: 1 })).rejects.toMatchObject({ status: 409 })
    const rejoined = await service.rejoinThread(peer, 'thread', { expectedVersion: 2 })
    expect(rejoined).toMatchObject({ participant: { id: 'peer', role: 'MEMBER', version: 3 }, threadVersion: 3 })
    expect(await prisma.threadParticipant.findUniqueOrThrow({ where: { id: 'p_peer' } })).toMatchObject({ leftAt: null })
    await expect(service.detail(peer, 'thread')).resolves.toMatchObject({ canPost: true })
  })

  it('refuses rejoining after a removal by an owner or after the window', async () => {
    await service.removeParticipant(author, 'thread', 'peer', { expectedVersion: 1, expectedThreadVersion: 1 })
    await expect(service.rejoinThread(peer, 'thread', { expectedVersion: 2 })).rejects.toMatchObject({ status: 404 })

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'))
    await service.removeParticipant(third, 'thread', 'third', { expectedVersion: 1, expectedThreadVersion: 2 })
    vi.setSystemTime(new Date(Date.parse('2026-11-18T10:00:00Z') + ACTOR_RESTORE_WINDOW_MS + 1_000))
    await expect(service.rejoinThread(third, 'thread', { expectedVersion: 2 })).rejects.toMatchObject({ status: 404 })
    // An active participant has nothing to rejoin.
    await expect(service.rejoinThread(author, 'thread', { expectedVersion: 1 })).rejects.toMatchObject({ status: 404 })
  })
})

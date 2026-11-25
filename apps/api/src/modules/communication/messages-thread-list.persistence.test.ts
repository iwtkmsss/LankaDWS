import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { chatThreadListQuerySchema } from '@lankadws/contracts'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { FilesService } from '../files/files.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import type { ChatRealtimeService } from './chat-realtime.service.js'
import { MessagesService } from './messages.service.js'

let prisma: PrismaClient
let directory: string
let service: MessagesService
const viewer = { userId: 'me', workspaceId: 'workspace', allowedCompanyIds: ['company'] } as AuthPrincipal

async function thread(id: string, kind: 'DIRECT' | 'GROUP', lastMessageAt: Date | null, createdAt: Date) {
  await prisma.messageThread.create({ data: {
    id, workspaceId: 'workspace', companyId: 'company', kind, title: kind === 'GROUP' ? id : null,
    lastMessageAt, createdAt,
    participants: { create: ['me', 'other'].map((userId) => ({ id: `${id}_${userId}`, userId, role: 'MEMBER' })) },
  } })
}

async function message(id: string, threadId: string, body: string, createdAt: Date, deletedAt: Date | null = null) {
  await prisma.message.create({ data: { id, threadId, authorId: 'other', body, createdAt, deletedAt } })
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-thread-list-'))
  const path = join(directory, 'test.db')
  const db = new Database(path)
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const migration of readdirSync(migrations).sort()) {
    if (migration !== 'migration_lock.toml') db.exec(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
  }
  db.close()
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: `file:${path}` }) })
  service = new MessagesService(prisma as PrismaService, new ScopeService(),
    null as unknown as FilesService, null as unknown as ChatRealtimeService)
  await prisma.workspace.create({ data: { id: 'workspace', displayName: 'Workspace' } })
  await prisma.company.create({ data: { id: 'company', workspaceId: 'workspace', displayName: 'Company', legalName: 'Company', code: 'company' } })
  for (const userId of ['me', 'other']) {
    await prisma.user.create({ data: { id: userId, workspaceId: 'workspace', displayName: userId,
      normalizedDisplayName: userId, username: userId, normalizedUsername: userId, primaryCompanyId: 'company' } })
  }
  const at = (day: number, hour = 8) => new Date(`2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`)
  // Latest message was deleted: the preview falls back to the previous live one.
  await thread('deleted_tail', 'GROUP', at(20), at(1))
  await message('m_dt_1', 'deleted_tail', 'live', at(19))
  await message('m_dt_2', 'deleted_tail', 'removed', at(20), at(20, 9))
  // Same timestamp: the higher id wins, as in the message page ordering.
  await thread('tie', 'GROUP', at(18), at(1))
  await message('m_tie_a', 'tie', 'first id', at(18))
  await message('m_tie_b', 'tie', 'second id', at(18))
  await message('m_tie_0', 'tie', 'older', at(17))
  // A group without messages stays listed with an empty preview.
  await thread('empty_group', 'GROUP', null, at(16))
  // A direct chat with only deleted messages stays hidden.
  await thread('ghost_direct', 'DIRECT', at(15), at(1))
  await message('m_ghost', 'ghost_direct', 'gone', at(15), at(15, 9))
  // An old pinned direct chat appears on the first page.
  await thread('pinned_old', 'DIRECT', at(2), at(1))
  await message('m_pin_1', 'pinned_old', 'pinned older', at(1))
  await message('m_pin_2', 'pinned_old', 'pinned latest', at(2))
  await prisma.userUiPreference.create({ data: {
    id: 'pref_pin', userId: 'me', module: 'MESSAGES', key: 'PIN:pinned_old', schemaVersion: 1, valueJson: '{}',
  } })
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it('returns the latest live message per thread with a bounded query', async () => {
  const nestedInclude = vi.spyOn(prisma.message, 'findMany')
  const page = await service.threads(viewer, chatThreadListQuerySchema.parse({ company: 'all', limit: '2' }))
  expect(page.items.map((item) => [item.id, item.lastMessageId, item.lastMessage, item.lastMessageAt, item.pinned]))
    .toEqual([
      ['pinned_old', 'm_pin_2', 'pinned latest', '2026-10-02T08:00:00.000Z', true],
      ['deleted_tail', 'm_dt_1', 'live', '2026-10-19T08:00:00.000Z', false],
      ['tie', 'm_tie_b', 'second id', '2026-10-18T08:00:00.000Z', false],
    ])
  // Only the selected latest messages are loaded, never thread histories.
  expect(nestedInclude).toHaveBeenCalledTimes(1)
  const loaded = nestedInclude.mock.calls[0]?.[0] as { where: { id: { in: string[] }, deletedAt: null } }
  expect(loaded.where.deletedAt).toBeNull()
  expect([...loaded.where.id.in].sort()).toEqual(['m_dt_1', 'm_pin_2', 'm_tie_b'])

  const next = await service.threads(viewer, chatThreadListQuerySchema.parse({ company: 'all', limit: '2', cursor: page.nextCursor ?? undefined }))
  expect(next.items.map((item) => [item.id, item.lastMessageId, item.lastMessage, item.lastMessageAt]))
    .toEqual([
      ['pinned_old', 'm_pin_2', 'pinned latest', '2026-10-02T08:00:00.000Z'],
      ['empty_group', null, '', null],
    ])
  expect(next.nextCursor).toBeNull()
})

it('matches the previous nested latest-message include for every listed thread', async () => {
  const legacy = await prisma.messageThread.findMany({
    include: { messages: { where: { deletedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
  })
  const legacyLatest = new Map(legacy.map((row) => [row.id, row.messages[0]?.id ?? null]))
  const page = await service.threads(viewer, chatThreadListQuerySchema.parse({ company: 'all', limit: '50' }))
  expect(page.items.map((item) => item.id)).not.toContain('ghost_direct')
  for (const item of page.items) expect(item.lastMessageId).toBe(legacyLatest.get(item.id))
})

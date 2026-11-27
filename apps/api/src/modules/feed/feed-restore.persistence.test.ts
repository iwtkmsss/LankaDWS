import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { feedArchivedListQuerySchema, feedListQuerySchema } from '@lankadws/contracts'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { ACTOR_RESTORE_WINDOW_MS } from '../../common/restore-window.js'
import type { FilesService } from '../files/files.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { FeedService } from './feed.service.js'

let prisma: PrismaClient
let directory: string
let service: FeedService
const base = { workspaceId: 'workspace', allowedCompanyIds: ['company'], accountType: 'USER' } as AuthPrincipal
const author = { ...base, userId: 'author' }
const reader = { ...base, userId: 'reader' }
const admin = { ...base, userId: 'admin', accountType: 'ADMIN' as const }
const postAt = new Date('2026-10-20T08:00:00Z')

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-feed-restore-'))
  const path = join(directory, 'test.db')
  const db = new Database(path)
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const migration of readdirSync(migrations).sort()) {
    if (migration !== 'migration_lock.toml') db.exec(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
  }
  db.close()
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: `file:${path}` }) })
  service = new FeedService(prisma as PrismaService, new ScopeService(), null as unknown as FilesService)
  await prisma.workspace.create({ data: { id: 'workspace', displayName: 'Workspace' } })
  await prisma.company.create({ data: { id: 'company', workspaceId: 'workspace', displayName: 'Company', legalName: 'Company', code: 'company' } })
  for (const userId of ['author', 'reader', 'admin']) {
    await prisma.user.create({ data: { id: userId, workspaceId: 'workspace', displayName: userId,
      normalizedDisplayName: userId, username: userId, normalizedUsername: userId, primaryCompanyId: 'company',
      accountType: userId === 'admin' ? 'ADMIN' : 'USER' } })
  }
  await prisma.feedPost.create({ data: {
    id: 'post', workspaceId: 'workspace', companyId: 'company', authorId: 'author', body: 'Новина',
    publishedAt: postAt, recipients: { create: [{ id: 'post_company', type: 'COMPANY', recipientId: 'company' }] },
  } })
  await prisma.feedItem.create({ data: {
    id: 'post_item', workspaceId: 'workspace', companyId: 'company', sourceType: 'POST', sourceId: 'post', sourceVersion: 1,
    postId: 'post', action: 'PUBLISHED', eventKey: 'post_item', visibility: 'COMPANY', safePayload: '{}', occurredAt: postAt,
  } })
  await prisma.feedSourceHead.create({ data: { id: 'post_head', workspaceId: 'workspace', companyId: 'company',
    sourceType: 'POST', sourceId: 'post', sourceVersion: 1, itemId: 'post_item', occurredAt: postAt } })
})

afterEach(async () => {
  vi.useRealTimers()
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

const feedIds = async (principal: AuthPrincipal) =>
  (await service.list(principal, feedListQuerySchema.parse({}))).items.map((item) => item.id)

it('records who archived a post and lets that actor restore it to its place in the feed', async () => {
  await service.archive(author, 'post', 1)
  expect(await prisma.feedPost.findUniqueOrThrow({ where: { id: 'post' } }))
    .toMatchObject({ status: 'ARCHIVED', archivedById: 'author', archivedAt: expect.any(Date) as unknown, version: 2 })
  expect(await feedIds(reader)).toEqual([])
  await expect(service.restore(author, 'post', 1)).rejects.toMatchObject({ status: 409 })
  expect(await service.restore(author, 'post', 2)).toEqual({ id: 'post', version: 3 })
  expect(await prisma.feedPost.findUniqueOrThrow({ where: { id: 'post' } }))
    .toMatchObject({ status: 'PUBLISHED', archivedAt: null, archivedById: null, version: 3 })
  expect(await feedIds(reader)).toEqual(['post'])
  expect(await prisma.feedSourceHead.findFirstOrThrow({ where: { sourceId: 'post' }, include: { item: true } }))
    .toMatchObject({ sourceVersion: 3, occurredAt: postAt, item: { action: 'RESTORED' } })
  expect(await prisma.auditEvent.count({ where: { action: 'feed.post.restored' } })).toBe(1)
  expect(await prisma.outboxEvent.count({ where: { eventType: 'feed.post.restored' } })).toBe(1)
  await expect(service.restore(author, 'post', 3)).rejects.toMatchObject({ status: 404 })
})

it('refuses other users and the actor after 10 minutes; an administrator restores any archived post', async () => {
  await service.archive(author, 'post', 1)
  await expect(service.restore(reader, 'post', 2)).rejects.toMatchObject({ status: 404 })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + ACTOR_RESTORE_WINDOW_MS + 1_000)
  await expect(service.restore(author, 'post', 2)).rejects.toMatchObject({ status: 403 })
  await expect(service.restore(admin, 'post', 1)).rejects.toMatchObject({ status: 409 })
  await service.restore(admin, 'post', 2)
  expect(await feedIds(reader)).toEqual(['post'])
})

it('lists archived posts only for an administrator, flagged with who archived them', async () => {
  const query = feedArchivedListQuerySchema.parse({})
  await expect(service.archivedList(author, query)).rejects.toMatchObject({ status: 403 })
  expect((await service.archivedList(admin, query)).items).toEqual([])
  await service.archive(author, 'post', 1)
  const result = await service.archivedList(admin, query)
  expect(result.nextCursor).toBeNull()
  expect(result.items).toEqual([expect.objectContaining({
    id: 'post', status: 'ARCHIVED', version: 2, canEdit: false,
    hidden: { hiddenAt: expect.any(String) as unknown, hiddenBy: { id: 'author', displayName: 'author' } },
  })])
  // The ordinary feed stays unchanged for the administrator too.
  expect(await feedIds(admin)).toEqual([])
})

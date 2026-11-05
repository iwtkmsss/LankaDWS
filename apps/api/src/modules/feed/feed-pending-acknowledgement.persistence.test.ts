import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { feedListQuerySchema } from '@lankadws/contracts'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { FilesService } from '../files/files.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { FeedService } from './feed.service.js'

let prisma: PrismaClient
let directory: string
let service: FeedService
const reader = { userId: 'reader', workspaceId: 'workspace', allowedCompanyIds: ['company'] } as AuthPrincipal

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-feed-ack-'))
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
  for (const userId of ['author', 'reader']) {
    await prisma.user.create({ data: { id: userId, workspaceId: 'workspace', displayName: userId,
      normalizedDisplayName: userId, username: userId, normalizedUsername: userId, primaryCompanyId: 'company' } })
  }
  await prisma.task.create({ data: { id: 'task', number: '1', workspaceId: 'workspace', companyId: 'company',
    createdById: 'author', reporterId: 'author', title: 'task',
    participants: { create: [{ id: 'task_reader', userId: 'reader', role: 'WATCHER' as const }] } } })
  const taskAt = new Date('2026-10-22T08:00:00Z')
  await prisma.feedItem.create({ data: {
    id: 'task_item', workspaceId: 'workspace', companyId: 'company', sourceType: 'TASK', sourceId: 'task', sourceVersion: 1,
    action: 'UPDATED', eventKey: 'task_item', visibility: 'PARTICIPANTS', safePayload: '{}', occurredAt: taskAt,
    recipients: { create: [{ id: 'task_item_reader', userId: 'reader' }] },
  } })
  await prisma.feedSourceHead.create({ data: { id: 'task_head', workspaceId: 'workspace', companyId: 'company',
    sourceType: 'TASK', sourceId: 'task', sourceVersion: 1, itemId: 'task_item', occurredAt: taskAt } })
  const postAt = new Date('2026-10-20T08:00:00Z')
  await prisma.feedPost.create({ data: {
    id: 'mandatory', workspaceId: 'workspace', companyId: 'company', authorId: 'author', body: 'Прочитайте',
    requiresAcknowledgement: true, acknowledgementVersion: 1, publishedAt: postAt,
    recipients: { create: [{ id: 'mandatory_company', type: 'COMPANY', recipientId: 'company' }] },
    acknowledgementRecipients: { create: [{ id: 'mandatory_reader', userId: 'reader', acknowledgementVersion: 1 }] },
  } })
  await prisma.feedItem.create({ data: {
    id: 'post_item', workspaceId: 'workspace', companyId: 'company', sourceType: 'POST', sourceId: 'mandatory', sourceVersion: 1,
    postId: 'mandatory', action: 'PUBLISHED', eventKey: 'post_item', visibility: 'COMPANIES', safePayload: '{}', occurredAt: postAt,
  } })
  await prisma.feedSourceHead.create({ data: { id: 'post_head', workspaceId: 'workspace', companyId: 'company',
    sourceType: 'POST', sourceId: 'mandatory', sourceVersion: 1, itemId: 'post_item', occurredAt: postAt } })
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it('keeps task cards and advances the read marker while a mandatory post is unconfirmed', async () => {
  const result = await service.list(reader, feedListQuerySchema.parse({}))
  expect(result.attention.pendingAcknowledgements).toBe(1)
  expect(result.items.map((item) => item.itemId)).toEqual(['post_item', 'task_item'])
  expect(result.readMarkers).toEqual([{ companyId: 'company', lastItemId: 'task_item' }])
})

it('reports where the read cursor stood before the page is marked read', async () => {
  const first = await service.list(reader, feedListQuerySchema.parse({}))
  expect(first.readPositions).toEqual([])
  await service.markRead(reader, { markers: first.readMarkers })
  const second = await service.list(reader, feedListQuerySchema.parse({}))
  expect(second.readPositions).toEqual([{ companyId: 'company', lastReadAt: '2026-10-22T08:00:00.000Z' }])
})

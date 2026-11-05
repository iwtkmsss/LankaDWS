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
const viewer = { userId: 'reader', workspaceId: 'workspace', allowedCompanyIds: ['company'] } as AuthPrincipal

async function project(taskId: string, version: number, occurredAt: Date) {
  const itemId = `${taskId}_${version}`
  await prisma.feedItem.create({ data: {
    id: itemId, workspaceId: 'workspace', companyId: 'company',
    sourceType: 'TASK', sourceId: taskId, sourceVersion: version, action: 'PUBLISHED',
    eventKey: itemId, visibility: 'COMPANY', safePayload: '{}', occurredAt,
    recipients: { create: ['author', 'reader', 'other'].map((userId) => ({ id: `${itemId}_${userId}`, userId })) },
  } })
  await prisma.feedSourceHead.upsert({
    where: { id: `head_${taskId}` },
    create: { id: `head_${taskId}`, workspaceId: 'workspace', companyId: 'company',
      sourceType: 'TASK', sourceId: taskId, sourceVersion: version, itemId, occurredAt },
    update: { itemId, sourceVersion: version, occurredAt },
  })
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-feed-pins-'))
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
  for (const userId of ['author', 'reader', 'other']) {
    await prisma.user.create({ data: { id: userId, workspaceId: 'workspace', displayName: userId,
      normalizedDisplayName: userId, username: userId, normalizedUsername: userId, primaryCompanyId: 'company' } })
  }
  for (const [index, taskId] of ['old', 'new'].entries()) {
    const publishedAt = new Date(`2026-10-${20 + index}T08:00:00Z`)
    await prisma.task.create({ data: { id: taskId, number: String(index + 1), workspaceId: 'workspace', companyId: 'company',
      createdById: 'author', reporterId: 'author', title: taskId,
      participants: { create: ['reader', 'other'].map((userId) => ({
        id: `${taskId}_${userId}`, userId, role: 'WATCHER' as const,
      })) } } })
    await project(taskId, 1, publishedAt)
  }
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it('persists private pins across revisions and paginates back into the regular timeline', async () => {
  await service.setTaskPinned(viewer, 'old', true)
  await service.setTaskPinned(viewer, 'old', true)
  expect(await prisma.feedUserItemState.count()).toBe(1)
  const first = await service.list(viewer, feedListQuerySchema.parse({ limit: 1 }))
  expect(first.items).toMatchObject([{ id: 'old', pinnedByMe: true }])
  const second = await service.list(viewer, feedListQuerySchema.parse({ limit: 1, cursor: first.nextCursor }))
  expect(second.items).toMatchObject([{ id: 'new', pinnedByMe: false }])
  expect(second.nextCursor).toBeNull()
  const other = await service.list({ ...viewer, userId: 'other' }, feedListQuerySchema.parse({}))
  expect(other.items.map((item) => item.id)).toEqual(['new', 'old'])
  expect(other.items).toMatchObject([{ pinnedByMe: false }, { pinnedByMe: false }])
  await project('old', 2, new Date('2026-10-20T09:00:00Z'))
  const revised = await service.list(viewer, feedListQuerySchema.parse({}))
  expect(revised.items.map((item) => item.itemId)).toEqual(['old_2', 'new_1'])
  await service.setTaskPinned(viewer, 'old', false)
  await service.setTaskPinned(viewer, 'old', false)
  expect(await prisma.feedUserItemState.count()).toBe(0)
  expect((await service.list(viewer, feedListQuerySchema.parse({}))).items.map((item) => item.id)).toEqual(['new', 'old'])
})

it('shows an administrator only the task cards addressed to them', async () => {
  await prisma.user.create({ data: { id: 'boss', workspaceId: 'workspace', displayName: 'boss', normalizedDisplayName: 'boss',
    username: 'boss', normalizedUsername: 'boss', accountType: 'ADMIN' } })
  const admin = { ...viewer, userId: 'boss', accountType: 'ADMIN' } as AuthPrincipal
  expect((await service.list(admin, feedListQuerySchema.parse({}))).items).toEqual([])
  await prisma.feedItemRecipient.create({ data: { id: 'new_1_boss', itemId: 'new_1', userId: 'boss' } })
  expect((await service.list(admin, feedListQuerySchema.parse({}))).items.map((item) => item.id)).toEqual(['new'])
})

it('never treats a pin as an access grant after audience or company access is revoked', async () => {
  await service.setTaskPinned(viewer, 'old', true)
  await prisma.taskParticipant.updateMany({ where: { taskId: 'old', userId: viewer.userId }, data: { removedAt: new Date() } })
  expect((await service.list(viewer, feedListQuerySchema.parse({}))).items.map((item) => item.id)).toEqual(['new'])
  await expect(service.setTaskPinned(viewer, 'old', true)).rejects.toMatchObject({ status: 404 })
  await expect(service.setTaskPinned({ ...viewer, allowedCompanyIds: [] }, 'new', true)).rejects.toMatchObject({ status: 404 })
})

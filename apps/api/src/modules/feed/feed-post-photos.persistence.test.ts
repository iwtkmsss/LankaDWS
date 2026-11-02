import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { updateFeedPostSchema } from '@lankadws/contracts'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { FilesService } from '../files/files.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { FeedService } from './feed.service.js'

let prisma: PrismaClient
let directory: string
let service: FeedService
const author = { userId: 'author', workspaceId: 'workspace', allowedCompanyIds: ['company'] } as AuthPrincipal

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-post-photos-'))
  const path = join(directory, 'test.db')
  const db = new Database(path)
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const migration of readdirSync(migrations).sort()) {
    if (migration !== 'migration_lock.toml') db.exec(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
  }
  db.close()
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: `file:${path}` }) })
  const files: Pick<FilesService, 'assertAttachable'> = {
    assertAttachable: (...args) => FilesService.prototype.assertAttachable.call({ prisma } as unknown as FilesService, ...args),
  }
  service = new FeedService(prisma as PrismaService, new ScopeService(), files as FilesService)
  await prisma.workspace.create({ data: { id: 'workspace', displayName: 'Workspace' } })
  await prisma.company.create({ data: { id: 'company', workspaceId: 'workspace', displayName: 'Company', legalName: 'Company', code: 'company' } })
  for (const userId of ['author', 'reader']) await prisma.user.create({ data: {
    id: userId, workspaceId: 'workspace', displayName: userId, normalizedDisplayName: userId,
    username: userId, normalizedUsername: userId, primaryCompanyId: 'company',
  } })
  await prisma.feedPost.create({ data: { id: 'post', workspaceId: 'workspace', companyId: 'company',
    authorId: 'author', body: 'Original', recipients: { create: { id: 'audience', type: 'COMPANY', recipientId: 'company' } } } })
  for (let index = 0; index < 7; index++) await prisma.fileObject.create({ data: {
    id: `photo_${index}`, workspaceId: 'workspace', companyId: 'company', storageKey: `photo_${index}`,
    safeFilename: `photo_${index}.png`, declaredMime: 'image/png', detectedMime: 'image/png',
    bytes: 100, sha256: 'hash', scanStatus: 'QUARANTINED', ownerId: 'author',
  } })
  await prisma.fileLink.create({ data: { id: 'existing', fileId: 'photo_0', entityType: 'FEED_POST', entityId: 'post', purpose: 'ATTACHMENT', aclMode: 'INHERIT' } })
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it('appends photos atomically while preserving existing attachments and rejecting stale saves', async () => {
  const input = updateFeedPostSchema.parse({ body: 'Updated', expectedVersion: 1, attachmentIds: ['photo_1', 'photo_1'] })
  await service.update(author, 'post', input)
  expect((await prisma.fileLink.findMany({ orderBy: { fileId: 'asc' } })).map((link) => link.fileId)).toEqual(['photo_0', 'photo_1'])
  await expect(service.update(author, 'post', input)).rejects.toMatchObject({ status: 409 })
  expect(await prisma.fileLink.count()).toBe(2)
  await service.update(author, 'post', updateFeedPostSchema.parse({ body: 'Text only', expectedVersion: 2 }))
  expect(await prisma.fileLink.count()).toBe(2)
})

it('rolls back text and attachments when the total photo limit is exceeded', async () => {
  await expect(service.update(author, 'post', updateFeedPostSchema.parse({ body: 'Too many', expectedVersion: 1,
    attachmentIds: ['photo_1', 'photo_2', 'photo_3', 'photo_4', 'photo_5'],
  }))).rejects.toMatchObject({ code: 'feed_post_photo_limit' })
  expect(await prisma.feedPost.findUnique({ where: { id: 'post' } })).toMatchObject({ body: 'Original', version: 1 })
  expect(await prisma.fileLink.count()).toBe(1)
})

it('rejects non-authors, other owners files and disguised non-image files', async () => {
  const input = updateFeedPostSchema.parse({ body: 'Updated', expectedVersion: 1, attachmentIds: ['photo_1'] })
  await expect(service.update({ ...author, userId: 'reader' }, 'post', input)).rejects.toMatchObject({ status: 404 })
  await prisma.fileObject.update({ where: { id: 'photo_1' }, data: { ownerId: 'reader' } })
  await expect(service.update(author, 'post', input)).rejects.toMatchObject({ code: 'feed_attachment_invalid' })
  await prisma.fileObject.update({ where: { id: 'photo_1' }, data: { ownerId: 'author', detectedMime: 'text/plain' } })
  await expect(service.update(author, 'post', input)).rejects.toMatchObject({ code: 'feed_post_photo_invalid' })
  expect(await prisma.fileLink.count()).toBe(1)
})

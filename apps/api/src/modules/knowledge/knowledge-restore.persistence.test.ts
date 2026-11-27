import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { ACTOR_RESTORE_WINDOW_MS } from '../../common/restore-window.js'
import { KnowledgeService } from './knowledge.service.js'

let prisma: PrismaClient
let directory: string
let service: KnowledgeService
const base = { workspaceId: 'workspace', allowedCompanyIds: ['company'], accountType: 'USER' } as AuthPrincipal
const admin = { ...base, userId: 'admin', accountType: 'ADMIN' as const }
const reader = { ...base, userId: 'reader' }
const other = { ...base, userId: 'other' }

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-knowledge-restore-'))
  const path = join(directory, 'test.db')
  const db = new Database(path)
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const migration of readdirSync(migrations).sort()) {
    if (migration !== 'migration_lock.toml') db.exec(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
  }
  db.close()
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: `file:${path}` }) })
  service = new KnowledgeService(prisma as PrismaService)
  await prisma.workspace.create({ data: { id: 'workspace', displayName: 'Workspace' } })
  await prisma.company.create({ data: { id: 'company', workspaceId: 'workspace', displayName: 'Company', legalName: 'Company', code: 'company' } })
  for (const userId of ['admin', 'reader', 'other']) {
    await prisma.user.create({ data: { id: userId, workspaceId: 'workspace', displayName: userId,
      normalizedDisplayName: userId, username: userId, normalizedUsername: userId, primaryCompanyId: 'company',
      accountType: userId === 'admin' ? 'ADMIN' : 'USER' } })
  }
  await service.create(admin, { slug: 'policy', title: 'Policy', body: 'Read me', companyIds: ['company'], requiresAcknowledgement: true })
})

afterEach(async () => {
  vi.useRealTimers()
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it('restores an archived article like re-publishing the same version, keeping confirmed receipts', async () => {
  await service.acknowledge(reader, 'policy', 1)
  expect((await service.pendingAcknowledgements(other)).requiredPendingCount).toBe(1)
  expect(await service.archive(admin, 'policy', 1)).toEqual({ archived: true, version: 2 })
  expect(await prisma.knowledgeArticle.findFirstOrThrow({ where: { slug: 'policy' } }))
    .toMatchObject({ status: 'ARCHIVED', archivedById: 'admin', archivedAt: expect.any(Date) as unknown })
  // Archiving removes the reminder.
  expect((await service.pendingAcknowledgements(other)).requiredPendingCount).toBe(0)
  expect((await service.list(reader)).items).toEqual([])
  expect((await service.archivedList(admin)).items).toEqual([expect.objectContaining({
    slug: 'policy', version: 2, hidden: { hiddenAt: expect.any(String) as unknown, hiddenBy: { id: 'admin', displayName: 'admin' } },
  })])
  await expect(service.archivedList(reader)).rejects.toMatchObject({ status: 403 })
  await expect(service.restore(admin, 'policy', 1)).rejects.toMatchObject({ status: 409 })
  expect(await service.restore(admin, 'policy', 2)).toEqual({ id: expect.any(String) as unknown, slug: 'policy', version: 3 })
  expect((await service.list(reader)).items).toEqual([expect.objectContaining({ slug: 'policy', version: 3, hasAcknowledged: true })])
  expect((await service.pendingAcknowledgements(reader)).requiredPendingCount).toBe(0)
  expect((await service.pendingAcknowledgements(other)).requiredPendingCount).toBe(1)
  expect((await service.archivedList(admin)).items).toEqual([])
  expect(await prisma.auditEvent.count({ where: { action: 'knowledge.restored' } })).toBe(1)
  await expect(service.restore(admin, 'policy', 3)).rejects.toMatchObject({ status: 404 })
})

it('lets the actor who archived it undo for 10 minutes only and refuses everyone else', async () => {
  await service.archive(admin, 'policy', 1)
  // An actor who is no longer an administrator still has the 10-minute undo.
  await prisma.knowledgeArticle.updateMany({ where: { slug: 'policy' }, data: { archivedById: 'reader' } })
  await expect(service.restore(other, 'policy', 2)).rejects.toMatchObject({ status: 404 })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + ACTOR_RESTORE_WINDOW_MS + 1_000)
  await expect(service.restore(reader, 'policy', 2)).rejects.toMatchObject({ status: 403 })
  vi.useRealTimers()
  expect(await service.restore(reader, 'policy', 2)).toMatchObject({ version: 3 })
})

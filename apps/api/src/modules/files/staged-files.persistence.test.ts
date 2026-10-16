import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { resetConfigForTests } from '../../config/config.js'
import { JobsService } from '../jobs/jobs.service.js'
import { FilesService } from './files.service.js'
import { deleteStoredFile } from './storage.js'

const principal = { userId: 'me', workspaceId: 'workspace', allowedCompanyIds: ['company'] } as AuthPrincipal
let db: PrismaClient
let files: FilesService
let jobs: JobsService
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lankadws-draft-files-'))
  vi.stubEnv('FILE_STORAGE_DIR', join(root, 'clean'))
  vi.stubEnv('FILE_QUARANTINE_DIR', join(root, 'quarantine'))
  vi.stubEnv('MALWARE_SCANNER', 'development-clean')
  resetConfigForTests()
  db = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: ':memory:' }) })
  await db.$executeRawUnsafe(`CREATE TABLE FileObject (
    id TEXT PRIMARY KEY, workspaceId TEXT, companyId TEXT, storageKey TEXT UNIQUE, safeFilename TEXT,
    declaredMime TEXT, detectedMime TEXT, bytes INTEGER, sha256 TEXT, scanStatus TEXT DEFAULT 'QUARANTINED',
    ownerId TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME)`)
  await db.$executeRawUnsafe(`CREATE TABLE FileLink (id TEXT PRIMARY KEY, fileId TEXT, entityType TEXT, entityId TEXT, purpose TEXT, aclMode TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`)
  await db.$executeRawUnsafe(`CREATE TABLE FeedFileShare (id TEXT PRIMARY KEY, fileId TEXT)`)
  await db.$executeRawUnsafe(`CREATE TABLE AuditEvent (id TEXT PRIMARY KEY, workspaceId TEXT, companyId TEXT,
    actorType TEXT, actorId TEXT, action TEXT, entityType TEXT, entityId TEXT, result TEXT, risk TEXT,
    safeDiffJson TEXT DEFAULT '{}', reasonCode TEXT, correlationId TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`)
  await db.$executeRawUnsafe(`CREATE TABLE BackgroundJob (
    id TEXT PRIMARY KEY, type TEXT, entityType TEXT, entityId TEXT, state TEXT DEFAULT 'QUEUED', safePayload TEXT,
    progress INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, maxAttempts INTEGER DEFAULT 5,
    runAt DATETIME DEFAULT CURRENT_TIMESTAMP, leaseOwner TEXT, leaseUntil DATETIME, lastErrorCode TEXT,
    idempotencyKey TEXT UNIQUE, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME)`)
  jobs = new JobsService(db as never, {} as never)
  files = new FilesService(db as never, jobs, { assertCompany: () => 'company' } as never, {} as never, {} as never)
})

afterEach(async () => {
  await db?.$disconnect()
  await rm(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  resetConfigForTests()
})

async function createFile(fileId = 'file', staged = true) {
  const key = `company/${fileId}`
  for (const directory of ['clean', 'quarantine']) {
    await mkdir(join(root, directory, 'company'), { recursive: true })
    await writeFile(join(root, directory, key), 'contents')
  }
  await db.fileObject.create({ data: {
    id: fileId, workspaceId: 'workspace', companyId: 'company', ownerId: 'me', storageKey: key,
    safeFilename: 'report.txt', declaredMime: 'text/plain', detectedMime: 'text/plain', bytes: 8,
    sha256: 'hash', scanStatus: 'CLEAN', createdAt: new Date(Date.now() - 2 * 86_400_000),
  } })
  if (staged) await jobs.enqueue('file.staged.cleanup', 'FILE', fileId, { disposable: true }, `file-staged-cleanup:${fileId}`)
  return key
}

function worker() {
  return jobs as unknown as { cleanupStagedFile: (id: string) => Promise<void>; markDevelopmentScan: (id: string) => Promise<void> }
}

describe('staged attachment storage lifecycle', () => {
  it('removes discarded uploads from the database, clean storage and quarantine', async () => {
    const key = await createFile()
    await jobs.enqueue('file.scan', 'FILE', 'file', {}, 'scan:file')
    expect(await files.discardStagedAttachment(principal, 'file')).toEqual({ discarded: true })
    expect(await db.fileObject.findUnique({ where: { id: 'file' } })).toBeNull()
    for (const directory of ['clean', 'quarantine']) {
      await expect(readFile(join(root, directory, key))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    // An already claimed scan cannot recreate a discarded file.
    await worker().markDevelopmentScan('file')
    expect(await db.backgroundJob.count({ where: { state: { not: 'SUCCEEDED' } } })).toBe(0)
    expect(await files.discardStagedAttachment(principal, 'file')).toEqual({ discarded: false })
  })

  it('keeps sent files even if an edit later removes their last message link', async () => {
    const key = await createFile()
    await db.$transaction(async (tx) => {
      await files.retainStagedAttachments(tx, principal, ['file'])
      await tx.fileLink.create({ data: { id: 'link', fileId: 'file', entityType: 'MESSAGE', entityId: 'message', purpose: 'ATTACHMENT', aclMode: 'ENTITY' } })
    })
    await db.fileLink.deleteMany({})
    expect(await files.discardStagedAttachment(principal, 'file')).toEqual({ discarded: false })
    await worker().cleanupStagedFile('file')
    expect(await readFile(join(root, 'clean', key), 'utf8')).toBe('contents')
    expect(await db.fileObject.count()).toBe(1)
  })

  it('refuses to send an attachment discarded before the send transaction', async () => {
    await createFile()
    await files.discardStagedAttachment(principal, 'file')
    await expect(db.$transaction((tx) => files.retainStagedAttachments(tx, principal, ['file'])))
      .rejects.toMatchObject({ code: 'attachment_unavailable' })
    expect(await db.fileLink.count()).toBe(0)
  })

  it('preserves other owners, other workspaces, Drive originals and linked files', async () => {
    const key = await createFile()
    for (const caller of [{ ...principal, userId: 'other' }, { ...principal, workspaceId: 'other' }]) {
      expect(await files.discardStagedAttachment(caller, 'file')).toEqual({ discarded: false })
    }
    await createFile('drive-original', false)
    expect(await files.discardStagedAttachment(principal, 'drive-original')).toEqual({ discarded: false })
    await db.fileLink.create({ data: { id: 'document-link', fileId: 'file', entityType: 'DOCUMENT', entityId: 'document', purpose: 'CONTENT', aclMode: 'INHERIT' } })
    expect(await files.discardStagedAttachment(principal, 'file')).toEqual({ discarded: false })
    expect(await readFile(join(root, 'clean', key), 'utf8')).toBe('contents')
  })

  it('cleans abandoned staged files after 24 hours while preserving linked files', async () => {
    const key = await createFile()
    await db.fileObject.update({ where: { id: 'file' }, data: { createdAt: new Date() } })
    await worker().cleanupStagedFile('file')
    expect(await db.fileObject.count()).toBe(1)
    await db.fileObject.update({ where: { id: 'file' }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } })
    await worker().cleanupStagedFile('file')
    expect(await db.fileObject.count()).toBe(0)
    await expect(readFile(join(root, 'clean', key))).rejects.toMatchObject({ code: 'ENOENT' })
    await createFile('linked')
    await db.fileLink.create({ data: { id: 'link', fileId: 'linked', entityType: 'MESSAGE', entityId: 'message', purpose: 'ATTACHMENT', aclMode: 'ENTITY' } })
    await worker().cleanupStagedFile('linked')
    expect(await db.fileObject.count()).toBe(1)
  })

  it('preserves legacy files whose send history was not tracked', async () => {
    const key = await createFile('legacy', false)
    await jobs.enqueue('file.staged.cleanup', 'FILE', 'legacy', {}, 'file-staged-cleanup:legacy')
    expect(await files.discardStagedAttachment(principal, 'legacy')).toEqual({ discarded: false })
    await worker().cleanupStagedFile('legacy')
    expect(await readFile(join(root, 'clean', key), 'utf8')).toBe('contents')
  })

  it('schedules cleanup for new uploads and shares storage with independent Drive references', async () => {
    const data = Buffer.from('contents')
    const upload = await files.stageUpload(principal, { buffer: data, size: data.length, mimetype: 'text/plain', originalname: 'report.txt' })
    expect(await db.backgroundJob.findUnique({ where: { idempotencyKey: `file-staged-cleanup:${upload.id}` } })).toMatchObject({ state: 'QUEUED' })
    const originalKey = await createFile('drive-original', false)
    const copy = await files.copyForPrincipal(principal, 'drive-original', 'company')
    expect(copy.id).not.toBe('drive-original')
    const copyFile = await db.fileObject.findUniqueOrThrow({ where: { id: copy.id } })
    const originalStorage = await stat(join(root, 'clean', originalKey), { bigint: true })
    const copyStorage = await stat(join(root, 'clean', copyFile.storageKey), { bigint: true })
    expect([copyStorage.dev, copyStorage.ino]).toEqual([originalStorage.dev, originalStorage.ino])
    expect(await files.discardStagedAttachment(principal, copy.id)).toEqual({ discarded: true })
    expect(await db.fileObject.findUnique({ where: { id: 'drive-original' } })).not.toBeNull()
    expect(await readFile(join(root, 'clean', originalKey), 'utf8')).toBe('contents')
  })

  it('keeps a sent chat reference readable after physical removal of the Drive path', async () => {
    const originalKey = await createFile('drive-original', false)
    const attachment = await files.copyForPrincipal(principal, 'drive-original', 'company')
    await db.$transaction((tx) => files.retainStagedAttachments(tx, principal, [attachment.id]))
    await deleteStoredFile(originalKey)
    await expect(files.download(principal, attachment.id)).resolves.toMatchObject({ bytes: Buffer.from('contents'), name: 'report.txt' })
    expect(await files.discardStagedAttachment(principal, attachment.id)).toEqual({ discarded: false })
  })

  it('removes only the newly created hard link if creating its metadata fails', async () => {
    const originalKey = await createFile('drive-original', false)
    vi.spyOn(db.fileObject, 'create').mockRejectedValueOnce(new Error('database_unavailable'))
    await expect(files.copyForPrincipal(principal, 'drive-original', 'company')).rejects.toThrow('database_unavailable')
    expect(await readdir(join(root, 'clean', 'company'))).toEqual(['drive-original'])
    expect((await stat(join(root, 'clean', originalKey), { bigint: true })).nlink).toBe(1n)
  })
})

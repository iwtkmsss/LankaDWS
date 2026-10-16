import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { FILE_UPLOAD_MIME_TYPES, MAX_FILE_UPLOAD_BYTES } from '@lankadws/contracts'
import { resetConfigForTests } from '../../config/config.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { FilesService } from './files.service.js'
import { readCleanFile } from './storage.js'

vi.mock('./storage.js', () => ({
  readCleanFile: vi.fn(),
  writeQuarantine: vi.fn(),
}))

const principal: AuthPrincipal = {
  userId: 'viewer',
  workspaceId: 'workspace-1',
  username: 'viewer',
  displayName: 'Viewer',
  primaryCompanyId: 'company-1',
  accountType: 'USER',
  allowedCompanyIds: ['company-1'],
  authorizationVersion: 1,
  sessionId: 'session-1',
  authAssurance: 1,
  restricted: false,
}

describe('FilesService corporate uploads', () => {
  const prisma = { fileObject: { create: vi.fn() } }
  const jobs = { enqueue: vi.fn() }
  const scope = { assertCompany: vi.fn(() => 'company-1') }
  const service = new FilesService(prisma as never, jobs as never, scope as never, {} as never, {} as never)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MAX_UPLOAD_BYTES', String(MAX_FILE_UPLOAD_BYTES))
    vi.stubEnv('ALLOWED_UPLOAD_MIME', FILE_UPLOAD_MIME_TYPES.join(','))
    resetConfigForTests()
  })
  afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests() })

  it.each([
    'Звіт їєґ — жовтень.txt',
    'Договір № 15.txt',
    'Фото 📎 中文.txt',
    'café.txt',
    'report.txt',
  ])('restores the multipart UTF-8 filename %s before persistence and response', async (filename) => {
    const buffer = Buffer.from('Document contents')
    const uploaded = await service.upload(principal, undefined, {
      originalname: Buffer.from(filename, 'utf8').toString('latin1'),
      buffer, size: buffer.length, mimetype: 'text/plain',
    })
    const safeFilename = filename.normalize('NFKC')
    expect(uploaded.fileName).toBe(safeFilename)
    expect(prisma.fileObject.create.mock.calls).toMatchObject([[{ data: { safeFilename } }]])
  })

  it.each(['Звіт їєґ.txt', 'Фото 📎 中文.txt', 'café.txt', 'Ã.txt'])('preserves an already decoded filename %s', async (originalname) => {
    const buffer = Buffer.from('Document contents')
    await expect(service.upload(principal, undefined, {
      originalname, buffer, size: buffer.length, mimetype: 'text/plain',
    })).resolves.toMatchObject({ fileName: originalname })
  })

  it('sanitizes forbidden characters after decoding the multipart filename', async () => {
    const buffer = Buffer.from('Document contents')
    await expect(service.upload(principal, undefined, {
      originalname: Buffer.from('Звіт:дані\u0001.txt', 'utf8').toString('latin1'),
      buffer, size: buffer.length, mimetype: 'text/plain',
    })).resolves.toMatchObject({ fileName: 'Звіт_дані_.txt' })
  })

  it.each([
    ['report.csv', Buffer.from('name,total\nReport,10'), 'text/csv'],
    ['report.json', Buffer.from('{"total":10}'), 'application/json'],
    ['report.txt', Buffer.from('Корпоративний документ'), 'text/plain'],
    ['report.xml', Buffer.from('<report>10</report>'), 'application/xml'],
    ['archive.gz', gzipSync('arbitrary file contents'), 'application/gzip'],
  ])('accepts %s independently of the browser MIME', async (originalname, buffer, mimeType) => {
    await expect(service.upload(principal, undefined, {
      originalname, buffer, size: buffer.length, mimetype: 'application/octet-stream',
    })).resolves.toMatchObject({ mimeType, scanStatus: 'QUARANTINED' })
    expect(jobs.enqueue).toHaveBeenCalledWith('file.scan', 'FILE', expect.any(String), {}, expect.any(String))
  })

  it.each([
    ['old.doc', 'application/msword'], ['old.xls', 'application/vnd.ms-excel'], ['old.ppt', 'application/vnd.ms-powerpoint'],
  ])('accepts legacy Office container %s', async (originalname, mimeType) => {
    const buffer = Buffer.alloc(512)
    Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(buffer)
    await expect(service.upload(principal, undefined, {
      originalname, buffer, size: buffer.length, mimetype: 'application/octet-stream',
    })).resolves.toMatchObject({ mimeType })
  })

  it.each([
    ['renamed.csv', Buffer.from([0, 1, 2, 3])],
    ['bad.json', Buffer.from('not JSON')],
    ['unknown.bin', Buffer.from('unknown format')],
  ])('rejects unsupported content %s before persistence', async (originalname, buffer) => {
    await expect(service.upload(principal, undefined, {
      originalname, buffer, size: buffer.length, mimetype: 'application/octet-stream',
    })).rejects.toMatchObject({ code: 'file_type' })
    expect(prisma.fileObject.create).not.toHaveBeenCalled()
    expect(jobs.enqueue).not.toHaveBeenCalled()
  })

  it('accepts the 100 MB boundary and rejects larger or empty files', async () => {
    const buffer = Buffer.from('contents')
    const file = { buffer, originalname: 'report.txt', mimetype: 'text/plain', size: MAX_FILE_UPLOAD_BYTES }
    await expect(service.upload(principal, undefined, file)).resolves.toMatchObject({ bytes: MAX_FILE_UPLOAD_BYTES })
    await expect(service.upload(principal, undefined, { ...file, size: MAX_FILE_UPLOAD_BYTES + 1 })).rejects.toMatchObject({ code: 'file_size' })
    await expect(service.upload(principal, undefined, { ...file, size: 0 })).rejects.toMatchObject({ code: 'file_empty' })
  })
})

describe('FilesService Drive administrator access', () => {
  it.each(['USER', 'ADMIN'] as const)('keeps document download aligned with %s visibility', async (accountType) => {
    vi.clearAllMocks()
    const prisma = {
      fileObject: { findFirst: vi.fn().mockResolvedValue({ id: 'document-file', workspaceId: principal.workspaceId, companyId: 'company-1', ownerId: 'colleague', scanStatus: 'CLEAN', storageKey: 'document', safeFilename: 'report.pdf', detectedMime: 'application/pdf' }) },
      feedFileShare: { findFirst: vi.fn().mockResolvedValue(null) },
      fileLink: { findMany: vi.fn().mockResolvedValue([{ entityType: 'DOCUMENT', entityId: 'confidential-document' }]) },
      document: { findFirst: vi.fn().mockResolvedValue(accountType === 'ADMIN' ? { id: 'confidential-document' } : null) },
      documentAcl: { findFirst: vi.fn().mockResolvedValue(null) },
      auditEvent: { create: vi.fn() },
    }
    const sharing = { grantsFor: vi.fn().mockResolvedValue({ documentIds: new Set() }) }
    vi.mocked(readCleanFile).mockResolvedValue(Buffer.from('contents'))
    const service = new FilesService(prisma as never, {} as never, {} as never, {} as never, sharing as never)
    const download = service.download({ ...principal, accountType }, 'document-file')
    if (accountType === 'ADMIN') await expect(download).resolves.toMatchObject({ name: 'report.pdf' })
    else await expect(download).rejects.toMatchObject({ status: 404 })
    expect(prisma.document.findFirst).toHaveBeenCalledWith({ where: {
      id: { in: ['confidential-document'] }, companyId: { in: ['company-1'] },
      ...(accountType === 'ADMIN' ? {} : { OR: [{ ownerId: principal.userId }, { confidentiality: { in: ['GENERAL', 'INTERNAL'] } }] }),
    }, select: { id: true } })
  })
})

describe('FilesService avatar access', () => {
  const prisma = {
    fileObject: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.fileObject.findFirst.mockResolvedValue({
      id: 'file_avatar',
      workspaceId: 'workspace-1',
      companyId: null,
      storageKey: 'workspace/avatar',
      safeFilename: 'avatar.webp',
      detectedMime: 'image/webp',
      scanStatus: 'CLEAN',
    })
    prisma.user.findFirst.mockResolvedValue({ id: 'avatar-owner' })
    vi.mocked(readCleanFile).mockResolvedValue(Buffer.from('avatar'))
  })

  it('allows a colleague to read the current avatar of a user in the same workspace', async () => {
    const service = new FilesService(prisma as never, {} as never, {} as never, {} as never, {} as never)

    await expect(service.downloadAvatar(principal, 'file_avatar')).resolves.toMatchObject({
      bytes: Buffer.from('avatar'),
      mime: 'image/webp',
      name: 'avatar.webp',
    })
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        avatarAsset: { in: ['file_avatar', '/api/v1/me/avatar/file_avatar'] },
      },
      select: { id: true },
    })
  })

  it('does not expose an unassigned file as an avatar', async () => {
    prisma.user.findFirst.mockResolvedValue(null)
    const service = new FilesService(prisma as never, {} as never, {} as never, {} as never, {} as never)

    await expect(service.downloadAvatar(principal, 'file_avatar')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    })
    expect(readCleanFile).not.toHaveBeenCalled()
  })
})

describe('FilesService ZIP archives', () => {
  function service() {
    const files = new FilesService({} as never, {} as never, {} as never, {} as never, {} as never)
    const authorize = vi.spyOn(files as unknown as { authorizedFile: (p: AuthPrincipal, id: string) => Promise<unknown> }, 'authorizedFile')
    return { files, authorize }
  }
  it('checks each file and preserves duplicate filenames with suffixes', async () => {
    const { files, authorize } = service()
    authorize.mockResolvedValue({ scanStatus: 'CLEAN', safeFilename: 'Звіт.pdf', storageKey: 'clean/report' })
    const result = await files.archiveFiles(principal, ['one', 'two', 'one'])
    expect(authorize.mock.calls.map((call) => call[1])).toEqual(['one', 'two'])
    expect(result.map((file) => file.name)).toEqual(['Звіт.pdf', 'Звіт (2).pdf'])
  })
  it('rejects empty, oversized, inaccessible and unscanned archives', async () => {
    const { files, authorize } = service()
    await expect(files.archiveFiles(principal, [])).rejects.toMatchObject({ status: 400 })
    await expect(files.archiveFiles(principal, Array.from({ length: 21 }, (_, i) => String(i)))).rejects.toMatchObject({ status: 400 })
    authorize.mockRejectedValueOnce(new Error('inaccessible'))
    await expect(files.archiveFiles(principal, ['private'])).rejects.toThrow('inaccessible')
    authorize.mockResolvedValue({ scanStatus: 'QUARANTINED' })
    await expect(files.archiveFiles(principal, ['pending'])).rejects.toMatchObject({ status: 403 })
  })
})

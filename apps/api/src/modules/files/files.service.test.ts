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
const { officePreviewPdf, OfficePreviewUnavailable } = vi.hoisted(() => ({ officePreviewPdf: vi.fn(), OfficePreviewUnavailable: class OfficePreviewUnavailable extends Error {} }))
vi.mock('./office-preview.js', () => ({
  officePreviewPdf,
  OfficePreviewUnavailable,
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
      ...(accountType === 'ADMIN' ? {} : { ownerId: principal.userId }),
    }, select: { id: true } })
  })
})

describe('FilesService Feed post attachment access', () => {
  it('opens a post attachment only for its author and addressed recipients', async () => {
    const prisma = {
      fileObject: { findFirst: vi.fn().mockResolvedValue({ id: 'attachment', workspaceId: principal.workspaceId, companyId: 'company-1', ownerId: 'author', scanStatus: 'CLEAN', storageKey: 'attachment', safeFilename: 'plan.pdf', detectedMime: 'application/pdf' }) },
      feedFileShare: { findFirst: vi.fn().mockResolvedValue(null) },
      fileLink: { findMany: vi.fn().mockResolvedValue([{ entityType: 'FEED_POST', entityId: 'direct-post' }]) },
      feedPost: { findFirst: vi.fn().mockResolvedValue(null) },
      auditEvent: { create: vi.fn() },
    }
    const service = new FilesService(prisma as never, {} as never, {} as never, {} as never, {} as never)
    // A post addressed to other people stays closed even though its company is the reader's company.
    await expect(service.download(principal, 'attachment')).rejects.toMatchObject({ status: 404 })
    expect(prisma.feedPost.findFirst).toHaveBeenCalledWith({ where: {
      id: { in: ['direct-post'] }, workspaceId: principal.workspaceId, status: 'PUBLISHED', OR: [
        { authorId: principal.userId },
        { recipients: { some: { OR: [{ type: 'COMPANY', recipientId: { in: principal.allowedCompanyIds } }, { type: 'USER', recipientId: principal.userId }] } } },
      ],
    }, select: { id: true } })
    prisma.feedPost.findFirst.mockResolvedValue({ id: 'direct-post' })
    vi.mocked(readCleanFile).mockResolvedValue(Buffer.from('pdf'))
    await expect(service.download(principal, 'attachment')).resolves.toMatchObject({ name: 'plan.pdf' })
  })
})

describe('FilesService feedback attachment access', () => {
  it.each(['USER', 'ADMIN'] as const)('allows only an admin to download another user’s private ticket attachment (%s)', async (accountType) => {
    const prisma = {
      fileObject: { findFirst: vi.fn().mockResolvedValue({ id: 'private-file', workspaceId: principal.workspaceId, companyId: null, ownerId: 'sender', scanStatus: 'CLEAN', storageKey: 'private', safeFilename: 'feedback.txt', detectedMime: 'text/plain' }) },
      feedFileShare: { findFirst: vi.fn().mockResolvedValue(null) },
      fileLink: { findMany: vi.fn().mockResolvedValue([{ entityType: 'FEEDBACK_TICKET', entityId: 'ticket' }]) },
      feedbackTicket: { findFirst: vi.fn().mockResolvedValue({ id: 'ticket' }) },
      auditEvent: { create: vi.fn() },
    }
    vi.mocked(readCleanFile).mockResolvedValue(Buffer.from('private feedback'))
    const service = new FilesService(prisma as never, {} as never, {} as never, {} as never, {} as never)
    const result = service.download({ ...principal, accountType }, 'private-file')
    if (accountType === 'ADMIN') {
      await expect(result).resolves.toMatchObject({ name: 'feedback.txt' })
      expect(prisma.feedbackTicket.findFirst).toHaveBeenCalledWith({ where: { id: { in: ['ticket'] }, workspaceId: principal.workspaceId, status: 'ACTIVE' }, select: { id: true } })
      prisma.feedbackTicket.findFirst.mockResolvedValue(null)
      await expect(service.download({ ...principal, accountType }, 'private-file')).rejects.toMatchObject({ status: 404 })
    } else {
      await expect(result).rejects.toMatchObject({ status: 404 })
      expect(prisma.feedbackTicket.findFirst).not.toHaveBeenCalled()
    }
  })
})

describe('FilesService Feed comment photo access', () => {
  function setup() {
    const prisma = {
      fileObject: { findFirst: vi.fn().mockResolvedValue({ id: 'photo', workspaceId: principal.workspaceId, companyId: 'company-1', ownerId: 'author', scanStatus: 'CLEAN', storageKey: 'photo', safeFilename: 'screen.png', detectedMime: 'image/png' }) },
      feedFileShare: { findFirst: vi.fn().mockResolvedValue(null) },
      fileLink: { findMany: vi.fn().mockResolvedValue([{ entityType: 'FEED_COMMENT', entityId: 'comment' }]) },
      comment: { findMany: vi.fn().mockResolvedValue([{ entityId: 'post' }]) },
      feedPost: { findFirst: vi.fn().mockResolvedValue({ id: 'post' }) },
      auditEvent: { create: vi.fn() },
    }
    vi.mocked(readCleanFile).mockResolvedValue(Buffer.from('image'))
    return { prisma, service: new FilesService(prisma as never, {} as never, {} as never, {} as never, {} as never) }
  }

  it('resolves the live comment and requires the current post audience', async () => {
    const { prisma, service } = setup()
    await expect(service.download(principal, 'photo')).resolves.toMatchObject({ name: 'screen.png' })
    expect(prisma.comment.findMany).toHaveBeenCalledWith({ where: { id: { in: ['comment'] }, workspaceId: principal.workspaceId, entityType: 'FEED_POST', deletedAt: null }, select: { entityId: true } })
    expect(prisma.feedPost.findFirst).toHaveBeenCalledWith({ where: {
      id: { in: ['post'] }, workspaceId: principal.workspaceId, status: 'PUBLISHED', OR: [
        { authorId: principal.userId },
        { recipients: { some: { OR: [{ type: 'COMPANY', recipientId: { in: principal.allowedCompanyIds } }, { type: 'USER', recipientId: principal.userId }] } } },
      ],
    }, select: { id: true } })
    prisma.feedPost.findFirst.mockResolvedValue(null)
    await expect(service.download(principal, 'photo')).rejects.toMatchObject({ status: 404 })
  })

  it('denies deleted comments and keeps unscanned photos unavailable', async () => {
    const { prisma, service } = setup()
    prisma.comment.findMany.mockResolvedValue([])
    await expect(service.download(principal, 'photo')).rejects.toMatchObject({ status: 404 })
    prisma.comment.findMany.mockResolvedValue([{ entityId: 'post' }])
    prisma.fileObject.findFirst.mockResolvedValue({ ...await prisma.fileObject.findFirst(), scanStatus: 'QUARANTINED' })
    await expect(service.download(principal, 'photo')).rejects.toMatchObject({ status: 403 })
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

describe('FilesService Office preview', () => {
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const clean = { id: 'file', companyId: 'company-1', scanStatus: 'CLEAN', detectedMime: docx, bytes: 1024, sha256: 'a'.repeat(64), storageKey: 'company-1/file', safeFilename: 'Звіт.v2.docx' }
  function service() {
    const prisma = { auditEvent: { create: vi.fn() } }
    const files = new FilesService(prisma as never, {} as never, {} as never, {} as never, {} as never)
    const authorize = vi.spyOn(files as unknown as { authorizedFile: (p: AuthPrincipal, id: string) => Promise<unknown> }, 'authorizedFile')
    return { files, authorize, prisma }
  }
  beforeEach(() => { officePreviewPdf.mockReset() })

  it('returns the converted PDF under the download access rules and audits the read', async () => {
    const { files, authorize, prisma } = service()
    authorize.mockResolvedValue(clean)
    officePreviewPdf.mockResolvedValue('/tmp/office-previews/a.pdf')
    await expect(files.officePreview(principal, 'file')).resolves.toEqual({ path: '/tmp/office-previews/a.pdf', name: 'Звіт.v2.pdf' })
    expect(officePreviewPdf).toHaveBeenCalledWith({ storageKey: 'company-1/file', sha256: clean.sha256, mime: docx })
    expect(prisma.auditEvent.create.mock.calls).toMatchObject([[{ data: { action: 'file.downloaded', entityId: 'file' } }]])
  })

  it('refuses unscanned, non-Office and oversized files before converting', async () => {
    const { files, authorize } = service()
    authorize.mockResolvedValueOnce({ ...clean, scanStatus: 'QUARANTINED' })
    await expect(files.officePreview(principal, 'file')).rejects.toMatchObject({ status: 403 })
    authorize.mockResolvedValueOnce({ ...clean, detectedMime: 'application/pdf' })
    await expect(files.officePreview(principal, 'file')).rejects.toMatchObject({ status: 400 })
    authorize.mockResolvedValueOnce({ ...clean, bytes: 31 * 1024 * 1024 })
    await expect(files.officePreview(principal, 'file')).rejects.toMatchObject({ status: 400 })
    expect(officePreviewPdf).not.toHaveBeenCalled()
  })

  it('reports an unavailable converter as a temporary service problem', async () => {
    const { files, authorize, prisma } = service()
    authorize.mockResolvedValue(clean)
    officePreviewPdf.mockImplementation(() => Promise.reject(new OfficePreviewUnavailable('ConverterMissing')))
    await expect(files.officePreview(principal, 'file')).rejects.toMatchObject({ status: 503 })
    expect(prisma.auditEvent.create).not.toHaveBeenCalled()
  })
})

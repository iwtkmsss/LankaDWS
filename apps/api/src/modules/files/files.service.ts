import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { extname } from 'node:path'
import { id } from '../../common/crypto.js'
import { badRequest, forbidden, notFound } from '../../common/errors.js'
import { isGlobalAdmin, type AuthPrincipal } from '../../common/request-context.js'
import { getConfig } from '../../config/config.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { JobsService } from '../jobs/jobs.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { DriveSharingService } from '../documents/drive-sharing.service.js'
import { deleteStoredFile, linkCleanFile, readCleanFile, writeQuarantine } from './storage.js'

export interface UploadedBinary {
  buffer: Buffer
  size: number
  mimetype: string
  originalname: string
}

const legacyOfficeMime: Record<string, string> = {
  '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint',
}
const textFileMime: Record<string, string> = {
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.xml': 'application/xml',
}

function decodeUploadFilename(filename: string): string {
  // Multer reads ordinary multipart filename parameters as Latin-1, while browsers send UTF-8.
  // Already-decoded Unicode and genuine Latin-1 names must remain intact.
  if ([...filename].some((character) => character.codePointAt(0)! > 255)) return filename
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(filename, 'latin1'))
  } catch {
    return filename
  }
}

function detectTextMime(file: UploadedBinary): string | undefined {
  const mime = textFileMime[extname(file.originalname).toLowerCase()]
    ?? (file.mimetype === 'text/plain' ? 'text/plain' : undefined)
  if (!mime) return undefined
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer)
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index)
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) return undefined
    }
    if (mime === 'application/json') JSON.parse(text)
    return mime
  } catch {
    return undefined
  }
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly scope: ScopeService,
    private readonly taskAccess: TaskAccessService,
    private readonly driveSharing: DriveSharingService,
  ) {}

  async upload(principal: AuthPrincipal, companyInput: string | undefined, file: UploadedBinary) {
    const companyId = this.scope.assertCompany(principal, companyInput)
    return this.persistUpload(principal, companyId, file)
  }

  async uploadAvatar(principal: AuthPrincipal, file: UploadedBinary) {
    return this.persistUpload(principal, principal.primaryCompanyId, file)
  }

  async uploadCompanyLogo(principal: AuthPrincipal, file: UploadedBinary) {
    if (!file?.buffer || file.size <= 0 || file.size > 2 * 1024 * 1024) throw badRequest('Зображення має бути не більше 2 МБ.')
    const detected = await fileTypeFromBuffer(file.buffer)
    if (!detected || !['image/png', 'image/jpeg', 'image/webp'].includes(detected.mime)) throw badRequest('Виберіть зображення PNG, JPEG або WebP.')
    return this.persistUpload(principal, null, file)
  }

  async downloadCompanyLogo(principal: AuthPrincipal, companyId: string, fileId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, workspaceId: principal.workspaceId, logoFileId: fileId, ...(!isGlobalAdmin(principal) ? { isActive: true } : {}) },
      select: { id: true },
    })
    if (!company) throw notFound()
    const file = await this.prisma.fileObject.findFirst({ where: { id: fileId, workspaceId: principal.workspaceId } })
    if (!file) throw notFound()
    if (file.scanStatus !== 'CLEAN') throw forbidden('Файл перебуває на перевірці або недоступний.')
    if (!file.detectedMime || !['image/png', 'image/jpeg', 'image/webp'].includes(file.detectedMime)) throw notFound()
    return { bytes: await readCleanFile(file.storageKey), mime: file.detectedMime }
  }

  private async persistUpload(principal: AuthPrincipal, companyId: string | null, file: UploadedBinary) {
    if (!file || file.size <= 0) throw badRequest('file_empty')
    if (file.size > getConfig().MAX_UPLOAD_BYTES) throw badRequest('file_size')
    const detected = await fileTypeFromBuffer(file.buffer)
    const detectedMime = detected?.mime === 'application/x-cfb'
      ? legacyOfficeMime[extname(file.originalname).toLowerCase()]
      : detected?.mime ?? detectTextMime(file)
    if (!detectedMime || !getConfig().allowedMime.has(detectedMime)) throw badRequest('file_type')
    const forbiddenFilenameCharacters = '<>:"/\\|?*'
    const safeFilename = [...decodeUploadFilename(file.originalname).normalize('NFKC')]
      .map((character) => (character.codePointAt(0) ?? 0) < 32 || forbiddenFilenameCharacters.includes(character) ? '_' : character)
      .join('').slice(0, 180) || 'file'
    const fileId = id('file')
    const storageKey = `${companyId ?? 'workspace'}/${fileId.slice(-16)}`
    const sha256 = createHash('sha256').update(file.buffer).digest('hex')
    await writeQuarantine(storageKey, file.buffer)
    await this.prisma.fileObject.create({ data: { id: fileId, workspaceId: principal.workspaceId, companyId, storageKey, safeFilename, declaredMime: file.mimetype, detectedMime, bytes: file.size, sha256, ownerId: principal.userId } })
    await this.jobs.enqueue('file.scan', 'FILE', fileId, {}, `scan:${fileId}`)
    return {
      id: fileId,
      fileName: safeFilename,
      bytes: file.size,
      mimeType: detectedMime,
      scanStatus: 'QUARANTINED' as const,
    }
  }

  async stageTaskUpload(principal: AuthPrincipal, file: UploadedBinary, companyId?: string) {
    return this.stageUpload(principal, file, companyId)
  }

  async stageUpload(principal: AuthPrincipal, file: UploadedBinary, companyId?: string) {
    const staged = await this.upload(principal, companyId ?? principal.primaryCompanyId ?? undefined, file)
    await this.scheduleStagedCleanup(staged.id)
    return staged
  }

  private async scheduleStagedCleanup(fileId: string) {
    await this.jobs.enqueue(
      'file.staged.cleanup',
      'FILE',
      fileId,
      { disposable: true },
      `file-staged-cleanup:${fileId}`,
      new Date(Date.now() + 86_400_000),
    )
  }

  async retainStagedAttachments(tx: Prisma.TransactionClient, principal: AuthPrincipal, fileIds: string[]) {
    const ids = [...new Set(fileIds)]
    if (!ids.length) return
    // Recheck inside the send transaction so discard cannot win between validation and linking.
    const count = await tx.fileObject.count({ where: {
      id: { in: ids }, workspaceId: principal.workspaceId,
      companyId: { in: principal.allowedCompanyIds }, ownerId: principal.userId,
      scanStatus: { in: ['QUARANTINED', 'SCANNING', 'CLEAN'] },
    } })
    if (count !== ids.length) throw badRequest('attachment_unavailable')
    await this.markAttachmentsRetained(tx, ids)
  }

  async markAttachmentsRetained(tx: Prisma.TransactionClient, ids: string[]) {
    if (!ids.length) return
    await tx.backgroundJob.updateMany({
      where: { type: 'file.staged.cleanup', entityId: { in: ids } },
      data: { state: 'SUCCEEDED', safePayload: JSON.stringify({ retained: true }) },
    })
  }

  async discardStagedAttachment(principal: AuthPrincipal, fileId: string) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.findFirst({
        where: { id: fileId, workspaceId: principal.workspaceId, ownerId: principal.userId },
      })
      if (!file) return { discarded: false }
      const staged = await tx.backgroundJob.findUnique({ where: { idempotencyKey: `file-staged-cleanup:${fileId}` } })
      // Only disposable staged files qualify. Never delete Drive originals or legacy files with unknown history.
      if (!staged || staged.state === 'SUCCEEDED' || staged.safePayload !== JSON.stringify({ disposable: true })) return { discarded: false }
      const [link, share] = await Promise.all([
        tx.fileLink.findFirst({ where: { fileId }, select: { id: true } }),
        tx.feedFileShare.findFirst({ where: { fileId }, select: { id: true } }),
      ])
      if (link || share) return { discarded: false }
      await deleteStoredFile(file.storageKey)
      await tx.fileObject.delete({ where: { id: fileId } })
      await tx.backgroundJob.updateMany({
        where: { entityType: 'FILE', entityId: fileId, type: { in: ['file.scan', 'file.staged.cleanup'] } },
        data: { state: 'SUCCEEDED' },
      })
      return { discarded: true }
    })
  }

  async status(principal: AuthPrincipal, fileId: string) {
    const file = await this.authorizedFile(principal, fileId)
    return {
      id: file.id,
      safeFilename: file.safeFilename,
      bytes: file.bytes,
      detectedMime: file.detectedMime,
      scanStatus: file.scanStatus,
      createdAt: file.createdAt,
    }
  }

  async archiveFiles(principal: AuthPrincipal, fileIds: string[]) {
    const ids = [...new Set(fileIds)]
    if (!ids.length || ids.length > 20) throw badRequest('file_archive_limit')
    const names = new Set<string>()
    const files = []
    for (const fileId of ids) {
      const file = await this.authorizedFile(principal, fileId)
      if (file.scanStatus !== 'CLEAN') throw forbidden('Файл перебуває на перевірці або недоступний.')
      let name = file.safeFilename
      let suffix = 2
      while (names.has(name.toLowerCase())) {
        const extension = extname(file.safeFilename)
        name = `${file.safeFilename.slice(0, file.safeFilename.length - extension.length)} (${suffix++})${extension}`
      }
      names.add(name.toLowerCase())
      files.push({ storageKey: file.storageKey, name })
    }
    return files
  }

  async download(principal: AuthPrincipal, fileId: string): Promise<{ bytes: Buffer; mime: string; name: string }> {
    const file = await this.authorizedFile(principal, fileId)
    if (file.scanStatus !== 'CLEAN') throw forbidden('Файл перебуває на перевірці або недоступний.')
    const bytes = await readCleanFile(file.storageKey)
    await this.recordDownload(principal, file)
    return { bytes, mime: file.detectedMime ?? 'application/octet-stream', name: file.safeFilename }
  }

  private async recordDownload(principal: AuthPrincipal, file: { id: string; companyId: string | null }) {
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: file.companyId, actorType: 'USER', actorId: principal.userId, action: 'file.downloaded', entityType: 'FILE', entityId: file.id, result: 'SUCCESS', risk: 'HIGH', correlationId: id('corr') } })
  }

  /**
   * Creates an independently authorized reference owned by the principal. Hard links
   * share immutable storage bytes without weakening `assertAttachable`'s owner check.
   */
  async copyForPrincipal(principal: AuthPrincipal, fileId: string, companyInput: string | undefined) {
    const companyId = this.scope.assertCompany(principal, companyInput)
    const source = await this.authorizedFile(principal, fileId)
    if (source.scanStatus !== 'CLEAN') throw forbidden('Файл перебуває на перевірці або недоступний.')
    await this.recordDownload(principal, source)
    const copyId = id('file')
    const storageKey = `${companyId}/${copyId.slice(-16)}`
    await linkCleanFile(source.storageKey, storageKey)
    try {
      await this.prisma.fileObject.create({
        data: {
          id: copyId,
          workspaceId: principal.workspaceId,
          companyId,
          storageKey,
          safeFilename: source.safeFilename,
          declaredMime: source.declaredMime,
          detectedMime: source.detectedMime,
          bytes: source.bytes,
          sha256: source.sha256,
          ownerId: principal.userId,
          scanStatus: 'CLEAN',
        },
      })
    } catch (error) {
      await deleteStoredFile(storageKey)
      throw error
    }
    await this.scheduleStagedCleanup(copyId)
    return {
      id: copyId,
      fileName: source.safeFilename,
      bytes: source.bytes,
      mimeType: source.detectedMime ?? 'application/octet-stream',
      scanStatus: 'CLEAN' as const,
    }
  }

  async downloadAvatar(principal: AuthPrincipal, fileId: string): Promise<{ bytes: Buffer; mime: string; name: string }> {
    const [file, avatarOwner] = await Promise.all([
      this.prisma.fileObject.findFirst({
        where: { id: fileId, workspaceId: principal.workspaceId },
      }),
      this.prisma.user.findFirst({
        where: {
          workspaceId: principal.workspaceId,
          avatarAsset: { in: [fileId, `/api/v1/me/avatar/${fileId}`] },
        },
        select: { id: true },
      }),
    ])
    if (!file || !avatarOwner) throw notFound()
    if (file.scanStatus !== 'CLEAN') throw forbidden('Файл перебуває на перевірці або недоступний.')
    const bytes = await readCleanFile(file.storageKey)
    return { bytes, mime: file.detectedMime ?? 'application/octet-stream', name: file.safeFilename }
  }

  async assertAttachable(
    principal: AuthPrincipal,
    companyId: string | string[],
    fileIds: string[],
    errorCode = 'feed_attachment_invalid',
  ) {
    const uniqueIds = [...new Set(fileIds)]
    if (uniqueIds.length === 0) return []
    const files = await this.prisma.fileObject.findMany({
      where: {
        id: { in: uniqueIds },
        workspaceId: principal.workspaceId,
        companyId: typeof companyId === 'string' ? companyId : { in: companyId },
        ownerId: principal.userId,
        scanStatus: { in: ['QUARANTINED', 'SCANNING', 'CLEAN'] },
      },
      select: {
        id: true,
        safeFilename: true,
        bytes: true,
        detectedMime: true,
        declaredMime: true,
        scanStatus: true,
      },
    })
    if (files.length !== uniqueIds.length) throw badRequest(errorCode)
    return files
  }

  async assertTaskStagedAttachments(
    principal: AuthPrincipal,
    companyId: string,
    fileIds: string[],
    errorCode = 'task_attachment',
  ) {
    const uniqueIds = [...new Set(fileIds)]
    if (!uniqueIds.length) return []
    const stagedSince = new Date(Date.now() - 86_400_000)
    const [files, links] = await Promise.all([
      this.prisma.fileObject.findMany({
        where: {
          id: { in: uniqueIds },
          workspaceId: principal.workspaceId,
          companyId,
          ownerId: principal.userId,
          createdAt: { gte: stagedSince },
          scanStatus: { in: ['QUARANTINED', 'SCANNING', 'CLEAN'] },
        },
        select: {
          id: true,
          safeFilename: true,
          bytes: true,
          detectedMime: true,
          scanStatus: true,
          createdAt: true,
        },
      }),
      this.prisma.fileLink.findMany({
        where: { fileId: { in: uniqueIds } },
        select: { fileId: true },
      }),
    ])
    if (files.length !== uniqueIds.length || links.length) {
      throw badRequest(errorCode)
    }
    return files
  }

  async assertShareable(principal: AuthPrincipal, companyId: string, fileId: string) {
    const file = await this.prisma.fileObject.findFirst({
      where: {
        id: fileId,
        workspaceId: principal.workspaceId,
        companyId,
        ownerId: principal.userId,
        scanStatus: { in: ['QUARANTINED', 'SCANNING', 'CLEAN'] },
      },
      select: {
        id: true,
        workspaceId: true,
        companyId: true,
        ownerId: true,
        scanStatus: true,
        createdAt: true,
      },
    })
    if (!file) throw badRequest('feed_file_share_invalid')
    return file
  }

  private async authorizedFile(principal: AuthPrincipal, fileId: string) {
    const file = await this.prisma.fileObject.findFirst({
      where: {
        id: fileId,
        workspaceId: principal.workspaceId,
        OR: [
          { companyId: { in: principal.allowedCompanyIds } },
          { companyId: null, ownerId: principal.userId },
        ],
      },
    })
    if (!file) throw notFound()
    if (file.ownerId === principal.userId) return file
    const fileShare = await this.prisma.feedFileShare.findFirst({
      where: {
        fileId,
        workspaceId: principal.workspaceId,
        companyId: { in: principal.allowedCompanyIds },
        status: 'ACTIVE',
        OR: [
          { audienceType: 'COMPANY' },
          {
            audienceType: 'USER',
            directRecipients: { some: { userId: principal.userId } },
          },
        ],
      },
      select: { id: true },
    })
    if (fileShare) return file
    const links = await this.prisma.fileLink.findMany({
      where: { fileId },
      select: { entityType: true, entityId: true },
    })
    {
      const messageIds = links
        .filter((link) => link.entityType === 'MESSAGE')
        .map((link) => link.entityId)
      if (messageIds.length > 0) {
        const messages = await this.prisma.message.findMany({
          where: {
            id: { in: messageIds },
            deletedAt: null,
            thread: {
              workspaceId: principal.workspaceId,
              companyId: { in: principal.allowedCompanyIds },
              participants: {
                some: {
                  userId: principal.userId,
                  leftAt: null,
                },
              },
            },
          },
          select: {
            id: true,
            thread: { select: { entityType: true, entityId: true } },
          },
        })
        if (messages.length > 0) return file
      }
    }
    {
      const taskIds = links
        .filter((link) => link.entityType === 'TASK')
        .map((link) => link.entityId)
      const commentIds = links
        .filter((link) => link.entityType === 'TASK_COMMENT')
        .map((link) => link.entityId)
      if (commentIds.length > 0) {
        const taskComments = await this.prisma.comment.findMany({
          where: {
            id: { in: commentIds },
            workspaceId: principal.workspaceId,
            entityType: 'TASK',
            deletedAt: null,
          },
          select: { entityId: true },
        })
        taskIds.push(...taskComments.map((comment) => comment.entityId))
      }
      for (const taskId of [...new Set(taskIds)]) {
        if (await this.taskAccess.findReadableTask(principal, taskId)) return file
      }
    }
    const documentIds = links.filter((link) => link.entityType === 'DOCUMENT').map((link) => link.entityId)
    if (documentIds.length > 0) {
      const document = await this.prisma.document.findFirst({
        where: {
          id: { in: documentIds },
          companyId: { in: principal.allowedCompanyIds },
          ...(isGlobalAdmin(principal) ? {} : { OR: [
            { ownerId: principal.userId },
            { confidentiality: { in: ['GENERAL', 'INTERNAL'] } },
          ] }),
        },
        select: { id: true },
      })
      if (document) return file
      const acl = await this.prisma.documentAcl.findFirst({
        where: { documentId: { in: documentIds }, principalType: 'USER', principalId: principal.userId },
        select: { documentId: true },
      })
      if (acl && await this.prisma.document.findFirst({
        where: { id: acl.documentId, companyId: { in: principal.allowedCompanyIds } },
        select: { id: true },
      })) return file
      const grants = await this.driveSharing.grantsFor(principal)
      const shared = documentIds.find((documentId) => grants.documentIds.has(documentId))
      if (shared && await this.prisma.document.findFirst({
        where: { id: shared, companyId: { in: principal.allowedCompanyIds } },
        select: { id: true },
      })) return file
    }
    const articleIds = links.filter((link) => link.entityType === 'KNOWLEDGE_ARTICLE').map((link) => link.entityId)
    if (articleIds.length > 0) {
      const article = await this.prisma.knowledgeArticle.findFirst({
        where: { id: { in: articleIds }, workspaceId: principal.workspaceId, status: 'ACTIVE' },
        select: { id: true },
      })
      if (article) {
        const audience = await this.prisma.articleAudience.findFirst({ where: { articleId: article.id, OR: [{ principalType: 'COMPANY', principalId: { in: principal.allowedCompanyIds } }, { principalType: 'USER', principalId: principal.userId }] }, select: { id: true } })
        if (audience) return file
      }
    }
    const postIds = links.filter((link) => link.entityType === 'FEED_POST').map((link) => link.entityId)
    if (postIds.length > 0) {
      const post = await this.prisma.feedPost.findFirst({
        where: {
          id: { in: postIds },
          workspaceId: principal.workspaceId,
          status: 'PUBLISHED',
          OR: [
            { authorId: principal.userId },
            { companyId: { in: principal.allowedCompanyIds } },
            {
              recipients: {
                some: {
                  OR: [
                    { type: 'COMPANY', recipientId: { in: principal.allowedCompanyIds } },
                    { type: 'USER', recipientId: principal.userId },
                  ],
                },
              },
            },
          ],
        },
        select: { id: true },
      })
      if (post) return file
    }
    throw notFound()
  }
}

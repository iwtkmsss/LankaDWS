import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { id } from '../../common/crypto.js'
import { badRequest, forbidden, notFound } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { getConfig } from '../../config/config.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JobsService } from '../jobs/jobs.service.js'
import { ScopeService } from '../authorization/scope.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { DriveSharingService } from '../documents/drive-sharing.service.js'
import { readCleanFile, writeCleanFile, writeQuarantine } from './storage.js'

export interface UploadedBinary {
  buffer: Buffer
  size: number
  mimetype: string
  originalname: string
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

  private async persistUpload(principal: AuthPrincipal, companyId: string | null, file: UploadedBinary) {
    if (!file || file.size <= 0 || file.size > getConfig().MAX_UPLOAD_BYTES) throw badRequest('file_size')
    const detected = await fileTypeFromBuffer(file.buffer)
    const detectedMime = detected?.mime ?? (file.mimetype === 'text/plain' ? 'text/plain' : undefined)
    if (!detectedMime || !getConfig().allowedMime.has(detectedMime)) throw badRequest('file_type')
    const forbiddenFilenameCharacters = '<>:"/\\|?*'
    const safeFilename = [...file.originalname.normalize('NFKC')]
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

  async stageTaskUpload(principal: AuthPrincipal, file: UploadedBinary) {
    const staged = await this.upload(principal, principal.primaryCompanyId ?? undefined, file)
    await this.jobs.enqueue(
      'file.staged.cleanup',
      'FILE',
      staged.id,
      {},
      `file-staged-cleanup:${staged.id}`,
      new Date(Date.now() + 86_400_000),
    )
    return staged
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

  async download(principal: AuthPrincipal, fileId: string): Promise<{ bytes: Buffer; mime: string; name: string }> {
    const file = await this.authorizedFile(principal, fileId)
    if (file.scanStatus !== 'CLEAN') throw forbidden('Файл перебуває на перевірці або недоступний.')
    const bytes = await readCleanFile(file.storageKey)
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: file.companyId, actorType: 'USER', actorId: principal.userId, action: 'file.downloaded', entityType: 'FILE', entityId: file.id, result: 'SUCCESS', risk: 'HIGH', correlationId: id('corr') } })
    return { bytes, mime: file.detectedMime ?? 'application/octet-stream', name: file.safeFilename }
  }

  /**
   * Duplicates an already-readable file into one the principal owns, so moving a file
   * between Drive and chat never weakens the owner check that `assertAttachable` relies on.
   */
  async copyForPrincipal(principal: AuthPrincipal, fileId: string, companyInput: string | undefined) {
    const companyId = this.scope.assertCompany(principal, companyInput)
    const source = await this.download(principal, fileId)
    const copyId = id('file')
    const storageKey = `${companyId}/${copyId.slice(-16)}`
    await writeCleanFile(storageKey, source.bytes)
    await this.prisma.fileObject.create({
      data: {
        id: copyId,
        workspaceId: principal.workspaceId,
        companyId,
        storageKey,
        safeFilename: source.name,
        declaredMime: source.mime,
        detectedMime: source.mime,
        bytes: source.bytes.length,
        sha256: createHash('sha256').update(source.bytes).digest('hex'),
        ownerId: principal.userId,
        scanStatus: 'CLEAN',
      },
    })
    return {
      id: copyId,
      fileName: source.name,
      bytes: source.bytes.length,
      mimeType: source.mime,
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
    companyId: string,
    fileIds: string[],
    errorCode = 'feed_attachment_invalid',
  ) {
    const uniqueIds = [...new Set(fileIds)]
    if (uniqueIds.length === 0) return []
    const files = await this.prisma.fileObject.findMany({
      where: {
        id: { in: uniqueIds },
        workspaceId: principal.workspaceId,
        companyId,
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
      throw badRequest('task_attachment')
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
            audienceType: 'GROUP',
            group: {
              is: {
                status: 'ACTIVE',
                members: { some: { userId: principal.userId, leftAt: null } },
              },
            },
          },
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
        if (messages.some((message) => message.thread.entityType !== 'GROUP')) return file
        const groupIds = messages
          .filter((message) => message.thread.entityType === 'GROUP' && message.thread.entityId)
          .map((message) => message.thread.entityId!)
        if (groupIds.length > 0) {
          const membership = await this.prisma.groupMember.findFirst({
            where: {
              groupId: { in: groupIds },
              userId: principal.userId,
              leftAt: null,
              group: {
                workspaceId: principal.workspaceId,
                companyId: { in: principal.allowedCompanyIds },
                status: 'ACTIVE',
              },
            },
            select: { id: true },
          })
          if (membership) return file
        }
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
          OR: [
            { ownerId: principal.userId },
            { confidentiality: { in: ['GENERAL', 'INTERNAL'] } },
          ],
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
      const memberships = await this.prisma.groupMember.findMany({
        where: {
          userId: principal.userId,
          leftAt: null,
          group: { companyId: { in: principal.allowedCompanyIds }, status: 'ACTIVE' },
        },
        select: { groupId: true },
      })
      const groupIds = memberships.map((membership) => membership.groupId)
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
                    ...(groupIds.length > 0
                      ? [{ type: 'GROUP' as const, recipientId: { in: groupIds } }]
                      : []),
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

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
import { readCleanFile, writeQuarantine } from './storage.js'

export interface UploadedBinary {
  buffer: Buffer
  size: number
  mimetype: string
  originalname: string
}

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService, private readonly jobs: JobsService, private readonly scope: ScopeService) {}

  async upload(principal: AuthPrincipal, companyInput: string | undefined, file: UploadedBinary) {
    const companyId = this.scope.assertCompany(principal, companyInput)
    if (!file || file.size <= 0 || file.size > getConfig().MAX_UPLOAD_BYTES) throw badRequest('file_size')
    const detected = await fileTypeFromBuffer(file.buffer)
    const detectedMime = detected?.mime ?? (file.mimetype === 'text/plain' ? 'text/plain' : undefined)
    if (!detectedMime || !getConfig().allowedMime.has(detectedMime)) throw badRequest('file_type')
    const forbiddenFilenameCharacters = '<>:"/\\|?*'
    const safeFilename = [...file.originalname.normalize('NFKC')]
      .map((character) => (character.codePointAt(0) ?? 0) < 32 || forbiddenFilenameCharacters.includes(character) ? '_' : character)
      .join('').slice(0, 180) || 'file'
    const fileId = id('file')
    const storageKey = `${companyId}/${fileId.slice(-16)}`
    const sha256 = createHash('sha256').update(file.buffer).digest('hex')
    await writeQuarantine(storageKey, file.buffer)
    await this.prisma.fileObject.create({ data: { id: fileId, workspaceId: principal.workspaceId, companyId, storageKey, safeFilename, declaredMime: file.mimetype, detectedMime, bytes: file.size, sha256, ownerId: principal.userId } })
    await this.jobs.enqueue('file.scan', 'FILE', fileId, {}, `scan:${fileId}`)
    return { id: fileId, fileName: safeFilename, bytes: file.size, mimeType: detectedMime, scanStatus: 'QUARANTINED' }
  }

  async status(principal: AuthPrincipal, fileId: string) {
    const file = await this.prisma.fileObject.findFirst({ where: { id: fileId, companyId: { in: principal.allowedCompanyIds }, OR: [{ ownerId: principal.userId }, { id: { in: await this.linkedAllowedFiles(principal) } }] }, select: { id: true, safeFilename: true, bytes: true, detectedMime: true, scanStatus: true, createdAt: true } })
    if (!file) throw notFound()
    return file
  }

  async download(principal: AuthPrincipal, fileId: string): Promise<{ bytes: Buffer; mime: string; name: string }> {
    const file = await this.prisma.fileObject.findFirst({ where: { id: fileId, companyId: { in: principal.allowedCompanyIds }, OR: [{ ownerId: principal.userId }, { id: { in: await this.linkedAllowedFiles(principal) } }] } })
    if (!file) throw notFound()
    if (file.scanStatus !== 'CLEAN') throw forbidden('Файл перебуває на перевірці або недоступний.')
    const bytes = await readCleanFile(file.storageKey)
    await this.prisma.auditEvent.create({ data: { id: id('aud'), workspaceId: principal.workspaceId, companyId: file.companyId, actorType: 'USER', actorId: principal.userId, action: 'file.downloaded', entityType: 'FILE', entityId: file.id, result: 'SUCCESS', risk: 'HIGH', correlationId: id('corr') } })
    return { bytes, mime: file.detectedMime ?? 'application/octet-stream', name: file.safeFilename }
  }

  private async linkedAllowedFiles(principal: AuthPrincipal): Promise<string[]> {
    if (!principal.permissions.has('documents.read')) return []
    const links = await this.prisma.fileLink.findMany({ where: { entityType: 'DOCUMENT', entityId: { in: (await this.prisma.document.findMany({ where: { companyId: { in: principal.allowedCompanyIds }, confidentiality: { in: ['GENERAL', 'INTERNAL'] } }, select: { id: true } })).map((document) => document.id) } }, select: { fileId: true } })
    return links.map((link) => link.fileId)
  }
}

import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { DocumentsService } from './documents.service.js'
import { DriveService } from './drive.service.js'

const principal = { userId: 'usr', workspaceId: 'ws', allowedCompanyIds: ['cmp'], accountType: 'USER' } as AuthPrincipal
const document = { id: 'doc', ownerId: 'usr', companyId: 'cmp', fileId: 'file', version: 2, confidentiality: 'INTERNAL' }

describe('documents without file versions', () => {
  it('creates a document with a direct file reference and an inherited content link', async () => {
    const prisma = {
      document: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(document) },
      fileObject: { findFirst: vi.fn().mockResolvedValue({ id: 'file' }), findUnique: vi.fn().mockResolvedValue({ safeFilename: 'file.pdf', bytes: 20, detectedMime: 'application/pdf', scanStatus: 'CLEAN' }) },
      fileLink: { create: vi.fn() }, auditEvent: { create: vi.fn() },
      documentAcl: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
    }
    prisma.$transaction.mockImplementation((callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma))
    const service = new DocumentsService(prisma as never, { assertCompany: () => 'cmp' } as never, {
      grantsFor: () => Promise.resolve({ documentIds: new Set() }),
    } as never)
    const result = await service.create(principal, { name: 'File', fileId: 'file' })
    expect(prisma.document.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fileId: 'file', name: 'File' }) as Record<string, unknown> })
    expect(prisma.fileLink.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fileId: 'file', purpose: 'CONTENT', aclMode: 'INHERIT' }) as Record<string, unknown> })
    expect(result.file?.mimeType).toBe('application/pdf')
    expect(result).not.toHaveProperty('versions')
  })

  it('does not read file metadata when the document is inaccessible', async () => {
    const prisma = { document: { findFirst: vi.fn().mockResolvedValue(null) }, fileObject: { findUnique: vi.fn() }, documentAcl: { findMany: vi.fn().mockResolvedValue([]) } }
    const service = new DocumentsService(prisma as never, {} as never, { grantsFor: () => Promise.resolve({ documentIds: new Set() }) } as never)
    await expect(service.detail(principal, 'private')).rejects.toThrow()
    expect(prisma.fileObject.findUnique).not.toHaveBeenCalled()
    expect(prisma.document.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ companyId: { in: ['cmp'] }, OR: expect.arrayContaining([{ ownerId: 'usr' }]) as unknown[] }) as Record<string, unknown> })
  })

  it('copies the direct document file when sending it as a chat attachment', async () => {
    const files = { copyForPrincipal: vi.fn().mockResolvedValue({ id: 'copy' }) }
    const service = new DriveService({ document: { findFirst: vi.fn().mockResolvedValue(document) } } as never, {} as never, {} as never, {} as never, files as never)
    expect(await service.attachmentFromDocument(principal, 'doc')).toEqual({ id: 'copy' })
    expect(files.copyForPrincipal).toHaveBeenCalledWith(principal, 'file', 'cmp')
  })
})

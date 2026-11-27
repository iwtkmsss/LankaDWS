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

describe('document archive access', () => {
  function setup(role: 'VIEWER' | 'EDITOR' | null, owner = 'other') {
    const prisma = {
      document: { findFirst: vi.fn().mockResolvedValue({ id: 'doc', companyId: 'cmp', version: 2, ownerId: owner }), update: vi.fn() },
      auditEvent: { create: vi.fn() },
      $transaction: vi.fn(),
    }
    prisma.$transaction.mockImplementation((callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma))
    const sharing = { grantsFor: vi.fn().mockResolvedValue({ roleOf: () => role }) }
    return { prisma, service: new DocumentsService(prisma as never, {} as never, sharing as never) }
  }

  it('hides the document from a user without access', async () => {
    const { prisma, service } = setup(null)
    await expect(service.archive(principal, 'doc', 2)).rejects.toMatchObject({ status: 404 })
    expect(prisma.document.update).not.toHaveBeenCalled()
  })

  it('refuses a viewer', async () => {
    const { prisma, service } = setup('VIEWER')
    await expect(service.archive(principal, 'doc', 2)).rejects.toMatchObject({ status: 403 })
    expect(prisma.document.update).not.toHaveBeenCalled()
  })

  it.each([
    ['an editor', 'EDITOR' as const, 'other', principal],
    ['the owner', null, 'usr', principal],
    ['a global administrator', null, 'other', { ...principal, accountType: 'ADMIN' as const }],
  ])('lets %s archive', async (_label, role, owner, actor) => {
    const { prisma, service } = setup(role, owner)
    await expect(service.archive(actor, 'doc', 2)).resolves.toMatchObject({ archived: true, version: 3 })
    expect(prisma.document.update).toHaveBeenCalledOnce()
  })
})

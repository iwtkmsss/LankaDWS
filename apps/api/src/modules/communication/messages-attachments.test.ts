import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { FilesService } from '../files/files.service.js'
import { MessagesService } from './messages.service.js'

const principal = {
  userId: 'sender', workspaceId: 'workspace', allowedCompanyIds: ['chat-company', 'drive-company'],
} as AuthPrincipal
const input = { body: '', attachmentIds: ['drive-copy'], mentions: [] }

function setup() {
  const tx = {
    fileObject: { count: vi.fn().mockResolvedValue(1) },
    backgroundJob: { updateMany: vi.fn() },
    message: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, createdAt: new Date() })) },
    fileLink: { createMany: vi.fn() },
    messageThread: { update: vi.fn().mockResolvedValue({ version: 2 }) },
    threadParticipant: { update: vi.fn() }, idempotencyRecord: { create: vi.fn() },
    auditEvent: { create: vi.fn() }, outboxEvent: { create: vi.fn() },
  }
  const prisma = {
    fileObject: { findMany: vi.fn().mockResolvedValue([{ id: 'drive-copy' }]) },
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  }
  const files = new FilesService(prisma as never, {} as never, {} as never, {} as never, {} as never)
  const service = new MessagesService(prisma as never, {} as never, files, { publish: vi.fn().mockResolvedValue(undefined) } as never)
  const readableThread = vi.fn().mockResolvedValue({ companyId: 'chat-company', participants: [] })
  Object.assign(service, { readableThread, idempotentResult: vi.fn().mockResolvedValue(null) })
  return { service, prisma, tx, readableThread }
}

describe('sending Drive attachments in chats', () => {
  it('sends a file-only message using an owned Drive copy from another allowed company', async () => {
    const { service, prisma, tx } = setup()
    const result = await service.post(principal, 'thread', input, 'request-key')
    expect(result.id).toBeTruthy()
    expect(prisma.fileObject.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['drive-copy'] }, workspaceId: 'workspace', ownerId: 'sender',
        companyId: { in: principal.allowedCompanyIds },
        scanStatus: { in: ['QUARANTINED', 'SCANNING', 'CLEAN'] },
      },
      select: { id: true, safeFilename: true, bytes: true, detectedMime: true, declaredMime: true, scanStatus: true },
    })
    expect(tx.fileLink.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      fileId: 'drive-copy', entityType: 'MESSAGE', entityId: result.id, aclMode: 'ENTITY',
    })] })
  })

  it('rejects files excluded by owner, workspace, allowed company or scan checks', async () => {
    const { service, prisma } = setup()
    prisma.fileObject.findMany.mockResolvedValue([])
    await expect(service.post(principal, 'thread', input, 'key')).rejects.toMatchObject({ code: 'chat_attachment_invalid' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('checks chat access before looking up attachment metadata', async () => {
    const { service, prisma, readableThread } = setup()
    readableThread.mockRejectedValue(new Error('not_found'))
    await expect(service.post(principal, 'private', input, 'key')).rejects.toThrow('not_found')
    expect(prisma.fileObject.findMany).not.toHaveBeenCalled()
  })

  it('preserves the existing single-company validation for other file callers', async () => {
    const { prisma } = setup()
    const files = new FilesService(prisma as never, {} as never, {} as never, {} as never, {} as never)
    await files.assertAttachable(principal, 'chat-company', ['drive-copy'])
    expect(prisma.fileObject.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: 'chat-company' }) as Record<string, unknown>,
    }))
  })
})

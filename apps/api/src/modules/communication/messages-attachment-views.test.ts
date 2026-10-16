import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { MessagesService } from './messages.service.js'

const principal = { userId: 'sender', workspaceId: 'workspace', allowedCompanyIds: ['chat-company', 'drive-company'] } as AuthPrincipal
const message = {
  id: 'message', threadId: 'thread', authorId: 'sender', body: '', version: 1,
  createdAt: new Date(), editedAt: null, deletedAt: null, replyToId: null,
}
const file = {
  id: 'drive-file', workspaceId: 'workspace', companyId: 'drive-company', ownerId: 'sender',
  safeFilename: 'Report.pdf', bytes: 1024, detectedMime: 'application/pdf', declaredMime: 'application/pdf',
  storageKey: 'drive/file', scanStatus: 'CLEAN',
}

function setup() {
  const prisma = {
    fileLink: { findMany: vi.fn().mockResolvedValue([{ fileId: file.id, entityId: message.id }]) },
    fileObject: { findMany: vi.fn().mockImplementation(({ where }: {
      where: { companyId: string | { in: string[] }; workspaceId: string }
    }) => Promise.resolve(where.workspaceId === file.workspaceId
      && (typeof where.companyId === 'string' ? where.companyId === file.companyId : where.companyId.in.includes(file.companyId)) ? [file] : [])) },
    contentMention: { findMany: vi.fn().mockResolvedValue([]) },
    messageReaction: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'sender', displayName: 'Sender' }]) },
    message: { findFirst: vi.fn().mockResolvedValue(message) },
    auditEvent: { create: vi.fn() },
  }
  const service = new MessagesService(prisma as never, {} as never, {} as never, {} as never)
  const readableThread = vi.fn().mockResolvedValue({ id: 'thread', companyId: 'chat-company', participants: [] })
  Object.assign(service, { readableMessage: vi.fn().mockResolvedValue(message), readableThread })
  return { service, prisma, readableThread }
}

describe('chat attachment projections', () => {
  it.each(['sender', 'recipient'])('shows a Drive attachment to the authorized %s despite different persistence companies', async (userId) => {
    const { service, prisma } = setup()
    const result = await service.message({ ...principal, userId }, message.id)
    expect(result.attachments).toEqual([{
      id: file.id, fileName: file.safeFilename, bytes: file.bytes, mimeType: file.detectedMime, scanStatus: 'CLEAN',
    }])
    expect(prisma.fileObject.findMany).toHaveBeenCalledWith({ where: {
      id: { in: [file.id] }, workspaceId: 'workspace', companyId: { in: principal.allowedCompanyIds },
    } })
  })

  it('keeps files outside the authorized company set out of the projection', async () => {
    const { service } = setup()
    const result = await service.message({ ...principal, allowedCompanyIds: ['chat-company'] }, message.id)
    expect(result.attachments).toEqual([])
  })

  it('checks thread access before reading any attachment metadata', async () => {
    const { service, prisma, readableThread } = setup()
    readableThread.mockRejectedValue(new Error('not_found'))
    await expect(service.message(principal, message.id)).rejects.toThrow('not_found')
    expect(prisma.fileObject.findMany).not.toHaveBeenCalled()
  })

  it.each([2, 3])('includes %s Drive files in a message archive after checking chat access', async (count) => {
    const { service, prisma } = setup()
    const files = Array.from({ length: count }, (_, index) => ({ ...file, id: `drive-file-${index}`, storageKey: `drive/file-${index}` }))
    prisma.fileLink.findMany.mockResolvedValue(files.map((entry) => ({ fileId: entry.id, entityId: message.id })))
    prisma.fileObject.findMany.mockResolvedValue(files)
    const result = await service.archiveAttachments(principal, message.id)
    expect(result.files).toHaveLength(count)
    expect(prisma.fileObject.findMany).toHaveBeenCalledWith({
      where: { id: { in: files.map((entry) => entry.id) }, workspaceId: 'workspace', companyId: { in: principal.allowedCompanyIds }, scanStatus: 'CLEAN' },
      select: { id: true, safeFilename: true, storageKey: true },
    })
  })

  it('does not create an archive for a single file', async () => {
    const { service, prisma } = setup()
    await expect(service.archiveAttachments(principal, message.id)).rejects.toMatchObject({ code: 'chat_attachment_archive_unavailable' })
    expect(prisma.auditEvent.create).not.toHaveBeenCalled()
  })
})

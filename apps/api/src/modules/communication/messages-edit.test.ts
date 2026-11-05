import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { MessagesService } from './messages.service.js'

const principal = { userId: 'me', workspaceId: 'workspace' } as AuthPrincipal

function setup(version = 1) {
  const findMany = vi.fn().mockResolvedValue([{ fileId: 'photo-1' }, { fileId: 'photo-2' }])
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
  const updateMany = vi.fn().mockResolvedValue({ count: 1 })
  const tx = {
    message: { updateMany }, fileLink: { deleteMany },
    messageThread: { update: vi.fn().mockResolvedValue({ version: 2 }) },
    auditEvent: { create: vi.fn() }, outboxEvent: { create: vi.fn() },
  }
  const transaction = vi.fn((work: (value: typeof tx) => unknown) => Promise.resolve(work(tx)))
  const service = new MessagesService({
    fileLink: { findMany }, contentMention: { findMany: vi.fn().mockResolvedValue([]) }, $transaction: transaction,
  } as never, {} as never, {} as never, { publish: vi.fn().mockResolvedValue(undefined) } as never)
  Object.assign(service, {
    readableMessage: vi.fn().mockResolvedValue({ id: 'message', threadId: 'thread', authorId: 'me', body: 'Текст', version,
      deletedAt: null, createdAt: new Date(), thread: { companyId: 'company' } }),
    readableThread: vi.fn().mockResolvedValue({ participants: [] }),
  })
  return { service, findMany, deleteMany, updateMany, transaction }
}

describe('editing message attachments', () => {
  it('persists attachment removal even when the text stays the same', async () => {
    const { service, deleteMany, updateMany } = setup()
    expect(await service.editMessage(principal, 'message', {
      body: 'Текст', expectedVersion: 1, attachmentIds: ['photo-2'],
    })).toMatchObject({ version: 2 })
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'message', version: 1, deletedAt: null } }))
    expect(deleteMany).toHaveBeenCalledWith({ where: {
      entityType: 'MESSAGE', entityId: 'message', purpose: 'ATTACHMENT', fileId: { in: ['photo-1'] },
    } })
  })

  it('allows a file-only message to keep its remaining attachment', async () => {
    const { service } = setup()
    await expect(service.editMessage(principal, 'message', {
      body: '', expectedVersion: 1, attachmentIds: ['photo-2'],
    })).resolves.toMatchObject({ body: '', version: 2 })
  })

  it('rejects adding unrelated files and leaving an empty message', async () => {
    const { service, transaction } = setup()
    await expect(service.editMessage(principal, 'message', {
      body: 'Текст', expectedVersion: 1, attachmentIds: ['foreign-file'],
    })).rejects.toThrow()
    await expect(service.editMessage(principal, 'message', {
      body: '', expectedVersion: 1, attachmentIds: [],
    })).rejects.toThrow()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('keeps attachments unchanged for existing text-only edit requests', async () => {
    const { service, findMany, deleteMany } = setup()
    await service.editMessage(principal, 'message', { body: 'Новий текст', expectedVersion: 1 })
    expect(findMany).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('does not detach anything when the version is stale or changes during saving', async () => {
    const stale = setup(2)
    await expect(stale.service.editMessage(principal, 'message', {
      body: 'Текст', expectedVersion: 1, attachmentIds: [],
    })).rejects.toThrow()
    expect(stale.transaction).not.toHaveBeenCalled()
    const concurrent = setup()
    concurrent.updateMany.mockResolvedValue({ count: 0 })
    await expect(concurrent.service.editMessage(principal, 'message', {
      body: 'Текст', expectedVersion: 1, attachmentIds: [],
    })).rejects.toThrow()
    expect(concurrent.deleteMany).not.toHaveBeenCalled()
  })
})

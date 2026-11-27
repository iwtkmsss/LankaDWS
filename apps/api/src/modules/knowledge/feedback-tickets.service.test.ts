import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { FeedbackTicketsService } from './feedback-tickets.service.js'

const user = { userId: 'sender', workspaceId: 'workspace', accountType: 'USER' } as AuthPrincipal
const admin = { ...user, userId: 'admin', accountType: 'ADMIN' } as AuthPrincipal
function setup() {
  const prisma = {
    feedbackTicket: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    fileObject: { findMany: vi.fn().mockResolvedValue([{ id: 'file' }]) },
    fileLink: { count: vi.fn().mockResolvedValue(0), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue({ displayName: 'Автор' }) },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  }
  prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) => callback(prisma))
  return { prisma, service: new FeedbackTicketsService(prisma as never) }
}

describe('private feedback tickets', () => {
  it('lets a user submit a ticket with fresh owned clean files without an audience or acknowledgement', async () => {
    const { service, prisma } = setup()
    await expect(service.create(user, { title: ' Тема ', body: ' Відгук ', attachmentIds: ['file'] })).resolves.toEqual({ submitted: true })
    expect(prisma.feedbackTicket.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workspaceId: 'workspace', ownerId: 'sender', title: 'Тема', body: 'Відгук' }) as unknown })
    expect(prisma.fileObject.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerId: 'sender', workspaceId: 'workspace', companyId: null, scanStatus: 'CLEAN' }) as unknown }))
    expect(prisma.fileLink.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ entityType: 'FEEDBACK_TICKET', fileId: 'file' })] })
  })

  it.each(['list', 'detail', 'remove', 'restore'] as const)('denies %s to all ordinary users including the author before reading data', async (method) => {
    const { service, prisma } = setup()
    await expect(service[method](user, 'ticket')).rejects.toMatchObject({ status: 403 })
    expect(prisma.feedbackTicket.findFirst).not.toHaveBeenCalled()
    expect(prisma.feedbackTicket.findMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([{}, { title: ' ', body: 'text' }, { title: 'title', body: 1 }, { title: 'title', body: 'text', companyIds: ['company'] }, { title: 'title', body: 'text', requiresAcknowledgement: true }])('rejects invalid or audience-bearing input', async (input) => {
    const { service, prisma } = setup()
    await expect(service.create(user, input)).rejects.toMatchObject({ status: 400 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each(['foreign', 'linked'])('rejects %s attachment IDs before creating a ticket', async (kind) => {
    const { service, prisma } = setup()
    if (kind === 'foreign') prisma.fileObject.findMany.mockResolvedValue([])
    else prisma.fileLink.count.mockResolvedValue(1)
    await expect(service.create(user, { title: 'Title', body: 'Body', attachmentIds: ['file'] })).rejects.toMatchObject({ status: 400 })
    expect(prisma.feedbackTicket.create).not.toHaveBeenCalled()
  })

  it('scopes admin detail to active tickets in the same workspace', async () => {
    const { service, prisma } = setup()
    prisma.feedbackTicket.findFirst.mockResolvedValue(null)
    await expect(service.detail(admin, 'foreign-ticket')).rejects.toMatchObject({ status: 404 })
    expect(prisma.feedbackTicket.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-ticket', workspaceId: 'workspace', status: 'ACTIVE' } })
    expect(prisma.fileLink.findMany).not.toHaveBeenCalled()
  })

  it('paginates admin results using a stable date/id boundary and a database limit', async () => {
    const { service, prisma } = setup()
    const createdAt = new Date('2026-10-19T12:00:00Z')
    prisma.feedbackTicket.findFirst.mockResolvedValue({ id: 'cursor', createdAt })
    prisma.feedbackTicket.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, index) => ({ id: `ticket-${index}`, ownerId: 'sender', title: 'Title', createdAt })))
    const result = await service.list(admin, 'cursor')
    expect(result.items).toHaveLength(20)
    expect(result.nextCursor).toBe('ticket-19')
    expect(prisma.feedbackTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 21, where: { workspaceId: 'workspace', status: 'ACTIVE', OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: 'cursor' } }] } }))
  })

  it('archives with an audit record and returns 404 on an already removed or foreign ticket', async () => {
    const { service, prisma } = setup()
    await expect(service.remove(admin, 'ticket')).resolves.toEqual({ archived: true })
    expect(prisma.feedbackTicket.updateMany).toHaveBeenCalledWith({ where: { id: 'ticket', workspaceId: 'workspace', status: 'ACTIVE' }, data: { status: 'ARCHIVED', archivedAt: expect.any(Date) as unknown, archivedById: 'admin' } })
    expect(prisma.auditEvent.create).toHaveBeenCalledOnce()
    prisma.auditEvent.create.mockClear()
    prisma.feedbackTicket.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.remove(admin, 'ticket')).rejects.toMatchObject({ status: 404 })
    expect(prisma.auditEvent.create).not.toHaveBeenCalled()
  })

  it('lists archived tickets for an administrator with who archived them and when', async () => {
    const { service, prisma } = setup()
    const createdAt = new Date('2026-10-19T12:00:00Z')
    const archivedAt = new Date('2026-10-20T12:00:00Z')
    prisma.feedbackTicket.findMany.mockResolvedValue([{ id: 'ticket', ownerId: 'sender', title: 'Title', createdAt, archivedAt, archivedById: 'admin' }])
    prisma.user.findMany.mockResolvedValue([{ id: 'sender', displayName: 'Автор' }, { id: 'admin', displayName: 'Адмін' }])
    const result = await service.list(admin, undefined, true)
    expect(prisma.feedbackTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace', status: 'ARCHIVED' } }))
    expect(result.items).toEqual([{ id: 'ticket', ownerId: 'sender', title: 'Title', createdAt, author: 'Автор',
      hidden: { hiddenAt: archivedAt.toISOString(), hiddenBy: { id: 'admin', displayName: 'Адмін' } } }])
    expect((await service.list(admin)).items[0]).not.toHaveProperty('hidden')
  })

  it('restores an archived ticket for an administrator, refusing an active (409) or foreign (404) one', async () => {
    const { service, prisma } = setup()
    prisma.feedbackTicket.findFirst.mockResolvedValue({ status: 'ARCHIVED' })
    await expect(service.restore(admin, 'ticket')).resolves.toEqual({ restored: true })
    expect(prisma.feedbackTicket.updateMany).toHaveBeenCalledWith({ where: { id: 'ticket', workspaceId: 'workspace', status: 'ARCHIVED' }, data: { status: 'ACTIVE', archivedAt: null, archivedById: null } })
    expect(prisma.auditEvent.create).toHaveBeenCalledOnce()
    prisma.feedbackTicket.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.restore(admin, 'ticket')).rejects.toMatchObject({ status: 409 })
    prisma.feedbackTicket.findFirst.mockResolvedValue(null)
    await expect(service.restore(admin, 'foreign')).rejects.toMatchObject({ status: 404 })
  })
})

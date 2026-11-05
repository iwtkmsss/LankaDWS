import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { KnowledgeService } from './knowledge.service.js'

const principal = { userId: 'admin', workspaceId: 'workspace', accountType: 'ADMIN', allowedCompanyIds: ['company'] } as AuthPrincipal
const input = { title: ' Updated title ', body: ' Updated body ', changeSummary: ' Changes ', expectedVersion: 2 }

function setup(count = 1, audience: object | null = {}) {
  const tx = { knowledgeArticle: { updateMany: vi.fn().mockResolvedValue({ count }) }, knowledgeArticleVersion: { create: vi.fn() }, fileLink: { upsert: vi.fn(), deleteMany: vi.fn() }, auditEvent: { create: vi.fn() } }
  const prisma = {
    knowledgeArticle: { findFirst: vi.fn().mockResolvedValue({ id: 'article', workspaceId: 'workspace', version: 2, versions: [] }), updateMany: vi.fn().mockResolvedValue({ count }) },
    articleAudience: { findFirst: vi.fn().mockResolvedValue(audience), findMany: vi.fn().mockResolvedValue([{ principalId: 'company' }]) },
    fileLink: { findMany: vi.fn().mockResolvedValue([]) },
    fileObject: { findMany: vi.fn().mockResolvedValue([]) },
    acknowledgement: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  }
  return { service: new KnowledgeService(prisma as unknown as PrismaService), prisma, tx }
}

describe('knowledge updates', () => {
  it('returns a clean image thumbnail only from visible article attachments', async () => {
    const { service, prisma } = setup()
    const findMany = vi.fn().mockResolvedValue([{ id: 'article', slug: 'policy', versions: [{ title: 'Policy' }], reviewAt: null, version: 2, createdAt: new Date('2026-10-05'), requiresAcknowledgement: false, updatedAt: new Date('2026-10-06') }])
    Object.assign(prisma.knowledgeArticle, { findMany })
    prisma.articleAudience.findMany.mockResolvedValue([{ articleId: 'article' }] as never)
    prisma.fileLink.findMany.mockResolvedValue([{ entityId: 'article', fileId: 'document' }, { entityId: 'article', fileId: 'image' }] as never)
    prisma.fileObject.findMany.mockResolvedValue([{ id: 'image' }] as never)
    const result = await service.list(principal)
    expect(result.items[0]?.imageFileId).toBe('image')
    expect(result.items[0]?.hasAcknowledged).toBe(false)
    expect(prisma.acknowledgement.findMany).toHaveBeenCalledWith({ where: { entityType: 'ARTICLE', entityId: { in: ['article'] }, userId: 'admin', confirmedAt: { not: null } }, select: { entityId: true, version: true } })
    prisma.acknowledgement.findMany.mockResolvedValue([{ entityId: 'article', version: 1 }] as never)
    expect((await service.list(principal)).items[0]?.hasAcknowledged).toBe(false)
    prisma.acknowledgement.findMany.mockResolvedValue([{ entityId: 'article', version: 2 }] as never)
    expect((await service.list(principal)).items[0]?.hasAcknowledged).toBe(true)
    expect(prisma.fileLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entityType: 'KNOWLEDGE_ARTICLE', entityId: { in: ['article'] }, purpose: 'ATTACHMENT' } }))
    expect(prisma.fileObject.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'workspace', scanStatus: 'CLEAN', detectedMime: { in: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] } }) as unknown }))
  })
  it('publishes the next version atomically with an audit record', async () => {
    const { service, tx } = setup()
    await expect(service.update(principal, 'policy', input)).resolves.toEqual({ id: 'article', slug: 'policy' })
    expect(tx.knowledgeArticle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'article', workspaceId: 'workspace', version: 2, status: 'ACTIVE' } }))
    expect(tx.knowledgeArticleVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 3, title: 'Updated title', body: 'Updated body', changeSummary: 'Changes' }) as unknown }))
    expect(tx.auditEvent.create).toHaveBeenCalledOnce()
  })
  it('rejects stale versions without publishing', async () => {
    const { service, tx } = setup(0)
    await expect(service.update(principal, 'policy', input)).rejects.toMatchObject({ status: 409 })
    expect(tx.knowledgeArticleVersion.create).not.toHaveBeenCalled()
    expect(tx.auditEvent.create).not.toHaveBeenCalled()
  })
  it('rejects non-admin callers before reading the article', async () => {
    const { service, prisma } = setup()
    await expect(service.update({ ...principal, accountType: 'USER' }, 'policy', input)).rejects.toMatchObject({ status: 403 })
    expect(prisma.knowledgeArticle.findFirst).not.toHaveBeenCalled()
  })
  it('preserves audience checks', async () => {
    const { service, prisma } = setup(1, null)
    await expect(service.update(principal, 'policy', input)).rejects.toMatchObject({ status: 404 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it('rejects empty content', async () => {
    const { service, prisma } = setup()
    await expect(service.update(principal, 'policy', { ...input, body: ' ' })).rejects.toMatchObject({ status: 400 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it('detaches only selected article attachments in the version transaction', async () => {
    const { service, prisma, tx } = setup()
    prisma.fileLink.findMany.mockResolvedValue([{ fileId: 'file' }] as never)
    prisma.fileObject.findMany.mockResolvedValue([{ id: 'file', safeFilename: 'file.pdf', bytes: 10, detectedMime: 'application/pdf', scanStatus: 'CLEAN' }] as never)
    await service.update(principal, 'policy', { ...input, removedAttachmentIds: ['file'] })
    expect(tx.fileLink.deleteMany).toHaveBeenCalledWith({ where: { entityType: 'KNOWLEDGE_ARTICLE', entityId: 'article', purpose: 'ATTACHMENT', fileId: { in: ['file'] } } })
    expect(tx.knowledgeArticleVersion.create).toHaveBeenCalledOnce()
  })
  it('rejects removal of a file that is not attached to this article', async () => {
    const { service, prisma, tx } = setup()
    await expect(service.update(principal, 'policy', { ...input, removedAttachmentIds: ['foreign'] })).rejects.toMatchObject({ status: 400 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.fileLink.deleteMany).not.toHaveBeenCalled()
  })
  it('archives an article using the supplied version', async () => {
    const { service, prisma } = setup()
    await expect(service.archive(principal, 'policy', 2)).resolves.toEqual({ archived: true })
    expect(prisma.knowledgeArticle.updateMany).toHaveBeenCalledWith({ where: { id: 'article', workspaceId: 'workspace', status: 'ACTIVE', version: 2 }, data: { status: 'ARCHIVED', version: { increment: 1 } } })
  })
})


describe('mandatory knowledge reading', () => {
  function pendingSetup() {
    const { service, prisma } = setup()
    const findMany = vi.fn().mockResolvedValue([
      { id: 'a', slug: 'first', version: 2, requiresAcknowledgement: true, versions: [{ title: 'First' }] },
      { id: 'b', slug: 'second', version: 1, requiresAcknowledgement: true, versions: [{ title: 'Second' }] },
    ])
    Object.assign(prisma.knowledgeArticle, { findMany })
    const receipts = vi.fn().mockResolvedValue([{ entityId: 'a', version: 1 }, { entityId: 'b', version: 1 }])
    Object.assign(prisma.acknowledgement, { findMany: receipts })
    prisma.articleAudience.findMany.mockResolvedValue([{ articleId: 'a' }, { articleId: 'b' }] as never)
    return { service, prisma, findMany, receipts }
  }
  it('counts only current unconfirmed mandatory articles in the caller audience and workspace', async () => {
    const { service, prisma, findMany, receipts } = pendingSetup()
    expect(await service.pendingAcknowledgements(principal)).toEqual({ pendingCount: 1, requiredPendingCount: 1, nextArticle: { slug: 'first', title: 'First' } })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace', status: 'ACTIVE', requiresAcknowledgement: true, id: { in: ['a', 'b'] } } }))
    expect(prisma.articleAudience.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ principalType: 'COMPANY', principalId: { in: ['company'] } }, { principalType: 'USER', principalId: 'admin' }] } }))
    expect(receipts).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'admin', confirmedAt: { not: null } }) as unknown }))
  })
  it('includes optional unread articles in the navigation indicator', async () => {
    const { service, findMany, receipts } = pendingSetup()
    findMany.mockResolvedValue([{ id: 'a', slug: 'optional', version: 2, versions: [{ title: 'Optional' }] }])
    expect(await service.readingSummary(principal)).toEqual({ unreadCount: 1, requiredUnreadCount: 0 })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace', status: 'ACTIVE', id: { in: ['a', 'b'] } } }))
    receipts.mockResolvedValue([{ entityId: 'a', version: 2 }])
    expect(await service.readingSummary(principal)).toEqual({ unreadCount: 0, requiredUnreadCount: 0 })
  })
  it('prioritizes mandatory unread articles until their current version is confirmed', async () => {
    const { service, findMany, receipts } = pendingSetup()
    findMany.mockResolvedValue([
      { id: 'a', slug: 'required', version: 2, requiresAcknowledgement: true, versions: [{ title: 'Required' }] },
      { id: 'b', slug: 'optional', version: 1, requiresAcknowledgement: false, versions: [{ title: 'Optional' }] },
    ])
    receipts.mockResolvedValue([])
    expect(await service.readingSummary(principal)).toEqual({ unreadCount: 2, requiredUnreadCount: 1 })
    receipts.mockResolvedValue([{ entityId: 'a', version: 2 }])
    expect(await service.readingSummary(principal)).toEqual({ unreadCount: 1, requiredUnreadCount: 0 })
  })
  it('keeps a reminder after opening and removes it only after explicit confirmation', async () => {
    const { service, prisma, receipts } = pendingSetup()
    prisma.knowledgeArticle.findFirst.mockResolvedValue({ id: 'a', workspaceId: 'workspace', version: 2, versions: [] })
    const upsert = vi.fn().mockImplementation(() => {
      receipts.mockResolvedValue([{ entityId: 'a', version: 2 }, { entityId: 'b', version: 1 }])
      return Promise.resolve()
    })
    Object.assign(prisma.acknowledgement, { upsert })
    await service.detail(principal, 'first')
    expect((await service.pendingAcknowledgements(principal)).pendingCount).toBe(1)
    expect(upsert).not.toHaveBeenCalled()
    await service.acknowledge(principal, 'first', 2)
    expect(await service.pendingAcknowledgements(principal)).toEqual({ pendingCount: 0, requiredPendingCount: 0, nextArticle: null })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: 'admin', version: 2, confirmedAt: expect.any(Date) as unknown }) as unknown }))
  })
  it('does not acknowledge a stale article version', async () => {
    const { service, prisma } = setup()
    const upsert = vi.fn()
    Object.assign(prisma.acknowledgement, { upsert })
    await expect(service.acknowledge(principal, 'policy', 1)).rejects.toMatchObject({ status: 409 })
    expect(upsert).not.toHaveBeenCalled()
  })
  it('allows administrators to change mandatory reading and rejects malformed flags', async () => {
    const { service, tx } = setup()
    await service.update(principal, 'policy', { ...input, requiresAcknowledgement: true })
    expect(tx.knowledgeArticle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ requiresAcknowledgement: true }) as unknown }))
    await expect(service.update(principal, 'policy', { ...input, requiresAcknowledgement: 'false' as never })).rejects.toMatchObject({ status: 400 })
  })
  it('rejects article creation by non-admins', async () => {
    const { service, prisma } = setup()
    await expect(service.create({ ...principal, accountType: 'USER' }, { slug: 'policy', title: 'Policy', body: 'Body', companyIds: ['company'], requiresAcknowledgement: true })).rejects.toMatchObject({ status: 403 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

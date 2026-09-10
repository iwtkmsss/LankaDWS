import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { KnowledgeService } from './knowledge.service.js'

const principal = { userId: 'admin', workspaceId: 'workspace', accountType: 'ADMIN', allowedCompanyIds: ['company'] } as AuthPrincipal
const input = { title: ' Updated title ', body: ' Updated body ', changeSummary: ' Changes ', expectedVersion: 2 }

function setup(count = 1, audience: object | null = {}) {
  const tx = { knowledgeArticle: { updateMany: vi.fn().mockResolvedValue({ count }) }, knowledgeArticleVersion: { create: vi.fn() }, fileLink: { upsert: vi.fn() }, auditEvent: { create: vi.fn() } }
  const prisma = {
    knowledgeArticle: { findFirst: vi.fn().mockResolvedValue({ id: 'article', workspaceId: 'workspace', version: 2, versions: [] }), updateMany: vi.fn().mockResolvedValue({ count }) },
    articleAudience: { findFirst: vi.fn().mockResolvedValue(audience), findMany: vi.fn().mockResolvedValue([{ principalId: 'company' }]) },
    fileLink: { findMany: vi.fn().mockResolvedValue([]) },
    fileObject: { findMany: vi.fn().mockResolvedValue([]) },
    acknowledgement: { findFirst: vi.fn().mockResolvedValue(null) },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  }
  return { service: new KnowledgeService(prisma as unknown as PrismaService), prisma, tx }
}

describe('knowledge updates', () => {
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
  it('archives an article using the supplied version', async () => {
    const { service, prisma } = setup()
    await expect(service.archive(principal, 'policy', 2)).resolves.toEqual({ archived: true })
    expect(prisma.knowledgeArticle.updateMany).toHaveBeenCalledWith({ where: { id: 'article', workspaceId: 'workspace', status: 'ACTIVE', version: 2 }, data: { status: 'ARCHIVED', version: { increment: 1 } } })
  })
})

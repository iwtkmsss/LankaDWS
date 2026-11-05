import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { ScopeService } from '../authorization/scope.service.js'
import { TaskCatalogService } from './task-catalog.service.js'

function setup() {
  const users = vi.fn().mockResolvedValue([])
  const service = new TaskCatalogService({
    user: { findMany: users }, project: { findMany: vi.fn().mockResolvedValue([]) },
    tag: { findMany: vi.fn().mockResolvedValue([]) }, task: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService, { assertCompany: () => 'company-a' } as unknown as ScopeService)
  return { users, service, principal: { workspaceId: 'workspace-a', userId: 'me', accountType: 'USER' } as AuthPrincipal }
}

describe('task catalog user search', () => {
  it('does not preload users for the initial catalog request', async () => {
    const { service, users, principal } = setup()
    expect((await service.options(principal, {})).users).toEqual([])
    expect(users).not.toHaveBeenCalled()
  })
  it('limits database matches and normalizes a one-character search', async () => {
    const { service, users, principal } = setup()
    await service.options(principal, { search: ' Я ' })
    expect(users.mock.calls[0]?.[0]).toMatchObject({
      where: { workspaceId: 'workspace-a', isActive: true, AND: [{}, { OR: [
        { normalizedDisplayName: 'я' }, { normalizedUsername: 'я' },
      ] }, { id: { notIn: [] } }] }, take: 5,
    })
  })
})

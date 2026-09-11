import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { TaskHierarchyService } from './task-hierarchy.service.js'

const principal: AuthPrincipal = {
  userId: 'usr_actor',
  workspaceId: 'wrk_1',
  username: 'actor',
  displayName: 'Actor',
  accountType: 'USER',
  primaryCompanyId: 'cmp_1',
  allowedCompanyIds: ['cmp_1'],
  authorizationVersion: 1,
  sessionId: 'ses_1',
  authAssurance: 1,
  restricted: false,
}

describe('TaskHierarchyService', () => {
  it('returns the complete readable tree that contains the searched task', async () => {
    const items = [
      { id: 'tsk_root', number: '1', title: 'Root', status: 'NEW', groupId: null, projectId: 'prj_1', parentTaskId: null },
      { id: 'tsk_selected', number: '2', title: 'Selected', status: 'NEW', groupId: null, projectId: 'prj_1', parentTaskId: 'tsk_root' },
      { id: 'tsk_sibling', number: '3', title: 'Sibling', status: 'NEW', groupId: null, projectId: 'prj_1', parentTaskId: 'tsk_root' },
      { id: 'tsk_deep', number: '4', title: 'Deep', status: 'NEW', groupId: null, projectId: 'prj_1', parentTaskId: 'tsk_selected' },
      { id: 'tsk_other', number: '5', title: 'Other root', status: 'NEW', groupId: null, projectId: 'prj_1', parentTaskId: null },
    ]
    const prisma = {
      task: { findMany: vi.fn().mockResolvedValue(items) },
    }
    const access = {
      readableTask: vi.fn().mockResolvedValue({
        id: 'tsk_selected',
        companyId: 'cmp_1',
        groupId: null,
        projectId: 'prj_1',
      }),
    }
    const service = new TaskHierarchyService(prisma as never, access as never)

    const result = await service.tree(principal, 'tsk_selected')

    expect(result.rootId).toBe('tsk_root')
    expect(result.items.map((item) => item.id)).toEqual([
      'tsk_root',
      'tsk_selected',
      'tsk_sibling',
      'tsk_deep',
    ])
    expect(access.readableTask).toHaveBeenCalledWith(principal, 'tsk_selected')
    const query = prisma.task.findMany.mock.calls[0]?.[0] as unknown as {
      where: {
        workspaceId: string
        companyId: string
        projectId: string | null
        OR: Array<Record<string, unknown>>
      }
    }
    expect(query.where.workspaceId).toBe('wrk_1')
    expect(query.where.companyId).toBe('cmp_1')
    expect(query.where.projectId).toBe('prj_1')
    expect(query.where.OR).toContainEqual({ createdById: 'usr_actor' })
    expect(query.where.OR).toContainEqual({ reporterId: 'usr_actor' })
  })
})

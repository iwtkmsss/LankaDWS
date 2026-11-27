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

interface Row {
  id: string
  number: string
  title: string
  status: string
  projectId: string | null
  parentTaskId: string | null
  createdAt: Date
  workspaceId: string
  companyId: string
  archivedAt: Date | null
  createdById: string
  reporterId: string
}

/** A task the actor reads as its creator unless overridden. */
function row(id: string, parentTaskId: string | null, minute: number, overrides: Partial<Row> = {}): Row {
  return {
    id, number: id, title: id, status: 'NEW', projectId: 'prj_1', parentTaskId,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
    workspaceId: 'wrk_1', companyId: 'cmp_1', archivedAt: null, createdById: 'usr_actor', reporterId: 'usr_other',
    ...overrides,
  }
}
const stranger = { createdById: 'usr_other', reporterId: 'usr_other' }

function serviceFor(rows: Row[], selectedId: string, participants: Array<{ taskId: string; userId: string; removedAt: Date | null }> = []) {
  const prisma = {
    task: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(rows.find((item) => item.id === where.id) ?? null)),
      // Deliberately reverse order so the service must apply the canonical order itself.
      findMany: vi.fn(({ where }: { where: { parentTaskId: { in: string[] } } }) => Promise.resolve(rows
        .filter((item) => item.parentTaskId !== null && where.parentTaskId.in.includes(item.parentTaskId))
        .reverse())),
    },
    taskParticipant: {
      findMany: vi.fn(({ where }: { where: { userId: string; removedAt: null; taskId: { in: string[] } } }) => Promise.resolve(participants
        .filter((item) => item.userId === where.userId && item.removedAt === null && where.taskId.in.includes(item.taskId))
        .map((item) => ({ taskId: item.taskId })))),
    },
  }
  const selected = rows.find((item) => item.id === selectedId)!
  const access = {
    readableTask: vi.fn().mockResolvedValue({ ...selected }),
  }
  return { prisma, access, service: new TaskHierarchyService(prisma as never, access as never) }
}

describe('TaskHierarchyService', () => {
  it('returns the complete readable tree that contains the searched task', async () => {
    const { access, service } = serviceFor([
      row('tsk_root', null, 1),
      row('tsk_selected', 'tsk_root', 2),
      row('tsk_sibling', 'tsk_root', 3),
      row('tsk_deep', 'tsk_selected', 4),
      row('tsk_other', null, 5),
    ], 'tsk_selected')

    const result = await service.tree(principal, 'tsk_selected')

    expect(result.rootId).toBe('tsk_root')
    expect(result.items.map((item) => item.id)).toEqual(['tsk_root', 'tsk_selected', 'tsk_sibling', 'tsk_deep'])
    expect(result.items[0]).toEqual({
      id: 'tsk_root', number: 'tsk_root', title: 'tsk_root', status: 'NEW', projectId: 'prj_1', parentTaskId: null,
    })
    expect(access.readableTask).toHaveBeenCalledWith(principal, 'tsk_selected')
  })

  it('stops the upward walk at an unreadable parent and hides unreadable, archived or out-of-scope subtrees', async () => {
    const { service } = serviceFor([
      row('tsk_hidden_root', null, 1, stranger),
      row('tsk_top', 'tsk_hidden_root', 2, { createdById: 'usr_other', reporterId: 'usr_actor' }),
      row('tsk_hidden_child', 'tsk_top', 3, stranger),
      row('tsk_under_hidden', 'tsk_hidden_child', 4),
      row('tsk_archived', 'tsk_top', 5, { archivedAt: new Date() }),
      row('tsk_other_project', 'tsk_top', 6, { projectId: 'prj_2' }),
      row('tsk_other_company', 'tsk_top', 7, { companyId: 'cmp_2' }),
      row('tsk_other_workspace', 'tsk_top', 8, { workspaceId: 'wrk_2' }),
      row('tsk_participant', 'tsk_top', 9, stranger),
      row('tsk_removed_participant', 'tsk_top', 10, stranger),
      row('tsk_selected', 'tsk_top', 11),
    ], 'tsk_selected', [
      { taskId: 'tsk_participant', userId: 'usr_actor', removedAt: null },
      { taskId: 'tsk_removed_participant', userId: 'usr_actor', removedAt: new Date() },
      { taskId: 'tsk_hidden_child', userId: 'usr_someone', removedAt: null },
    ])

    const result = await service.tree(principal, 'tsk_selected')

    expect(result.rootId).toBe('tsk_top')
    expect(result.items.map((item) => item.id)).toEqual(['tsk_top', 'tsk_participant', 'tsk_selected'])
  })

  it('keeps null-project trees separate from project trees', async () => {
    const { service } = serviceFor([
      row('tsk_root', null, 1, { projectId: null }),
      row('tsk_selected', 'tsk_root', 2, { projectId: null }),
      row('tsk_project_child', 'tsk_selected', 3),
    ], 'tsk_selected')
    const result = await service.tree(principal, 'tsk_selected')
    expect(result.items.map((item) => item.id)).toEqual(['tsk_root', 'tsk_selected'])
  })

  it('returns an empty tree when the selected task itself is outside the tree scope', async () => {
    const { service } = serviceFor([row('tsk_selected', null, 1, { archivedAt: new Date() })], 'tsk_selected')
    await expect(service.tree(principal, 'tsk_selected')).resolves.toEqual({ rootId: 'tsk_selected', items: [] })
  })

  it('terminates on parent cycles and orders by creation time then id', async () => {
    const { service } = serviceFor([
      row('tsk_b', 'tsk_a', 1),
      row('tsk_a', 'tsk_c', 1),
      row('tsk_c', 'tsk_b', 0),
    ], 'tsk_a')

    const result = await service.tree(principal, 'tsk_a')

    // Upward walk: a -> c -> b -> a (already visited) stops at tsk_a, matching the previous in-memory walk.
    expect(result.rootId).toBe('tsk_a')
    expect(result.items.map((item) => item.id)).toEqual(['tsk_c', 'tsk_a', 'tsk_b'])
  })

  it('lets global administrators read every in-scope node without participation lookups', async () => {
    const { prisma, service } = serviceFor([
      row('tsk_root', null, 1, stranger),
      row('tsk_selected', 'tsk_root', 2, stranger),
      row('tsk_archived', 'tsk_root', 3, { ...stranger, archivedAt: new Date() }),
    ], 'tsk_selected')
    const result = await service.tree({ ...principal, accountType: 'ADMIN' }, 'tsk_selected')
    expect(result.items.map((item) => item.id)).toEqual(['tsk_root', 'tsk_selected'])
    expect(prisma.taskParticipant.findMany).not.toHaveBeenCalled()
  })
})

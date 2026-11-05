import { expect, it, vi } from 'vitest'
import { CalendarController } from './calendar.controller.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { ScopeService } from '../authorization/scope.service.js'
import type { CalendarService } from './calendar.service.js'
import type { AuthPrincipal, LankaDWSRequest } from '../../common/request-context.js'

const principal = { userId: 'me', workspaceId: 'workspace', primaryCompanyId: 'mine', accountType: 'USER' } as AuthPrincipal
const event = { id: 'event', ownerId: 'me', companyId: 'other', title: 'Meeting', visibility: 'INTERNAL',
  startAt: new Date('2026-10-05T09:00:00Z'), endAt: new Date('2026-10-05T10:00:00Z'),
  sourceTimezone: 'Europe/Kyiv', recurrenceJson: null, audiences: [{ companyId: 'mine' }] }
const task = { id: 'task', companyId: 'mine', title: 'Deadline', dueAt: new Date('2026-10-06T12:00:00Z'), createdById: 'other', reporterId: 'me' }
function setup() {
  const prisma = { event: { findMany: vi.fn().mockResolvedValue([event, { ...event, id: 'private', visibility: 'PRIVATE' }, { ...event, id: 'other-company', audiences: [{ companyId: 'other' }] }]) },
    task: { findMany: vi.fn<(query: { where: Record<string, unknown> }) => Promise<typeof task[]>>().mockResolvedValue([task]) }, user: { findMany: vi.fn().mockResolvedValue([]) }, company: { findMany: vi.fn().mockResolvedValue([]) } }
  return { prisma, controller: new CalendarController(prisma as unknown as PrismaService, { allowedCompanies: () => ['mine', 'other'] } as unknown as ScopeService, {} as CalendarService) }
}
const request = { principal } as LankaDWSRequest
it('company filter includes all readable shared events, excluding private events and tasks', async () => {
  const { controller } = setup()
  const result = await controller.events(request, 'all', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 'TEAM')
  expect(result.items.map((item) => item.id)).toEqual(['event', 'other-company'])
  expect(result.counts).toEqual({ ALL: 4, MINE: 1, TEAM: 2, TASKS: 1 })
})
it('personal filter includes only owned private events, excluding owned shared events and tasks', async () => {
  const { controller } = setup()
  const result = await controller.events(request, 'all', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 'MINE')
  expect(result.items.map((item) => item.id)).toEqual(['private'])
  expect(result.counts.MINE).toBe(result.items.length)
})
it('keeps all readable entries in All while the three category filters never overlap', async () => {
  const { controller } = setup()
  const load = (scope: string) => controller.events(request, 'all', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', scope)
  const all = await load('ALL')
  expect(all.items.map((item) => item.id)).toEqual(['event', 'other-company', 'private', 'task'])
  const categories = await Promise.all(['MINE', 'TEAM', 'TASKS'].map(load))
  const ids = categories.flatMap((result) => result.items.map((item) => item.id))
  expect(new Set(ids).size).toBe(ids.length)
  expect([...ids].sort()).toEqual(all.items.map((item) => item.id).sort())
  expect(all.counts.ALL).toBe(all.counts.MINE + all.counts.TEAM + all.counts.TASKS)
  expect(categories.map((result) => result.items.length)).toEqual([all.counts.MINE, all.counts.TEAM, all.counts.TASKS])
})
it('keeps readable shared events in Company even without a primary company', async () => {
  const { controller } = setup()
  const result = await controller.events({ principal: { ...principal, primaryCompanyId: null } } as LankaDWSRequest,
    'all', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 'TEAM')
  expect(result.items.map((item) => item.id)).toEqual(['event', 'other-company'])
  expect(result.counts).toMatchObject({ TEAM: 2, MINE: 1, TASKS: 1 })
})
it('accounts for all fourteen entries across companies instead of losing two from category counts', async () => {
  const { controller, prisma } = setup()
  prisma.event.findMany.mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({
    ...event, id: `event-${index}`, audiences: [{ companyId: index < 4 ? 'mine' : 'other' }],
  })))
  prisma.task.findMany.mockResolvedValue(Array.from({ length: 8 }, (_, index) => ({ ...task, id: `task-${index}` })))
  const result = await controller.events(request, 'all', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 'ALL')
  expect(result.items).toHaveLength(14)
  expect(result.counts).toEqual({ ALL: 14, MINE: 0, TEAM: 6, TASKS: 8 })
})
it('tasks filter projects deadline and enforces task confidentiality in the database query', async () => {
  const { controller, prisma } = setup()
  const result = await controller.events(request, 'all', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 'TASKS')
  expect(result.items).toEqual([expect.objectContaining({ id: 'task', taskId: 'task', kind: 'TASK', startAt: '2026-10-06T12:00:00.000Z' })])
  expect(prisma.task.findMany.mock.calls[0]?.[0].where).toMatchObject({ workspaceId: 'workspace', archivedAt: null,
    OR: [{ createdById: 'me' }, { reporterId: 'me' }, { participants: { some: { userId: 'me', removedAt: null } } }],
    dueAt: { gte: new Date('2026-10-01T00:00:00Z'), lt: new Date('2026-11-01T00:00:00Z') },
  })
})
it('rejects invalid or unbounded ranges before querying', async () => {
  const { controller, prisma } = setup()
  await expect(controller.events(request, 'all', 'bad', '2026-11-01T00:00:00Z')).rejects.toThrow()
  await expect(controller.events(request, 'all', '2020-01-01T00:00:00Z', '2026-11-01T00:00:00Z')).rejects.toThrow()
  expect(prisma.event.findMany).not.toHaveBeenCalled()
})

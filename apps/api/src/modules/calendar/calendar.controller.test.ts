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
it('company filter includes own shared events by audience, excluding private and other audiences', async () => {
  const { controller } = setup()
  const result = await controller.events(request, 'all', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 'TEAM')
  expect(result.items.map((item) => item.id)).toEqual(['event', 'task'])
  expect(result.counts).toEqual({ ALL: 4, MINE: 4, TEAM: 2, TASKS: 1 })
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

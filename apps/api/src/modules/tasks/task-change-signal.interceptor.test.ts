import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { lastValueFrom, of, throwError } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { TaskChangeSignalInterceptor } from './task-change-signal.interceptor.js'

function setup() {
  const findUnique = vi.fn().mockResolvedValue({
    workspaceId: 'workspace',
    createdById: 'creator',
    reporterId: 'actor',
    participants: [{ userId: 'viewer' }, { userId: 'creator' }],
  })
  const admins = vi.fn().mockResolvedValue([{ id: 'admin' }, { id: 'actor' }])
  const publishSummary = vi.fn()
  const interceptor = new TaskChangeSignalInterceptor({ task: { findUnique }, user: { findMany: admins } } as unknown as PrismaService, { publishSummary } as never)
  const run = (method: string, path: string, params: Record<string, string>, handler: CallHandler = { handle: () => of({ ok: true }) }) => {
    const request = { method, params, route: { path }, principal: { userId: 'actor' } }
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext
    return lastValueFrom(interceptor.intercept(context, handler))
  }
  return { findUnique, publishSummary, run }
}

describe('TaskChangeSignalInterceptor', () => {
  it('signals everyone on the task and administrators, except the person who changed it', async () => {
    const { publishSummary, run } = setup()
    await run('POST', '/tasks/:id/checklist', { id: 'task-1' })
    await vi.waitFor(() => expect(publishSummary).toHaveBeenCalledTimes(1))
    expect(publishSummary).toHaveBeenCalledWith(new Set(['creator', 'viewer', 'admin']), ['notifications'])
  })

  it.each([
    ['GET', '/tasks/:id', { id: 'task-1' }],
    ['POST', '/tasks', {}],
    ['PUT', '/tasks/:id/user-state', { id: 'task-1' }],
  ])('stays silent for %s %s', async (method, path, params) => {
    const { findUnique, run } = setup()
    await run(method, path, params)
    await new Promise((resolve) => setTimeout(resolve))
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('stays silent when the change failed', async () => {
    const { findUnique, run } = setup()
    await expect(run('POST', '/tasks/:id/checklist', { id: 'task-1' }, { handle: () => throwError(() => new Error('conflict')) })).rejects.toThrow('conflict')
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('does not fail the response when the signal cannot be sent', async () => {
    const { findUnique, publishSummary, run } = setup()
    findUnique.mockRejectedValue(new Error('database busy'))
    await expect(run('POST', '/tasks/:id/checklist', { id: 'task-1' })).resolves.toEqual({ ok: true })
    await new Promise((resolve) => setTimeout(resolve))
    expect(publishSummary).not.toHaveBeenCalled()
  })
})

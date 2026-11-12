import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { addOrgUnitThreadMembers, ensureOrgUnitThread, leaveFormerOrgUnitThreads } from './org-unit-chat.js'

const principal = { userId: 'usr_admin', workspaceId: 'wrk_one', accountType: 'ADMIN', allowedCompanyIds: ['cmp_one'] } as AuthPrincipal
const unit = { id: 'org_design', workspaceId: 'wrk_one', companyId: 'cmp_one', name: 'Дизайн', managerId: 'usr_boss' }
type Tx = Parameters<typeof addOrgUnitThreadMembers>[0]

function setup({ threadExists = true, participants = [] as Array<{ id: string; userId: string; leftAt: Date | null }> } = {}) {
  const tx = {
    messageThread: {
      findUnique: vi.fn().mockResolvedValue(threadExists ? { id: 'thr_org_design' } : null),
      create: vi.fn<(input: { data: Record<string, unknown> }) => Promise<{ version: number }>>().mockResolvedValue({ version: 1 }),
      update: vi.fn().mockResolvedValue({ version: 5 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    threadParticipant: {
      findMany: vi.fn().mockResolvedValue(participants),
      createMany: vi.fn<(input: { data: Array<{ userId: string; role: string }> }) => Promise<object>>().mockResolvedValue({}),
      create: vi.fn<(input: { data: { userId: string; role: string } }) => Promise<object>>().mockResolvedValue({}),
      update: vi.fn<(input: { where: { id: string }; data: { leftAt: null } }) => Promise<object>>().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findMany: vi.fn<(input: { where: { id: { in?: string[]; notIn?: string[] } } }) => Promise<Array<{ id: string; displayName?: string }>>>().mockResolvedValue([]) },
    message: { create: vi.fn<(input: { data: { threadId: string; authorId: string; body: string } }) => Promise<object>>().mockResolvedValue({}) },
    notification: { upsert: vi.fn<(input: { create: { recipientId: string } }) => Promise<object>>().mockResolvedValue({}) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    userOrgAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    orgUnit: { findMany: vi.fn().mockResolvedValue([]) },
  }
  return { tx, client: tx as unknown as Tx }
}

describe('department chat', () => {
  it('creates one group chat per unit, linked to it, with the manager as owner', async () => {
    const { tx, client } = setup({ threadExists: false })
    tx.user.findMany.mockResolvedValueOnce([{ id: 'usr_boss' }, { id: 'usr_member' }])
    await expect(ensureOrgUnitThread(client, principal, unit)).resolves.toBe('thr_org_design')
    expect(tx.messageThread.create.mock.calls[0][0].data).toMatchObject({
      id: 'thr_org_design', kind: 'GROUP', title: 'Дизайн', companyId: 'cmp_one', entityType: 'ORG_UNIT', entityId: 'org_design',
    })
    expect(tx.threadParticipant.createMany.mock.calls[0][0].data.map(({ userId, role }) => ({ userId, role })))
      .toEqual([{ userId: 'usr_boss', role: 'OWNER' }, { userId: 'usr_member', role: 'MEMBER' }])
  })

  it('reuses the existing chat instead of creating a duplicate', async () => {
    const { tx, client } = setup()
    await ensureOrgUnitThread(client, principal, unit)
    expect(tx.messageThread.create).not.toHaveBeenCalled()
  })

  it('adds a new member and announces them in the chat', async () => {
    const { tx, client } = setup()
    tx.user.findMany.mockResolvedValueOnce([{ id: 'usr_new', displayName: 'Олена Шевченко' }])
    const events = await addOrgUnitThreadMembers(client, principal, unit, ['usr_new'])
    expect(tx.threadParticipant.create.mock.calls[0][0].data).toMatchObject({ userId: 'usr_new', role: 'MEMBER' })
    expect(tx.message.create.mock.calls[0][0].data).toMatchObject({
      threadId: 'thr_org_design', authorId: 'usr_admin', body: 'До підрозділу «Дизайн» додано нового учасника: Олена Шевченко.',
    })
    expect(tx.notification.upsert.mock.calls[0][0].create.recipientId).toBe('usr_new')
    expect(events.threadIds).toEqual(['thr_org_design'])
    expect(events.messages).toHaveLength(1)
  })

  it('returns a former participant without duplicating the row and skips current ones silently', async () => {
    const { tx, client } = setup({ participants: [
      { id: 'tpart_back', userId: 'usr_back', leftAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'tpart_here', userId: 'usr_here', leftAt: null },
    ] })
    tx.user.findMany.mockResolvedValueOnce([{ id: 'usr_back', displayName: 'Іван Франко' }])
    await addOrgUnitThreadMembers(client, principal, unit, ['usr_back', 'usr_here'])
    expect(tx.user.findMany.mock.calls[0][0].where.id).toEqual({ in: ['usr_back'] })
    expect(tx.threadParticipant.update.mock.calls[0][0]).toMatchObject({ where: { id: 'tpart_back' }, data: { leftAt: null } })
    expect(tx.threadParticipant.create).not.toHaveBeenCalled()
    expect(tx.message.create).toHaveBeenCalledOnce()
  })

  it('posts nothing when everyone already participates', async () => {
    const { tx, client } = setup({ participants: [{ id: 'tpart_here', userId: 'usr_here', leftAt: null }] })
    await expect(addOrgUnitThreadMembers(client, principal, unit, ['usr_here'])).resolves.toEqual({ threadIds: [], messages: [] })
    expect(tx.message.create).not.toHaveBeenCalled()
    expect(tx.messageThread.update).not.toHaveBeenCalled()
  })

  it('removes a person only from chats of units they no longer belong to', async () => {
    const { tx, client } = setup({ participants: [{ id: 'tpart_old', userId: 'usr_moved', leftAt: null }].map((row) => ({ ...row, threadId: 'thr_org_old' })) })
    tx.userOrgAssignment.findMany.mockResolvedValueOnce([{ orgUnitId: 'org_design' }])
    tx.orgUnit.findMany.mockResolvedValueOnce([{ id: 'org_managed' }])
    await expect(leaveFormerOrgUnitThreads(client, ['usr_moved'])).resolves.toEqual({ threadIds: ['thr_org_old'], messages: [] })
    expect(tx.threadParticipant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'usr_moved', leftAt: null, thread: { entityType: 'ORG_UNIT', entityId: { notIn: ['org_design', 'org_managed'] } } },
    }))
    expect(tx.threadParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['tpart_old'] }, leftAt: null } }))
  })
})

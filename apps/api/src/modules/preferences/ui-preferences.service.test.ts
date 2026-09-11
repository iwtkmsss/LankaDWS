import { describe, expect, it, vi } from 'vitest'
import { TASK_DETAIL_SECTION_IDS } from '@lankadws/contracts'
import type { AuthPrincipal } from '../../common/request-context.js'
import { UiPreferencesService } from './ui-preferences.service.js'

const principal: AuthPrincipal = {
  userId: 'usr_one',
  workspaceId: 'ws_one',
  username: 'one',
  displayName: 'One',
  primaryCompanyId: 'cmp_one',
  accountType: 'USER',
  allowedCompanyIds: ['cmp_one'],
  authorizationVersion: 1,
  sessionId: 'ses_one',
  authAssurance: 1,
  restricted: false,
}

const value = {
  order: [...TASK_DETAIL_SECTION_IDS],
  hidden: ['history' as const],
  collapsed: ['materials' as const],
}

describe('UiPreferencesService', () => {
  it('creates the preference only for the authenticated user', async () => {
    const created = {
      id: 'uip_one',
      userId: principal.userId,
      module: 'TASKS',
      key: 'DETAIL_LAYOUT',
      schemaVersion: 1,
      valueJson: JSON.stringify(value),
      version: 1,
      createdAt: new Date('2026-08-11T09:00:00.000Z'),
      updatedAt: new Date('2026-08-11T09:00:00.000Z'),
    }
    const create = vi.fn((input: unknown) => {
      void input
      return Promise.resolve(created)
    })
    const tx = {
      userUiPreference: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    const service = new UiPreferencesService(prisma as never)

    await expect(service.putTaskDetail(principal, {
      schemaVersion: 1,
      value,
      expectedVersion: 0,
    })).resolves.toMatchObject({ version: 1, value })
    expect(create).toHaveBeenCalledOnce()
    const createInput = create.mock.calls[0]?.[0] as { data: { userId: string; module: string; key: string } }
    expect(createInput.data).toMatchObject({ userId: principal.userId, module: 'TASKS', key: 'DETAIL_LAYOUT' })
  })

  it('rejects a stale update without writing', async () => {
    const tx = {
      userUiPreference: {
        findUnique: vi.fn().mockResolvedValue({ id: 'uip_one', version: 3 }),
        updateMany: vi.fn(),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    const service = new UiPreferencesService(prisma as never)

    await expect(service.putTaskDetail(principal, {
      schemaVersion: 1,
      value,
      expectedVersion: 2,
    })).rejects.toMatchObject({ status: 409, safeDetail: 'ui_preference_version' })
    expect(tx.userUiPreference.updateMany).not.toHaveBeenCalled()
  })

  it('resets only the authenticated user preference at the expected version', async () => {
    const prisma = { userUiPreference: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) } }
    const service = new UiPreferencesService(prisma as never)

    await expect(service.resetTaskDetail(principal, 4)).resolves.toEqual({ deleted: true })
    const deleteInput = prisma.userUiPreference.deleteMany.mock.calls[0]?.[0] as {
      where: { userId: string; version: number }
    }
    expect(deleteInput.where).toMatchObject({ userId: principal.userId, version: 4 })
  })

  it('rejects default reset when another device has created a preference', async () => {
    const prisma = {
      userUiPreference: {
        findUnique: vi.fn().mockResolvedValue({ id: 'uip_other_device' }),
        deleteMany: vi.fn(),
      },
    }
    const service = new UiPreferencesService(prisma as never)

    await expect(service.resetTaskDetail(principal, 0)).rejects.toMatchObject({ status: 409 })
    expect(prisma.userUiPreference.deleteMany).not.toHaveBeenCalled()
  })
})

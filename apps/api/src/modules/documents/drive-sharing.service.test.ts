import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { DriveSharingService } from './drive-sharing.service.js'

const principal: AuthPrincipal = {
  userId: 'usr_viewer',
  workspaceId: 'workspace-1',
  username: 'viewer',
  displayName: 'Viewer',
  primaryCompanyId: 'company-1',
  accountType: 'USER',
  allowedCompanyIds: ['company-1'],
  authorizationVersion: 1,
  sessionId: 'session-1',
  authAssurance: 1,
  restricted: false,
}

describe('DriveSharingService grant resolution', () => {
  const prisma = {
    driveShare: { findMany: vi.fn() },
    driveFolder: { findMany: vi.fn() },
    document: { findMany: vi.fn() },
  }
  const service = () => new DriveSharingService(prisma as never)

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.driveShare.findMany.mockResolvedValue([])
    prisma.driveFolder.findMany.mockResolvedValue([])
    prisma.document.findMany.mockResolvedValue([])
  })

  it('grants a directly shared document without touching the folder tree', async () => {
    prisma.driveShare.findMany.mockResolvedValue([
      { targetType: 'DOCUMENT', targetId: 'doc_1', role: 'VIEWER' },
    ])

    const grants = await service().grantsFor(principal)

    expect([...grants.documentIds]).toEqual(['doc_1'])
    expect(grants.folderIds.size).toBe(0)
    expect(grants.roleOf('DOCUMENT', 'doc_1')).toBe('VIEWER')
    expect(grants.roleOf('DOCUMENT', 'doc_other')).toBeNull()
  })

  it('reaches nested subfolders and the documents inside a shared folder', async () => {
    prisma.driveShare.findMany.mockResolvedValue([
      { targetType: 'FOLDER', targetId: 'fol_root', role: 'VIEWER' },
    ])
    prisma.driveFolder.findMany
      .mockResolvedValueOnce([{ id: 'fol_child' }])
      .mockResolvedValueOnce([{ id: 'fol_grandchild' }])
      .mockResolvedValueOnce([])
    prisma.document.findMany.mockResolvedValue([
      { id: 'doc_deep', folderId: 'fol_grandchild' },
    ])

    const grants = await service().grantsFor(principal)

    expect([...grants.folderIds].sort()).toEqual(['fol_child', 'fol_grandchild', 'fol_root'])
    expect([...grants.documentIds]).toEqual(['doc_deep'])
    expect(grants.roleOf('DOCUMENT', 'doc_deep')).toBe('VIEWER')
  })

  it('keeps the stronger role when a document is reachable twice', async () => {
    prisma.driveShare.findMany.mockResolvedValue([
      { targetType: 'FOLDER', targetId: 'fol_root', role: 'EDITOR' },
      { targetType: 'DOCUMENT', targetId: 'doc_1', role: 'VIEWER' },
    ])
    prisma.driveFolder.findMany.mockResolvedValueOnce([]).mockResolvedValue([])
    prisma.document.findMany.mockResolvedValue([{ id: 'doc_1', folderId: 'fol_root' }])

    const grants = await service().grantsFor(principal)

    expect(grants.roleOf('FOLDER', 'fol_root')).toBe('EDITOR')
    expect(grants.roleOf('DOCUMENT', 'doc_1')).toBe('EDITOR')
  })

  it('only resolves grants addressed to the current user', async () => {
    await service().grantsFor(principal)
    const args = prisma.driveShare.findMany.mock.calls[0]?.[0] as { where: { OR: unknown[] } }
    expect(args.where.OR).toEqual([{ principalType: 'USER', principalId: 'usr_viewer' }])
  })

  it('stops expanding a folder tree that points back at itself', async () => {
    prisma.driveShare.findMany.mockResolvedValue([
      { targetType: 'FOLDER', targetId: 'fol_a', role: 'VIEWER' },
    ])
    prisma.driveFolder.findMany
      .mockResolvedValueOnce([{ id: 'fol_b' }])
      .mockResolvedValueOnce([{ id: 'fol_a' }])
      .mockResolvedValue([])

    const grants = await service().grantsFor(principal)

    expect([...grants.folderIds].sort()).toEqual(['fol_a', 'fol_b'])
  })
})

describe('Drive sharing notifications', () => {
  function setup() {
    const tx = {
      driveShare: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: 'share-1' }) },
      auditEvent: { create: vi.fn() },
      notification: { create: vi.fn() },
    }
    const target = { ownerId: principal.userId, name: 'Договори', companyId: 'company-1' }
    const prisma = {
      document: { findFirst: vi.fn().mockResolvedValue(target) },
      driveFolder: { findFirst: vi.fn().mockResolvedValue(target) },
      driveShare: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'recipient' }), findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn((callback: (transaction: typeof tx) => Promise<boolean>) => callback(tx)),
    }
    const realtime = { publishSummary: vi.fn() }
    const service = new DriveSharingService(prisma as never, realtime as never)
    return { service, prisma, tx, realtime }
  }

  it.each([
    ['DOCUMENT', 'VIEWER', 'файлу', 'перегляду'],
    ['DOCUMENT', 'EDITOR', 'файлу', 'редагування'],
    ['FOLDER', 'VIEWER', 'папки', 'перегляду'],
    ['FOLDER', 'EDITOR', 'папки', 'редагування'],
  ] as const)('notifies the recipient of %s/%s access after commit', async (targetType, role, kind, access) => {
    const { service, tx, realtime } = setup()
    await service.create(principal, { targetType, targetId: 'target', principalType: 'USER', principalId: 'recipient', role })
    expect(tx.notification.create).toHaveBeenCalledWith({ data: {
      id: expect.any(String) as string, recipientId: 'recipient', category: 'DRIVE',
      safeTitle: `Вам відкрито доступ до ${kind} «Договори»`,
      safeSnippet: `Viewer надав доступ для ${access}.`,
      entityType: targetType === 'FOLDER' ? 'DRIVE_FOLDER' : 'DOCUMENT', entityId: 'target',
      requiresAction: false, deliveredAt: expect.any(Date) as Date, dedupeKey: expect.stringContaining('drive-share:share-1:') as string,
    } })
    expect(realtime.publishSummary).toHaveBeenCalledWith(['recipient'], ['notifications'])
    expect(tx.auditEvent.create).toHaveBeenCalledOnce()
  })

  it('does not notify twice when saving the same grant again', async () => {
    const { service, tx, realtime } = setup()
    tx.driveShare.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ role: 'VIEWER' })
    const input = { targetType: 'DOCUMENT' as const, targetId: 'target', principalType: 'USER' as const, principalId: 'recipient', role: 'VIEWER' as const }
    await service.create(principal, input)
    await service.create(principal, input)
    expect(tx.notification.create).toHaveBeenCalledOnce()
    expect(realtime.publishSummary).toHaveBeenCalledOnce()
  })

  it('notifies when an existing grant changes to editing', async () => {
    const { service, tx } = setup()
    tx.driveShare.findUnique.mockResolvedValue({ role: 'VIEWER' })
    await service.create(principal, { targetType: 'DOCUMENT', targetId: 'target', principalType: 'USER', principalId: 'recipient', role: 'EDITOR' })
    expect(tx.notification.create.mock.calls[0]?.[0]).toMatchObject({ data: {
      safeTitle: 'Змінено ваш доступ до файлу «Договори»', safeSnippet: 'Viewer надав доступ для редагування.',
    } })
  })

  it('does not notify or grant access to a recipient from another workspace', async () => {
    const { service, prisma, tx, realtime } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    await expect(service.create(principal, { targetType: 'FOLDER', targetId: 'target', principalType: 'USER', principalId: 'recipient', role: 'VIEWER' })).rejects.toMatchObject({ code: 'drive_share_principal_invalid' })
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'recipient', workspaceId: principal.workspaceId, isActive: true } }))
    expect(tx.driveShare.upsert).not.toHaveBeenCalled()
    expect(tx.notification.create).not.toHaveBeenCalled()
    expect(realtime.publishSummary).not.toHaveBeenCalled()
  })

  it('does not publish an update when the notification transaction fails', async () => {
    const { service, tx, realtime } = setup()
    tx.notification.create.mockRejectedValue(new Error('database unavailable'))
    await expect(service.create(principal, { targetType: 'DOCUMENT', targetId: 'target', principalType: 'USER', principalId: 'recipient', role: 'VIEWER' })).rejects.toThrow('database unavailable')
    expect(realtime.publishSummary).not.toHaveBeenCalled()
  })
})

describe('Drive sharing metadata access', () => {
  function setup(confidentiality: string) {
    const prisma = {
      document: { findFirst: vi.fn().mockResolvedValue({ ownerId: 'usr_owner', confidentiality }) },
      driveFolder: { findFirst: vi.fn().mockResolvedValue({ ownerId: 'usr_owner' }), findMany: vi.fn().mockResolvedValue([]) },
      driveShare: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn() },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    }
    return { prisma, service: new DriveSharingService(prisma as never) }
  }

  it('includes profile photos in the share list using the safe workspace projection', async () => {
    const { service, prisma } = setup('INTERNAL')
    prisma.driveShare.findMany.mockResolvedValue([{ id: 'share', targetType: 'DOCUMENT', targetId: 'doc', principalType: 'USER', principalId: 'usr_other', role: 'VIEWER', createdAt: new Date('2026-10-13T00:00:00Z') }])
    prisma.user.findMany.mockResolvedValue([{ id: 'usr_other', displayName: 'Олена', avatarAsset: 'file_avatar' }])
    const result = await service.list(principal, 'DOCUMENT', 'doc')
    expect(result[0]?.avatarAsset).toBe('file_avatar')
    expect(result[0]?.principalName).toBe('Олена')
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['usr_other'] }, workspaceId: principal.workspaceId }, select: { id: true, displayName: true, avatarAsset: true } })
  })

  it.each(['GENERAL', 'INTERNAL'])('lets an existing %s document reader load its empty share list', async (confidentiality) => {
    const { service, prisma } = setup(confidentiality)
    expect(await service.list(principal, 'DOCUMENT', 'doc')).toEqual([])
    const args = prisma.document.findFirst.mock.calls[0]?.[0] as { where: { companyId: unknown }; select: Record<string, boolean> }
    expect(args.where.companyId).toEqual({ in: ['company-1'] })
    expect(args.select.confidentiality).toBe(true)
  })

  it('keeps a confidential document hidden from an unshared reader', async () => {
    const { service } = setup('CONFIDENTIAL')
    await expect(service.list(principal, 'DOCUMENT', 'private')).rejects.toMatchObject({ status: 404 })
  })

  it('does not grant access to an unshared folder', async () => {
    const { service } = setup('INTERNAL')
    await expect(service.list(principal, 'FOLDER', 'private')).rejects.toMatchObject({ status: 404 })
  })

  it('keeps documents outside the allowed companies hidden', async () => {
    const { service, prisma } = setup('INTERNAL')
    prisma.document.findFirst.mockResolvedValue(null)
    await expect(service.list(principal, 'DOCUMENT', 'other-company')).rejects.toMatchObject({ status: 404 })
    expect(prisma.driveShare.findMany).not.toHaveBeenCalled()
  })

  it('does not let an internal-document reader change its sharing', async () => {
    const { service, prisma } = setup('INTERNAL')
    await expect(service.create(principal, { targetType: 'DOCUMENT', targetId: 'doc', principalType: 'USER', principalId: 'usr_other', role: 'VIEWER' }))
      .rejects.toMatchObject({ status: 403 })
    expect(prisma.driveShare.upsert).not.toHaveBeenCalled()
  })
})

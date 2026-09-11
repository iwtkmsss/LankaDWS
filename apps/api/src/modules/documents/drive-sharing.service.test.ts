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
    groupMember: { findMany: vi.fn() },
    driveShare: { findMany: vi.fn() },
    driveFolder: { findMany: vi.fn() },
    document: { findMany: vi.fn() },
  }
  const service = () => new DriveSharingService(prisma as never)

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.groupMember.findMany.mockResolvedValue([])
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

  it('resolves shares granted to a group the user still belongs to', async () => {
    prisma.groupMember.findMany.mockResolvedValue([{ groupId: 'grp_ops' }])
    prisma.driveShare.findMany.mockResolvedValue([
      { targetType: 'DOCUMENT', targetId: 'doc_group', role: 'EDITOR' },
    ])

    const grants = await service().grantsFor(principal)

    const args = prisma.driveShare.findMany.mock.calls[0]?.[0] as { where: { OR: unknown[] } }
    expect(args.where.OR).toEqual([
      { principalType: 'USER', principalId: 'usr_viewer' },
      { principalType: 'GROUP', principalId: 'grp_ops' },
    ])
    expect(grants.roleOf('DOCUMENT', 'doc_group')).toBe('EDITOR')
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

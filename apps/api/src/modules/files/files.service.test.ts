import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { FilesService } from './files.service.js'
import { readCleanFile } from './storage.js'

vi.mock('./storage.js', () => ({
  readCleanFile: vi.fn(),
  writeQuarantine: vi.fn(),
}))

const principal: AuthPrincipal = {
  userId: 'viewer',
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

describe('FilesService avatar access', () => {
  const prisma = {
    fileObject: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.fileObject.findFirst.mockResolvedValue({
      id: 'file_avatar',
      workspaceId: 'workspace-1',
      companyId: null,
      storageKey: 'workspace/avatar',
      safeFilename: 'avatar.webp',
      detectedMime: 'image/webp',
      scanStatus: 'CLEAN',
    })
    prisma.user.findFirst.mockResolvedValue({ id: 'avatar-owner' })
    vi.mocked(readCleanFile).mockResolvedValue(Buffer.from('avatar'))
  })

  it('allows a colleague to read the current avatar of a user in the same workspace', async () => {
    const service = new FilesService(prisma as never, {} as never, {} as never, {} as never)

    await expect(service.downloadAvatar(principal, 'file_avatar')).resolves.toMatchObject({
      bytes: Buffer.from('avatar'),
      mime: 'image/webp',
      name: 'avatar.webp',
    })
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        avatarAsset: { in: ['file_avatar', '/api/v1/me/avatar/file_avatar'] },
      },
      select: { id: true },
    })
  })

  it('does not expose an unassigned file as an avatar', async () => {
    prisma.user.findFirst.mockResolvedValue(null)
    const service = new FilesService(prisma as never, {} as never, {} as never, {} as never)

    await expect(service.downloadAvatar(principal, 'file_avatar')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    })
    expect(readCleanFile).not.toHaveBeenCalled()
  })
})

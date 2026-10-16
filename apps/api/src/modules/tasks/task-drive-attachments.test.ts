import { describe, expect, it, vi } from 'vitest'
import type { AuthPrincipal } from '../../common/request-context.js'
import { TaskCompatibilityService } from './task-compatibility.service.js'

const principal = { userId: 'user', workspaceId: 'workspace', allowedCompanyIds: ['drive-company', 'task-company'] } as AuthPrincipal
const task = { id: 'task', companyId: 'task-company' }
const source = {
  id: 'drive-copy', companyId: 'drive-company', safeFilename: 'report.pdf',
  bytes: 1024, detectedMime: 'application/pdf', declaredMime: 'application/pdf',
  scanStatus: 'CLEAN', createdAt: new Date(),
}

function setup(companyId = source.companyId) {
  const file = { ...source, companyId }
  const target = { ...file, id: 'task-copy', companyId: task.companyId }
  const prisma = {
    fileObject: { findFirst: vi.fn().mockResolvedValueOnce(file).mockResolvedValue(target) },
    fileLink: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
  }
  const files = {
    assertTaskStagedAttachments: vi.fn().mockResolvedValue([]),
    copyForPrincipal: vi.fn().mockResolvedValue({ id: target.id }),
    discardStagedAttachment: vi.fn().mockResolvedValue({ discarded: true }),
  }
  const service = new TaskCompatibilityService(prisma as never, {} as never,
    { readableTask: vi.fn().mockResolvedValue(task) } as never,
    files as never, {} as never, {} as never, {} as never)
  return { service, prisma, files }
}

describe('Drive files in task comment drafts', () => {
  it('prepares a staged attachment using the task persistence company', async () => {
    const { service, prisma, files } = setup()
    await expect(service.attachDriveFile(principal, task.id, source.id, true)).resolves.toMatchObject({
      id: 'task-copy', fileName: 'report.pdf', canRemove: true,
    })
    expect(files.assertTaskStagedAttachments).toHaveBeenNthCalledWith(1, principal, 'drive-company', ['drive-copy'])
    expect(files.copyForPrincipal).toHaveBeenCalledWith(principal, 'drive-copy', 'task-company')
    expect(files.discardStagedAttachment).toHaveBeenCalledWith(principal, 'drive-copy')
    expect(files.assertTaskStagedAttachments).toHaveBeenNthCalledWith(2, principal, 'task-company', ['task-copy'])
    expect(prisma.fileObject.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: source.id, workspaceId: principal.workspaceId, companyId: { in: principal.allowedCompanyIds }, ownerId: principal.userId },
    })
    expect(prisma.fileLink.create).not.toHaveBeenCalled()
  })

  it('reuses an attachment already staged under the task company', async () => {
    const { service, files } = setup(task.companyId)
    await expect(service.attachDriveFile(principal, task.id, source.id, true)).resolves.toMatchObject({ id: source.id })
    expect(files.copyForPrincipal).not.toHaveBeenCalled()
    expect(files.assertTaskStagedAttachments).toHaveBeenCalledWith(principal, task.companyId, [source.id])
  })

  it('rejects an inaccessible file before preparing a copy', async () => {
    const { service, prisma, files } = setup()
    prisma.fileObject.findFirst.mockReset().mockResolvedValue(null)
    await expect(service.attachDriveFile(principal, task.id, source.id, true)).rejects.toMatchObject({ status: 404 })
    expect(files.copyForPrincipal).not.toHaveBeenCalled()
  })

  it('rejects a source that is no longer a valid staged attachment', async () => {
    const { service, files } = setup()
    files.assertTaskStagedAttachments.mockRejectedValue(new Error('task_attachment'))
    await expect(service.attachDriveFile(principal, task.id, source.id, true)).rejects.toThrow('task_attachment')
    expect(files.copyForPrincipal).not.toHaveBeenCalled()
  })
})

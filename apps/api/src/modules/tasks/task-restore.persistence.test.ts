import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { ACTOR_RESTORE_WINDOW_MS } from '../../common/restore-window.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { DriveSharingService } from '../documents/drive-sharing.service.js'
import { FilesService } from '../files/files.service.js'
import { TaskChecklistService } from './task-checklist.service.js'
import { TaskCommandService } from './task-command.service.js'
import { TaskRelationsService } from './task-relations.service.js'
import { TaskTimeService } from './task-time.service.js'
import { TasksService } from './tasks.service.js'

// Hidden task content can be restored (decision 2026-11-18): an administrator
// always, the person who hid it within the actor window, an owner where an owner
// restore path exists (unarchiving their own task).

let prisma: PrismaClient
let directory: string
let access: TaskAccessService
const owner = { userId: 'owner', workspaceId: 'workspace', allowedCompanyIds: ['company'], accountType: 'USER' } as AuthPrincipal
const member: AuthPrincipal = { ...owner, userId: 'member' }
const other: AuthPrincipal = { ...owner, userId: 'other' }
const admin: AuthPrincipal = { ...owner, userId: 'admin', accountType: 'ADMIN' }
const pastWindow = () => new Date(Date.now() - ACTOR_RESTORE_WINDOW_MS - 60_000)

async function taskVersion(taskId = 'task') {
  return (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).version
}

function tasksService() {
  const files = new FilesService(prisma as PrismaService, {} as never, {} as never, access, new DriveSharingService(prisma as PrismaService))
  return new TasksService(prisma as never, {} as never, access, files, {} as never, {} as never, {} as never)
}

function commandService() {
  const none = {} as never
  return new TaskCommandService(prisma as PrismaService, none, access, none, none, none, none, none, none, none, none, none)
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-task-restore-'))
  const path = join(directory, 'test.db')
  const db = new Database(path)
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const migration of readdirSync(migrations).sort()) {
    if (migration === 'migration_lock.toml') continue
    db.exec(readFileSync(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
  }
  db.close()
  prisma = new PrismaClient({ adapter: new LankaSqliteAdapter({ url: `file:${path}` }) })
  access = new TaskAccessService(prisma as PrismaService)
  await prisma.workspace.create({ data: { id: 'workspace', displayName: 'Workspace' } })
  await prisma.company.create({ data: { id: 'company', workspaceId: 'workspace', displayName: 'Company', legalName: 'Company', code: 'company' } })
  for (const userId of ['owner', 'member', 'other', 'admin']) {
    await prisma.user.create({ data: {
      id: userId, workspaceId: 'workspace', displayName: userId, normalizedDisplayName: userId,
      username: userId, normalizedUsername: userId, primaryCompanyId: 'company',
      ...(userId === 'admin' ? { accountType: 'ADMIN' } : {}),
    } })
  }
  for (const [index, taskId] of ['task', 'target'].entries()) {
    await prisma.task.create({ data: {
      id: taskId, number: String(index + 1), workspaceId: 'workspace', companyId: 'company',
      createdById: 'owner', reporterId: 'owner', title: taskId,
      participants: { create: [
        { id: `${taskId}_member`, userId: 'member', role: 'RESPONSIBLE' },
        { id: `${taskId}_other`, userId: 'other', role: 'WATCHER' },
      ] },
    } })
  }
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

describe('task unarchive', () => {
  it('returns the task to its status before archiving and records who archived it', async () => {
    await prisma.task.update({ where: { id: 'task' }, data: { status: 'IN_PROGRESS' } })
    const commands = commandService()
    await commands.archive(owner, 'task', await taskVersion())
    expect(await prisma.task.findUniqueOrThrow({ where: { id: 'task' } })).toMatchObject({
      status: 'ARCHIVED', archivedAt: expect.any(Date) as unknown, archivedById: 'owner',
    })
    // A participant who is not an owner cannot unarchive.
    await expect(commands.restore(member, 'task', await taskVersion())).rejects.toMatchObject({ status: 403 })
    await expect(commands.restore(owner, 'task', 1)).rejects.toMatchObject({ status: 409 })
    const restored = await commands.restore(owner, 'task', await taskVersion())
    expect(restored.status).toBe('IN_PROGRESS')
    expect(await prisma.task.findUniqueOrThrow({ where: { id: 'task' } })).toMatchObject({
      status: 'IN_PROGRESS', archivedAt: null, archivedById: null, version: restored.version,
    })
    expect(await prisma.auditEvent.count({ where: { action: 'task.restored', entityId: 'task' } })).toBe(1)
    expect(await prisma.outboxEvent.count({ where: { eventType: 'task.restored', aggregateId: 'task' } })).toBe(1)
    await expect(commands.restore(owner, 'task', restored.version)).rejects.toMatchObject({ status: 409 })
  })

  it('keeps invalidated review rounds and sends a task that was in review back to work', async () => {
    await prisma.task.update({ where: { id: 'task' }, data: { status: 'IN_REVIEW', requiresAcceptance: true } })
    await prisma.taskApprovalRound.create({ data: {
      id: 'round', taskId: 'task', roundNumber: 1, approverId: 'owner', requestedById: 'member', requestedTaskVersion: 1,
    } })
    const commands = commandService()
    await commands.archive(admin, 'task', await taskVersion())
    // The administrator archived it; the owner keeps the unarchive path.
    const restored = await commands.restore(owner, 'task', await taskVersion())
    expect(restored.status).toBe('IN_PROGRESS')
    expect((await prisma.taskApprovalRound.findUniqueOrThrow({ where: { id: 'round' } })).status).toBe('INVALIDATED')
  })

  it('falls back to NEW without an archive record and lets an administrator restore', async () => {
    await prisma.task.update({ where: { id: 'task' }, data: { status: 'ARCHIVED', archivedAt: pastWindow(), archivedById: 'owner' } })
    await expect(commandService().restore(admin, 'task', await taskVersion())).resolves.toMatchObject({ status: 'NEW' })
  })
})

describe('task comment restore', () => {
  async function seedComment() {
    await prisma.fileObject.create({ data: {
      id: 'file', workspaceId: 'workspace', companyId: 'company', ownerId: 'member', storageKey: 'company/file',
      safeFilename: 'report.pdf', declaredMime: 'application/pdf', detectedMime: 'application/pdf', bytes: 10,
      sha256: 'hash', scanStatus: 'CLEAN',
    } })
    await prisma.fileLink.create({ data: {
      id: 'task_link', fileId: 'file', entityType: 'TASK', entityId: 'task', purpose: 'ATTACHMENT', aclMode: 'ENTITY',
    } })
    await prisma.comment.create({ data: {
      id: 'comment', workspaceId: 'workspace', companyId: 'company', entityType: 'TASK', entityId: 'task',
      authorId: 'member', body: 'Дивись @owner', visibility: 'PARTICIPANTS',
    } })
    await prisma.contentMention.create({ data: {
      id: 'mention', workspaceId: 'workspace', sourceType: 'TASK_COMMENT', sourceId: 'comment',
      userId: 'owner', start: 7, end: 13, label: 'owner',
    } })
    await prisma.fileLink.create({ data: {
      id: 'comment_link', fileId: 'file', entityType: 'TASK_COMMENT', entityId: 'comment', purpose: 'ATTACHMENT', aclMode: 'ENTITY',
    } })
  }

  it('brings the comment back with its mentions and attachment links; admin sees it hidden meanwhile', async () => {
    await seedComment()
    const tasks = tasksService()
    await tasks.deleteComment(admin, 'task', 'comment', { expectedVersion: 1 })
    expect(await prisma.comment.findUniqueOrThrow({ where: { id: 'comment' } })).toMatchObject({
      deletedAt: expect.any(Date) as unknown, deletedById: 'admin', version: 2,
    })
    expect((await prisma.fileLink.findUniqueOrThrow({ where: { id: 'comment_link' } })).removedAt).not.toBeNull()

    // Ordinary readers no longer see it; the administrator sees it in place, flagged.
    const memberView = await tasks.detail(member, 'task')
    expect(memberView.comments).toEqual([])
    expect(memberView).not.toHaveProperty('hiddenContent')
    const adminView = await tasks.detail(admin, 'task')
    expect(adminView.commentCount).toBe(0)
    expect(adminView.comments).toEqual([expect.objectContaining({
      id: 'comment', deletedAt: expect.any(String) as unknown, deletedBy: { id: 'admin', displayName: 'admin' },
      canEdit: false, canDelete: false,
    })])

    await expect(tasks.restoreComment(member, 'task', 'comment', { expectedVersion: 2 })).rejects.toMatchObject({ status: 403 })
    await expect(tasks.restoreComment(admin, 'task', 'comment', { expectedVersion: 1 })).rejects.toMatchObject({ status: 409 })
    const restored = await tasks.restoreComment(admin, 'task', 'comment', { expectedVersion: 2 })
    expect(restored.version).toBe(3)
    expect(await prisma.comment.findUniqueOrThrow({ where: { id: 'comment' } })).toMatchObject({ deletedAt: null, deletedById: null })
    expect(await prisma.fileLink.findUniqueOrThrow({ where: { id: 'comment_link' } })).toMatchObject({ removedAt: null, removedById: null })
    const view = await tasks.detail(member, 'task')
    expect(view.comments).toEqual([expect.objectContaining({
      id: 'comment',
      mentions: [expect.objectContaining({ userId: 'owner', start: 7, end: 13 })],
      attachments: [expect.objectContaining({ id: 'file' })],
    })])
    expect(view.comments[0]).not.toHaveProperty('deletedAt')
    expect(await prisma.auditEvent.count({ where: { action: 'task.comment_restored' } })).toBe(1)
    await expect(tasks.restoreComment(admin, 'task', 'comment', { expectedVersion: 3 })).rejects.toMatchObject({ status: 409 })
  })

  it('refuses the actor after the window and does not revive links of a file removed from the task', async () => {
    await seedComment()
    const tasks = tasksService()
    const hiddenAt = pastWindow()
    await prisma.comment.update({ where: { id: 'comment' }, data: { deletedAt: hiddenAt, deletedById: 'member', version: 2 } })
    await prisma.fileLink.update({ where: { id: 'comment_link' }, data: { removedAt: hiddenAt, removedById: 'member' } })
    await prisma.fileLink.update({ where: { id: 'task_link' }, data: { removedAt: new Date(), removedById: 'owner' } })
    await expect(tasks.restoreComment(member, 'task', 'comment', { expectedVersion: 2 })).rejects.toMatchObject({ status: 403 })
    // Within the window the actor may restore (simulated by moving the hide forward).
    const recent = new Date()
    await prisma.comment.update({ where: { id: 'comment' }, data: { deletedAt: recent } })
    await prisma.fileLink.update({ where: { id: 'comment_link' }, data: { removedAt: recent } })
    await tasks.restoreComment(member, 'task', 'comment', { expectedVersion: 2 })
    // The file left the task meanwhile, so its comment link stays removed.
    expect((await prisma.fileLink.findUniqueOrThrow({ where: { id: 'comment_link' } })).removedAt).not.toBeNull()
  })
})

describe('task attachment restore', () => {
  it('revives the task link and the comment links removed with it', async () => {
    await prisma.fileObject.create({ data: {
      id: 'file', workspaceId: 'workspace', companyId: 'company', ownerId: 'member', storageKey: 'company/file',
      safeFilename: 'report.pdf', declaredMime: 'application/pdf', detectedMime: 'application/pdf', bytes: 10,
      sha256: 'hash', scanStatus: 'CLEAN',
    } })
    await prisma.comment.create({ data: {
      id: 'comment', workspaceId: 'workspace', companyId: 'company', entityType: 'TASK', entityId: 'task',
      authorId: 'member', body: 'Файл', visibility: 'PARTICIPANTS',
    } })
    await prisma.fileLink.createMany({ data: [
      { id: 'task_link', fileId: 'file', entityType: 'TASK', entityId: 'task', purpose: 'ATTACHMENT', aclMode: 'ENTITY' },
      { id: 'comment_link', fileId: 'file', entityType: 'TASK_COMMENT', entityId: 'comment', purpose: 'ATTACHMENT', aclMode: 'ENTITY' },
    ] })
    const tasks = tasksService()
    await tasks.removeAttachment(member, 'task', 'file')
    const adminView = await tasks.detail(admin, 'task')
    expect(adminView.attachments).toEqual([])
    expect(adminView.hiddenContent?.attachments).toEqual([expect.objectContaining({
      id: 'file', deletedBy: { id: 'member', displayName: 'member' },
    })])
    await expect(tasks.restoreAttachment(other, 'task', 'file')).rejects.toMatchObject({ status: 403 })
    await tasks.restoreAttachment(member, 'task', 'file')
    for (const linkId of ['task_link', 'comment_link']) {
      expect(await prisma.fileLink.findUniqueOrThrow({ where: { id: linkId } })).toMatchObject({ removedAt: null, removedById: null })
    }
    await expect(tasks.restoreAttachment(admin, 'task', 'file')).rejects.toMatchObject({ status: 409 })
    expect(await prisma.auditEvent.count({ where: { action: 'task.attachment_restored' } })).toBe(1)

    // After the window only an administrator can restore it.
    await tasks.removeAttachment(member, 'task', 'file')
    await prisma.fileLink.updateMany({ where: { fileId: 'file' }, data: { removedAt: pastWindow() } })
    await expect(tasks.restoreAttachment(member, 'task', 'file')).rejects.toMatchObject({ status: 403 })
    await tasks.restoreAttachment(admin, 'task', 'file')
    expect(await prisma.fileLink.count({ where: { fileId: 'file', removedAt: null } })).toBe(2)
  })
})

describe('task checklist, relation and time entry restore', () => {
  it('restores a checklist item in place with a task version check', async () => {
    const service = new TaskChecklistService(prisma as PrismaService, access)
    const first = await service.add(owner, 'task', 'Перший', await taskVersion())
    const second = await service.add(owner, 'task', 'Другий', await taskVersion())
    await service.remove(owner, 'task', first.id, await taskVersion())
    const adminView = await tasksService().detail(admin, 'task')
    expect(adminView.checklist.map((item) => item.id)).toEqual([second.id])
    expect(adminView.hiddenContent?.checklist).toEqual([expect.objectContaining({ id: first.id, text: 'Перший' })])
    await expect(service.restore(other, 'task', first.id, await taskVersion())).rejects.toMatchObject({ status: 403 })
    await expect(service.restore(owner, 'task', first.id, 1)).rejects.toMatchObject({ status: 409 })
    await service.restore(owner, 'task', first.id, await taskVersion())
    const visible = await prisma.taskChecklistItem.findMany({ where: { taskId: 'task', deletedAt: null }, orderBy: { position: 'asc' } })
    expect(visible.map((item) => item.id)).toEqual([first.id, second.id])
    await expect(service.restore(owner, 'task', first.id, await taskVersion())).rejects.toMatchObject({ status: 409 })

    await service.remove(owner, 'task', first.id, await taskVersion())
    await prisma.taskChecklistItem.update({ where: { id: first.id }, data: { deletedAt: pastWindow() } })
    await expect(service.restore(owner, 'task', first.id, await taskVersion())).rejects.toMatchObject({ status: 403 })
    await service.restore(admin, 'task', first.id, await taskVersion())
    expect((await prisma.taskChecklistItem.findUniqueOrThrow({ where: { id: first.id } })).deletedAt).toBeNull()
  })

  it('restores a relation and refuses one that would close a blocking cycle', async () => {
    const service = new TaskRelationsService(prisma as PrismaService, access)
    const blocks = await service.add(owner, 'task', { targetTaskId: 'target', type: 'BLOCKS', direction: 'OUTGOING' }, await taskVersion())
    await service.remove(owner, 'task', blocks.id, await taskVersion())
    const adminView = await tasksService().detail(admin, 'task')
    expect(adminView.hiddenContent?.relations).toEqual([expect.objectContaining({
      id: blocks.id, type: 'BLOCKS', direction: 'OUTGOING', task: expect.objectContaining({ id: 'target' }) as unknown,
    })])
    await expect(service.restore(member, 'task', blocks.id, await taskVersion())).rejects.toMatchObject({ status: 403 })
    await expect(service.restore(owner, 'task', blocks.id, 1)).rejects.toMatchObject({ status: 409 })
    // The reverse edge now exists, so restoring would create a cycle.
    const reverse = await service.add(owner, 'target', { targetTaskId: 'task', type: 'BLOCKS', direction: 'OUTGOING' }, await taskVersion('target'))
    await expect(service.restore(owner, 'task', blocks.id, await taskVersion())).rejects.toMatchObject({ status: 409 })
    await service.remove(owner, 'target', reverse.id, await taskVersion('target'))
    await service.restore(owner, 'task', blocks.id, await taskVersion())
    expect((await prisma.taskRelation.findUniqueOrThrow({ where: { id: blocks.id } })).deletedAt).toBeNull()

    await service.remove(owner, 'task', blocks.id, await taskVersion())
    await prisma.taskRelation.update({ where: { id: blocks.id }, data: { deletedAt: pastWindow() } })
    await expect(service.restore(owner, 'task', blocks.id, await taskVersion())).rejects.toMatchObject({ status: 403 })
    await service.restore(admin, 'task', blocks.id, await taskVersion())
  })

  it('restores a time entry into the list and the total', async () => {
    const service = new TaskTimeService(prisma as PrismaService, access)
    const startedAt = new Date(Date.now() - 7_200_000).toISOString()
    const entry = await service.addManual(member, 'task', { startedAt, durationSeconds: 900, description: '' })
    await service.remove(member, 'task', entry.id)
    const adminView = await tasksService().detail(admin, 'task')
    expect(adminView.hiddenContent?.timeEntries).toEqual([expect.objectContaining({ id: entry.id, durationSeconds: 900 })])
    await expect(service.restore(other, 'task', entry.id)).rejects.toMatchObject({ status: 403 })
    await service.restore(member, 'task', entry.id)
    expect((await service.list(member, 'task')).totalSeconds).toBe(900)
    await expect(service.restore(member, 'task', entry.id)).rejects.toMatchObject({ status: 409 })
    expect(await prisma.auditEvent.count({ where: { action: 'task.time_restored' } })).toBe(1)

    await service.remove(member, 'task', entry.id)
    await prisma.timeEntry.update({ where: { id: entry.id }, data: { deletedAt: pastWindow() } })
    await expect(service.restore(member, 'task', entry.id)).rejects.toMatchObject({ status: 403 })
    await service.restore(admin, 'task', entry.id)
    expect((await service.list(member, 'task')).totalSeconds).toBe(900)
  })

  it('answers not found to someone who cannot read the task', async () => {
    const outsider: AuthPrincipal = { ...owner, userId: 'stranger' }
    await expect(new TaskTimeService(prisma as PrismaService, access).restore(outsider, 'task', 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(commandService().restore(outsider, 'task', 1)).rejects.toMatchObject({ status: 404 })
  })
})

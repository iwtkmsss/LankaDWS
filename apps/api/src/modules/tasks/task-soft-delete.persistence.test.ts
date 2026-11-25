import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma/client.js'
import { LankaSqliteAdapter } from '../../prisma/sqlite-adapter.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { DriveSharingService } from '../documents/drive-sharing.service.js'
import { FilesService } from '../files/files.service.js'
import { TaskChecklistService } from './task-checklist.service.js'
import { TaskRelationsService } from './task-relations.service.js'
import { TaskTimeService } from './task-time.service.js'
import { TasksService } from './tasks.service.js'

// Content is hidden, never deleted (decision 2026-11-18): task checklist items,
// time entries, relations and attachment links stay as hidden rows.

let prisma: PrismaClient
let directory: string
let access: TaskAccessService
const owner = { userId: 'owner', workspaceId: 'workspace', allowedCompanyIds: ['company'], accountType: 'USER' } as AuthPrincipal
const member: AuthPrincipal = { ...owner, userId: 'member' }

async function taskVersion(taskId = 'task') {
  return (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).version
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lankadws-task-soft-delete-'))
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
  for (const userId of ['owner', 'member', 'other']) {
    await prisma.user.create({ data: {
      id: userId, workspaceId: 'workspace', displayName: userId, normalizedDisplayName: userId,
      username: userId, normalizedUsername: userId, primaryCompanyId: 'company',
    } })
  }
  for (const [index, taskId] of ['task', 'target'].entries()) {
    await prisma.task.create({ data: {
      id: taskId, number: String(index + 1), workspaceId: 'workspace', companyId: 'company',
      createdById: 'owner', reporterId: 'owner', title: taskId,
      participants: { create: { id: `${taskId}_member`, userId: 'member', role: 'RESPONSIBLE' } },
    } })
  }
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

describe('task checklist soft delete', () => {
  it('hides a removed item, keeps it out of the list and still allocates and reorders positions', async () => {
    const service = new TaskChecklistService(prisma as PrismaService, access)
    const first = await service.add(owner, 'task', 'Перший', await taskVersion())
    const second = await service.add(owner, 'task', 'Другий', await taskVersion())
    const third = await service.add(owner, 'task', 'Третій', await taskVersion())
    await service.remove(owner, 'task', second.id, await taskVersion())
    expect(await prisma.taskChecklistItem.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      deletedAt: expect.any(Date) as unknown, deletedById: 'owner', position: 1,
    })
    // A new item is placed after every row, hidden ones included.
    const fourth = await service.add(owner, 'task', 'Четвертий', await taskVersion())
    expect((await prisma.taskChecklistItem.findUniqueOrThrow({ where: { id: fourth.id } })).position).toBe(3)
    // Reordering covers exactly the visible items and never collides with the hidden one.
    await expect(service.reorder(owner, 'task', [first.id, third.id, fourth.id, second.id], await taskVersion()))
      .rejects.toMatchObject({ status: 400 })
    await service.reorder(owner, 'task', [fourth.id, first.id, third.id], await taskVersion())
    const detail = await prisma.task.findUniqueOrThrow({ where: { id: 'task' }, include: {
      checklist: { where: { deletedAt: null }, orderBy: { position: 'asc' } },
    } })
    expect(detail.checklist.map((item) => item.id)).toEqual([fourth.id, first.id, third.id])
    expect((await prisma.taskChecklistItem.findUniqueOrThrow({ where: { id: second.id } })).position).toBe(1)
    // A hidden item can no longer be changed or removed again.
    await expect(service.update(owner, 'task', second.id, { isCompleted: true, expectedVersion: await taskVersion() }))
      .rejects.toMatchObject({ status: 400 })
    await expect(service.remove(owner, 'task', second.id, await taskVersion())).rejects.toMatchObject({ status: 400 })
    expect(await prisma.taskChecklistItem.count()).toBe(4)
  })
})

describe('task time entry soft delete', () => {
  it('hides a removed entry from the list and the total', async () => {
    const service = new TaskTimeService(prisma as PrismaService, access)
    const startedAt = new Date(Date.now() - 7_200_000).toISOString()
    const kept = await service.addManual(member, 'task', { startedAt, durationSeconds: 600, description: '' })
    const removed = await service.addManual(member, 'task', { startedAt, durationSeconds: 900, description: '' })
    expect((await service.list(member, 'task')).totalSeconds).toBe(1500)
    await service.remove(member, 'task', removed.id)
    const list = await service.list(member, 'task')
    expect(list.items.map((item) => item.id)).toEqual([kept.id])
    expect(list.totalSeconds).toBe(600)
    expect(await prisma.timeEntry.findUniqueOrThrow({ where: { id: removed.id } })).toMatchObject({
      deletedAt: expect.any(Date) as unknown, deletedById: 'member',
    })
    await expect(service.remove(member, 'task', removed.id)).rejects.toMatchObject({ status: 404 })
    await expect(service.update(member, 'task', removed.id, { durationSeconds: 60, expectedUpdatedAt: new Date().toISOString() }))
      .rejects.toMatchObject({ status: 404 })
  })
})

describe('task relation soft delete', () => {
  it('hides a removed relation and revives the same row when it is created again', async () => {
    const service = new TaskRelationsService(prisma as PrismaService, access)
    const created = await service.add(owner, 'task', { targetTaskId: 'target', type: 'RELATED' }, await taskVersion())
    await service.remove(owner, 'task', created.id, await taskVersion())
    expect(await prisma.taskRelation.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      deletedAt: expect.any(Date) as unknown, deletedById: 'owner',
    })
    await expect(service.remove(owner, 'task', created.id, await taskVersion())).rejects.toMatchObject({ status: 400 })
    // RELATED/DUPLICATES pairs are stored sorted, so the same pair is revived.
    const revived = await service.add(owner, 'task', { targetTaskId: 'target', type: 'DUPLICATES' }, await taskVersion())
    expect(revived.id).toBe(created.id)
    expect(await prisma.taskRelation.count()).toBe(1)
    expect(await prisma.taskRelation.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      deletedAt: null, deletedById: null, type: 'DUPLICATES', createdById: 'owner',
    })
  })

  it('ignores a hidden BLOCKS edge in cycle detection', async () => {
    const service = new TaskRelationsService(prisma as PrismaService, access)
    const blocks = await service.add(owner, 'task', { targetTaskId: 'target', type: 'BLOCKS', direction: 'OUTGOING' }, await taskVersion())
    await expect(service.add(owner, 'target', { targetTaskId: 'task', type: 'BLOCKS', direction: 'OUTGOING' }, await taskVersion('target')))
      .rejects.toMatchObject({ status: 409 })
    await service.remove(owner, 'task', blocks.id, await taskVersion())
    await service.add(owner, 'target', { targetTaskId: 'task', type: 'BLOCKS', direction: 'OUTGOING' }, await taskVersion('target'))
    const visible = await prisma.task.findUniqueOrThrow({ where: { id: 'task' }, include: {
      outgoingRelations: { where: { deletedAt: null } }, incomingRelations: { where: { deletedAt: null } },
    } })
    expect(visible.outgoingRelations).toEqual([])
    expect(visible.incomingRelations.map((relation) => relation.sourceTaskId)).toEqual(['target'])
  })
})

describe('task attachment link soft removal', () => {
  it('stops granting the file once removed and revives the same link when attached again', async () => {
    await prisma.fileObject.create({ data: {
      id: 'file', workspaceId: 'workspace', companyId: 'company', ownerId: 'owner', storageKey: 'company/file',
      safeFilename: 'report.pdf', declaredMime: 'application/pdf', detectedMime: 'application/pdf', bytes: 10,
      sha256: 'hash', scanStatus: 'CLEAN',
    } })
    await prisma.fileLink.create({ data: {
      id: 'link', fileId: 'file', entityType: 'TASK', entityId: 'task', purpose: 'ATTACHMENT', aclMode: 'ENTITY',
    } })
    const files = new FilesService(prisma as PrismaService, {} as never, {} as never, access, new DriveSharingService(prisma as PrismaService))
    const authorized = (principal: AuthPrincipal) => (files as unknown as {
      authorizedFile: (principal: AuthPrincipal, fileId: string) => Promise<{ id: string }>
    }).authorizedFile(principal, 'file')
    await expect(authorized(member)).resolves.toMatchObject({ id: 'file' })

    const tasks = new TasksService(prisma as never, {} as never, access, files, {} as never, {} as never, {} as never)
    await tasks.removeAttachment(owner, 'task', 'file')
    expect(await prisma.fileLink.findUniqueOrThrow({ where: { id: 'link' } })).toMatchObject({
      removedAt: expect.any(Date) as unknown, removedById: 'owner',
    })
    await expect(authorized(member)).rejects.toMatchObject({ status: 404 })
    await expect(tasks.removeAttachment(owner, 'task', 'file')).rejects.toMatchObject({ status: 404 })

    await tasks.attachDriveFile(owner, 'task', 'file')
    expect(await prisma.fileLink.count()).toBe(1)
    expect(await prisma.fileLink.findUniqueOrThrow({ where: { id: 'link' } })).toMatchObject({ removedAt: null, removedById: null })
    await expect(authorized(member)).resolves.toMatchObject({ id: 'file' })
  })
})

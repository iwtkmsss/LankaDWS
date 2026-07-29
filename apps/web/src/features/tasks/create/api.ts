import type { ProjectOption, TagOption } from '@bert-crm/contracts'
import { api, jsonBody } from '../../../shared/api/client'
import type {
  TaskAttachmentDraft,
  TaskCreateOptions,
} from './types'

export function taskCreateOptionsPath(
  groupId: string,
  projectId: string,
  search = '',
): string {
  const query = new URLSearchParams()
  if (groupId) query.set('groupId', groupId)
  if (projectId) query.set('projectId', projectId)
  if (search) query.set('search', search)
  return `/tasks/options?${query.toString()}`
}

export function loadTaskCreateOptions(
  groupId: string,
  projectId: string,
): Promise<TaskCreateOptions> {
  return api<TaskCreateOptions>(taskCreateOptionsPath(groupId, projectId))
}

export function createProject(name: string): Promise<ProjectOption> {
  return api<ProjectOption>('/tasks/projects', {
    method: 'POST',
    body: jsonBody({ name }),
  })
}

export function createTag(name: string, color: string): Promise<TagOption> {
  return api<TagOption>('/tasks/tags', {
    method: 'POST',
    body: jsonBody({ name, color }),
  })
}

export async function stageTaskAttachment(file: File): Promise<TaskAttachmentDraft> {
  const body = new FormData()
  body.append('file', file)
  const staged = await api<{
    id: string
    fileName: string
    bytes: number
    scanStatus: TaskAttachmentDraft['scanStatus']
  }>('/tasks/attachments/staged', {
    method: 'POST',
    body,
  })
  return {
    ...staged,
    stagedAt: new Date().toISOString(),
  }
}

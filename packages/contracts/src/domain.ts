import { z } from 'zod'
import type { OrganizationCapabilityView } from './capabilities.js'

export const companyScopeSchema = z.union([
  z.literal('all'),
  z.string().regex(/^cmp_[a-zA-Z0-9_-]+$/),
])
export type CompanyScope = z.infer<typeof companyScopeSchema>

export const taskStatusSchema = z.enum([
  'NEW',
  'PLANNED',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'BLOCKED',
  'CANCELLED',
  'ARCHIVED',
])
export type TaskStatus = z.infer<typeof taskStatusSchema>

export const taskViewRoleSchema = z.enum([
  'RESPONSIBLE',
  'CO_EXECUTOR',
  'CREATOR',
  'OBSERVER',
  'ALL',
])
export type TaskViewRole = z.infer<typeof taskViewRoleSchema>

export const taskParticipantRoleSchema = z.enum(['CO_EXECUTOR', 'OBSERVER'])
export type TaskParticipantRole = z.infer<typeof taskParticipantRoleSchema>

export const executionStatusSchema = z.enum([
  'NOT_STARTED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL_FAILURE',
  'FAILED',
])
export type ExecutionStatus = z.infer<typeof executionStatusSchema>

export const confidentialitySchema = z.enum([
  'GENERAL',
  'INTERNAL',
  'CONFIDENTIAL',
  'HR_SECURITY',
])
export type Confidentiality = z.infer<typeof confidentialitySchema>

export interface OrganizationView {
  id: string
  displayName: string
  timezone: string
}

export interface UserSummary {
  id: string
  displayName: string
  username: string
  displayRole: string
  jobTitle: string
  avatarAsset: string | null
}

export interface PrincipalView extends UserSummary {
  organization: OrganizationView
  permissions: string[]
  capabilities: OrganizationCapabilityView[]
  csrfToken: string
  mustEnroll2FA: boolean
}

export interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export interface TaskListItem {
  id: string
  number: string
  companyId: string
  parentTaskId: string | null
  title: string
  assignee: Pick<UserSummary, 'id' | 'displayName' | 'avatarAsset'>
  status: TaskStatus
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  deadline: string | null
  version: number
  commentCount: number
  attachmentCount: number
  subtaskProgress: {
    done: number
    total: number
  }
  viewerRoles: Exclude<TaskViewRole, 'ALL'>[]
}

export interface TaskParticipantView {
  id: string
  user: Pick<UserSummary, 'id' | 'displayName' | 'avatarAsset'>
  role: TaskParticipantRole
  addedAt: string
}

export interface TaskReminderView {
  id: string
  remindAt: string
  status: 'ACTIVE' | 'SENT' | 'CANCELLED'
}

export interface TaskPersonalStateView {
  favorited: boolean
  important: boolean
  following: boolean
  followerCount: number
  reminders: TaskReminderView[]
}

export interface TaskActivityItem {
  id: string
  action: string
  label: string
  actor: Pick<UserSummary, 'id' | 'displayName' | 'avatarAsset'> | null
  createdAt: string
}

export interface TaskActivityPage {
  items: TaskActivityItem[]
  nextCursor: string | null
}

export interface TaskAttachmentView {
  id: string
  fileName: string
  bytes: number
  mimeType: string
  scanStatus: 'QUARANTINED' | 'SCANNING' | 'CLEAN' | 'INFECTED' | 'UNSUPPORTED' | 'FAILED'
  createdAt: string
  canRemove: boolean
}

export interface TaskSourceLinkView {
  id: string
  kind: 'MESSAGE' | 'LIFECYCLE' | 'DOCUMENT'
  label: string
  href: string
  createdAt: string
}

export interface TaskReference {
  id: string
  number: string
  title: string
  status: TaskStatus
}

export interface TaskDetailView extends TaskListItem {
  description: string
  blockReason: string | null
  creator: Pick<UserSummary, 'id' | 'displayName'>
  checklist: Array<{
    id: string
    text: string
    isDone: boolean
    version: number
  }>
  comments: Array<{
    id: string
    author: Pick<UserSummary, 'id' | 'displayName' | 'avatarAsset'>
    body: string
    createdAt: string
    replyToCommentId: string | null
    replyPreview: {
      authorName: string
      body: string
    } | null
    attachments: TaskAttachmentView[]
  }>
  attachments: TaskAttachmentView[]
  sourceLinks: TaskSourceLinkView[]
  parent: TaskReference | null
  subtasks: TaskReference[]
  coExecutors: TaskParticipantView[]
  observers: TaskParticipantView[]
  canEdit: boolean
  canReassign: boolean
  canTransferCreator: boolean
  canCreateSubtask: boolean
  canManageParticipants: boolean
  canAttachFiles: boolean
  personalState: TaskPersonalStateView
}

export interface EventListItem {
  id: string
  companyId: string
  title: string
  startAt: string
  endAt: string
  allDay: boolean
  visibility: string
}

export interface DocumentListItem {
  id: string
  number: string
  companyId: string
  name: string
  mimeType: string | null
  ownerName: string
  status: string
  updatedAt: string
  version: number
}

export interface AnnouncementListItem {
  id: string
  title: string
  safeSnippet: string
  authorName: string
  companyIds: string[]
  status: string
  isPinned: boolean
  publishedAt: string | null
  readAt: string | null
}

export interface DashboardView {
  attentionCount: number
  tasks: TaskListItem[]
  events: EventListItem[]
  announcements: AnnouncementListItem[]
  lifecycle: Array<{ id: string; type: string; employeeName: string; progress: number; status: string }>
}

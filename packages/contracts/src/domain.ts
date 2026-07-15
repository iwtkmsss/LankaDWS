import { z } from 'zod'

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

export const requestDecisionStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'PENDING',
  'APPROVED',
  'RETURNED',
  'REJECTED',
  'CANCELLED',
])
export type RequestDecisionStatus = z.infer<typeof requestDecisionStatusSchema>

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

export interface CompanyView {
  id: string
  displayName: string
  code: string
  timezone: string
}

export interface UserSummary {
  id: string
  displayName: string
  username: string
  displayRole: string
  jobTitle: string
  primaryCompanyId: string
  avatarAsset: string | null
}

export interface PrincipalView extends UserSummary {
  companies: CompanyView[]
  permissions: string[]
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
  title: string
  assignee: Pick<UserSummary, 'id' | 'displayName' | 'avatarAsset'>
  status: TaskStatus
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  deadline: string | null
  version: number
  commentCount: number
  attachmentCount: number
}

export interface RequestListItem {
  id: string
  number: string
  companyId: string
  type: string
  safeSummary: string
  currentApprover: Pick<UserSummary, 'id' | 'displayName'> | null
  decisionStatus: RequestDecisionStatus
  executionStatus: ExecutionStatus
  slaDueAt: string | null
  version: number
  updatedAt: string
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
  requests: RequestListItem[]
  decisions: RequestListItem[]
  events: EventListItem[]
  announcements: AnnouncementListItem[]
  lifecycle: Array<{ id: string; type: string; employeeName: string; progress: number; status: string }>
}

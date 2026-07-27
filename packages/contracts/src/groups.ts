import { z } from 'zod'
import { companyScopeSchema } from './domain.js'

export const groupDiscoverabilitySchema = z.enum(['LISTED', 'HIDDEN'])
export type GroupDiscoverability = z.infer<typeof groupDiscoverabilitySchema>

export const groupJoinPolicySchema = z.enum(['OPEN', 'REQUEST', 'INVITE_ONLY'])
export type GroupJoinPolicy = z.infer<typeof groupJoinPolicySchema>

export const groupStatusSchema = z.enum(['ACTIVE', 'ARCHIVED'])
export type GroupStatus = z.infer<typeof groupStatusSchema>

export const groupMemberRoleSchema = z.enum(['OWNER', 'MODERATOR', 'MEMBER'])
export type GroupMemberRole = z.infer<typeof groupMemberRoleSchema>

export const groupListQuerySchema = z.object({
  company: companyScopeSchema.optional(),
  status: groupStatusSchema.default('ACTIVE'),
  query: z.string().trim().max(100).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})
export type GroupListQuery = z.infer<typeof groupListQuerySchema>

export const createGroupSchema = z.object({
  companyId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).optional(),
  discoverability: groupDiscoverabilitySchema.default('LISTED'),
  joinPolicy: groupJoinPolicySchema.default('REQUEST'),
})
export type CreateGroupInput = z.infer<typeof createGroupSchema>

export const updateGroupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).optional(),
  discoverability: groupDiscoverabilitySchema,
  joinPolicy: groupJoinPolicySchema,
  expectedVersion: z.number().int().positive(),
})
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>

export const archiveGroupSchema = z.object({
  expectedVersion: z.number().int().positive(),
})

export const decideGroupJoinRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
})
export type DecideGroupJoinRequestInput = z.infer<typeof decideGroupJoinRequestSchema>

export interface GroupListItem {
  id: string
  companyId: string
  key: string
  name: string
  description: string | null
  discoverability: GroupDiscoverability
  joinPolicy: GroupJoinPolicy
  status: GroupStatus
  owner: { id: string; displayName: string }
  memberCount: number
  currentUserRole: GroupMemberRole | null
  updatedAt: string
  version: number
}

export interface GroupListResult {
  items: GroupListItem[]
  nextCursor: string | null
}

export interface GroupMemberView {
  id: string
  role: GroupMemberRole
  joinedAt: string
  user: { id: string; displayName: string; avatarAsset: string | null }
}

export interface GroupJoinRequestView {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  createdAt: string
  requester: { id: string; displayName: string; avatarAsset: string | null }
}

export interface GroupDetailView extends GroupListItem {
  members: GroupMemberView[]
  pendingRequests: GroupJoinRequestView[]
  currentUserRequestStatus: GroupJoinRequestView['status'] | null
  canManageMembers: boolean
  canEdit: boolean
}

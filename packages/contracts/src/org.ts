import { z } from 'zod'
import { companyScopeSchema } from './domain.js'

const normalizeOrgUnitName = (value: unknown) => typeof value === 'string'
  ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  : value

export const orgUnitNameSchema = z.preprocess(normalizeOrgUnitName, z.string().min(1).max(120))
export const orgManagerIdSchema = z.string().min(1).max(120).nullable()
export const orgUnitIconSchema = z.enum(['building', 'scales', 'settings', 'document', 'computer', 'people', 'briefcase', 'tools'])
export type OrgUnitIcon = z.infer<typeof orgUnitIconSchema>

export const orgUnitListQuerySchema = z.object({
  company: companyScopeSchema.optional(),
  parentId: z.string().min(1).max(120).nullable().optional(),
  query: z.string().trim().max(100).optional(),
})
export type OrgUnitListQuery = z.infer<typeof orgUnitListQuerySchema>

export const adminOrgUnitListQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ALL'),
})
export type AdminOrgUnitListQuery = z.infer<typeof adminOrgUnitListQuerySchema>

export const createOrgUnitSchema = z.object({
  icon: orgUnitIconSchema.nullable().optional(),
  name: orgUnitNameSchema,
  description: z.string().trim().max(320).optional(),
  parentId: z.string().min(1).max(120).nullable().optional(),
  managerId: orgManagerIdSchema.optional(),
})
export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>

export const updateOrgUnitSchema = z.object({
  icon: orgUnitIconSchema.nullable().optional(),
  name: orgUnitNameSchema.optional(),
  description: z.string().trim().max(320).optional(),
  parentId: z.string().min(1).max(120).nullable().optional(),
  managerId: orgManagerIdSchema.optional(),
  expectedVersion: z.number().int().positive(),
}).refine((value) => value.icon !== undefined || value.name !== undefined || value.description !== undefined || value.parentId !== undefined || value.managerId !== undefined, {
  message: 'org_unit_update_empty',
})
export type UpdateOrgUnitInput = z.infer<typeof updateOrgUnitSchema>

export const assignOrgUnitEmployeesSchema = z.object({
  employeeIds: z.array(z.string().min(1).max(120)).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, 'employee_ids_unique'),
  expectedVersion: z.number().int().positive(),
})
export type AssignOrgUnitEmployeesInput = z.infer<typeof assignOrgUnitEmployeesSchema>

export const archiveOrgUnitSchema = z.object({
  expectedVersion: z.number().int().positive(),
  archiveBranch: z.boolean().optional(),
  targetUnitId: z.string().min(1).max(120).optional(),
}).refine((value) => !value.archiveBranch || value.targetUnitId === undefined, { message: 'archive_branch_target_not_allowed' })
export type ArchiveOrgUnitInput = z.infer<typeof archiveOrgUnitSchema>

export const restoreOrgUnitSchema = z.object({
  expectedVersion: z.number().int().positive(),
  parentId: z.string().min(1).max(120).nullable().optional(),
  name: orgUnitNameSchema.optional(),
})
export type RestoreOrgUnitInput = z.infer<typeof restoreOrgUnitSchema>

export interface OrgManagerView {
  id: string
  displayName: string
  jobTitle: string
  avatarAsset?: string | null
}

export interface OrgCompanyView {
  logoAsset?: string | null
  id: string
  name: string
  description: string | null
  manager: OrgManagerView | null
  version: number
}

export interface OrgUnitView {
  icon?: OrgUnitIcon | null
  id: string
  companyId: string
  parentId: string | null
  name: string
  description: string | null
  manager: OrgManagerView | null
  activeEmployeeCount: number
  childCount: number
  sortOrder: number
  version: number
}

export interface AdminOrgUnitView extends OrgUnitView {
  status: 'ACTIVE' | 'ARCHIVED'
}

export interface OrgUnitEmployeeView {
  id: string
  displayName: string
  jobTitle: string
  avatarAsset: string | null
  positionTitle: string | null
  isPrimary: boolean
}

import { z } from 'zod'
import { companyScopeSchema } from './domain.js'

export const orgUnitListQuerySchema = z.object({
  company: companyScopeSchema.optional(),
  parentId: z.string().min(1).max(120).nullable().optional(),
  query: z.string().trim().max(100).optional(),
})
export type OrgUnitListQuery = z.infer<typeof orgUnitListQuerySchema>

export interface OrgUnitView {
  id: string
  companyId: string
  parentId: string | null
  name: string
  manager: { id: string; displayName: string; jobTitle: string } | null
  activeEmployeeCount: number
  childCount: number
  sortOrder: number
  version: number
}

export interface OrgUnitEmployeeView {
  id: string
  displayName: string
  jobTitle: string
  avatarAsset: string | null
  positionTitle: string | null
  isPrimary: boolean
}

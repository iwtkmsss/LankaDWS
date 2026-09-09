import { z } from 'zod'

export const OrganizationCapability = {
  GroupsUi: 'GROUPS_UI',
  Drive: 'DRIVE',
  CalendarWrite: 'CALENDAR_WRITE',
  Calls: 'CALLS',
  Absences: 'ABSENCES',
} as const

export const allOrganizationCapabilityCodes = Object.values(OrganizationCapability)
export const organizationCapabilityCodeSchema = z.enum(allOrganizationCapabilityCodes)
export type OrganizationCapabilityCode = z.infer<typeof organizationCapabilityCodeSchema>

export const organizationCapabilityViewSchema = z.object({
  code: organizationCapabilityCodeSchema,
  enabled: z.boolean(),
  version: z.number().int().nonnegative(),
  enabledAt: z.string().datetime().nullable(),
  disabledAt: z.string().datetime().nullable(),
})
export type OrganizationCapabilityView = z.infer<typeof organizationCapabilityViewSchema>

export const updateOrganizationCapabilitySchema = z.object({
  enabled: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
})
export type UpdateOrganizationCapability = z.infer<typeof updateOrganizationCapabilitySchema>

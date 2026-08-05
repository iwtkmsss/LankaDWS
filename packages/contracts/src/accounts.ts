import { z } from 'zod'

export const accountTypeSchema = z.enum(['ADMIN', 'USER'])
export type AccountType = z.infer<typeof accountTypeSchema>

export const companyInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  timezone: z.string().trim().min(3).max(64).default('Europe/Kyiv'),
  isActive: z.boolean().default(true),
})
export type CompanyInput = z.infer<typeof companyInputSchema>

export const adminUserInputSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
  accountType: accountTypeSchema,
  companyId: z.string().min(1).optional(),
  isActive: z.boolean().default(true),
})
export type AdminUserInput = z.infer<typeof adminUserInputSchema>

export const adminUserUpdateInputSchema = adminUserInputSchema.extend({
  contactEmail: z.string().email().max(254).nullable().optional(),
  jobTitle: z.string().trim().max(120).optional(),
})
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateInputSchema>

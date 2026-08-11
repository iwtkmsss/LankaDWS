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

const adminUserBaseSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  contactEmail: z.string().email().max(254),
  phone: z.string().trim().max(32).optional(),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER']).nullable().optional(),
  birthDate: z.string().date().nullable().optional(),
  jobTitle: z.string().trim().max(120).optional(),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
  accountType: accountTypeSchema,
  companyId: z.string().min(1).optional(),
  orgUnitId: z.string().min(1).optional(),
  isActive: z.boolean().default(true),
})

export const adminUserInputSchema = adminUserBaseSchema.extend({
  password: z.string().min(15).max(128),
  passwordConfirmation: z.string().min(15).max(128),
}).superRefine((value, context) => {
  if (value.password !== value.passwordConfirmation) context.addIssue({ code: z.ZodIssueCode.custom, path: ['passwordConfirmation'], message: 'password_confirmation' })
})
export type AdminUserInput = z.infer<typeof adminUserInputSchema>

export const adminUserUpdateInputSchema = adminUserBaseSchema.extend({
  contactEmail: z.string().email().max(254).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER']).nullable().optional(),
  birthDate: z.string().date().nullable().optional(),
  jobTitle: z.string().trim().max(120).optional(),
  password: z.string().min(15).max(128).optional(),
  passwordConfirmation: z.string().min(15).max(128).optional(),
}).superRefine((value, context) => {
  if ((value.password || value.passwordConfirmation) && value.password !== value.passwordConfirmation) context.addIssue({ code: z.ZodIssueCode.custom, path: ['passwordConfirmation'], message: 'password_confirmation' })
})
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateInputSchema>

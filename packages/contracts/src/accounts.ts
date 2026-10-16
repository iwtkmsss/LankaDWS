import { z } from 'zod'
import { PASSWORD_MIN_LENGTH } from './auth.js'

export const accountTypeSchema = z.enum(['ADMIN', 'USER'])
export type AccountType = z.infer<typeof accountTypeSchema>
const withoutWhitespace = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/gu, '') : value

export const companyInputSchema = z.object({
  logoFileId: z.string().regex(/^file_[a-zA-Z0-9_-]+$/).max(120).nullable().optional(),
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  description: z.string().trim().max(320).nullable().optional()
    .transform((value) => value || null),
  timezone: z.string().trim().min(3).max(64).default('Europe/Kyiv'),
  isActive: z.boolean().default(true),
})
export type CompanyInput = z.infer<typeof companyInputSchema>

export const createCompanySchema = companyInputSchema.extend({
  managerId: z.string().min(1).max(120).nullable().optional(),
  employeeIds: z.array(z.string().min(1).max(120)).max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'employee_ids_unique').optional(),
})
export type CreateCompanyInput = z.infer<typeof createCompanySchema>

export const updateCompanyManagerSchema = z.object({
  managerId: z.string().min(1).max(120).nullable(),
  expectedVersion: z.number().int().positive(),
})
export type UpdateCompanyManagerInput = z.infer<typeof updateCompanyManagerSchema>

const accountPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH, `Введіть щонайменше ${PASSWORD_MIN_LENGTH} символів без пробілів.`).max(128, 'Введіть не більше 128 символів без пробілів.')
const accountEmailSchema = z.string().email('Введіть коректну email-адресу, наприклад name@example.com.').max(254, 'Email має містити не більше 254 символів.')
const adminUserBaseSchema = z.object({
  firstName: z.string().trim().min(1, 'Вкажіть ім’я.').max(80, 'Ім’я має містити не більше 80 символів.'),
  lastName: z.string().trim().min(1, 'Вкажіть прізвище.').max(80, 'Прізвище має містити не більше 80 символів.'),
  middleName: z.string().trim().max(80, 'По батькові має містити не більше 80 символів.').optional(),
  contactEmail: accountEmailSchema,
  phone: z.string().trim().max(32, 'Телефон має містити не більше 32 символів.').optional(),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER']).nullable().optional(),
  birthDate: z.string().date('Вкажіть коректну дату народження.').nullable().optional(),
  jobTitle: z.string().trim().max(120, 'Посада має містити не більше 120 символів.').optional(),
  username: z.preprocess(withoutWhitespace, z.string().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, 'Логін має містити від 3 до 32 символів: латинські літери, цифри, крапку, дефіс або підкреслення.')),
  accountType: accountTypeSchema,
  companyId: z.string().min(1).optional(),
  orgUnitId: z.string().min(1).optional(),
  isActive: z.boolean().default(true),
})

export const adminUserInputSchema = adminUserBaseSchema.extend({
  password: z.preprocess(withoutWhitespace, accountPasswordSchema),
  passwordConfirmation: z.preprocess(withoutWhitespace, accountPasswordSchema),
}).superRefine((value, context) => {
  if (value.password !== value.passwordConfirmation) context.addIssue({ code: z.ZodIssueCode.custom, path: ['passwordConfirmation'], message: 'Паролі не збігаються. Повторіть введений пароль.' })
})
export type AdminUserInput = z.infer<typeof adminUserInputSchema>

export const adminUserUpdateInputSchema = adminUserBaseSchema.extend({
  orgUnitId: z.string().min(1).nullable().optional(),
  newOwnerId: z.string().min(1).optional(),
  contactEmail: accountEmailSchema.nullable().optional(),
  phone: adminUserBaseSchema.shape.phone.unwrap().nullable().optional(),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER']).nullable().optional(),
  birthDate: adminUserBaseSchema.shape.birthDate,
  jobTitle: adminUserBaseSchema.shape.jobTitle,
  password: z.preprocess(withoutWhitespace, accountPasswordSchema.optional()),
  passwordConfirmation: z.preprocess(withoutWhitespace, accountPasswordSchema.optional()),
}).superRefine((value, context) => {
  if ((value.password || value.passwordConfirmation) && value.password !== value.passwordConfirmation) context.addIssue({ code: z.ZodIssueCode.custom, path: ['passwordConfirmation'], message: 'Паролі не збігаються. Повторіть введений пароль.' })
})
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateInputSchema>

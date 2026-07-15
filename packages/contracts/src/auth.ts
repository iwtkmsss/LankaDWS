import { z } from 'zod'

export const usernamePattern = /^[a-z0-9._-]{3,32}$/

export const loginInputSchema = z.object({
  username: z.string().trim().toLowerCase().regex(usernamePattern),
  password: z.string().min(1).max(128),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
})

export type LoginInput = z.infer<typeof loginInputSchema>

export const authNextStepSchema = z.enum([
  'AUTHENTICATED',
  'FIRST_LOGIN',
  'TWO_FACTOR',
  'TWO_FACTOR_SETUP',
])
export type AuthNextStep = z.infer<typeof authNextStepSchema>

export interface LoginResult {
  nextStep: AuthNextStep
  csrfToken?: string
}

export interface SessionView {
  id: string
  deviceLabel: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  current: boolean
}

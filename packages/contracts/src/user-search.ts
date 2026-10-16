import { z } from 'zod'

export const USER_SEARCH_LIMIT = 5
export const USER_SEARCH_MAX_QUERY_LENGTH = 120

const apostrophes = /[\u0060\u00b4\u02bc\u2018\u2019\u201b\u2032\uff07]/gu

export function normalizeUserSearchValue(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    .toLocaleLowerCase('uk-UA').replace(apostrophes, "'")
}

export function userSearchCodePointLength(value: string): number {
  return [...normalizeUserSearchValue(value)].length
}

export function isUserSearchValueLongEnough(value: string): boolean {
  return userSearchCodePointLength(value) >= 1
}

// Older clients can request larger pages; every search response is capped centrally.
export const userSearchLimitSchema = z.coerce.number().int().min(1).max(1000).default(USER_SEARCH_LIMIT)

export const userSelectorSearchSchema = z.object({
  q: z.string().max(USER_SEARCH_MAX_QUERY_LENGTH),
  limit: userSearchLimitSchema,
  company: z.string().trim().min(1).max(120).optional(),
  accountType: z.enum(['ALL', 'USER']).default('ALL'),
  excludeIds: z.array(z.string().min(1).max(120)).max(5000).default([]),
  excludeOrgUnitId: z.string().min(1).max(120).optional(),
  managersOnly: z.boolean().default(false),
})
export type UserSelectorSearchQuery = z.infer<typeof userSelectorSearchSchema>

export interface UserSearchOptionView {
  id: string
  displayName: string
  username: string
  jobTitle: string
  avatarAsset: string | null
  accountType: 'ADMIN' | 'USER'
  primaryCompanyId: string | null
}

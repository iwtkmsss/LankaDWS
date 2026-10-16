import { normalizeUserSearchValue, USER_SEARCH_LIMIT, USER_SEARCH_MAX_QUERY_LENGTH } from '@lankadws/contracts'
import type { Prisma } from '../generated/prisma/client.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { AuthPrincipal } from './request-context.js'
import { badRequest } from './errors.js'

export function parseUserSearchExcludedIds(value?: string): string[] {
  const ids = [...new Set(value?.split(',').filter(Boolean) ?? [])]
  if (ids.length > 200 || ids.some((id) => id.length > 120)) throw badRequest('user_search_invalid')
  return ids
}

export function userSearchPredicate(query: string, { includeJobTitle = false } = {}): Prisma.UserWhereInput {
  const normalized = normalizeUserSearchValue(query)
  return { OR: [
    { normalizedDisplayName: { contains: normalized } },
    { normalizedUsername: { contains: normalized } },
    ...(includeJobTitle ? [{ jobTitle: { contains: query.trim() } }] : []),
  ] }
}

/** Shared, bounded search. Callers resolve aggregate access and pass eligible-user scope. */
export async function searchUsers(prisma: PrismaService, principal: AuthPrincipal, query: string, {
  where = {}, excludeIds = [], limit = USER_SEARCH_LIMIT,
}: { where?: Prisma.UserWhereInput; excludeIds?: string[]; limit?: number } = {}) {
  const normalized = normalizeUserSearchValue(query)
  if (!normalized) return []
  if ([...normalized].length > USER_SEARCH_MAX_QUERY_LENGTH) throw badRequest('user_search_invalid')
  const take = Math.min(USER_SEARCH_LIMIT, Math.max(1, Math.floor(limit)))
  const select = { id: true, displayName: true, username: true, jobTitle: true,
    avatarAsset: true, accountType: true, primaryCompanyId: true } as const
  const tiers: Prisma.UserWhereInput[] = [
    { OR: [{ normalizedDisplayName: normalized }, { normalizedUsername: normalized }] },
    { OR: [{ normalizedDisplayName: { startsWith: normalized } }, { normalizedUsername: { startsWith: normalized } }] },
    userSearchPredicate(normalized),
  ]
  const matches: Array<Prisma.UserGetPayload<{ select: typeof select }>> = []
  for (const tier of tiers) {
    const rows = await prisma.user.findMany({
      where: { workspaceId: principal.workspaceId, isActive: true,
        AND: [where, tier, { id: { notIn: [...excludeIds, ...matches.map((user) => user.id)] } }] },
      select,
      orderBy: [{ normalizedDisplayName: 'asc' }, { id: 'asc' }],
      take: take - matches.length,
    })
    matches.push(...rows.slice(0, take - matches.length))
    if (matches.length === take) break
  }
  return matches
}

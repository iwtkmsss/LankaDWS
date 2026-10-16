import { normalizeUserSearchValue, USER_SEARCH_LIMIT, type UserSearchOptionView } from '@lankadws/contracts'
import { api } from './client'

export interface UserSearchOptions {
  endpoint?: string
  params?: Record<string, string>
  includeAdmins?: boolean
  managersOnly?: boolean
  companyId?: string
  excludeIds?: string[]
  excludeOrgUnitId?: string
  signal?: AbortSignal
}

/** All people selectors use this request builder and the shared search policy. */
export async function searchUsers<T = UserSearchOptionView>(query: string, {
  endpoint = '/employees', params = {}, includeAdmins = true, managersOnly = false, companyId, excludeIds = [], excludeOrgUnitId, signal,
}: UserSearchOptions = {}): Promise<{ items: T[] }> {
  const search = normalizeUserSearchValue(query)
  if (!search) return { items: [] }
  const [path, existingParams] = endpoint.split('?')
  const queryParams = new URLSearchParams(existingParams)
  for (const [key, value] of Object.entries(params)) queryParams.set(key, value)
  queryParams.set(path === '/employees' ? 'search' : 'q', search)
  queryParams.set('limit', String(USER_SEARCH_LIMIT))
  if (path === '/employees') queryParams.set('accountType', includeAdmins ? 'ALL' : 'USER')
  if (managersOnly) queryParams.set('managersOnly', 'true')
  if (companyId) queryParams.set('company', companyId)
  if (excludeIds.length) queryParams.set('exclude', excludeIds.join(','))
  if (excludeOrgUnitId) queryParams.set('excludeOrgUnitId', excludeOrgUnitId)
  // Keep large exclusion lists out of the URL/header limits without truncating them.
  if (path === '/employees' && (excludeIds.length > 200 || queryParams.toString().length > 6000)) {
    return api<{ items: T[] }>('/employees/search', { method: 'POST', signal, body: JSON.stringify({
      q: search, limit: USER_SEARCH_LIMIT, company: queryParams.get('company') ?? undefined,
      accountType: includeAdmins ? 'ALL' : 'USER', excludeIds, excludeOrgUnitId, managersOnly,
    }) })
  }
  return api<{ items: T[] }>(`${path}?${queryParams}`, { signal })
}

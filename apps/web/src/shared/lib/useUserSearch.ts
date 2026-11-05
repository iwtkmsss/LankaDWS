import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { normalizeUserSearchValue, type UserSearchOptionView } from '@lankadws/contracts'
import { searchUsers, type UserSearchOptions } from '../api/user-search'
import { useDebouncedSearchValue } from './useDebouncedSearchValue'

export function useUserSearch<T = UserSearchOptionView>(query: string, options: UserSearchOptions & { enabled?: boolean } = {}) {
  const debounce = useDebouncedSearchValue(query)
  const normalized = normalizeUserSearchValue(query)
  const debounced = normalizeUserSearchValue(debounce.debouncedValue)
  const searching = options.enabled !== false && !debounce.isComposing && Boolean(normalized) && normalized === debounced
  const client = useQueryClient()
  const queryKey = ['user-search', options.endpoint ?? '/employees', JSON.stringify(options.params ?? {}), options.companyId,
    options.includeAdmins ?? true, options.managersOnly ?? false, options.excludeOrgUnitId, (options.excludeIds ?? []).join(','), debounced]
  const key = JSON.stringify(queryKey)
  const users = useQuery({
    queryKey,
    queryFn: ({ signal }) => searchUsers<T>(debounced, { ...options, signal }),
    enabled: searching,
    staleTime: 30_000,
  })
  useEffect(() => {
    if (!searching) void client.cancelQueries({ queryKey: JSON.parse(key) as unknown[], exact: true })
  }, [client, key, searching])
  return { ...debounce, users, searching, waitingForDebounce: Boolean(normalized) && normalized !== debounced,
    items: searching ? users.data?.items ?? [] : [] }
}

import { searchUsers } from '../../shared/api/user-search'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { api } from '../../shared/api/client'
import { personName } from '../../shared/lib/personName'
import { AsyncTaskCombobox } from '../tasks/AsyncTaskCombobox'

export interface UserSearchOption {
  id: string
  displayName: string
  jobTitle: string
  username?: string
  accountType?: 'ADMIN' | 'USER'
  avatarAsset?: string | null
}

export function UserSearchCombobox({
  label, value, defaultUser, name, onChange, onSelect, excludeIds = [], includeAdmins = true, managersOnly = false,
  companyId, excludeOrgUnitId, disabled = false, clearOnSelect = false, placeholder = 'Почніть вводити ім’я',
}: {
  label: string
  value?: string
  defaultUser?: (Pick<UserSearchOption, 'id' | 'displayName'> & Partial<UserSearchOption>) | null
  name?: string
  onChange?: (value: string) => void
  onSelect?: (user: UserSearchOption) => void
  excludeIds?: string[]
  includeAdmins?: boolean
  managersOnly?: boolean
  companyId?: string
  excludeOrgUnitId?: string
  disabled?: boolean
  clearOnSelect?: boolean
  placeholder?: string
}) {
  const [localValue, setLocalValue] = useState(defaultUser?.id ?? '')
  const currentValue = value ?? localValue
  const knownUsers = useRef(new Map<string, UserSearchOption>())
  if (defaultUser) knownUsers.current.set(defaultUser.id, { ...defaultUser, jobTitle: defaultUser.jobTitle ?? '' })
  const excludeKey = excludeIds.join(',')
  const loadOptions = useCallback(async (search: string, signal: AbortSignal) => {
    const { items: users } = await searchUsers<UserSearchOption>(search, { signal, includeAdmins, managersOnly, companyId, excludeOrgUnitId, excludeIds: excludeKey ? excludeKey.split(',') : [] })
    if (signal.aborted) return []
    for (const user of users) knownUsers.current.set(user.id, user)
    return users.map((user) => ({ id: user.id, label: personName(user.displayName),
      detail: user.accountType === 'ADMIN' ? 'Адміністратор' : user.jobTitle,
      avatar: { name: user.displayName, src: user.avatarAsset } }))
  }, [companyId, excludeKey, excludeOrgUnitId, includeAdmins, managersOnly])
  const knownUser = knownUsers.current.get(currentValue)
  const selected = useQuery({
    queryKey: ['user-selector-value', currentValue],
    queryFn: ({ signal }) => api<UserSearchOption>(`/employees/${encodeURIComponent(currentValue)}`, { signal }),
    enabled: Boolean(currentValue) && !knownUser,
  })
  const person = knownUser ?? selected.data
  return <>
    {name && <input type="hidden" name={name} value={currentValue} />}
    <AsyncTaskCombobox
      label={label}
      value={currentValue}
      selectedOption={person ? { id: person.id, label: personName(person.displayName) }
        : currentValue ? { id: currentValue, label: 'Вибраний користувач' } : null}
      placeholder={placeholder}
      disabled={disabled}
      clearOnSelect={clearOnSelect}
      loadOptions={loadOptions}
      onChange={(id) => {
        setLocalValue(id)
        onChange?.(id)
        const user = knownUsers.current.get(id)
        if (user) onSelect?.(user)
      }}
    />
  </>
}

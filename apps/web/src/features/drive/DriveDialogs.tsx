import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DriveShareRole, DriveShareTargetType, GroupListResult } from '@lankadws/contracts'
import { Check, Trash2, UserPlus, UsersRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../shared/api/client'
import { Avatar, Button, IconButton, Modal, Skeleton } from '../../shared/ui'
import { createShare, listShares, revokeShare } from './api'

interface EmployeeOption { id: string; displayName: string; avatarAsset: string | null }

export function NameDialog({
  title,
  label,
  initialValue = '',
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string
  label: string
  initialValue?: string
  confirmLabel: string
  onSubmit: (value: string) => Promise<void> | void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(trimmed)
      onClose()
    } catch {
      setError('Не вдалося зберегти. Спробуйте ще раз.')
      setBusy(false)
    }
  }

  return (
    <Modal title={title} size="sm" onRequestClose={onClose}>
      <form className="drive-name-form" onSubmit={submit}>
        <label>
          {label}
          <input
            autoFocus
            value={value}
            maxLength={120}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="drive-name-form__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Скасувати</Button>
          <Button disabled={busy || !value.trim()}>{busy ? 'Зберігаємо…' : confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  )
}

export function ShareDialog({
  targetType,
  targetId,
  targetName,
  canManage,
  onClose,
}: {
  targetType: DriveShareTargetType
  targetId: string
  targetName: string
  canManage: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [principalType, setPrincipalType] = useState<'USER' | 'GROUP'>('USER')
  const [principalId, setPrincipalId] = useState('')
  const [role, setRole] = useState<DriveShareRole>('VIEWER')
  const [error, setError] = useState('')

  const shares = useQuery({
    queryKey: ['drive-shares', targetType, targetId],
    queryFn: () => listShares(targetType, targetId),
  })
  const people = useQuery({
    queryKey: ['employees'],
    queryFn: () => api<{ items: EmployeeOption[] }>('/employees'),
    enabled: principalType === 'USER',
  })
  const groups = useQuery({
    queryKey: ['groups', 'share-picker'],
    queryFn: () => api<GroupListResult>('/groups?status=ACTIVE&limit=50'),
    enabled: principalType === 'GROUP',
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['drive-shares', targetType, targetId] })
    void queryClient.invalidateQueries({ queryKey: ['drive'] })
  }
  const grant = useMutation({
    mutationFn: () => createShare({ targetType, targetId, principalType, principalId, role }),
    onSuccess: () => { setPrincipalId(''); setError(''); invalidate() },
    onError: () => setError('Не вдалося надати доступ.'),
  })
  const revoke = useMutation({
    mutationFn: (shareId: string) => revokeShare(shareId),
    onSuccess: invalidate,
    onError: () => setError('Не вдалося відкликати доступ.'),
  })

  const options = principalType === 'USER'
    ? (people.data?.items ?? []).map((person) => ({ id: person.id, label: person.displayName }))
    : (groups.data?.items ?? []).map((group) => ({ id: group.id, label: group.name }))
  const alreadyShared = new Set((shares.data ?? []).map((share) => share.principalId))
  const available = options.filter((option) => !alreadyShared.has(option.id))

  return (
    <Modal title={`Доступ до «${targetName}»`} size="md" onRequestClose={onClose}>
      <div className="drive-share">
        {canManage && (
          <form
            className="drive-share__grant"
            onSubmit={(event) => { event.preventDefault(); if (principalId) grant.mutate() }}
          >
            <div className="drive-share__kind" role="group" aria-label="Кому надати доступ">
              <button
                type="button"
                className={principalType === 'USER' ? 'is-active' : ''}
                onClick={() => { setPrincipalType('USER'); setPrincipalId('') }}
              >
                <UserPlus size={15} aria-hidden />Людині
              </button>
              <button
                type="button"
                className={principalType === 'GROUP' ? 'is-active' : ''}
                onClick={() => { setPrincipalType('GROUP'); setPrincipalId('') }}
              >
                <UsersRound size={15} aria-hidden />Групі
              </button>
            </div>
            <label className="drive-share__pick">
              <span className="visually-hidden">{principalType === 'USER' ? 'Людина' : 'Група'}</span>
              <select value={principalId} onChange={(event) => setPrincipalId(event.target.value)}>
                <option value="">{principalType === 'USER' ? 'Оберіть людину…' : 'Оберіть групу…'}</option>
                {available.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label className="drive-share__role">
              <span className="visually-hidden">Рівень доступу</span>
              <select value={role} onChange={(event) => setRole(event.target.value as DriveShareRole)}>
                <option value="VIEWER">Перегляд</option>
                <option value="EDITOR">Редагування</option>
              </select>
            </label>
            <Button disabled={!principalId || grant.isPending}>Надати</Button>
          </form>
        )}
        {error && <div className="form-error">{error}</div>}
        {shares.isPending ? <Skeleton rows={2} /> : (
          <ul className="drive-share__list">
            {(shares.data ?? []).length === 0 && (
              <li className="drive-share__empty">Доступ поки ні в кого немає.</li>
            )}
            {(shares.data ?? []).map((share) => (
              <li key={share.id}>
                {share.principalType === 'USER'
                  ? <Avatar name={share.principalName} size="sm" />
                  : <span className="drive-share__group-icon"><UsersRound size={16} aria-hidden /></span>}
                <span className="drive-share__name">{share.principalName}</span>
                <span className="drive-share__badge">{share.role === 'EDITOR' ? 'Редагування' : 'Перегляд'}</span>
                {canManage && (
                  <IconButton
                    label={`Відкликати доступ: ${share.principalName}`}
                    onClick={() => revoke.mutate(share.id)}
                    disabled={revoke.isPending}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {targetType === 'FOLDER' && (
          <p className="drive-share__hint">
            <Check size={14} aria-hidden />
            Доступ до папки поширюється на все, що всередині, включно з вкладеними папками.
          </p>
        )}
      </div>
    </Modal>
  )
}

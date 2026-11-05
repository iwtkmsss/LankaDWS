import { UserSearchCombobox } from '../employees/UserSearchCombobox'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DriveShareRole, DriveShareTargetType } from '@lankadws/contracts'
import { Check, Folder, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Avatar, Button, ErrorState, IconButton, Modal, Skeleton } from '../../shared/ui'
import { createShare, fetchDrive, listShares, revokeShare } from './api'
import { useAuth } from '../../shared/auth/AuthProvider'
import { personName } from '../../shared/lib/personName'

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
  const { user } = useAuth()
  const principalType = 'USER' as const
  const [principalId, setPrincipalId] = useState('')
  const [role, setRole] = useState<DriveShareRole>('VIEWER')
  const [error, setError] = useState('')

  const shares = useQuery({
    queryKey: ['drive-shares', targetType, targetId],
    queryFn: () => listShares(targetType, targetId),
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
    onSuccess: () => { setError(''); invalidate() },
    onError: () => setError('Не вдалося відкликати доступ.'),
  })
  const changeRole = useMutation({
    mutationFn: (input: { principalId: string; role: DriveShareRole }) => createShare({ targetType, targetId, principalType, ...input }),
    onSuccess: () => { setError(''); invalidate() },
    onError: () => setError('Не вдалося змінити рівень доступу.'),
  })


  return (
    <Modal title={`Доступ до «${targetName}»`} size="md" onRequestClose={onClose}>
      <div className="drive-share">
        {canManage && (
          <form
            className="drive-share__grant"
            onSubmit={(event) => { event.preventDefault(); if (principalId) grant.mutate() }}
          >
            <UserSearchCombobox
              label="Людина"
              value={principalId}
              onChange={setPrincipalId}
              excludeIds={[...(user ? [user.id] : []), ...(shares.data ?? []).map((share) => share.principalId)]}
              disabled={grant.isPending}
            />
            <label className="drive-share__role">
              <span>Рівень доступу</span>
              <select value={role} onChange={(event) => setRole(event.target.value as DriveShareRole)}>
                <option value="VIEWER">Перегляд</option>
                <option value="EDITOR">Редагування</option>
              </select>
            </label>
            <Button disabled={!principalId || grant.isPending}>Надати</Button>
          </form>
        )}
        {error && <div className="form-error">{error}</div>}
        {shares.isError && <div className="form-error" role="alert">Не вдалося завантажити список доступу. <Button variant="ghost" onClick={() => void shares.refetch()}>Повторити</Button></div>}
        {shares.isPending ? <Skeleton rows={2} /> : shares.isError ? null : (
          <ul className="drive-share__list">
            {(shares.data ?? []).length === 0 && (
              <li className="drive-share__empty">Доступ поки ні в кого немає.</li>
            )}
            {(shares.data ?? []).map((share) => (
              <li key={share.id}>
                <div className="drive-share__person">
                  <Avatar name={share.principalName} src={share.avatarAsset} size="sm" />
                  <span className="drive-share__name" title={personName(share.principalName)}>{personName(share.principalName)}</span>
                </div>
                {canManage ? (
                  <select
                    className="drive-share__member-role"
                    aria-label={`Рівень доступу: ${share.principalName}`}
                    value={share.role}
                    disabled={changeRole.isPending || revoke.isPending}
                    onChange={(event) => changeRole.mutate({ principalId: share.principalId, role: event.target.value as DriveShareRole })}
                  >
                    <option value="VIEWER">Перегляд</option>
                    <option value="EDITOR">Редагування</option>
                  </select>
                ) : <span className="drive-share__badge">{share.role === 'EDITOR' ? 'Редагування' : 'Перегляд'}</span>}
                {canManage && (
                  <IconButton
                    label={`Відкликати доступ: ${share.principalName}`}
                    onClick={() => revoke.mutate(share.id)}
                    disabled={revoke.isPending || changeRole.isPending}
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


export function MoveDialog({ target, onClose, onMove }: {
  target: import('./DriveItems').DriveTarget
  onClose: () => void
  onMove: (folderId: string | null) => Promise<void>
}) {
  const [folderId, setFolderId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const query = useQuery({
    queryKey: ['drive', 'move-destination', folderId],
    queryFn: () => fetchDrive({ view: 'MY_DRIVE', type: 'FOLDER', ...(folderId ? { folderId } : {}) }),
  })
  const currentFolderId = target.kind === 'FILE' ? target.file.folderId : target.folder.parentId
  async function submit() {
    setBusy(true)
    setError('')
    try { await onMove(folderId); onClose() }
    catch { setError('Не вдалося перемістити. Перевірте доступ і повторіть спробу.'); setBusy(false) }
  }
  return <Modal title="Перемістити" description={target.kind === 'FILE' ? target.file.name : target.folder.name} size="sm" onRequestClose={() => { if (!busy) onClose() }}
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Скасувати</Button><Button disabled={busy || !query.data || query.isError || currentFolderId === folderId} onClick={() => void submit()}>Перемістити сюди</Button></>}>
    <nav className="drive-move-path" aria-label="Папка призначення"><Button variant="secondary" disabled={busy} onClick={() => setFolderId(null)}>Мій диск</Button>{query.data?.breadcrumbs.map((crumb) => <Button key={crumb.id} variant="secondary" disabled={busy} onClick={() => setFolderId(crumb.id)}>{crumb.name}</Button>)}</nav>
    {query.isLoading ? <Skeleton rows={3} /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <div className="drive-move-folders">{query.data?.folders.filter((folder) => folder.isOwner && (target.kind !== 'FOLDER' || folder.id !== target.folder.id)).map((folder) => <Button key={folder.id} variant="secondary" disabled={busy} onClick={() => setFolderId(folder.id)}><Folder size={18} aria-hidden />{folder.name}</Button>)}</div>}
    {error && <p role="alert">{error}</p>}
  </Modal>
}

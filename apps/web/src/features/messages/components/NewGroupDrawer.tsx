import { useUserSearch } from '../../../shared/lib/useUserSearch'
import { personName } from '../../../shared/lib/personName'
import type { ChatContactUser } from '@lankadws/contracts'
import { useMutation } from '@tanstack/react-query'
import { Check, Plus, Search, UsersRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { randomId } from '../../../shared/api/client'
import {
  Avatar,
  Button,
  Drawer,
  Skeleton,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../../../shared/ui'
import { createThread } from '../api/messageApi'
import { normalizedCodePointLength } from '../lib/messageText'

export function NewGroupDrawer({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string
  onClose: () => void
  onCreated: (threadId: string) => void
}) {
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [selected, setSelected] = useState<ChatContactUser[]>([])
  const { users, items: searchItems,
    debouncedValue: debounced, isComposing, onCompositionStart, onCompositionEnd,
  } = useUserSearch<ChatContactUser>(query, {
    endpoint: '/messages/users/search', params: { company: companyId }, excludeIds: selected.map((user) => user.id),
  })
  const attemptRef = useRef({ signature: '', key: '' })
  const closeGuard = useModalCloseGuard({
    dirty: Boolean(title.trim() || selected.length),
    onRequestClose: () => onClose(),
  })
  const normalizedLength = normalizedCodePointLength(debounced)

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        companyId,
        kind: 'GROUP' as const,
        title: title.trim(),
        participantIds: selected.map((user) => user.id),
      }
      const signature = JSON.stringify(payload)
      if (attemptRef.current.signature !== signature) {
        attemptRef.current = {
          signature,
          key: `chat-group:${randomId()}`,
        }
      }
      return createThread(payload, attemptRef.current.key)
    },
    onSuccess: (thread) => closeGuard.closeForSuccess(() => onCreated(thread.id)),
  })

  useEffect(() => {
    setQuery('')
    setSelected([])
    attemptRef.current = { signature: '', key: '' }
  }, [companyId])

  function toggle(contact: ChatContactUser) {
    setSelected((current) =>
      current.some((item) => item.id === contact.id)
        ? current.filter((item) => item.id !== contact.id)
        : [...current, contact],
    )
  }

  return (
    <>
      <Drawer
        title="Нова група"
        onBeforeClose={closeGuard.shouldClose}
        onRequestClose={closeGuard.requestClose}
        className="new-group-drawer"
        footer={(
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => closeGuard.requestClose('cancel-button')}
            >
              Скасувати
            </Button>
            <Button
              disabled={create.isPending || title.trim().length < 2 || selected.length < 2}
              onClick={() => create.mutate()}
            >
              Створити групу
            </Button>
          </>
        )}
      >
        <div className="new-group">
        <label className="new-group__title">
          Назва групи
          <input
            autoFocus
            value={title}
            maxLength={120}
            placeholder="Наприклад, Запуск кабінету"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div
          className="new-group__search-area"
          onFocusCapture={() => setSearchFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSearchFocused(false)
          }}
        >
        <label>
          <span className="new-group__participants-heading">
            <span>Учасники</span>
            <span className="new-group__count" aria-label={`Обрано ${selected.length} із 49 учасників`}>{selected.length}/49</span>
          </span>
          <div className="new-group__search">
            <Search size={17} />
            <input
              value={query}
              aria-label="Пошук учасників групи"
              aria-describedby="new-group-search-hint"
              placeholder="Введіть ім’я або нікнейм"
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
            />
            {query && (
              <button type="button" aria-label="Очистити пошук" onClick={() => setQuery('')}>
                <X size={15} />
              </button>
            )}
          </div>
        </label>
        <p id="new-group-search-hint" className="new-group__hint">Додайте щонайменше двох учасників. Пошук — за ім’ям або нікнеймом.</p>
        {selected.length > 0 && (
          <div className="new-group__selected" aria-label="Обрані учасники">
            {selected.map((contact) => (
              <button type="button" key={contact.id} aria-label={`Прибрати учасника ${personName(contact.displayName)}`} onClick={() => toggle(contact)}>
                <Avatar size="sm" name={personName(contact.displayName)} src={contact.avatarAsset} />
                <span className="new-group__selected-name">{personName(contact.displayName)}</span>
                <X size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        {searchFocused && (query && !isComposing && normalizedLength < 1 ? (
          <p className="new-group__hint">Введіть щонайменше 1 символ.</p>
        ) : users.isLoading ? (
          <Skeleton rows={5} />
        ) : (
          <div className="new-group__results">
            {searchItems.map((contact) => {
              const isSelected = selected.some((item) => item.id === contact.id)
              return (
                <button
                  type="button"
                  className={isSelected ? 'is-selected' : ''}
                  aria-pressed={isSelected}
                  key={contact.id}
                  onClick={() => toggle(contact)}
                >
                  <Avatar name={personName(contact.displayName)} src={contact.avatarAsset} />
                  <span>
                    <strong>{personName(contact.displayName)}</strong>
                    <small>{contact.jobTitle || `@${contact.username}`}</small>
                  </span>
                  <i>{isSelected ? <Check size={16} /> : <Plus size={16} />}</i>
                </button>
              )
            })}
          </div>
        ))}
        </div>
        {!query.trim() && !selected.length && (
          <div className="new-group__empty">
            <span className="new-group__empty-icon" aria-hidden="true"><UsersRound size={26} /></span>
            <p>Зберіть людей для спільної розмови</p>
          </div>
        )}
        {create.isError && <p className="form-error" role="alert">Не вдалося створити групу. Оновіть дані й спробуйте ще раз.</p>}
        </div>
      </Drawer>
      <UnsavedChangesDialog
        guard={closeGuard}
        title="Закрити створення групи?"
        description="Назва й вибрані учасники не збережуться."
      />
    </>
  )
}

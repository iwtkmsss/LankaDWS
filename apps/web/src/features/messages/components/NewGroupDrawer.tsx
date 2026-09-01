import type { ChatContactUser } from '@bert-crm/contracts'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Plus, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { randomId } from '../../../shared/api/client'
import { useDebouncedSearchValue } from '../../../shared/lib/useDebouncedSearchValue'
import {
  Avatar,
  Button,
  Drawer,
  Skeleton,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../../../shared/ui'
import { createThread, searchChatUsers } from '../api/messageApi'
import { messageKeys } from '../api/messageKeys'
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
  const {
    debouncedValue: debounced,
    isComposing,
    onCompositionStart,
    onCompositionEnd,
  } = useDebouncedSearchValue(query)
  const [selected, setSelected] = useState<ChatContactUser[]>([])
  const attemptRef = useRef({ signature: '', key: '' })
  const closeGuard = useModalCloseGuard({
    dirty: Boolean(title.trim() || selected.length),
    onRequestClose: () => onClose(),
  })
  const normalizedLength = normalizedCodePointLength(debounced)
  const users = useQuery({
    queryKey: messageKeys.users(companyId, debounced),
    queryFn: ({ signal }) => searchChatUsers(companyId, debounced, signal),
    enabled: !isComposing && normalizedLength >= 1,
  })
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
        <label>
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
          Учасники <span>{selected.length}/49</span>
          <div className="new-group__search">
            <Search size={17} />
            <input
              value={query}
              placeholder="Ім’я або нікнейм"
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
        {selected.length > 0 && (
          <div className="new-group__selected" aria-label="Обрані учасники">
            {selected.map((contact) => (
              <button type="button" key={contact.id} onClick={() => toggle(contact)}>
                <Avatar size="sm" name={contact.displayName} src={contact.avatarAsset} />
                {contact.displayName}
                <X size={14} />
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
            {users.data?.items.map((contact) => {
              const isSelected = selected.some((item) => item.id === contact.id)
              return (
                <button
                  type="button"
                  className={isSelected ? 'is-selected' : ''}
                  aria-pressed={isSelected}
                  key={contact.id}
                  onClick={() => toggle(contact)}
                >
                  <Avatar name={contact.displayName} src={contact.avatarAsset} />
                  <span>
                    <strong>{contact.displayName}</strong>
                    <small>@{contact.username}{contact.jobTitle ? ` · ${contact.jobTitle}` : ''}</small>
                  </span>
                  <i>{isSelected ? <Check size={16} /> : <Plus size={16} />}</i>
                </button>
              )
            })}
          </div>
        ))}
        </div>
        {create.isError && <p className="form-error" role="alert">Не вдалося створити групу. Оновіть дані й спробуйте ще раз.</p>}
        </div>
      </Drawer>
      <UnsavedChangesDialog guard={closeGuard} />
    </>
  )
}

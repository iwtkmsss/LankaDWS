import type { ChatContactUser } from '@bert-crm/contracts'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, Search, UsersRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useDebouncedSearchValue } from '../../../shared/lib/useDebouncedSearchValue'
import { Avatar, Button, Drawer, Skeleton } from '../../../shared/ui'
import { searchChatUsers } from '../api/messageApi'
import { messageKeys } from '../api/messageKeys'
import { normalizedCodePointLength } from '../lib/messageText'

export function NewChatDrawer({
  companyId,
  targetUserId,
  startingUserId,
  onClose,
  onStartDirect,
  onOpenGroup,
}: {
  companyId: string
  targetUserId: string | null
  startingUserId: string | null
  onClose: () => void
  onStartDirect: (userId: string) => void
  onOpenGroup: () => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [searchFocused, setSearchFocused] = useState(false)
  const attemptedTargetRef = useRef<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const {
    debouncedValue: debouncedQuery,
    isComposing,
    onCompositionStart,
    onCompositionEnd,
  } = useDebouncedSearchValue(query)
  const normalizedLength = normalizedCodePointLength(debouncedQuery)
  const searching = !isComposing && normalizedLength >= 1
  const users = useQuery({
    queryKey: messageKeys.users(companyId, debouncedQuery),
    queryFn: ({ signal }) => searchChatUsers(companyId, debouncedQuery, signal),
    enabled: searching,
  })
  const results = users.data?.items ?? []
  const waitingForDebounce = !isComposing && Boolean(query) && query !== debouncedQuery

  useEffect(() => setActiveIndex(0), [debouncedQuery])

  useEffect(() => {
    if (!targetUserId || attemptedTargetRef.current === targetUserId) return
    attemptedTargetRef.current = targetUserId
    onStartDirect(targetUserId)
  }, [onStartDirect, targetUserId])

  function select(contact: ChatContactUser) {
    onStartDirect(contact.id)
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!searching || !results.length) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (query) setQuery('')
        else onClose()
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const selected = results[activeIndex]
      if (selected) select(selected)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setQuery('')
    }
  }

  return (
    <Drawer
      title="Новий чат"
      onRequestClose={onClose}
      initialFocusRef={searchInputRef}
      footer={(
        <Button type="button" variant="secondary" onClick={onClose}>Скасувати</Button>
      )}
    >
      <div className="new-chat">
        <p>Оберіть колегу для особистого діалогу або створіть групу.</p>
        <Button type="button" variant="secondary" onClick={onOpenGroup}>
          <UsersRound size={16} /> Створити групу
        </Button>
        <div
          className="new-chat__search-area"
          onFocusCapture={() => setSearchFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSearchFocused(false)
          }}
        >
        <label>
          Кому написати
          <div className="new-chat__search">
            <Search size={17} />
            <input
              ref={searchInputRef}
              role="combobox"
              aria-label="Пошук користувачів для нового чату"
              aria-autocomplete="list"
              aria-expanded={searching}
              aria-controls={searching ? 'new-chat-user-results' : undefined}
              aria-activedescendant={
                searching && results[activeIndex]
                  ? `new-chat-user-${results[activeIndex]!.id}`
                  : undefined
              }
              value={query}
              placeholder="Ім’я або нікнейм"
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              onKeyDown={handleSearchKeyDown}
            />
            {query && (
              <button type="button" aria-label="Очистити пошук" onClick={() => setQuery('')}>
                <X size={15} />
              </button>
            )}
          </div>
        </label>
        {targetUserId && startingUserId === targetUserId && (
          <p className="new-chat__status" role="status"><LoaderCircle className="is-spinning" size={16} /> Відкриваємо діалог…</p>
        )}
        {searchFocused && (query && !isComposing && normalizedLength < 1 ? (
          <p className="new-chat__hint">Введіть щонайменше 1 символ.</p>
        ) : (users.isLoading || waitingForDebounce) ? (
          <Skeleton rows={5} />
        ) : searching ? (
          <div id="new-chat-user-results" className="new-chat__results" role="listbox" aria-label="Результати пошуку користувачів">
            {results.map((contact, index) => (
              <button
                id={`new-chat-user-${contact.id}`}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                className={activeIndex === index ? 'is-active' : ''}
                key={contact.id}
                disabled={Boolean(startingUserId)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(contact)}
              >
                <Avatar name={contact.displayName} src={contact.avatarAsset} />
                <span>
                  <strong>{contact.displayName}</strong>
                  <small>@{contact.username}{contact.jobTitle ? ` · ${contact.jobTitle}` : ''}</small>
                </span>
                {startingUserId === contact.id
                  ? <LoaderCircle className="is-spinning" size={18} aria-label="Відкриваємо діалог" />
                  : <Search size={17} aria-hidden="true" />}
              </button>
            ))}
            {!results.length && <p className="new-chat__hint">Користувачів не знайдено.</p>}
          </div>
        ) : (
          <p className="new-chat__hint">Пошук починається з 1 символу.</p>
        ))}
        </div>
      </div>
    </Drawer>
  )
}

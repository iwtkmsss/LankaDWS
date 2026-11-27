import { personName } from '../../../shared/lib/personName'
import type { ChatMessageSearchPage } from '@lankadws/contracts'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useDebouncedSearchValue } from '../../../shared/lib/useDebouncedSearchValue'
import { IconButton } from '../../../shared/ui'
import { messageKeys } from '../api/messageKeys'
import { searchThreadMessages } from '../api/messageApi'
import { formatChatDay } from '../lib/chatDates'
import { normalizedCodePointLength } from '../lib/messageText'

export function ConversationSearch({
  threadId,
  onOpenResult,
}: {
  threadId: string
  onOpenResult: (messageId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const controlsId = useId()
  const {
    debouncedValue: debounced,
    isComposing,
    onCompositionStart,
    onCompositionEnd,
  } = useDebouncedSearchValue(query)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])
  const searchTerm = open && !isComposing && debounced === query.trim() ? debounced : ''
  const canSearch = normalizedCodePointLength(searchTerm) >= 1
  const results = useQuery<ChatMessageSearchPage>({
    queryKey: messageKeys.search(threadId, searchTerm),
    queryFn: ({ signal }) => searchThreadMessages(threadId, searchTerm, undefined, signal),
    enabled: canSearch,
  })

  function closeSearch() {
    triggerRef.current?.focus()
    setOpen(false)
    setQuery('')
    onCompositionEnd()
  }

  return (
    <section
      className={`conversation-search${open ? ' is-open' : ''}`}
      aria-label="Пошук у діалозі"
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.stopPropagation()
        closeSearch()
      }}
    >
      <IconButton
        ref={triggerRef}
        label="Пошук у діалозі"
        aria-expanded={open}
        aria-controls={controlsId}
        onClick={open ? closeSearch : () => setOpen(true)}
      >
        <Search size={20} aria-hidden="true" />
      </IconButton>
      <div id={controlsId} className="conversation-search__controls" inert={!open}>
        <input
          ref={inputRef}
          aria-label="Пошук у діалозі"
          placeholder="Пошук у діалозі"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
        <IconButton label="Закрити пошук" onClick={closeSearch}>
          <X size={18} aria-hidden="true" />
        </IconButton>
      </div>
      {canSearch && (results.isLoading || results.isError || results.data) && (
        <div className="conversation-search__results">
          {results.isLoading ? (
            <p><LoaderCircle className="is-spinning" size={16} /> Шукаємо…</p>
          ) : results.isError ? (
            <p role="alert">Не вдалося виконати пошук.</p>
          ) : results.data && (
            <>
              <small>Знайдено: {results.data.total}</small>
              {results.data.items.map((message) => (
                <button
                  type="button"
                  key={message.id}
                  onClick={() => {
                    closeSearch()
                    onOpenResult(message.id)
                  }}
                >
                  <span>
                    <strong>{personName(message.author.displayName)}</strong>
                    <time>{formatChatDay(message.createdAt)}</time>
                  </span>
                  <span>{message.body}</span>
                </button>
              ))}
              {!results.data.items.length && <p>Повідомлень не знайдено.</p>}
            </>
          )}
        </div>
      )}
    </section>
  )
}

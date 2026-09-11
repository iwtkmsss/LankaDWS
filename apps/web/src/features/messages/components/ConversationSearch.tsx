import type { ChatMessageSearchPage } from '@lankadws/contracts'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDebouncedSearchValue } from '../../../shared/lib/useDebouncedSearchValue'
import { messageKeys } from '../api/messageKeys'
import { searchThreadMessages } from '../api/messageApi'
import { formatChatDay } from '../lib/chatDates'
import { normalizedCodePointLength } from '../lib/messageText'

export function ConversationSearch({
  threadId,
  onClose,
  onOpenResult,
}: {
  threadId: string
  onClose: () => void
  onOpenResult: (messageId: string) => void
}) {
  const [query, setQuery] = useState('')
  const {
    debouncedValue: debounced,
    isComposing,
    onCompositionStart,
    onCompositionEnd,
  } = useDebouncedSearchValue(query)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const results = useQuery<ChatMessageSearchPage>({
    queryKey: messageKeys.search(threadId, debounced),
    queryFn: ({ signal }) => searchThreadMessages(threadId, debounced, undefined, signal),
    enabled: !isComposing && normalizedCodePointLength(debounced) >= 1,
  })

  return (
    <section className="conversation-search" aria-label="Пошук у діалозі">
      <div>
        <Search size={18} />
        <input
          ref={inputRef}
          aria-label="Пошук у діалозі"
          placeholder="Пошук у діалозі"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
          }}
        />
        <button type="button" aria-label="Закрити пошук" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {results.isLoading ? (
        <p><LoaderCircle className="is-spinning" size={16} /> Шукаємо…</p>
      ) : results.isError ? (
        <p role="alert">Не вдалося виконати пошук.</p>
      ) : results.data ? (
        <div className="conversation-search__results">
          <small>Знайдено: {results.data.total}</small>
          {results.data.items.map((message) => (
            <button
              type="button"
              key={message.id}
              onClick={() => onOpenResult(message.id)}
            >
              <span>
                <strong>{message.author.displayName}</strong>
                <time>{formatChatDay(message.createdAt)}</time>
              </span>
              <span>{message.body}</span>
            </button>
          ))}
          {!results.data.items.length && <p>Повідомлень не знайдено.</p>}
        </div>
      ) : null}
    </section>
  )
}

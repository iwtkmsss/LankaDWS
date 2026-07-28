import type { ChatMessageSearchPage } from '@bert-crm/contracts'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { messageKeys } from '../api/messageKeys'
import { searchThreadMessages } from '../api/messageApi'
import { formatChatDay } from '../lib/chatDates'

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
  const [debounced, setDebounced] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [query])
  useEffect(() => inputRef.current?.focus(), [])
  const results = useQuery<ChatMessageSearchPage>({
    queryKey: messageKeys.search(threadId, debounced),
    queryFn: ({ signal }) => searchThreadMessages(threadId, debounced, undefined, signal),
    enabled: debounced.length >= 2,
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
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
          }}
        />
        <button type="button" aria-label="Закрити пошук" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {query.trim().length > 0 && query.trim().length < 2 && (
        <p>Введіть щонайменше 2 символи.</p>
      )}
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

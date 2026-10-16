import { conversationName, personName } from '../../../shared/lib/personName'
import type {
  ChatContactUser,
  ChatThreadCounts,
  ChatThreadListItem,
  RecommendedChatUser,
} from '@lankadws/contracts'
import { LoaderCircle, MessageCircle, Search, UsersRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Avatar, ErrorState, PageDataLoader, Skeleton } from '../../../shared/ui'
import { formatChatTime } from '../lib/chatDates'
import type { MessageDrafts } from '../lib/messageDrafts'
import { highlightNormalizedText, normalizedCodePointLength } from '../lib/messageText'
import { ChatPinButton } from './ChatPinButton'

interface MessagesSidebarProps {
  drafts: MessageDrafts
  threads: ChatThreadListItem[]
  counts: ChatThreadCounts
  selectedThreadId?: string
  unreadOnly: boolean
  query: string
  debouncedQuery: string
  isComposing: boolean
  searchResults: ChatContactUser[]
  recommendations: RecommendedChatUser[]
  loadingThreads: boolean
  threadError: boolean
  loadingSearch: boolean
  loadingRecommendations: boolean
  startingUserId: string | null
  hasMoreThreads: boolean
  loadingMoreThreads: boolean
  onQueryChange: (value: string) => void
  onSearchCompositionStart: () => void
  onSearchCompositionEnd: () => void
  onUnreadChange: (value: boolean) => void
  onSelectThread: (threadId: string) => void
  onStartDirect: (contact: ChatContactUser) => void
  onLoadMore: () => void
  onRetryThreads: () => void
  onPinThread?: (threadId: string, pinned: boolean) => void
  pinPending?: boolean
  pinError?: boolean
}

function ThreadAvatar({ thread }: { thread: ChatThreadListItem }) {
  if (thread.kind === 'DIRECT') {
    return <Avatar name={conversationName(thread)} src={thread.avatarAsset} />
  }
  return (
    <span className="messages-avatar-stack" aria-hidden="true">
      {thread.previewParticipants.slice(0, 3).map((participant) => (
        <Avatar
          key={participant.id}
          size="sm"
          name={personName(participant.displayName)}
          src={participant.avatarAsset}
        />
      ))}
      {!thread.previewParticipants.length && <UsersRound size={21} />}
    </span>
  )
}

function reasonLabel(reason: RecommendedChatUser['reason']): string {
  if (reason === 'RECENT') return 'Нещодавній діалог'
  if (reason === 'FREQUENT') return 'Часто спілкуєтесь'
  if (reason === 'SHARED_CONTEXT') return 'Спільна робота'
  return 'Ваша команда'
}

export function MessagesSidebar(props: MessagesSidebarProps) {
  const [activeResult, setActiveResult] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const searching = !props.isComposing && normalizedCodePointLength(props.query) >= 1
  const waitingForDebounce = searching && props.query !== props.debouncedQuery
  const resultCount = props.searchResults.length

  useEffect(() => setActiveResult(0), [props.debouncedQuery])

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!searching || !resultCount) {
      if (event.key === 'Escape' && props.query) props.onQueryChange('')
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveResult((current) => (current + 1) % resultCount)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveResult((current) => (current - 1 + resultCount) % resultCount)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const selected = props.searchResults[activeResult]
      if (selected) props.onStartDirect(selected)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      props.onQueryChange('')
    }
  }

  return (
    <aside className="messages-sidebar" aria-label="Повідомлення">
      <div className="messages-sidebar__search">
        <Search size={18} aria-hidden="true" />
        <input
          ref={searchRef}
          role="combobox"
          aria-label="Пошук користувачів"
          aria-autocomplete="list"
          aria-expanded={searching}
          aria-controls={searching ? 'message-user-results' : undefined}
          aria-activedescendant={
            searching && props.searchResults[activeResult]
              ? `message-user-${props.searchResults[activeResult]!.id}`
              : undefined
          }
          value={props.query}
          placeholder="Пошук користувачів"
          onChange={(event) => props.onQueryChange(event.target.value)}
          onCompositionStart={props.onSearchCompositionStart}
          onCompositionEnd={props.onSearchCompositionEnd}
          onKeyDown={handleSearchKeyDown}
        />
        {props.query && (
          <button
            type="button"
            aria-label="Очистити пошук"
            onClick={() => {
              props.onQueryChange('')
              searchRef.current?.focus()
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {props.query && !props.isComposing && !searching && (
        <p className="messages-sidebar__search-hint" role="status">
          Введіть щонайменше 1 символ
        </p>
      )}

      {searching ? (
        <section className="messages-sidebar__results" aria-label="Результати пошуку">
          {(props.loadingSearch || waitingForDebounce) ? (
            <Skeleton rows={5} />
          ) : props.searchResults.length ? (
            <div id="message-user-results" role="listbox">
              {props.searchResults.map((contact, index) => (
                <button
                  id={`message-user-${contact.id}`}
                  role="option"
                  aria-selected={activeResult === index}
                  className={activeResult === index ? 'is-active' : ''}
                  type="button"
                  key={contact.id}
                  onMouseEnter={() => setActiveResult(index)}
                  onClick={() => props.onStartDirect(contact)}
                  disabled={Boolean(props.startingUserId)}
                >
                  <Avatar name={personName(contact.displayName)} src={contact.avatarAsset} />
                  <span>
                    <strong>{highlightNormalizedText(personName(contact.displayName), props.debouncedQuery)}</strong>
                    <small>
                      @{highlightNormalizedText(contact.username, props.debouncedQuery)}
                      {contact.jobTitle ? ` · ${contact.jobTitle}` : ''}
                    </small>
                  </span>
                  {props.startingUserId === contact.id
                    ? <LoaderCircle className="is-spinning" size={18} aria-label="Відкриваємо діалог" />
                    : <MessageCircle size={18} aria-hidden="true" />}
                </button>
              ))}
            </div>
          ) : (
            <div className="messages-sidebar__no-results">
              <Search size={24} />
              <strong>Користувачів не знайдено</strong>
              <span>Перевірте ім’я або нікнейм.</span>
            </div>
          )}
        </section>
      ) : (
        <>
          {props.recommendations.length > 0 && (
            <section className="messages-recommendations" aria-label="Рекомендовані контакти">
              <div className="messages-section-label">Рекомендовані</div>
              <div>
                {props.recommendations.map((contact) => {
                  const [surname, givenName] = personName(contact.displayName).trim().split(/\s+/u)
                  return (
                    <button
                      type="button"
                      key={contact.id}
                      disabled={Boolean(props.startingUserId)}
                      onClick={() => props.onStartDirect(contact)}
                      title={`${personName(contact.displayName)}: ${reasonLabel(contact.reason)}`}
                    >
                      <Avatar name={personName(contact.displayName)} src={contact.avatarAsset} />
                      <strong>{givenName || surname}</strong>
                      {givenName && <strong>{surname}</strong>}
                    </button>
                  )
                })}
              </div>
            </section>
          )}
          {props.loadingRecommendations && (
            <div className="messages-recommendations messages-recommendations--loading">
              <Skeleton rows={1} />
            </div>
          )}

          <div className="messages-tabs" role="tablist" aria-label="Фільтр діалогів">
            <button
              type="button"
              role="tab"
              aria-selected={!props.unreadOnly}
              className={!props.unreadOnly ? 'is-active' : ''}
              onClick={() => props.onUnreadChange(false)}
            >
              Усі <span>{props.counts.all}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={props.unreadOnly}
              className={props.unreadOnly ? 'is-active' : ''}
              onClick={() => props.onUnreadChange(true)}
            >
              Непрочитані <span>{props.counts.unread}</span>
            </button>
          </div>

          <div className="messages-thread-scroll">
            {props.pinError && <p role="alert">Не вдалося змінити закріплення чату. Спробуйте ще раз.</p>}
            {props.loadingThreads ? (
              <PageDataLoader />
            ) : props.threadError ? (
              <ErrorState title="Не вдалося завантажити діалоги" onRetry={props.onRetryThreads} />
            ) : props.threads.length ? (
              <div className="messages-thread-list">
                {props.threads.map((thread) => (
                  <div className="message-thread-entry" key={thread.id}>
                  <button
                    type="button"
                    key={thread.id}
                    className={[
                      'message-thread-select',
                      props.selectedThreadId === thread.id ? 'is-selected' : '',
                      thread.unread ? 'is-unread' : '',
                    ].filter(Boolean).join(' ')}
                    aria-current={props.selectedThreadId === thread.id ? 'page' : undefined}
                    aria-label={`${conversationName(thread)}${thread.unreadCount ? `, ${thread.unreadCount} непрочитаних` : ''}`}
                    onClick={() => props.onSelectThread(thread.id)}
                  >
                    <ThreadAvatar thread={thread} />
                    <span className="messages-thread-list__copy">
                      <span>
                        <strong>{conversationName(thread)}</strong>
                      </span>
                      <span>
                        <small>
                          {props.drafts[thread.id]?.body.trim()
                            ? <><span className="message-draft-label">Чернетка:</span> {props.drafts[thread.id]!.body}</>
                            : thread.lastMessage || (thread.kind === 'DIRECT' ? 'Почніть розмову' : `${thread.participantCount} учасників`)}
                        </small>
                        {thread.unreadCount > 0 && <b>{Math.min(thread.unreadCount, 99)}</b>}
                      </span>
                    </span>
                  </button>
                  <div className="message-thread-meta">
                  <time>{props.drafts[thread.id]?.createdAt
                    ? formatChatTime(new Date(props.drafts[thread.id]!.createdAt).toISOString())
                    : thread.lastMessageAt ? formatChatTime(thread.lastMessageAt) : ''}</time>
                  <ChatPinButton pinned={Boolean(thread.pinned)} name={conversationName(thread)}
                    disabled={Boolean(props.pinPending) || !props.onPinThread}
                    onClick={() => props.onPinThread?.(thread.id, !thread.pinned)} />
                  </div>
                  </div>
                ))}
                {props.hasMoreThreads && (
                  <button
                    className="messages-load-more"
                    type="button"
                    disabled={props.loadingMoreThreads}
                    onClick={props.onLoadMore}
                  >
                    {props.loadingMoreThreads ? 'Завантажуємо…' : 'Показати більше'}
                  </button>
                )}
              </div>
            ) : (
              <div className="messages-sidebar__empty">
                <MessageCircle size={28} />
                <strong>{props.unreadOnly ? 'Усе прочитано' : 'Діалогів ще немає'}</strong>
                <span>
                  {props.unreadOnly
                    ? 'Нові повідомлення з’являться тут.'
                    : 'Знайдіть колегу вище або створіть групу.'}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  )
}

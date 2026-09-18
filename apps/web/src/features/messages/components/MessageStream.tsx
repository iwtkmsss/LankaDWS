import type { ChatMessageView, StructuredMentionInput } from '@lankadws/contracts'
import { MessageCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { chatDayKey, formatChatDay } from '../lib/chatDates'
import { MessageBubble } from './MessageBubble'

interface MessageStreamProps {
  threadId: string
  messages: ChatMessageView[]
  currentUserId: string
  lastReadMessageId: string | null
  highlightedMessageId?: string | null
  canLoadOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => Promise<unknown>
  onReply: (message: ChatMessageView) => void
  onLike: (message: ChatMessageView) => void
  onForward: (message: ChatMessageView) => void
  onEdit: (message: ChatMessageView, body: string, mentions: StructuredMentionInput[]) => Promise<void>
  onDelete: (message: ChatMessageView) => Promise<void>
}

export function MessageStream(props: MessageStreamProps) {
  const lastScrollTopRef = useRef<number | null>(null)
  const scrollingUpRef = useRef(false)
  const touchStartYRef = useRef<number | null>(null)
  const pointerStartYRef = useRef<number | null>(null)
  const loadingOlderRef = useRef(false)
  const hasUserScrollIntentRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const openedAtRef = useRef(Date.now())
  const initialReadMessageIdRef = useRef<string | null>(props.lastReadMessageId)
  const [liveMessageIds, setLiveMessageIds] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!props.highlightedMessageId) return
    requestAnimationFrame(() => {
      document.getElementById(`message-${props.highlightedMessageId}`)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })
    })
  }, [props.highlightedMessageId, props.messages])

  useEffect(() => {
    openedAtRef.current = Date.now()
    initialReadMessageIdRef.current = props.lastReadMessageId
    setLiveMessageIds(new Set())
    lastScrollTopRef.current = null
    scrollingUpRef.current = false
    touchStartYRef.current = null
    pointerStartYRef.current = null
    loadingOlderRef.current = false
    hasUserScrollIntentRef.current = false
  }, [props.threadId])

  const initialReadIndex = initialReadMessageIdRef.current
    ? props.messages.findIndex((message) => message.id === initialReadMessageIdRef.current)
    : -1
  function isInitiallyUnread(message: ChatMessageView, index: number): boolean {
    if (message.authorId === props.currentUserId) return false
    return initialReadMessageIdRef.current === null || initialReadIndex === -1 || index < initialReadIndex
  }

  useEffect(() => {
    const openedAt = openedAtRef.current
    const newIds = props.messages
      .filter((message) => (
        message.authorId !== props.currentUserId
        && Date.parse(message.createdAt) >= openedAt
      ))
      .map((message) => message.id)
    if (!newIds.length) return
    setLiveMessageIds((current) => {
      const next = new Set(current)
      newIds.forEach((id) => next.add(id))
      return next
    })
  }, [props.currentUserId, props.messages])

  function loadOlderAfterScrollingUp(element: HTMLDivElement) {
    const previousScrollTop = lastScrollTopRef.current
    const scrolledUp = scrollingUpRef.current
      || (previousScrollTop !== null && element.scrollTop < previousScrollTop)
    lastScrollTopRef.current = element.scrollTop
    scrollingUpRef.current = false
    if (
      !scrolledUp
      || !hasUserScrollIntentRef.current
      || element.scrollTop > -Math.max(0, element.scrollHeight - element.clientHeight - 80)
      || !props.canLoadOlder
      || props.loadingOlder
      || loadingOlderRef.current
    ) return
    loadingOlderRef.current = true
    void props.onLoadOlder().finally(() => {
      loadingOlderRef.current = false
    })
  }

  return (
    <div
      ref={containerRef}
      className="message-stream"
      onKeyDown={(event) => {
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
          hasUserScrollIntentRef.current = true
          scrollingUpRef.current = true
        }
      }}
      onPointerDown={(event) => {
        pointerStartYRef.current = event.clientY
        lastScrollTopRef.current = containerRef.current?.scrollTop ?? null
      }}
      onPointerMove={(event) => {
        if (pointerStartYRef.current === null) return
        hasUserScrollIntentRef.current = true
        scrollingUpRef.current = event.clientY > pointerStartYRef.current
        pointerStartYRef.current = event.clientY
      }}
      onPointerUp={() => { pointerStartYRef.current = null }}
      onScroll={(event) => {
        const element = event.currentTarget
        loadOlderAfterScrollingUp(element)
      }}
      onTouchStart={(event) => {
        touchStartYRef.current = event.touches[0]?.clientY ?? null
      }}
      onTouchMove={(event) => {
        const touchY = event.touches[0]?.clientY
        if (touchY !== undefined && touchStartYRef.current !== null) {
          hasUserScrollIntentRef.current = true
          scrollingUpRef.current = touchY > touchStartYRef.current
          touchStartYRef.current = touchY
        }
      }}
      onWheel={(event) => {
        hasUserScrollIntentRef.current = true
        scrollingUpRef.current = event.deltaY < 0
      }}
    >
      <div ref={contentRef} className="message-stream__content">
        {!props.messages.length ? (
          <div className="message-stream__empty">
            <MessageCircle size={34} />
            <strong>Почніть розмову</strong>
            <span>Напишіть перше повідомлення в цьому діалозі.</span>
          </div>
        ) : (
          props.messages.map((message, index) => {
            const next = props.messages[index + 1]
            const showDay = !next || chatDayKey(next.createdAt) !== chatDayKey(message.createdAt)
            const isNew = isInitiallyUnread(message, index) || liveMessageIds.has(message.id)
            const showUnreadBoundary = isNew && (index === initialReadIndex - 1 || initialReadIndex === -1 && index === props.messages.length - 1)
            return (
              <div key={message.id}>
                {showUnreadBoundary && <div className="conversation-new-messages">Нові повідомлення</div>}
                {showDay && <div className="message-day-separator"><span>{formatChatDay(message.createdAt)}</span></div>}
                <MessageBubble
                  threadId={props.threadId}
                  message={message}
                  own={message.authorId === props.currentUserId}
                  highlighted={message.id === props.highlightedMessageId}
                  isNew={isNew}
                  onReply={props.onReply}
                  onLike={props.onLike}
                  onForward={props.onForward}
                  onEdit={props.onEdit}
                  onDelete={props.onDelete}
                />
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}

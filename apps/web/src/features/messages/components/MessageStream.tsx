import type { ChatMessageView, StructuredMentionInput } from '@bert-crm/contracts'
import { MessageCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { chatDayKey, formatChatDay } from '../lib/chatDates'
import { MessageBubble } from './MessageBubble'

interface MessageStreamProps {
  threadId: string
  messages: ChatMessageView[]
  currentUserId: string
  highlightedMessageId?: string | null
  canLoadOlder: boolean
  loadingOlder: boolean
  canConvertToTask: boolean
  canConvertToEvent: boolean
  onLoadOlder: () => Promise<unknown>
  onReply: (message: ChatMessageView) => void
  onLike: (message: ChatMessageView) => void
  onForward: (message: ChatMessageView) => void
  onEdit: (message: ChatMessageView, body: string, mentions: StructuredMentionInput[]) => Promise<void>
  onDelete: (message: ChatMessageView) => Promise<void>
  onConvert: (kind: 'task' | 'event', message: ChatMessageView) => void
}

export function MessageStream(props: MessageStreamProps) {
  const lastScrollTopRef = useRef<number | null>(null)
  const scrollingUpRef = useRef(false)
  const touchStartYRef = useRef<number | null>(null)
  const loadingOlderRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const openedAtRef = useRef(Date.now())
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
    setLiveMessageIds(new Set())
    lastScrollTopRef.current = null
    scrollingUpRef.current = false
    touchStartYRef.current = null
    loadingOlderRef.current = false
  }, [props.threadId])

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
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) scrollingUpRef.current = true
      }}
      onPointerDown={() => {
        lastScrollTopRef.current = containerRef.current?.scrollTop ?? null
      }}
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
          scrollingUpRef.current = touchY < touchStartYRef.current
          touchStartYRef.current = touchY
        }
      }}
      onWheel={(event) => {
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
            return (
              <div key={message.id}>
                {showDay && <div className="message-day-separator"><span>{formatChatDay(message.createdAt)}</span></div>}
                <MessageBubble
                  threadId={props.threadId}
                  message={message}
                  own={message.authorId === props.currentUserId}
                  highlighted={message.id === props.highlightedMessageId}
                  isNew={liveMessageIds.has(message.id)}
                  canConvertToTask={props.canConvertToTask}
                  canConvertToEvent={props.canConvertToEvent}
                  onReply={props.onReply}
                  onLike={props.onLike}
                  onForward={props.onForward}
                  onEdit={props.onEdit}
                  onDelete={props.onDelete}
                  onConvert={props.onConvert}
                />
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}

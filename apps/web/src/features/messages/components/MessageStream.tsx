import type { ChatMessageView, StructuredMentionInput } from '@bert-crm/contracts'
import { ArrowDown, LoaderCircle, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePreservedChatScroll } from '../hooks/usePreservedChatScroll'
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
  canConvertToTask: boolean
  canConvertToEvent: boolean
  onLoadOlder: () => Promise<unknown>
  onReply: (message: ChatMessageView) => void
  onEdit: (message: ChatMessageView, body: string, mentions: StructuredMentionInput[]) => Promise<void>
  onDelete: (message: ChatMessageView) => Promise<void>
  onConvert: (kind: 'task' | 'event', message: ChatMessageView) => void
}

export function MessageStream(props: MessageStreamProps) {
  const [showBottom, setShowBottom] = useState(false)
  const scroll = usePreservedChatScroll(props.messages.length)
  const readIndex = props.lastReadMessageId
    ? props.messages.findIndex((message) => message.id === props.lastReadMessageId)
    : -1
  const firstUnreadIndex = readIndex >= 0 && readIndex < props.messages.length - 1
    ? readIndex + 1
    : -1

  useEffect(() => {
    if (!props.highlightedMessageId) return
    requestAnimationFrame(() => {
      document.getElementById(`message-${props.highlightedMessageId}`)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })
    })
  }, [props.highlightedMessageId, props.messages])

  return (
    <div
      ref={scroll.containerRef}
      className="message-stream"
      onScroll={() => {
        scroll.onScroll()
        const element = scroll.containerRef.current
        setShowBottom(Boolean(element && element.scrollHeight - element.scrollTop - element.clientHeight > 220))
      }}
    >
      {props.canLoadOlder && (
        <button
          type="button"
          className="message-stream__older"
          disabled={props.loadingOlder}
          onClick={() => {
            scroll.rememberBeforePrepend()
            void props.onLoadOlder()
          }}
        >
          {props.loadingOlder && <LoaderCircle className="is-spinning" size={15} />}
          {props.loadingOlder ? 'Завантажуємо…' : 'Раніші повідомлення'}
        </button>
      )}

      {!props.messages.length ? (
        <div className="message-stream__empty">
          <MessageCircle size={34} />
          <strong>Почніть розмову</strong>
          <span>Напишіть перше повідомлення в цьому діалозі.</span>
        </div>
      ) : (
        props.messages.map((message, index) => {
          const previous = props.messages[index - 1]
          const showDay = !previous || chatDayKey(previous.createdAt) !== chatDayKey(message.createdAt)
          return (
            <div key={message.id}>
              {showDay && <div className="message-day-separator"><span>{formatChatDay(message.createdAt)}</span></div>}
              {index === firstUnreadIndex && (
                <div className="message-unread-separator"><span>Непрочитані</span></div>
              )}
              <MessageBubble
                threadId={props.threadId}
                message={message}
                own={message.authorId === props.currentUserId}
                highlighted={message.id === props.highlightedMessageId}
                canConvertToTask={props.canConvertToTask}
                canConvertToEvent={props.canConvertToEvent}
                onReply={props.onReply}
                onEdit={props.onEdit}
                onDelete={props.onDelete}
                onConvert={props.onConvert}
              />
            </div>
          )
        })
      )}

      {showBottom && (
        <button
          type="button"
          className="message-stream__bottom"
          aria-label="До нових повідомлень"
          onClick={() => scroll.scrollToBottom()}
        >
          <ArrowDown size={19} />
        </button>
      )}
    </div>
  )
}

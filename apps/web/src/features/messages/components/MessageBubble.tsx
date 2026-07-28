import type { ChatMessageView } from '@bert-crm/contracts'
import {
  CalendarPlus,
  FileText,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Reply,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Avatar, Button } from '../../../shared/ui'
import { formatChatTime } from '../lib/chatDates'

interface MessageBubbleProps {
  message: ChatMessageView
  own: boolean
  highlighted?: boolean
  canConvertToTask: boolean
  canConvertToEvent: boolean
  onReply: (message: ChatMessageView) => void
  onEdit: (message: ChatMessageView, body: string) => Promise<void>
  onDelete: (message: ChatMessageView) => Promise<void>
  onConvert: (kind: 'task' | 'event', message: ChatMessageView) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export function MessageBubble({
  message,
  own,
  highlighted,
  canConvertToTask,
  canConvertToEvent,
  onReply,
  onEdit,
  onDelete,
  onConvert,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(message.body)
  const [busy, setBusy] = useState(false)

  if (message.deletedAt) {
    return (
      <article
        id={`message-${message.id}`}
        className={`message-row ${own ? 'is-own' : ''}`}
      >
        {!own && <Avatar size="sm" name={message.author.displayName} src={message.author.avatarAsset} />}
        <div className="message-bubble is-deleted">
          <em>Повідомлення видалено</em>
          <time>{formatChatTime(message.createdAt)}</time>
        </div>
      </article>
    )
  }

  return (
    <article
      id={`message-${message.id}`}
      className={[
        'message-row',
        own ? 'is-own' : '',
        highlighted ? 'is-highlighted' : '',
      ].filter(Boolean).join(' ')}
    >
      {!own && <Avatar size="sm" name={message.author.displayName} src={message.author.avatarAsset} />}
      <div className="message-bubble">
        {!own && <strong className="message-bubble__author">{message.author.displayName}</strong>}
        {message.replyPreview && (
          <button
            type="button"
            className="message-bubble__reply-preview"
            onClick={() => document.getElementById(`message-${message.replyPreview!.id}`)?.scrollIntoView({
              block: 'center',
              behavior: 'smooth',
            })}
          >
            <strong>{message.replyPreview.authorName}</strong>
            <span>{message.replyPreview.body}</span>
          </button>
        )}

        {editing ? (
          <form
            className="message-bubble__edit"
            onSubmit={(event) => {
              event.preventDefault()
              if (!editBody.trim()) return
              setBusy(true)
              void onEdit(message, editBody.trim())
                .then(() => setEditing(false))
                .finally(() => setBusy(false))
            }}
          >
            <textarea
              autoFocus
              value={editBody}
              maxLength={8_000}
              onChange={(event) => setEditBody(event.target.value)}
            />
            <div>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  setEditBody(message.body)
                }}
              >
                Скасувати
              </Button>
              <Button disabled={busy || !editBody.trim()}>Зберегти</Button>
            </div>
          </form>
        ) : (
          <p>{message.body}</p>
        )}

        {message.attachments.length > 0 && (
          <div className="message-attachments">
            {message.attachments.map((attachment) => (
              <div key={attachment.id}>
                <span><FileText size={18} /></span>
                <span>
                  <strong>{attachment.fileName}</strong>
                  <small>
                    {formatBytes(attachment.bytes)}
                    {attachment.scanStatus !== 'CLEAN' ? ` · ${attachment.scanStatus === 'SCANNING' || attachment.scanStatus === 'QUARANTINED' ? 'Перевіряється' : 'Недоступний'}` : ''}
                  </small>
                </span>
              </div>
            ))}
          </div>
        )}

        <footer>
          {message.editedAt && <span>змінено</span>}
          <time dateTime={message.createdAt}>{formatChatTime(message.createdAt)}</time>
        </footer>

        {!editing && (
          <div className="message-bubble__actions">
            <button type="button" aria-label="Відповісти" onClick={() => onReply(message)}>
              <Reply size={16} />
            </button>
            <button
              type="button"
              aria-label="Дії з повідомленням"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              {menuOpen ? <X size={16} /> : <MoreHorizontal size={16} />}
            </button>
            {menuOpen && (
              <div className="message-action-menu">
                {message.canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      setEditing(true)
                    }}
                  >
                    <Pencil size={15} /> Редагувати
                  </button>
                )}
                {canConvertToTask && (
                  <button type="button" onClick={() => onConvert('task', message)}>
                    <ListTodo size={15} /> Створити завдання
                  </button>
                )}
                {canConvertToEvent && (
                  <button type="button" onClick={() => onConvert('event', message)}>
                    <CalendarPlus size={15} /> Додати в календар
                  </button>
                )}
                {message.canDelete && (
                  <button
                    type="button"
                    className="is-danger"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      void onDelete(message).finally(() => setBusy(false))
                    }}
                  >
                    <Trash2 size={15} /> Видалити
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

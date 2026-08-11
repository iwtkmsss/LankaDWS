import type { ChatMessageView, StructuredMentionInput } from '@bert-crm/contracts'
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
import { MentionText } from '../../../shared/mentions/MentionRenderer'
import { MentionTextarea } from '../../../shared/mentions/MentionTextarea'
import { editableMentions, trimMentionValue } from '../../../shared/mentions/mentionText'
import { formatChatTime } from '../lib/chatDates'

interface MessageBubbleProps {
  threadId: string
  message: ChatMessageView
  own: boolean
  highlighted?: boolean
  canConvertToTask: boolean
  canConvertToEvent: boolean
  onReply: (message: ChatMessageView) => void
  onEdit: (message: ChatMessageView, body: string, mentions: StructuredMentionInput[]) => Promise<void>
  onDelete: (message: ChatMessageView) => Promise<void>
  onConvert: (kind: 'task' | 'event', message: ChatMessageView) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export function MessageBubble({
  threadId,
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
  const [editMentions, setEditMentions] = useState<StructuredMentionInput[]>(() =>
    editableMentions(message.body, message.mentions))
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
              const value = trimMentionValue(editBody, editMentions)
              if (!value.body) return
              setBusy(true)
              void onEdit(message, value.body, value.mentions)
                .then(() => setEditing(false))
                .finally(() => setBusy(false))
            }}
          >
            <MentionTextarea
              label="Текст повідомлення"
              value={editBody}
              mentions={editMentions}
              candidateUrl={`/messages/threads/${encodeURIComponent(threadId)}/mention-candidates`}
              autoFocus
              rows={3}
              maxLength={8_000}
              onChange={(body, mentions) => {
                setEditBody(body)
                setEditMentions(mentions)
              }}
            />
            <div className="message-bubble__edit-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  setEditBody(message.body)
                  setEditMentions(editableMentions(message.body, message.mentions))
                }}
              >
                Скасувати
              </Button>
              <Button disabled={busy || !editBody.trim()}>Зберегти</Button>
            </div>
          </form>
        ) : (
          <p><MentionText body={message.body} mentions={message.mentions} /></p>
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
                      setEditBody(message.body)
                      setEditMentions(editableMentions(message.body, message.mentions))
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

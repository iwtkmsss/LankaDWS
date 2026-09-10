import type { ChatAttachmentView, ChatMessageView, StructuredMentionInput } from '@bert-crm/contracts'
import {
  CalendarPlus,
  Check,
  CheckCheck,
  Download,
  Eye,
  FileText,
  Forward,
  Heart,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Reply,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Avatar, Button, CompactFileName } from '../../../shared/ui'
import { UserProfileLink } from '../../employees/UserProfileDrawer'
import { MentionText } from '../../../shared/mentions/MentionRenderer'
import { MentionTextarea } from '../../../shared/mentions/MentionTextarea'
import { editableMentions, trimMentionValue } from '../../../shared/mentions/mentionText'
import { apiUrl } from '../../../shared/api/client'
import { formatChatTime } from '../lib/chatDates'
import { FilePreviewModal } from '../../../shared/files/FilePreviewModal'

interface MessageBubbleProps {
  threadId: string
  message: ChatMessageView
  own: boolean
  highlighted?: boolean
  isNew?: boolean
  canConvertToTask: boolean
  canConvertToEvent: boolean
  onReply: (message: ChatMessageView) => void
  onLike: (message: ChatMessageView) => void
  onForward: (message: ChatMessageView) => void
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
  isNew,
  canConvertToTask,
  canConvertToEvent,
  onReply,
  onLike,
  onForward,
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
  const [previewFile, setPreviewFile] = useState<ChatAttachmentView | null>(null)
  // Editing a long message should show the whole text rather than a three-row
  // window the author has to scroll. Browsers that support `field-sizing` size
  // the box from its content; this estimate covers the rest, counting the wraps
  // a long paragraph produces as well as its explicit line breaks.
  const editRows = Math.min(24, Math.max(3, editBody
    .split('\n')
    .reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 50)), 1)))
  const deliveryLabel = message.id.startsWith('optimistic:')
    ? 'Надсилається'
    : message.readByCount > 0
      ? message.readByCount > 1 ? `Прочитано: ${message.readByCount}` : 'Прочитано'
      : 'Відправлено'
  const singleImageAttachment = message.attachments.length === 1
    && message.attachments[0]?.scanStatus === 'CLEAN'
    && /^image\/(?:png|jpeg|gif|webp)$/.test(message.attachments[0].mimeType ?? '')
    ? message.attachments[0]
    : null
  const likeCount = message.reactions.likeCount
  const messageMeta = (
    <footer className="message-bubble__meta">
      {likeCount > 0 && (
        <button
          type="button"
          className={`message-bubble__likes${message.reactions.likedByMe ? ' is-mine' : ''}`}
          aria-label={message.reactions.likedByMe ? 'Прибрати вподобання' : 'Подобається'}
          aria-pressed={message.reactions.likedByMe}
          onClick={() => onLike(message)}
        >
          <Heart size={12} />
          {likeCount}
        </button>
      )}
      {singleImageAttachment && <CompactFileName fileName={singleImageAttachment.fileName} />}
      {message.editedAt && <span>змінено</span>}
      {own && (
        <span className={`message-delivery-status ${message.readByCount > 0 ? 'is-read' : ''}`} title={deliveryLabel}>
          {message.readByCount > 0 ? <CheckCheck size={13} /> : <Check size={13} />}
          <span>{deliveryLabel}</span>
        </span>
      )}
      <time dateTime={message.createdAt}>{formatChatTime(message.createdAt)}</time>
    </footer>
  )

  if (message.deletedAt) {
    return (
      <article
        id={`message-${message.id}`}
        className={`message-row ${own ? 'is-own' : 'is-other'}`}
      >
        {!own && (
          <UserProfileLink
            className="message-author-avatar"
            userId={message.author.id}
            aria-label={`Відкрити профіль ${message.author.displayName}`}
          >
            <Avatar size="sm" name={message.author.displayName} src={message.author.avatarAsset} />
          </UserProfileLink>
        )}
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
        own ? 'is-own' : 'is-other',
        highlighted ? 'is-highlighted' : '',
        isNew ? 'is-new' : '',
      ].filter(Boolean).join(' ')}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button, a, input, textarea')) return
        onReply(message)
      }}
    >
      {!own && (
        <UserProfileLink
          className="message-author-avatar"
          userId={message.author.id}
          aria-label={`Відкрити профіль ${message.author.displayName}`}
        >
          <Avatar size="sm" name={message.author.displayName} src={message.author.avatarAsset} />
        </UserProfileLink>
      )}
      <div className="message-bubble">
        {!own && (
          <UserProfileLink className="message-bubble__author" userId={message.author.id}>
            {message.author.displayName}
          </UserProfileLink>
        )}
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
              className="message-bubble__edit-input"
              label="Текст повідомлення"
              value={editBody}
              mentions={editMentions}
              candidateUrl={`/messages/threads/${encodeURIComponent(threadId)}/mention-candidates`}
              autoFocus
              rows={editRows}
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
        ) : message.body ? (
          <div className="message-bubble__content">
            <p><MentionText body={message.body} mentions={message.mentions} /></p>
          </div>
        ) : null}

        {message.attachments.length > 0 && (
          <div className="message-attachments">
            {message.attachments.map((attachment) => (
              <div className="message-attachment" key={attachment.id}>
                {attachment.scanStatus === 'CLEAN' && /^image\/(?:png|jpeg|gif|webp)$/.test(attachment.mimeType ?? '') ? (
                  <button
                    type="button"
                    className="message-attachment__preview"
                    aria-label={`Переглянути ${attachment.fileName}`}
                    onClick={() => setPreviewFile(attachment)}
                  >
                    <img
                      src={apiUrl(`/files/${encodeURIComponent(attachment.id)}/download?inline=true`)}
                      alt={attachment.fileName}
                      loading="lazy"
                    />
                  </button>
                ) : (
                  <span className="message-attachment__icon"><FileText size={18} /></span>
                )}
                <span className="message-attachment__copy">
                  {singleImageAttachment?.id !== attachment.id && <CompactFileName fileName={attachment.fileName} />}
                  <small>
                    {formatBytes(attachment.bytes)}
                    {attachment.scanStatus !== 'CLEAN' ? ` · ${attachment.scanStatus === 'SCANNING' || attachment.scanStatus === 'QUARANTINED' ? 'Перевіряється' : 'Недоступний'}` : ''}
                  </small>
                  {attachment.scanStatus === 'CLEAN' && (
                    <span className="message-attachment__actions">
                      <button
                        type="button"
                        onClick={() => setPreviewFile(attachment)}
                      >
                        <Eye size={13} /> Переглянути
                      </button>
                      <a href={apiUrl(`/files/${encodeURIComponent(attachment.id)}/download`)} download>
                        <Download size={13} /> Завантажити
                      </a>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}

        {messageMeta}

        {!editing && (
          <div className="message-bubble__actions">
            <button
              type="button"
              className={message.reactions.likedByMe ? 'is-active' : ''}
              aria-label={message.reactions.likedByMe ? 'Прибрати вподобання' : 'Подобається'}
              aria-pressed={message.reactions.likedByMe}
              onClick={() => onLike(message)}
            >
              <Heart size={16} />
            </button>
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
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onForward(message)
                  }}
                >
                  <Forward size={15} /> Переслати
                </button>
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

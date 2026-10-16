import { personName } from '../../../shared/lib/personName'
import type { ChatAttachmentView, ChatMessageView, StructuredMentionInput } from '@lankadws/contracts'
import {
  Check,
  CheckCheck,
  Copy,
  Download,
  Eye,
  Forward,
  HardDrive,
  Heart,
  Pencil,
  Reply,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar, Button, CompactFileName } from '../../../shared/ui'
import { UserProfileLink } from '../../employees/UserProfileDrawer'
import { MentionText } from '../../../shared/mentions/MentionRenderer'
import { MentionTextarea } from '../../../shared/mentions/MentionTextarea'
import { editableMentions, trimMentionValue } from '../../../shared/mentions/mentionText'
import { apiUrl } from '../../../shared/api/client'
import { formatChatTime } from '../lib/chatDates'
import { FilePreviewModal } from '../../../shared/files/FilePreviewModal'
import { FileFormatIcon, FileThumbnail } from '../../../shared/files/FileThumbnail'
import { importFileToDrive } from '../../drive/api'
import { SaveToDriveButton } from '../../../shared/files/SaveToDriveButton'
import { isChatPhoto } from '../lib/photoAlbums'
import { MessageBubbleOutline } from './MessageBubbleOutline'

interface MessageBubbleProps {
  idPrefix?: string
  threadId: string
  message: ChatMessageView
  own: boolean
  showAuthor?: boolean
  showAvatar?: boolean
  highlighted?: boolean
  isNew?: boolean
  onReply: (message: ChatMessageView) => void
  onLike: (message: ChatMessageView) => void
  onForward: (message: ChatMessageView) => void
  onEdit: (message: ChatMessageView, body: string, mentions: StructuredMentionInput[], attachmentIds?: string[]) => Promise<void>
  onDelete: (message: ChatMessageView) => Promise<void>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function contextMenuPosition(x: number, y: number): { left: number; top: number } {
  const menuWidth = 248
  const menuHeight = 340
  const inset = 8
  return {
    left: Math.max(inset, Math.min(x, window.innerWidth - menuWidth - inset)),
    top: Math.max(inset, Math.min(y, window.innerHeight - menuHeight - inset)),
  }
}

export function MessageBubble({
  threadId,
  idPrefix = 'message',
  message,
  own,
  showAuthor = true,
  showAvatar = true,
  highlighted,
  isNew,
  onReply,
  onLike,
  onForward,
  onEdit,
  onDelete,
}: MessageBubbleProps) {
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(message.body)
  const [editMentions, setEditMentions] = useState<StructuredMentionInput[]>(() =>
    editableMentions(message.body, message.mentions))
  const [busy, setBusy] = useState(false)
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([])
  const [editError, setEditError] = useState('')
  const [driveSave, setDriveSave] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [previewFile, setPreviewFile] = useState<ChatAttachmentView | null>(null)
  const [menuPhoto, setMenuPhoto] = useState<ChatAttachmentView | null>(null)
  const [replyHighlightVersion, setReplyHighlightVersion] = useState(0)
  const replyHighlightCounterRef = useRef(0)
  const messageRowRef = useRef<HTMLElement>(null)
  const menuCloseTimer = useRef<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const visibleAttachments = editing
    ? message.attachments.filter((attachment) => !removedAttachmentIds.includes(attachment.id))
    : message.attachments
  const savableAttachments = visibleAttachments.filter((attachment) => attachment.scanStatus === 'CLEAN')
  const archivableAttachments = savableAttachments.length >= 2
  const photosOnly = message.attachments.length > 0 && message.attachments.every(isChatPhoto)
  const previewPhotos = photosOnly ? savableAttachments : []
  const previewPhotoIndex = previewPhotos.findIndex((attachment) => attachment.id === previewFile?.id)
  const photoAlbum = !editing && photosOnly && visibleAttachments.length > 1
  // Editing a long message should show the whole text rather than a two-row
  // window the author has to scroll. Browsers that support `field-sizing` size
  // the box from its content; this estimate covers the rest, counting the wraps
  // a long paragraph produces as well as its explicit line breaks.
  const editRows = Math.min(24, Math.max(2, editBody
    .split('\n')
    .reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 50)), 1)))
  const deliveryLabel = message.id.startsWith('optimistic:')
    ? 'Надсилається'
    : message.readByCount > 0
      ? message.readByCount > 1 ? `Прочитано: ${message.readByCount}` : 'Прочитано'
      : 'Відправлено'
  const singleImageAttachment = visibleAttachments.length === 1
    && photosOnly
    && visibleAttachments[0]?.scanStatus === 'CLEAN'
    && isChatPhoto(visibleAttachments[0])
    ? visibleAttachments[0]
    : null
  const likeCount = message.reactions.likeCount
  // The existing forwarding flow stores attribution as the first text line.
  const forwardMatch = /^Переслано від ([^\r\n]+):\r?\n/.exec(message.body)
  const forwardPrefixLength = forwardMatch?.[0].length ?? 0
  const displayedBody = message.body.slice(forwardPrefixLength)
  const displayedMentions = forwardMatch
    ? message.mentions.filter((mention) => mention.start >= forwardPrefixLength)
      .map((mention) => ({ ...mention, start: mention.start - forwardPrefixLength, end: mention.end - forwardPrefixLength }))
    : message.mentions
  const closeMenu = () => {
    if (menuCloseTimer.current !== null) window.clearTimeout(menuCloseTimer.current)
    setMenuPosition(null)
  }
  const openMenu = (x: number, y: number, photo: ChatAttachmentView | null = null) => {
    if (menuCloseTimer.current !== null) window.clearTimeout(menuCloseTimer.current)
    window.dispatchEvent(new CustomEvent('lanka:context-menu-open', { detail: `${idPrefix}:${message.id}` }))
    setMenuPhoto(photo)
    setMenuPosition(contextMenuPosition(x, y))
  }
  const delayMenuClose = () => {
    menuCloseTimer.current = window.setTimeout(closeMenu, 120)
  }
  const keepMenuOpen = () => {
    if (menuCloseTimer.current !== null) window.clearTimeout(menuCloseTimer.current)
  }
  useEffect(() => {
    const element = messageRowRef.current
    if (!element) return
    const highlightReply = () => setReplyHighlightVersion(++replyHighlightCounterRef.current)
    element.addEventListener('lanka:highlight-message', highlightReply)
    return () => element.removeEventListener('lanka:highlight-message', highlightReply)
  }, [message.deletedAt])
  useEffect(() => {
    const closeOnAnotherMenu = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== `${idPrefix}:${message.id}`) closeMenu()
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      if (!(event.target as HTMLElement).closest(`#${idPrefix}-${message.id}`)) closeMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenu() }
    window.addEventListener('lanka:context-menu-open', closeOnAnotherMenu)
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('lanka:context-menu-open', closeOnAnotherMenu)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  })
  const attachmentActions = (attachment: ChatAttachmentView) => (
    <span className="message-attachment__actions" role="group" aria-label={attachment.fileName}>
      <a href={apiUrl(`/files/${encodeURIComponent(attachment.id)}/download`)} download
        title={`Завантажити ${attachment.fileName}`} aria-label="Завантажити">
        <Download size={11} aria-hidden />
      </a>
      <SaveToDriveButton fileId={attachment.id} fileName={attachment.fileName} className="message-attachment__save" iconOnly />
    </span>
  )
  const messageTimestamp = (
    <span className="message-bubble__timestamp">
      {editing && visibleAttachments.length === 1 && savableAttachments[0] && attachmentActions(savableAttachments[0])}
      {!editing && message.editedAt && <span className="message-bubble__edited">змінено</span>}
      <time dateTime={message.createdAt}>{formatChatTime(message.createdAt)}</time>
      {own && (
        <span className={`message-delivery-status ${message.readByCount > 0 ? 'is-read' : ''}`} aria-label={deliveryLabel}>
          {message.readByCount > 0 ? <CheckCheck size={13} /> : <Check size={13} />}
        </span>
      )}
    </span>
  )
  const messageMeta = (
    <footer className="message-bubble__meta">
      {visibleAttachments.length === 1 && savableAttachments[0] && attachmentActions(savableAttachments[0])}
      {archivableAttachments && !editing && (
        <a className="message-attachments__archive"
          href={apiUrl(`/messages/${encodeURIComponent(message.id)}/attachments/archive`)} download>
          <Download size={11} /> Завантажити ZIP
        </a>
      )}
      {singleImageAttachment && <CompactFileName fileName={singleImageAttachment.fileName} />}
      <span className="message-bubble__meta-actions">
        {likeCount > 0 && (
          <button
            type="button"
            className={`message-bubble__likes${message.reactions.likedByMe ? ' is-mine' : ''}`}
            aria-label={message.reactions.likedByMe ? 'Прибрати вподобання' : 'Подобається'}
            aria-pressed={message.reactions.likedByMe}
            onClick={() => onLike(message)}
          >
            <Heart size={13} fill={message.reactions.likedByMe ? 'currentColor' : 'none'} />
            <span>·</span>
            <span>{likeCount}</span>
          </button>
        )}
        {messageTimestamp}
      </span>
    </footer>
  )

  if (message.deletedAt) {
    return (
      <article
        ref={messageRowRef}
        id={`${idPrefix}-${message.id}`}
        className={`message-row ${own ? 'is-own' : 'is-other'}`}
      >
        {!own && (
          <UserProfileLink
            className="message-author-avatar"
            userId={message.author.id}
            aria-label={`Відкрити профіль ${personName(message.author.displayName)}`}
          >
            <Avatar size="sm" name={personName(message.author.displayName)} src={message.author.avatarAsset} />
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
      ref={messageRowRef}
      id={`${idPrefix}-${message.id}`}
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
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('button, a, input, textarea')) return
        event.preventDefault()
        openMenu(event.clientX, event.clientY)
      }}
    >
      {!own && !showAvatar && <span className="message-author-avatar is-placeholder" aria-hidden="true" />}
      {!own && showAvatar && (
        <UserProfileLink
          className="message-author-avatar"
          userId={message.author.id}
          aria-label={`Відкрити профіль ${personName(message.author.displayName)}`}
        >
          <Avatar size="sm" name={personName(message.author.displayName)} src={message.author.avatarAsset} />
        </UserProfileLink>
      )}
      <div className="message-bubble">
        <MessageBubbleOutline own={own} showAuthor={showAuthor} />
        {replyHighlightVersion > 0 && <span
          key={replyHighlightVersion}
          className="message-bubble__reply-highlight"
          aria-hidden="true"
          onAnimationEnd={() => setReplyHighlightVersion(0)}
        />}
        {!own && showAuthor && (
          <UserProfileLink className="message-bubble__author" userId={message.author.id}>
            {personName(message.author.displayName)}
          </UserProfileLink>
        )}
        {message.replyPreview && (
          <button
            type="button"
            className="message-bubble__reply-preview"
            onClick={() => {
              const target = document.getElementById(`${idPrefix}-${message.replyPreview!.id}`)
              if (!target) return
              target.scrollIntoView({ block: 'center', behavior: 'smooth' })
              target.dispatchEvent(new Event('lanka:highlight-message'))
            }}
          >
            <strong>{personName(message.replyPreview.authorName)}</strong>
            <span>{message.replyPreview.body}</span>
          </button>
        )}

        {forwardMatch && !editing && (
          <div className="message-bubble__forwarded" aria-label={`Переслано від ${forwardMatch[1]}`}>
            <Forward size={16} aria-hidden="true" />
            <span>Переслано від <strong>{forwardMatch[1]}</strong></span>
          </div>
        )}

        {!editing && message.body ? (
          <div className="message-bubble__content">
            <p><MentionText body={displayedBody} mentions={displayedMentions} /></p>
          </div>
        ) : null}

        {visibleAttachments.length > 0 && (
          <div className={`message-attachments${photoAlbum ? ' message-attachments--album' : ''}`}
            data-photo-count={photoAlbum ? visibleAttachments.length : undefined}>
            {visibleAttachments.map((attachment) => (
              <div className="message-attachment" key={attachment.id}>
                {attachment.scanStatus === 'CLEAN' && !isChatPhoto(attachment) && (
                  <button
                    type="button"
                    className="message-attachment__open"
                    onClick={() => setPreviewFile(attachment)}
                    aria-label={`Переглянути ${attachment.fileName}`}
                    title="Переглянути файл"
                  />
                )}
                {editing && (
                  <button type="button" className="message-attachment__remove"
                    aria-label={`Прибрати вкладення ${attachment.fileName}`} disabled={busy}
                    onClick={() => setRemovedAttachmentIds((current) => [...current, attachment.id])}>
                    <X size={15} />
                  </button>
                )}
                {attachment.scanStatus === 'CLEAN' && isChatPhoto(attachment) ? (
                  <button
                    type="button"
                    className="message-attachment__preview"
                    aria-label={`Переглянути ${attachment.fileName}`}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      openMenu(event.clientX, event.clientY, attachment)
                    }}
                    onClick={() => setPreviewFile(attachment)}
                  >
                    <FileThumbnail file={attachment} />
                  </button>
                ) : (
                  <span className="message-attachment__icon"><FileFormatIcon mimeType={attachment.mimeType} /></span>
                )}
                <span className="message-attachment__copy">
                  {singleImageAttachment?.id !== attachment.id && <CompactFileName fileName={attachment.fileName} />}
                  {singleImageAttachment?.id !== attachment.id && <small>
                    {formatBytes(attachment.bytes)}
                    {attachment.scanStatus !== 'CLEAN' ? ` · ${attachment.scanStatus === 'SCANNING' || attachment.scanStatus === 'QUARANTINED' ? 'Перевіряється' : 'Недоступний'}` : ''}
                  </small>}
                </span>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <form
            className="message-bubble__edit"
            onSubmit={(event) => {
              event.preventDefault()
              const value = trimMentionValue(editBody, editMentions)
              if (!value.body && visibleAttachments.length === 0) return
              setBusy(true)
              setEditError('')
              void onEdit(message, value.body, value.mentions,
                removedAttachmentIds.length ? visibleAttachments.map((attachment) => attachment.id) : undefined)
                .then(() => setEditing(false))
                .catch(() => setEditError('Не вдалося зберегти повідомлення. Спробуйте ще раз.'))
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
              <Button disabled={busy || (!editBody.trim() && visibleAttachments.length === 0)}>Зберегти</Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  setRemovedAttachmentIds([])
                  setEditError('')
                  setEditBody(message.body)
                  setEditMentions(editableMentions(message.body, message.mentions))
                }}
              >
                Скасувати
              </Button>
              {messageTimestamp}
            </div>
            {!editBody.trim() && visibleAttachments.length === 0 && removedAttachmentIds.length > 0 && (
              <p>Щоб прибрати останній файл, додайте текст або видаліть повідомлення.</p>
            )}
            {editError && <p role="alert">{editError}</p>}
          </form>
        )}

        {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} openInNewTab
          gallery={previewPhotos.length > 1 && previewPhotoIndex >= 0 ? {
            index: previewPhotoIndex,
            count: previewPhotos.length,
            onPrevious: () => setPreviewFile(previewPhotos[Math.max(0, previewPhotoIndex - 1)]!),
            onNext: () => setPreviewFile(previewPhotos[Math.min(previewPhotos.length - 1, previewPhotoIndex + 1)]!),
          } : undefined} />}

        {!editing && messageMeta}

        {!editing && menuPosition && createPortal(
          <div
            ref={menuRef}
            className="message-action-menu"
            role="menu"
            aria-label="Дії з повідомленням"
            style={menuPosition}
            onMouseEnter={keepMenuOpen}
            onMouseLeave={delayMenuClose}
          >
                {menuPhoto && (
                  <button type="button" onClick={() => { closeMenu(); setPreviewFile(menuPhoto) }}>
                    <Eye size={15} /> Переглянути фото
                  </button>
                )}
                <button
                  type="button"
                  aria-label={message.reactions.likedByMe ? 'Прибрати вподобання' : 'Подобається'}
                  onClick={() => {
                    closeMenu()
                    onLike(message)
                  }}
                >
                  <Heart size={15} /> {message.reactions.likedByMe ? 'Прибрати вподобання' : 'Подобається'}
                </button>
                <button type="button" onClick={() => { closeMenu(); onReply(message) }}>
                  <Reply size={15} /> Відповісти
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeMenu()
                    void navigator.clipboard.writeText(message.body)
                  }}
                >
                  <Copy size={15} /> Копіювати текст
                </button>
                {message.canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu()
                      setEditBody(message.body)
                      setEditMentions(editableMentions(message.body, message.mentions))
                      setRemovedAttachmentIds([])
                      setEditError('')
                      setEditing(true)
                    }}
                  >
                    <Pencil size={15} /> Редагувати
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    closeMenu()
                    onForward(message)
                  }}
                >
                  <Forward size={15} /> Переслати
                </button>
                {savableAttachments.length > 0 && (
                  <button
                    type="button"
                    disabled={driveSave === 'busy'}
                    onClick={() => {
                      setDriveSave('busy')
                      void Promise.all(savableAttachments.map((attachment) => importFileToDrive({
                        fileId: attachment.id,
                        name: attachment.fileName.replace(/\.[^/.]+$/, ''),
                      })))
                        .then(() => setDriveSave('done'))
                        .catch(() => setDriveSave('error'))
                        .finally(() => window.setTimeout(() => { closeMenu(); setDriveSave('idle') }, 1200))
                    }}
                  >
                    <HardDrive size={15} />
                    {driveSave === 'busy' ? 'Зберігаємо…'
                      : driveSave === 'done' ? 'Збережено на Диск'
                      : driveSave === 'error' ? 'Не вдалося зберегти'
                      : savableAttachments.length > 1 ? `Зберегти ${savableAttachments.length} файли на Диск` : 'Зберегти на Диск'}
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
          </div>,
          document.body,
        )}
      </div>
    </article>
  )
}

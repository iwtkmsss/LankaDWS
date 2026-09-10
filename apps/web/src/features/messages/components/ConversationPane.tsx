import type {
  ChatMessageView,
  ChatThreadDetail,
  ChatThreadListItem,
  StructuredMentionInput,
} from '@bert-crm/contracts'
import { ArrowLeft, Bell, BellOff, Info, MoreVertical, Search, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { FileDropOverlay, useFileDropTarget } from '../../../shared/files/FileDropzone'
import { Avatar, ErrorState, IconButton, Skeleton } from '../../../shared/ui'
import { ConversationSearch } from './ConversationSearch'
import { MessageComposer } from './MessageComposer'
import { MessageStream } from './MessageStream'

interface ConversationPaneProps {
  thread?: ChatThreadDetail
  preview?: ChatThreadListItem
  messages: ChatMessageView[]
  currentUserId: string
  loading: boolean
  error: boolean
  highlightedMessageId?: string | null
  canLoadOlder: boolean
  loadingOlder: boolean
  canConvertToTask: boolean
  canConvertToEvent: boolean
  replyTo: ChatMessageView | null
  attachments: Parameters<typeof MessageComposer>[0]['attachments']
  sending: boolean
  uploading: boolean
  composerError: string
  initialComposerBody?: string
  onInitialComposerBodyConsumed?: () => void
  onBack: () => void
  onInfo: () => void
  onToggleMute: () => void
  onOpenSearchResult: (messageId: string) => void
  onLatest: () => void
  onLoadOlder: () => Promise<unknown>
  onReply: (message: ChatMessageView) => void
  onLike: (message: ChatMessageView) => void
  onForward: (message: ChatMessageView) => void
  onReplyCancel: () => void
  onEdit: (message: ChatMessageView, body: string, mentions: StructuredMentionInput[]) => Promise<void>
  onDelete: (message: ChatMessageView) => Promise<void>
  onConvert: (kind: 'task' | 'event', message: ChatMessageView) => void
  onRemoveAttachment: (id: string) => void
  onFiles: (files: File[]) => void
  onSend: (input: { body: string; mentions: StructuredMentionInput[] }) => Promise<boolean>
  onRetry: () => void
}

function ConversationAvatar({
  thread,
  preview,
}: Pick<ConversationPaneProps, 'thread' | 'preview'>) {
  if (thread?.kind === 'DIRECT' || preview?.kind === 'DIRECT') {
    const other = thread?.participants.find((participant) =>
      participant.displayName === thread.title,
    )
    return <Avatar name={thread?.title ?? preview?.title ?? ''} src={other?.avatarAsset ?? preview?.avatarAsset} />
  }
  return (
    <span className="conversation-header__group-avatar" aria-hidden="true">
      <UsersRound size={22} />
    </span>
  )
}

export function ConversationPane(props: ConversationPaneProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const freeAttachmentSlots = 5 - props.attachments.length
  const { isDragging, dropTargetProps } = useFileDropTarget({
    disabled: !props.thread?.canPost || props.uploading || freeAttachmentSlots <= 0,
    onFiles: (files) => props.onFiles(files.slice(0, freeAttachmentSlots)),
  })

  if (props.loading) {
    return <section className="conversation-pane conversation-pane--loading"><Skeleton rows={8} /></section>
  }
  if (props.error || !props.thread) {
    return (
      <section className="conversation-pane">
        <ErrorState title="Не вдалося відкрити діалог" onRetry={props.onRetry} />
      </section>
    )
  }
  const directParticipant = props.thread.kind === 'DIRECT'
    ? props.thread.participants.find((participant) => participant.id !== props.currentUserId)
    : null
  const subtitle = props.thread.kind === 'DIRECT'
    ? [
        directParticipant?.username ? `@${directParticipant.username}` : '',
        directParticipant?.jobTitle ?? '',
      ].filter(Boolean).join(' · ')
    : `${props.thread.participants.length} учасників`

  return (
    <section
      className="conversation-pane is-file-drop-target"
      aria-label={`Діалог: ${props.thread.title}`}
      {...dropTargetProps}
    >
      <FileDropOverlay active={isDragging} label="Відпустіть файли, щоб прикріпити їх до повідомлення" />
      <header className="conversation-header">
        <IconButton className="conversation-header__back" label="До списку діалогів" onClick={props.onBack}>
          <ArrowLeft size={21} />
        </IconButton>
        <h1 className="conversation-header__person-heading">
          <button
            type="button"
            className="conversation-header__person"
            aria-label={`Інформація та файли: ${props.thread.title}`}
            onClick={props.onInfo}
          >
            <ConversationAvatar thread={props.thread} preview={props.preview} />
            <span className="conversation-header__copy">
              <strong>{props.thread.title}</strong>
              <span>{subtitle}</span>
            </span>
          </button>
        </h1>
        <div className="conversation-header__actions">
          <IconButton
            label="Пошук у діалозі"
            className={searchOpen ? 'is-active' : ''}
            onClick={() => setSearchOpen((value) => !value)}
          >
            <Search size={20} />
          </IconButton>
          <IconButton label="Інформація про діалог" onClick={props.onInfo}>
            <Info size={20} />
          </IconButton>
          <div className="conversation-more">
            <IconButton
              label="Інші дії"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <MoreVertical size={20} />
            </IconButton>
            {menuOpen && (
              <div className="conversation-more__menu">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    props.onToggleMute()
                  }}
                >
                  {props.thread.notificationMode === 'NONE'
                    ? <Bell size={17} />
                    : <BellOff size={17} />}
                  {props.thread.notificationMode === 'NONE'
                    ? 'Увімкнути сповіщення'
                    : 'Вимкнути сповіщення'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    props.onInfo()
                  }}
                >
                  <Info size={17} /> Інформація
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {searchOpen && (
        <ConversationSearch
          threadId={props.thread.id}
          onClose={() => setSearchOpen(false)}
          onOpenResult={(messageId) => {
            setSearchOpen(false)
            props.onOpenSearchResult(messageId)
          }}
        />
      )}

      {props.highlightedMessageId && (
        <button className="conversation-latest" type="button" onClick={props.onLatest}>
          Повернутися до нових повідомлень
        </button>
      )}

      <MessageStream
        threadId={props.thread.id}
        messages={props.messages}
        currentUserId={props.currentUserId}
        highlightedMessageId={props.highlightedMessageId}
        canLoadOlder={props.canLoadOlder}
        loadingOlder={props.loadingOlder}
        canConvertToTask={props.canConvertToTask}
        canConvertToEvent={props.canConvertToEvent}
        onLoadOlder={props.onLoadOlder}
        onReply={props.onReply}
        onLike={props.onLike}
        onForward={props.onForward}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onConvert={props.onConvert}
      />

      {props.thread.canPost && (
        <MessageComposer
          key={props.thread.id}
          threadId={props.thread.id}
          initialBody={props.initialComposerBody}
          onInitialBodyConsumed={props.onInitialComposerBodyConsumed}
          replyTo={props.replyTo}
          attachments={props.attachments}
          sending={props.sending}
          uploading={props.uploading}
          error={props.composerError}
          onReplyCancel={props.onReplyCancel}
          onRemoveAttachment={props.onRemoveAttachment}
          onFiles={props.onFiles}
          onSend={props.onSend}
        />
      )}
    </section>
  )
}

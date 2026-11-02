import type { ReactNode, Ref } from 'react'
import { Link } from 'react-router-dom'
import type { FeedAttachmentView, FeedCommentView, FeedPhotoPlacement, StructuredMentionView } from '@lankadws/contracts'
import {
  Archive, ArrowRight, CalendarClock, CalendarDays, Check, CheckCheck, CheckCircle2, Clock3,
  Download, Eye, FileText, Heart, LoaderCircle, MessageCircle, MoreHorizontal,
  Pencil, Pin, Reply, ShieldCheck, SquareCheckBig, Timer, TriangleAlert, UserRoundCheck, UserRoundPen, UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { Avatar, Button, IconButton } from '../../shared/ui'
import { FileFormatIcon } from '../../shared/files/FileFormatIcon'
import { FormattedText } from '../../shared/text/FormattedText'
import { RichTextEditor } from '../../shared/text/RichTextEditor'
import { formatDateTime } from '../../shared/lib/format'
import { FileThumbnail } from '../../shared/files/FileThumbnail'
import { FeedInlineCanvas, placedPhotos } from './FeedInlineCanvas'
import './feed-card-design.css'

export type AcknowledgementState = 'pending' | 'loading' | 'error' | 'done' | 'observer'
export type CardAcknowledgement = {
  state: AcknowledgementState
} | {
  state: 'summary'
  acknowledgedCount: number
  recipientCount: number
}
export interface FeedMetadataPerson {
  id?: string
  displayName: string
  avatarAsset: string | null
}
export interface FeedCardModel {
  kind: 'POST' | 'TASK' | 'EVENT'
  title?: string
  author?: FeedMetadataPerson
  date: string
  dateTime?: string
  href?: string
  audience: string
  body: string
  mentions?: StructuredMentionView[]
  edited?: boolean
  isNew?: boolean
  historical?: boolean
  canManage?: boolean
  canPin?: boolean
  pinned?: boolean
  pinning?: boolean
  likes?: number
  liked?: boolean
  comments?: FeedCommentView[]
  commentCount?: number
  attachments?: FeedAttachmentView[]
  photoLayout?: FeedPhotoPlacement[]
  acknowledgement?: CardAcknowledgement
  metadata?: Array<{ label: string; value: string; person?: FeedMetadataPerson }>
  changes?: { messages: number; status: number; participants: number }
}
export interface FeedCardViewState {
  mode: 'read' | 'edit' | 'saving' | 'archive' | 'archiving' | 'archived'
  menuOpen: boolean
  commentsOpen: boolean
  replyTo: string | null
  comment: string
  sending: boolean
  liking: boolean
  notice: string
}
export type CardAction = 'like' | 'comments' | 'menu' | 'edit' | 'save' | 'cancel-edit'
  | 'archive' | 'confirm-archive' | 'cancel-archive' | 'undo' | 'acknowledge' | 'send'
  | 'cancel-reply' | 'open' | 'profile' | 'pin'

export function FeedAcknowledgement({ value, onConfirm }: { value: CardAcknowledgement; onConfirm: () => void }) {
  if (value.state === 'summary') return (
    <section className="stream-ack is-summary" aria-label="Ознайомлення">
      <div className="stream-ack__main">
        <span className="stream-ack__icon" aria-hidden="true"><ShieldCheck size={18} /></span>
        <div className="stream-ack__copy"><strong>Ознайомилися {value.acknowledgedCount} із {value.recipientCount}</strong></div>
      </div>
    </section>
  )
  const done = value.state === 'done'
  const observer = value.state === 'observer'
  const busy = value.state === 'loading'
  if (observer) return null
  const title = done ? 'Ви ознайомилися' : 'Потрібне ознайомлення'
  return (
    <section className={`stream-ack is-${value.state}`} aria-label="Ознайомлення" aria-busy={busy}>
      <div className="stream-ack__main">
        <span className="stream-ack__icon" aria-hidden="true">{done ? <CheckCheck size={18} /> : <ShieldCheck size={18} />}</span>
        <div className="stream-ack__copy">
          <strong>{title}</strong>
        </div>
        {!done && !observer && <Button type="button" disabled={busy} onClick={onConfirm}>
          {busy ? <LoaderCircle size={14} className="stream-spin" /> : <Check size={14} />}
          {busy ? 'Підтверджуємо…' : 'Ознайомився'}
        </Button>}
      </div>
      {value.state === 'error' && <p className="stream-inline-error" role="alert"><TriangleAlert size={16} />Не вдалося підтвердити. Спробуйте ще раз.</p>}
    </section>
  )
}

export function formatFeedFileSize(bytes: number) {
  return bytes < 1024 ? `${bytes} Б` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

const metadataIcons: Record<string, LucideIcon> = {
  Дата: CalendarDays,
  'Дата і час': CalendarDays,
  Час: Clock3,
  Тривалість: Timer,
  Строк: CalendarClock,
  Завдання: SquareCheckBig,
  Постановник: UserRoundPen,
  Автор: UserRoundPen,
  Відповідальний: UserRoundCheck,
  Аудиторія: UsersRound,
}

export type FeedPersonRenderer = (person: FeedMetadataPerson, children: ReactNode, className: string, label?: string) => ReactNode

export function FeedMetadata({ entries = [], onProfile, renderPerson }: { entries?: FeedCardModel['metadata']; onProfile?: (person: FeedMetadataPerson) => void; renderPerson?: FeedPersonRenderer }) {
  if (entries.length === 0) return null
  return <dl className="stream-metadata">{entries.map(({ label, value, person }) => {
    const MetadataIcon = metadataIcons[label]
    return <div key={label}>
      <dt>{MetadataIcon && <MetadataIcon size={12} strokeWidth={2} aria-hidden="true" />}{label}</dt>
      <dd>{person ? renderPerson ? renderPerson(person, <span>{value}</span>, 'stream-metadata__person', `${label}: ${value}`) : <button type="button" className="stream-metadata__person" aria-label={`Відкрити профіль: ${person.displayName}`} onClick={() => onProfile?.(person)} disabled={!onProfile}><span>{value}</span></button> : value}</dd>
    </div>
  })}</dl>
}

export function FeedFileRow({ file, onPreview, onDownload, downloadHref, thumbnail }: { file: FeedAttachmentView; onPreview: () => void; onDownload?: () => void; downloadHref?: string; thumbnail?: ReactNode }) {
  const clean = file.scanStatus === 'CLEAN'
  const pending = file.scanStatus === 'QUARANTINED' || file.scanStatus === 'SCANNING'
  const label = clean ? formatFeedFileSize(file.bytes) : pending ? 'Перевіряється' : file.scanStatus === 'INFECTED' ? 'Файл заблоковано' : file.scanStatus === 'UNSUPPORTED' ? 'Формат не підтримується' : 'Не вдалося перевірити'
  return (
    <div className={`stream-file ${clean ? 'is-ready' : pending ? 'is-pending' : 'is-blocked'}`}>
      <span className="stream-file__icon">{clean && thumbnail ? thumbnail : <FileFormatIcon mimeType={file.mimeType} fileName={file.fileName} size={24} />}</span>
      <div className="stream-file__name"><strong>{file.fileName}</strong><small>{pending && <LoaderCircle size={13} className="stream-spin" />}{!clean && !pending && <TriangleAlert size={13} />}{label}</small></div>
      {clean && <div className="stream-file__actions"><IconButton label={`Переглянути ${file.fileName}`} onClick={onPreview}><Eye size={17} /></IconButton>{downloadHref ? <a className="icon-button" aria-label={`Завантажити ${file.fileName}`} href={downloadHref}><Download size={17} /></a> : <IconButton label={`Завантажити ${file.fileName}`} onClick={onDownload}><Download size={17} /></IconButton>}</div>}
    </div>
  )
}

const kinds = {
  POST: { label: 'Публікація', Icon: FileText, action: '' },
  TASK: { label: 'Завдання', Icon: SquareCheckBig, action: 'Відкрити завдання' },
  EVENT: { label: 'Подія календаря', Icon: CalendarClock, action: 'Відкрити подію' },
}

// Shared presentation. Callers own data, mutations and attachment/editor lifecycles.
export function FeedCardDesign({ item, state, editorId, onAction, onBodyChange, onReply, onFile, onProfile, renderPerson, renderAttachment, renderInlinePhoto, renderCommentExtra, renderCommentBody, editor, commentComposer, headerRef, headingLevel = 'h3', error }: {
  item: FeedCardModel
  state: FeedCardViewState
  editorId: string
  onProfile?: (person: FeedMetadataPerson) => void
  onAction: (action: CardAction) => void
  onBodyChange?: (body: string) => void
  onReply: (commentId: string) => void
  onFile: (file: FeedAttachmentView, action: 'preview' | 'download') => void
  renderPerson?: FeedPersonRenderer
  renderAttachment?: (file: FeedAttachmentView) => ReactNode
  renderInlinePhoto?: (file: FeedAttachmentView) => ReactNode
  renderCommentExtra?: (comment: FeedCommentView) => ReactNode
  renderCommentBody?: (comment: FeedCommentView) => ReactNode
  editor?: ReactNode
  commentComposer?: ReactNode
  headerRef?: Ref<HTMLElement>
  headingLevel?: 'h2' | 'h3'
  error?: string
}) {
  const { Icon, label, action } = kinds[item.kind]
  const Heading = headingLevel
  const DiscussionHeading = headingLevel === 'h2' ? 'h2' : 'h4'
  const titleInHeader = (item.kind === 'EVENT' || item.kind === 'TASK') && Boolean(item.title)
  const taskNumber = item.kind === 'TASK' ? item.metadata?.find((entry) => entry.label === 'Завдання')?.value.replace(/^№\s*/u, '') : undefined
  const metadata = item.kind === 'EVENT' && item.author
    ? [{ label: 'Автор', value: item.author.displayName, person: item.author }, ...item.metadata ?? []]
    : item.kind === 'TASK' ? item.metadata?.filter((entry) => entry.label !== 'Завдання') : item.metadata
  const editing = state.mode === 'edit' || state.mode === 'saving'
  // While editing, placed photos fall back to the regular attachment list.
  const inlinePhotos = editing ? [] : placedPhotos(item.photoLayout, item.attachments)
  const listedAttachments = item.attachments?.filter((file) => !inlinePhotos.some((photo) => photo.file.id === file.id))
  const comments = item.comments ?? []
  const busy = ['saving', 'archiving'].includes(state.mode)
  const commentCount = item.commentCount ?? comments.length
  let sourceAction: ReactNode = null
  if (item.kind !== 'POST') sourceAction = item.href ? <Link className="button button--secondary" to={item.href}>{action}<ArrowRight size={16} /></Link> : <Button type="button" variant="secondary" onClick={() => onAction('open')}>
    {action}<ArrowRight size={16} />
  </Button>
  const sourceAuthor = item.kind !== 'POST' && item.author ? (
    <button type="button" className="stream-source-author" onClick={() => onAction('profile')}>
      <Avatar name={item.author.displayName} src={item.author.avatarAsset} size="sm" />
      <span>Автор: <strong>{item.author.displayName}</strong></span>
    </button>
  ) : null

  if (state.mode === 'archived') return <article className="stream-card stream-card--removed"><Archive size={21} /><span><strong>Публікацію архівовано</strong><small>Цей запис більше не відображається у стрічці.</small></span><Button type="button" variant="secondary" onClick={() => onAction('undo')}>Повернути приклад</Button></article>

  return (
    <article className={`stream-card stream-card--${item.kind.toLowerCase()}${item.isNew ? ' is-new' : ''}`}>
      {item.isNew && <div className="stream-card__new"><span />Нове оновлення</div>}
      <header ref={headerRef} className="stream-card__header">
        {item.kind === 'POST' ? renderPerson && item.author ? renderPerson(item.author, <>
          <Avatar name={item.author.displayName} src={item.author.avatarAsset} />
          <span><strong>{item.author.displayName}</strong><small><span className="stream-card__source-label">{label}</span><time className="stream-card__source-date" dateTime={item.dateTime}><Clock3 size={13} />{item.date}</time><span className="stream-card__audience"><UsersRound size={13} />{item.audience}</span></small></span>
        </>, 'stream-card__person', `Відкрити профіль ${item.author.displayName}`) : <button type="button" className="stream-card__person" onClick={() => onAction('profile')}>
          <Avatar name={item.author?.displayName ?? 'Автор'} src={item.author?.avatarAsset} />
          <span>
            <strong>{item.author?.displayName ?? 'Недоступний користувач'}</strong>
            <small>
              <span className="stream-card__source-label">{label}</span>
              <span className="stream-card__source-date"><Clock3 size={13} />{item.date}</span>
              <span className="stream-card__audience"><UsersRound size={13} />{item.audience}</span>
            </small>
          </span>
        </button>
          : <div className="stream-card__source">
            <span className="stream-card__kind-icon"><Icon size={21} strokeWidth={item.kind === 'EVENT' ? 2.2 : 2} /></span>
            <div className="stream-card__source-copy">
              {titleInHeader ? <Heading>{item.title}</Heading> : <strong>{label}</strong>}
              <small>
                {item.kind === 'TASK' && <span className="stream-card__source-label">Задача{taskNumber && ` ${taskNumber}`}</span>}
                {item.kind === 'EVENT' && titleInHeader && <span className="stream-card__source-label">{label}</span>}
                <time className="stream-card__source-date" dateTime={item.dateTime}>{item.kind === 'EVENT' ? <Clock3 size={13} strokeWidth={2.2} /> : <CalendarDays size={13} />}{item.date}</time>
                {item.historical && <span>Історичний запис</span>}
              </small>
            </div>
          </div>}
        <div className="stream-card__badges">
          {item.canPin && item.kind === 'TASK' && <IconButton
            label={item.pinned ? 'Відкріпити' : 'Закріпити для себе'}
            title={item.pinned ? 'Відкріпити' : 'Закріпити для себе'}
            aria-pressed={Boolean(item.pinned)} disabled={item.pinning}
            className={item.pinned ? 'stream-card__pin-button is-pinned' : 'stream-card__pin-button'}
            onClick={() => onAction('pin')}
          ><Pin size={18} fill={item.pinned ? 'currentColor' : 'none'} /></IconButton>}
          {item.acknowledgement && ['pending', 'loading', 'error'].includes(item.acknowledgement.state) && <span className="stream-card__pin" title="Закріплено до ознайомлення">
            <Pin size={14} aria-label="Закріплено до ознайомлення" />
          </span>}
          {item.acknowledgement && <FeedAcknowledgement value={item.acknowledgement} onConfirm={() => onAction('acknowledge')} />}
          {item.canManage && <div className="stream-card__menu" onBlur={(event) => { if (state.menuOpen && !event.currentTarget.contains(event.relatedTarget)) onAction('menu') }} onKeyDown={(event) => {
            if (event.key === 'Escape' && state.menuOpen) { event.preventDefault(); event.stopPropagation(); onAction('menu'); document.getElementById(`${editorId}-menu-trigger`)?.focus() }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              if (!state.menuOpen) { onAction('menu'); requestAnimationFrame(() => document.getElementById(`${editorId}-menu`)?.querySelector<HTMLElement>('button')?.focus()); return }
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowUp' ? (current <= 0 ? buttons.length - 1 : current - 1) : (current + 1) % buttons.length
              buttons[next]?.focus()
            }
          }}><IconButton id={`${editorId}-menu-trigger`} label="Дії з записом" aria-haspopup="menu" aria-expanded={state.menuOpen} aria-controls={`${editorId}-menu`} onClick={() => onAction('menu')}><MoreHorizontal size={19} /></IconButton>{state.menuOpen && <div id={`${editorId}-menu`} role="menu" className="stream-menu">
            {item.canManage && item.kind === 'POST' && <button type="button" role="menuitem" onClick={() => onAction('edit')}><Pencil size={15} />Редагувати</button>}
            {item.canManage && <button type="button" role="menuitem" className="stream-menu__danger" onClick={() => onAction('archive')}><Archive size={15} />Архівувати</button>}
          </div>}</div>}
        </div>
      </header>

      <div className="stream-card__content">
        {item.title && !titleInHeader && <Heading>{item.title}</Heading>}
        {editing ? <form id={`${editorId}-edit-form`} onSubmit={(event) => { event.preventDefault(); if (!busy && item.body.trim()) onAction('save') }} className="stream-card__editor">{editor ?? <RichTextEditor id={`${editorId}-edit`} label="Текст публікації" value={item.body} onChange={(value) => onBodyChange?.(value)} rows={4} disabled={busy} maxLength={10000} />}</form>
          : (item.body || inlinePhotos.length > 0) && <FeedInlineCanvas photos={inlinePhotos} renderPhoto={(file) => renderInlinePhoto ? renderInlinePhoto(file)
            : <button type="button" aria-label={`Переглянути ${file.fileName}`} onClick={() => onFile(file, 'preview')}><FileThumbnail file={file} /></button>}>
            {item.body && <div className="stream-card__text"><FormattedText body={item.body} mentions={item.mentions} /></div>}
          </FeedInlineCanvas>}
        {item.kind === 'TASK' && <div className="stream-changes" aria-label="Непрочитані зміни завдання">{[
          { key: 'messages' as const, label: 'Нові повідомлення', Icon: MessageCircle },
          { key: 'status' as const, label: 'Зміни завдання', Icon: FileText },
          { key: 'participants' as const, label: 'Зміна учасників', Icon: UsersRound },
        ].filter((entry) => item.changes?.[entry.key]).map(({ key, label: changeLabel, Icon: ChangeIcon }) => <div key={key}><ChangeIcon size={17} /><span>{changeLabel}</span><strong>{item.changes![key]}</strong></div>)}
          {!Object.values(item.changes ?? {}).some(Boolean) && <p><CheckCircle2 size={17} />Нових змін немає</p>}
        </div>}
        {item.kind !== 'POST' ? <div className="stream-task-details">
          <FeedMetadata entries={metadata} onProfile={onProfile} renderPerson={renderPerson} />
          {sourceAction}
        </div> : <FeedMetadata entries={item.metadata} onProfile={onProfile} renderPerson={renderPerson} />}
        {item.kind === 'TASK' && !renderPerson && sourceAuthor}
        {listedAttachments?.length ? <section className="stream-attachments" aria-label="Вкладення"><span className="stream-section-label">Вкладення · {listedAttachments.length}</span>{listedAttachments.map((file) => <div key={file.id}>{renderAttachment ? renderAttachment(file) : <FeedFileRow file={file} onPreview={() => onFile(file, 'preview')} onDownload={() => onFile(file, 'download')} />}</div>)}</section> : null}
      </div>

      {(state.mode === 'archive' || state.mode === 'archiving') && <div className="stream-card__confirm" role="alert"><TriangleAlert size={20} /><span><strong>Архівувати публікацію?</strong><small>Запис зникне зі стрічки для всіх одержувачів.</small></span><div><Button type="button" variant="secondary" disabled={busy} onClick={() => onAction('cancel-archive')}>Скасувати</Button><Button type="button" variant="danger" disabled={busy} onClick={() => onAction('confirm-archive')}>{busy ? 'Прибираємо…' : 'Підтвердити'}</Button></div></div>}

      {item.kind === 'POST' && <footer className="stream-card__footer">
        <button type="button" className={`stream-reaction${item.liked ? ' is-active' : ''}`} aria-pressed={Boolean(item.liked)} disabled={state.liking} onClick={() => onAction('like')}><Heart size={18} fill={item.liked ? 'currentColor' : 'none'} />Подобається{Boolean(item.likes) && <strong>{item.likes}</strong>}</button>
        <button type="button" className="stream-reaction" aria-expanded={state.commentsOpen} aria-controls={`${editorId}-comments`} onClick={() => onAction('comments')}><MessageCircle size={18} />Коментарі{commentCount > 0 && <strong>{commentCount}</strong>}</button>
        {item.edited && <span className="stream-card__edited"><Pencil size={12} />Змінено</span>}
        {editing && <div className="stream-form-actions stream-card__edit-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => onAction('cancel-edit')}>Скасувати</Button><Button type="submit" form={`${editorId}-edit-form`} disabled={busy || !item.body.trim()}>{busy && <LoaderCircle size={15} className="stream-spin" />}{busy ? 'Зберігаємо…' : 'Зберегти зміни'}</Button></div>}
      </footer>}
      {item.kind === 'POST' && state.commentsOpen && <section id={`${editorId}-comments`} className="stream-comments" aria-label="Коментарі до публікації"><DiscussionHeading>Обговорення <span>{commentCount}</span></DiscussionHeading>{comments.length === 0 && <p className="stream-comments__empty">Коментарів ще немає. Розпочніть обговорення.</p>}{comments.map((comment) => <article key={comment.id} className={`stream-comment${comment.replyToCommentId ? ' is-reply' : ''}`}>
        {renderPerson ? renderPerson(comment.author, <Avatar name={comment.author.displayName} src={comment.author.avatarAsset} size="sm" />, 'stream-comment__avatar', `Відкрити профіль ${comment.author.displayName}`) : <Avatar name={comment.author.displayName} src={comment.author.avatarAsset} size="sm" />}
        <div><header>{renderPerson ? renderPerson(comment.author, <strong>{comment.author.displayName}</strong>, 'stream-comment__author') : <strong>{comment.author.displayName}</strong>}<time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time></header>{comment.body && (renderCommentBody ? renderCommentBody(comment) : <FormattedText body={comment.body} mentions={comment.mentions} />)}{renderCommentExtra?.(comment)}{!comment.replyToCommentId && <button type="button" disabled={state.sending} onClick={() => onReply(comment.id)}><Reply size={13} />Відповісти</button>}</div></article>)}
        {commentComposer}
      </section>}
      {error && <p className="stream-inline-error" role="alert"><TriangleAlert size={16} />{error}</p>}
      {state.notice && <p className="stream-card__notice" role="status"><Check size={15} />{state.notice}</p>}
    </article>
  )
}

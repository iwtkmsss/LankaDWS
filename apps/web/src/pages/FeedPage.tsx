import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  FeedAttachmentView,
  FeedItemType,
  FeedListFilter,
  FeedListResult,
  FeedPostView,
  FeedSourceView,
  StructuredMentionInput,
} from '@bert-crm/contracts'
import {
  Archive,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Heart,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Reply,
  Send,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import { organizationQueryScope } from '../shared/lib/navigation'
import { MentionText } from '../shared/mentions/MentionRenderer'
import { MentionTextarea } from '../shared/mentions/MentionTextarea'
import { editableMentions, trimMentionValue } from '../shared/mentions/mentionText'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Modal,
  PageDataLoader,
  PageHeader,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../shared/ui'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import { FeedComposerForm, formatBytes } from './FeedComposerForm'
import { FeedBirthdayHighlight } from './FeedBirthdayHighlight'
import { FeedOverview } from './FeedOverview'

export function FeedPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerBusy, setComposerBusy] = useState(false)
  const [composerDirty, setComposerDirty] = useState(false)
  const composerCloseGuard = useModalCloseGuard({
    dirty: composerOpen && composerDirty,
    onRequestClose: () => {
      setComposerDirty(false)
      setComposerOpen(false)
    },
  })
  const readKey = useRef('')
  const initialFeedItemIdsRef = useRef<Set<string> | null>(null)
  const [newFeedItemIds, setNewFeedItemIds] = useState<Set<string>>(() => new Set())
  const company = organizationQueryScope(user?.company?.id)
  const filter = parseFilter(params.get('filter'))
  const itemType = parseItemType(params.get('type'))
  const authorId = parseIdParam(params.get('authorId'))
  const groupId = parseIdParam(params.get('groupId'))
  const audienceId = parseIdParam(params.get('audienceId'))
  const dateFrom = parseDateParam(params.get('dateFrom'))
  const dateTo = parseDateParam(params.get('dateTo'))
  const mentioned = params.get('mentioned') === 'true'
  const important = params.get('important') === 'true'
  const feedSessionKey = [
    company, filter, itemType, authorId, groupId, audienceId, dateFrom, dateTo,
    mentioned, important,
  ].join('|')
  const pages = useInfiniteQuery({
    queryKey: [
      'feed',
      company,
      filter,
      itemType,
      authorId,
      groupId,
      audienceId,
      dateFrom,
      dateTo,
      mentioned,
      important,
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({
        company,
        filter,
        type: itemType,
        limit: '20',
      })
      if (authorId) query.set('authorId', authorId)
      if (groupId) query.set('groupId', groupId)
      if (audienceId) query.set('audienceId', audienceId)
      if (dateFrom) query.set('dateFrom', dateFrom)
      if (dateTo) query.set('dateTo', dateTo)
      if (mentioned) query.set('mentioned', 'true')
      if (important) query.set('important', 'true')
      if (pageParam) query.set('cursor', pageParam)
      return api<FeedListResult>(`/feed?${query}`)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const data = query.state.data as { pages?: FeedListResult[] } | undefined
      return data?.pages?.some((page) => page.items.some((item) =>
        item.kind === 'SOURCE'
        && item.sourceType === 'FILE'
        && item.actionState === 'PROCESSING'))
        ? 3_000
        : false
    },
  })
  const markRead = useMutation({
    mutationFn: (markers: FeedListResult['readMarkers']) =>
      api('/feed/read', { method: 'POST', body: jsonBody({ markers }) }),
    onSuccess: () => {
      queryClient.setQueriesData<{ unreadCount: number }>(
        { queryKey: ['feed', 'summary'] },
        (current) => current ? { ...current, unreadCount: 0 } : current,
      )
      void queryClient.invalidateQueries({ queryKey: ['feed', 'summary'] })
    },
    onError: () => { readKey.current = '' },
  })
  const firstPage = pages.data?.pages[0]
  const items = pages.data?.pages.flatMap((page) => page.items) ?? []

  useEffect(() => {
    document.title = 'Жива стрічка — Lanka'
  }, [])

  useEffect(() => {
    initialFeedItemIdsRef.current = null
    setNewFeedItemIds(new Set())
  }, [feedSessionKey])

  useEffect(() => {
    if (!firstPage || !user) return
    const knownIds = initialFeedItemIdsRef.current
    if (!knownIds) {
      initialFeedItemIdsRef.current = new Set(firstPage.items.map((item) => item.itemId))
      return
    }
    const newIds = firstPage.items
      .filter((item) => !knownIds.has(item.itemId) && !isOwnFeedItem(item, user.id))
      .map((item) => item.itemId)
    firstPage.items.forEach((item) => knownIds.add(item.itemId))
    if (newIds.length) setNewFeedItemIds((current) => new Set([...current, ...newIds]))
  }, [firstPage, user])

  useEffect(() => {
    if (
      filter !== 'ALL'
      || itemType !== 'ALL'
      || authorId
      || groupId
      || audienceId
      || dateFrom
      || dateTo
      || mentioned
      || important
    ) return
    const markers = firstPage?.readMarkers ?? []
    if (markers.length === 0) return
    const key = JSON.stringify(markers)
    if (readKey.current === key) return
    readKey.current = key
    markRead.mutate(markers)
  }, [
    authorId,
    audienceId,
    dateFrom,
    dateTo,
    filter,
    firstPage?.readMarkers,
    groupId,
    important,
    itemType,
    markRead,
    mentioned,
  ])

  function clearAllFilters() {
    const next = new URLSearchParams()
    setParams(next, { flushSync: true })
  }

  if (pages.isLoading || !user) {
    return (
      <>
        <PageHeader title="Жива стрічка" />
        <PageDataLoader />
      </>
    )
  }
  if (pages.isError || !firstPage) return <ErrorState onRetry={() => void pages.refetch()} />
  const hasLegacyFilter = filter !== 'ALL'
    || itemType !== 'ALL'
    || authorId
    || groupId
    || audienceId
    || dateFrom
    || dateTo
    || mentioned
    || important

  return (
    <div className="feed-page">
      <PageHeader
        title="Жива стрічка"
        description="Важливі оновлення команди без шуму чатів і дублювання завдань"
        action={(
          <Button onClick={() => {
            setComposerDirty(false)
            setComposerOpen(true)
          }}>
            <Plus size={17} />
            Створити публікацію
          </Button>
        )}
      />
      {!hasLegacyFilter && <FeedOverview />}
      <div className="feed-layout">
        <div className="feed-main">
          {hasLegacyFilter && (
            <div className="feed-legacy-filter-notice">
              <Button type="button" variant="secondary" onClick={clearAllFilters}>
                Показати всю стрічку
              </Button>
            </div>
          )}

          <section className="feed-list" aria-label="Оновлення стрічки">
            {items.length > 0 ? items.map((item) => (
              item.kind === 'POST'
                ? (
                    <FeedCard
                      key={item.itemId}
                      item={item}
                      isNew={newFeedItemIds.has(item.itemId)}
                      onChanged={() => void queryClient.invalidateQueries({ queryKey: ['feed'] })}
                    />
                  )
                : (
                    <FeedSourceCard
                      key={item.itemId}
                      item={item}
                      isNew={newFeedItemIds.has(item.itemId)}
                      onChanged={() => void queryClient.invalidateQueries({ queryKey: ['feed'] })}
                    />
                  )
            )) : (
              <Card>
                <EmptyState
                  title={!hasLegacyFilter ? 'Оновлень ще немає' : 'За цим посиланням нічого немає'}
                  description={!hasLegacyFilter
                    ? 'Опублікуйте корисне оновлення або створіть завдання для команди.'
                    : 'Поверніться до всієї стрічки, щоб побачити всі публікації.'}
                />
              </Card>
            )}
          </section>
          {pages.hasNextPage && (
            <Button
              variant="secondary"
              className="feed-load-more"
              disabled={pages.isFetchingNextPage}
              onClick={() => void pages.fetchNextPage()}
            >
              {pages.isFetchingNextPage ? 'Завантаження…' : 'Показати давніші публікації'}
            </Button>
          )}
        </div>

        <aside className="feed-attention" aria-label="Потребує уваги">
          <Card className="feed-attention__actions">
            <span className="eyebrow"><Sparkles size={14} /> Потребує уваги</span>
            <h2>Ваші наступні кроки</h2>
            <Link to="/feed?filter=ACK_REQUIRED">
              <ShieldCheck size={18} />
              <span>
                <strong>{firstPage.attention.pendingAcknowledgements}</strong>
                <small>підтверджень очікують</small>
              </span>
            </Link>
            <Link to="/tasks?role=RESPONSIBLE">
              <CheckCircle2 size={18} />
              <span>
                <strong>{firstPage.attention.overdueTasks}</strong>
                <small>прострочених завдань</small>
              </span>
            </Link>
            {firstPage.attention.pendingAcknowledgements === 0 && firstPage.attention.overdueTasks === 0 && (
              <p className="feed-attention__clear"><Check size={16} /> Термінових дій немає.</p>
            )}
          </Card>
          {!hasLegacyFilter && (
            <FeedBirthdayHighlight birthdays={firstPage.birthdays} />
          )}
        </aside>
      </div>
      {composerOpen && (
        <Modal
          title="Створити публікацію"
          description="Поділіться важливим оновленням із потрібною аудиторією."
          closeDisabled={composerBusy}
          onBeforeClose={composerCloseGuard.shouldClose}
          onRequestClose={composerCloseGuard.requestClose}
        >
          <FeedComposerForm
            defaultCompanyId={user?.company?.id}
            onBusyChange={setComposerBusy}
            onDirtyChange={setComposerDirty}
            onFeedChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ['feed'] })
              void queryClient.invalidateQueries({ queryKey: ['feed', 'summary'] })
            }}
            onPostCreated={() => composerCloseGuard.closeForSuccess(() => {
              setComposerDirty(false)
              setComposerOpen(false)
            })}
          />
        </Modal>
      )}
      <UnsavedChangesDialog
        guard={composerCloseGuard}
        title="Закрити створення публікації?"
        description="Текст, аудиторія та додані файли не збережуться."
      />
    </div>
  )
}

function FeedSourceCard({
  item,
  isNew,
  onChanged,
}: {
  item: FeedSourceView
  isNew: boolean
  onChanged: () => void
}) {
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [filePreviewOpen, setFilePreviewOpen] = useState(false)
  const revoke = useMutation({
    mutationFn: () => api(`/feed/file-shares/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      body: jsonBody({ expectedVersion: item.version }),
    }),
    onSuccess: onChanged,
  })
  const Icon = item.sourceType === 'TASK'
    ? SquareCheckBig
    : item.sourceType === 'EVENT'
      ? CalendarDays
      : item.sourceType === 'FILE'
        ? FileText
        : Megaphone
  const actionLabel = item.sourceType === 'TASK'
    ? 'Відкрити завдання'
    : item.sourceType === 'EVENT'
      ? 'Відкрити подію'
      : item.sourceType === 'FILE'
        ? 'Переглянути файл'
        : 'Відкрити оголошення'
  return (
    <Card className={`feed-source-card feed-source-card--${item.sourceType.toLowerCase()}${isNew ? ' is-new' : ''}`}>
      <div className="feed-source-card__icon" aria-hidden><Icon size={20} /></div>
      <div className="feed-source-card__content">
        <header>
          <span>{item.label}</span>
          <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt)}</time>
        </header>
        <h2>{item.title}</h2>
        {item.summary && <p>{item.summary}</p>}
        <div className="feed-source-card__meta">
          {item.metadata.map((entry) => <span key={entry}>{entry}</span>)}
          {item.actor && (
            <UserProfileLink className="feed-source-card__actor" userId={item.actor.id}>
              {item.actor.displayName}
            </UserProfileLink>
          )}
        </div>
      </div>
      <div className="feed-source-card__actions">
        {item.sourceType === 'FILE'
          ? item.actionState === 'AVAILABLE'
            ? (
                <button type="button" className="feed-source-card__action" onClick={() => setFilePreviewOpen(true)}>
                  <Eye size={15} /> {actionLabel}
                </button>
              )
            : (
                <span className={`feed-source-card__action is-${item.actionState.toLowerCase()}`} aria-disabled="true">
                  {item.actionState === 'PROCESSING' ? 'Перевіряється' : 'Заблоковано'}
                </span>
              )
          : (
              <Link className="feed-source-card__action" to={item.href}>
                {actionLabel} <ArrowRight size={15} />
              </Link>
            )}
        {item.sourceType === 'FILE' && item.canRevoke && (
          confirmRevoke
            ? (
                <span className="feed-source-card__confirm">
                  <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
                    {revoke.isPending ? 'Прибираємо…' : 'Підтвердити'}
                  </button>
                  <button type="button" disabled={revoke.isPending} onClick={() => setConfirmRevoke(false)}>
                    Скасувати
                  </button>
                </span>
              )
            : (
                <button
                  type="button"
                  className="feed-source-card__revoke"
                  onClick={() => setConfirmRevoke(true)}
                >
                  <Archive size={14} /> Прибрати
                </button>
              )
        )}
      </div>
      {filePreviewOpen && item.sourceType === 'FILE' && (
        <FilePreviewModal
          file={{
            id: fileIdFromDownloadHref(item.href),
            fileName: item.title,
            mimeType: item.metadata.find((entry) => entry === 'application/pdf' || entry.startsWith('image/'))
              ?? mimeTypeFromFileName(item.title),
          }}
          onClose={() => setFilePreviewOpen(false)}
        />
      )}
    </Card>
  )
}

function fileIdFromDownloadHref(href: string): string {
  const match = href.match(/\/files\/([^/]+)\/download/)
  if (!match?.[1]) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function isOwnFeedItem(item: FeedPostView | FeedSourceView, userId: string): boolean {
  return item.kind === 'POST'
    ? item.author.id === userId
    : item.actor?.id === userId
}

function mimeTypeFromFileName(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (extension === 'pdf') return 'application/pdf'
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  return null
}

function FeedCard({ item, isNew, onChanged }: { item: FeedPostView; isNew: boolean; onChanged: () => void }) {
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [commentMentions, setCommentMentions] = useState<StructuredMentionInput[]>([])
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(item.body)
  const [editMentions, setEditMentions] = useState<StructuredMentionInput[]>(() =>
    editableMentions(item.body, item.mentions))
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const like = useMutation({
    mutationFn: () => api(`/feed/${item.id}/reactions/like`, { method: 'POST' }),
    onSuccess: onChanged,
  })
  const acknowledge = useMutation({
    mutationFn: () => api(`/feed/${item.id}/acknowledge`, {
      method: 'POST',
      body: jsonBody({ acknowledgementVersion: item.acknowledgementVersion }),
    }),
    onSuccess: onChanged,
  })
  const addComment = useMutation({
    mutationFn: () => {
      const value = trimMentionValue(comment, commentMentions)
      return api(`/feed/${item.id}/comments`, {
        method: 'POST',
        body: jsonBody({ ...value, replyToCommentId: replyTo }),
      })
    },
    onSuccess: () => {
      setComment('')
      setCommentMentions([])
      setReplyTo(null)
      setCommentsOpen(true)
      onChanged()
    },
  })
  const update = useMutation({
    mutationFn: () => {
      const value = trimMentionValue(editBody, editMentions)
      return api(`/feed/${item.id}`, {
        method: 'PATCH',
        body: jsonBody({ ...value, expectedVersion: item.version }),
      })
    },
    onSuccess: () => {
      setEditing(false)
      setMenuOpen(false)
      onChanged()
    },
  })
  const archive = useMutation({
    mutationFn: () => api(`/feed/${item.id}`, {
      method: 'DELETE',
      body: jsonBody({ expectedVersion: item.version }),
    }),
    onSuccess: onChanged,
  })
  function submitComment(event: FormEvent) {
    event.preventDefault()
    if (comment.trim()) addComment.mutate()
  }

  function startEditing() {
    setEditBody(item.body)
    setEditMentions(editableMentions(item.body, item.mentions))
    setEditing(true)
    setMenuOpen(false)
  }

  function cancelEditing() {
    setEditing(false)
    setEditBody(item.body)
    setEditMentions(editableMentions(item.body, item.mentions))
  }

  return (
    <Card className={`feed-card${isNew ? ' is-new' : ''}`}>
      <header className="feed-card__header">
        <UserProfileLink
          className="feed-card__author"
          userId={item.author.id}
          aria-label={`Відкрити профіль ${item.author.displayName}`}
        >
          <Avatar name={item.author.displayName} src={item.author.avatarAsset} />
          <span>
            <strong>{item.author.displayName}</strong>
            <small><time dateTime={item.publishedAt}>{formatDateTime(item.publishedAt)}</time> · {item.audienceLabel}</small>
          </span>
        </UserProfileLink>
        <div className="feed-card__header-actions">
          {item.canEdit && (
            <div className="feed-card__menu">
              <IconButton
                label="Дії з публікацією"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((value) => !value)}
              >
                <MoreHorizontal size={18} />
              </IconButton>
              {menuOpen && (
                <div role="menu">
                  <button role="menuitem" onClick={startEditing}>
                    <Pencil size={15} /> Редагувати
                  </button>
                  <button role="menuitem" onClick={() => { setConfirmArchive(true); setMenuOpen(false) }}>
                    <Archive size={15} /> Архівувати
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {editing ? (
        <form className="feed-edit-form" onSubmit={(event) => { event.preventDefault(); update.mutate() }}>
          <MentionTextarea
            label="Текст публікації"
            value={editBody}
            mentions={editMentions}
            candidateUrl={`/feed/${encodeURIComponent(item.id)}/mention-candidates`}
            rows={4}
            maxLength={10_000}
            onChange={(value, mentions) => {
              setEditBody(value)
              setEditMentions(mentions)
            }}
          />
          <div className="feed-edit-form__actions">
            <Button type="button" variant="secondary" onClick={cancelEditing}>Скасувати</Button>
            <Button disabled={!editBody.trim() || update.isPending}>Зберегти зміни</Button>
          </div>
        </form>
      ) : (
        <div className="feed-card__body"><MentionText body={item.body} mentions={item.mentions} /></div>
      )}

      {item.attachments.length > 0 && (
        <div className="feed-card__attachments" aria-label="Вкладення">
          {item.attachments.map((attachment) => <FeedAttachment key={attachment.id} attachment={attachment} />)}
        </div>
      )}

      {confirmArchive && (
        <div className="feed-archive-confirm" role="alert">
          <span>Прибрати цю публікацію зі стрічки?</span>
          <div>
            <Button variant="ghost" onClick={() => setConfirmArchive(false)}>Залишити</Button>
            <Button variant="danger" disabled={archive.isPending} onClick={() => archive.mutate()}>Архівувати</Button>
          </div>
        </div>
      )}

      {item.requiresAcknowledgement && (
        <div className={`feed-acknowledgement ${item.hasAcknowledged ? 'is-done' : ''}`}>
          <ShieldCheck size={19} />
          <span>
            <strong>{item.hasAcknowledged ? 'Ви підтвердили ознайомлення' : 'Потрібне явне підтвердження'}</strong>
            <small>{item.acknowledgementCount} із {item.acknowledgementRecipientCount} адресатів підтвердили</small>
          </span>
          {item.acknowledgementRequiredForMe && !item.hasAcknowledged && (
            <Button
              variant="secondary"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate()}
            >
              Підтвердити
            </Button>
          )}
        </div>
      )}

      <footer className="feed-card__actions">
        <button
          className={item.likedByMe ? 'is-active' : ''}
          aria-pressed={item.likedByMe}
          disabled={like.isPending}
          onClick={() => like.mutate()}
        >
          <Heart size={17} fill={item.likedByMe ? 'currentColor' : 'none'} />
          Подобається{item.likeCount > 0 ? ` · ${item.likeCount}` : ''}
        </button>
        <button aria-expanded={commentsOpen} onClick={() => setCommentsOpen((value) => !value)}>
          <MessageCircle size={17} /> Коментарі{item.commentCount > 0 ? ` · ${item.commentCount}` : ''}
        </button>
        {item.editedAt && <small>Змінено {formatDateTime(item.editedAt)}</small>}
      </footer>

      {commentsOpen && (
        <section className="feed-comments" aria-label="Коментарі до публікації">
          {item.comments.length > 0 && (
            <div className="feed-comments__list">
              {item.comments.map((entry) => (
                <article key={entry.id} className={entry.replyToCommentId ? 'is-reply' : ''}>
                  <UserProfileLink
                    className="feed-comment__author-avatar"
                    userId={entry.author.id}
                    aria-label={`Відкрити профіль ${entry.author.displayName}`}
                  >
                    <Avatar name={entry.author.displayName} src={entry.author.avatarAsset} size="sm" />
                  </UserProfileLink>
                  <div>
                    <header>
                      <UserProfileLink userId={entry.author.id}>{entry.author.displayName}</UserProfileLink>
                      <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                    </header>
                    <p><MentionText body={entry.body} mentions={entry.mentions} /></p>
                    {!entry.replyToCommentId && (
                      <button onClick={() => { setReplyTo(entry.id); setComment(''); setCommentMentions([]) }}>
                        <Reply size={13} /> Відповісти
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          <form onSubmit={submitComment}>
            <MentionTextarea
              label={replyTo ? 'Відповідь на коментар' : 'Новий коментар'}
              value={comment}
              mentions={commentMentions}
              candidateUrl={`/feed/${encodeURIComponent(item.id)}/mention-candidates`}
              rows={2}
              maxLength={4_000}
              placeholder={replyTo ? 'Напишіть коротку відповідь…' : 'Додайте корисний контекст…'}
              onChange={(value, mentions) => {
                setComment(value)
                setCommentMentions(mentions)
              }}
            />
            <div className="feed-comments__actions">
              {replyTo && <Button type="button" variant="ghost" onClick={() => { setReplyTo(null); setCommentMentions([]) }}>Скасувати відповідь</Button>}
              <Button disabled={!comment.trim() || addComment.isPending}>
                <Send size={15} /> Надіслати
              </Button>
            </div>
          </form>
        </section>
      )}
    </Card>
  )
}

export function FeedAttachment({ attachment }: { attachment: FeedAttachmentView }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const status = useQuery({
    queryKey: ['file-status', attachment.id],
    queryFn: () => api<{ scanStatus: FeedAttachmentView['scanStatus'] }>(`/files/${attachment.id}/status`),
    enabled: !['CLEAN', 'INFECTED', 'UNSUPPORTED', 'FAILED'].includes(attachment.scanStatus),
    refetchInterval: (query) => {
      const state = query.state.data?.scanStatus ?? attachment.scanStatus
      return ['CLEAN', 'INFECTED', 'UNSUPPORTED', 'FAILED'].includes(state) ? false : 2_000
    },
  })
  const scanStatus = status.data?.scanStatus ?? attachment.scanStatus
  if (scanStatus === 'CLEAN') {
    return (
      <>
        <div className="feed-attachment">
          <button
            type="button"
            className="feed-attachment__preview-trigger"
            aria-label={`Переглянути ${attachment.fileName}`}
            onClick={() => setPreviewOpen(true)}
          >
            <FileText size={17} />
            <span>
              <strong>{attachment.fileName}</strong>
              <small>{formatBytes(attachment.bytes)}</small>
            </span>
          </button>
          <a
            className="feed-attachment__download"
            aria-label={`Завантажити ${attachment.fileName}`}
            href={`/api/v1/files/${encodeURIComponent(attachment.id)}/download`}
          >
            <Download size={15} />
          </a>
        </div>
        {previewOpen && (
          <FilePreviewModal file={attachment} onClose={() => setPreviewOpen(false)} />
        )}
      </>
    )
  }
  return (
    <span>
      <FileText size={17} />
      <span>
        <strong>{attachment.fileName}</strong>
        <small>{attachmentStateLabel(scanStatus)}</small>
      </span>
    </span>
  )
}

function parseFilter(value: string | null): FeedListFilter {
  return value === 'ACK_REQUIRED' || value === 'MINE' ? value : 'ALL'
}

function parseItemType(value: string | null): FeedItemType {
  return value === 'POST' || value === 'TASK' || value === 'EVENT' || value === 'ANNOUNCEMENT' || value === 'FILE'
    ? value
    : 'ALL'
}

function parseIdParam(value: string | null): string {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 && normalized.length <= 120 ? normalized : ''
}

function parseDateParam(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const parsed = new Date(`${value}T12:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : ''
}

function attachmentStateLabel(status: FeedAttachmentView['scanStatus']): string {
  if (status === 'INFECTED') return 'Файл заблоковано'
  if (status === 'UNSUPPORTED') return 'Формат не підтримується'
  if (status === 'FAILED') return 'Не вдалося перевірити'
  return 'Перевіряється перед завантаженням'
}

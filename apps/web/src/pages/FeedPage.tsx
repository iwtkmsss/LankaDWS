import { personName, personNamesInLabel } from '../shared/lib/personName'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  FeedAttachmentView,
  FeedItemType,
  FeedListFilter,
  FeedListResult,
  FeedPostView,
  FeedSourceView,
  StructuredMentionInput,
} from '@lankadws/contracts'
import { FEED_COMMENT_PHOTO_LIMIT, FEED_PHOTO_MIME_TYPES } from '@lankadws/contracts'
import { Check, CheckCircle2, Download, ImagePlus, LoaderCircle, Plus, Send, ShieldCheck, Sparkles, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import { organizationQueryScope } from '../shared/lib/navigation'
import { MentionTextarea } from '../shared/mentions/MentionTextarea'
import { editableMentions, trimMentionValue } from '../shared/mentions/mentionText'
import {
  Button,
  Card,
  IconButton,
  Modal,
  PageHeader,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../shared/ui'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import { FileThumbnail } from '../shared/files/FileThumbnail'
import { FeedComposerForm } from './FeedComposerForm'
import { FeedCardDesign, FeedFileRow, type FeedCardModel, type FeedCardViewState, type FeedPersonRenderer } from '../features/feed/FeedCardDesign'
import { FeedLoading, FeedPageState } from '../features/feed/FeedPageStates'
import { FeedDraftPhotos } from '../features/feed/FeedDraftPhotos'
import { useFeedCommentPhotos } from '../features/feed/useFeedCommentPhotos'
import '../features/feed/feed-page.css'
import { FeedBirthdayHighlight } from './FeedBirthdayHighlight'
import { FeedOverview } from './FeedOverview'
import { useEntityNotificationRead } from '../features/notifications/useEntityNotificationRead'

export const FEED_FALLBACK_POLL_MS = 60_000
export const feedFallbackInterval = (loadedPages: number) => (loadedPages > 1 ? false : FEED_FALLBACK_POLL_MS)

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
  // Opening the feed advances the read cursor at once, so remember where it stood
  // on arrival: what was news then stays marked until the person leaves the page.
  const [readPositionsOnArrival, setReadPositionsOnArrival] = useState<FeedListResult['readPositions'] | null>(null)
  const company = organizationQueryScope(user?.company?.id)
  const targetPostId = params.get('post')
  const targetPost = useQuery({
    queryKey: ['feed', 'post', targetPostId],
    queryFn: () => api<FeedPostView>(`/feed/${encodeURIComponent(targetPostId!)}`),
    enabled: Boolean(targetPostId),
  })
  const filter = parseFilter(params.get('filter'))
  const itemType = parseItemType(params.get('type'))
  const authorId = parseIdParam(params.get('authorId'))
  const audienceId = parseIdParam(params.get('audienceId'))
  const dateFrom = parseDateParam(params.get('dateFrom'))
  const dateTo = parseDateParam(params.get('dateTo'))
  const mentioned = params.get('mentioned') === 'true'
  const important = params.get('important') === 'true'
  const feedSessionKey = [
    company,
    filter,
    itemType,
    authorId,
    audienceId,
    dateFrom,
    dateTo,
    mentioned,
    important,
  ].join('|')
  const pages = useInfiniteQuery({
    queryKey: [
      'feed',
      company,
      filter,
      itemType,
      authorId,
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
    // Live updates arrive as realtime `summary` events (useMessageRealtime invalidates
    // ['feed']). This is only a slow, foreground-only safety net for a dropped SSE
    // stream. A refetch reloads every loaded page (~20 SQL queries each), so the poll
    // runs only while a single page is loaded; once the reader has paged deeper, the
    // realtime event and refetch-on-focus keep the list fresh instead.
    refetchInterval: (query) => feedFallbackInterval(query.state.data?.pages.length ?? 0),
    refetchIntervalInBackground: false,
  })
  const markRead = useMutation({
    mutationFn: (markers: FeedListResult['readMarkers']) =>
      api('/feed/read', { method: 'POST', body: jsonBody({ markers }) }),
    onSuccess: () => {
      queryClient.setQueriesData<{ unreadCount: number }>({ queryKey: ['feed', 'summary'] }, (current) =>
        current ? { ...current, unreadCount: 0 } : current,
      )
      void queryClient.invalidateQueries({ queryKey: ['feed', 'summary'] })
    },
    // Deliberately no retry on failure: `markRead` sits in the effect's dependency list, so
    // clearing readKey here re-triggers the effect on the very next render and a persistently
    // failing request (an expired CSRF cookie, say) turns into an unbounded request loop.
    // The next batch of markers produces a new key and gets its own attempt.
  })
  const firstPage = pages.data?.pages[0]
  const timelineItems = pages.data?.pages.flatMap((page) => page.items) ?? []
  const items = (targetPost.data
    ? [targetPost.data, ...timelineItems.filter((item) => item.kind !== 'POST' || item.id !== targetPost.data.id)]
    : timelineItems).sort((left, right) => {
      const leftPinned = needsAcknowledgement(left)
      const rightPinned = needsAcknowledgement(right)
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1
      const leftPersonal = Boolean(left.pinnedByMe)
      const rightPersonal = Boolean(right.pinnedByMe)
      if (!leftPinned && leftPersonal !== rightPersonal) return leftPersonal ? -1 : 1
      const leftAt = left.kind === 'POST' ? left.editedAt ?? left.publishedAt : left.occurredAt
      const rightAt = right.kind === 'POST' ? right.editedAt ?? right.publishedAt : right.occurredAt
      return Date.parse(rightAt) - Date.parse(leftAt) || right.itemId.localeCompare(left.itemId)
    })

  useEffect(() => {
    // Cached pages from an earlier visit hold an old cursor, so wait for a fresh one.
    if (readPositionsOnArrival || !firstPage || !pages.isFetchedAfterMount || pages.isPlaceholderData) return
    setReadPositionsOnArrival(firstPage.readPositions ?? [])
  }, [firstPage, pages.isFetchedAfterMount, pages.isPlaceholderData, readPositionsOnArrival])

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
      .filter((item) => !knownIds.has(item.itemId) && isNewsForViewer(item, user.id))
      .map((item) => item.itemId)
    firstPage.items.forEach((item) => knownIds.add(item.itemId))
    if (newIds.length) setNewFeedItemIds((current) => new Set([...current, ...newIds]))
  }, [firstPage, user])

  useEffect(() => {
    if (
      filter !== 'ALL' ||
      itemType !== 'ALL' ||
      authorId ||
      audienceId ||
      dateFrom ||
      dateTo ||
      mentioned ||
      important
    )
      return
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
        <FeedLoading />
      </>
    )
  }
  if (pages.isError || !firstPage) return <div className="feed-page"><PageHeader title="Жива стрічка" /><FeedPageState kind="error" onAction={() => void pages.refetch()} /></div>
  const hasLegacyFilter =
    filter !== 'ALL' ||
    itemType !== 'ALL' ||
    authorId ||
    audienceId ||
    dateFrom ||
    dateTo ||
    mentioned ||
    important

  return (
    <div className="feed-page">
      <PageHeader
        title="Жива стрічка"
        description="Важливі оновлення команди без шуму чатів і дублювання завдань"
        action={
          <Button
            onClick={() => {
              setComposerDirty(false)
              setComposerOpen(true)
            }}
          >
            <Plus size={17} />
            Створити публікацію
          </Button>
        }
      />
      <FeedOverview />
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
            {targetPostId && (targetPost.isLoading ? <FeedLoading /> : targetPost.isError ? <FeedPageState kind="error" onAction={() => void targetPost.refetch()} /> : null)}
            {items.length > 0 ? (
              items.map((item) =>
                item.kind === 'POST' ? (
                  <FeedCard
                    key={item.itemId}
                    viewerId={user.id}
                    item={item}
                    loadedAt={item.id === targetPost.data?.id ? targetPost.dataUpdatedAt : pages.dataUpdatedAt}
                    isNew={newFeedItemIds.has(item.itemId) || wasUnreadOnArrival(item, user.id, readPositionsOnArrival)}
                    onChanged={() => void queryClient.invalidateQueries({ queryKey: ['feed'] })}
                  />
                ) : (
                  <FeedSourceCard
                    key={item.itemId}
                    item={item}
                    isNew={newFeedItemIds.has(item.itemId) || wasUnreadOnArrival(item, user.id, readPositionsOnArrival)}
                    onChanged={() => void queryClient.invalidateQueries({ queryKey: ['feed'] })}
                  />
                ),
              )
            ) : (
              <FeedPageState kind={hasLegacyFilter ? 'filtered' : 'empty'} onAction={() => {
                if (hasLegacyFilter) clearAllFilters()
                else { setComposerDirty(false); setComposerOpen(true) }
              }} />
            )}
          </section>
          <div className="stream-pagination">{pages.hasNextPage ? (
            <Button
              variant="secondary"
              className="feed-load-more"
              disabled={pages.isFetchingNextPage}
              onClick={() => void pages.fetchNextPage()}
            >
              {pages.isFetchingNextPage && <LoaderCircle size={15} className="stream-spin" />}
              {pages.isFetchingNextPage ? 'Завантаження…' : 'Показати давніші публікації'}
            </Button>
          ) : items.length > 0 ? <p>Ви переглянули всі оновлення</p> : null}
          {pages.isFetchNextPageError && <p role="alert">Не вдалося завантажити давніші записи. Спробуйте ще раз.</p>}
          </div>
        </div>

        <aside className="feed-attention" aria-label="Потребує уваги">
          <Card className="feed-attention__actions">
            <span className="eyebrow">
              <Sparkles size={14} /> Потребує уваги
            </span>
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
              <p className="feed-attention__clear">
                <Check size={16} /> Термінових дій немає.
              </p>
            )}
          </Card>
          {!hasLegacyFilter && <FeedBirthdayHighlight birthdays={firstPage.birthdays} />}
        </aside>
      </div>
      {composerOpen && (
        <Modal
          title="Створити публікацію"
          size="xl"
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
            onPostCreated={() =>
              composerCloseGuard.closeForSuccess(() => {
                setComposerDirty(false)
                setComposerOpen(false)
              })
            }
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

export function needsAcknowledgement(item: FeedPostView | FeedSourceView): boolean {
  return item.kind === 'POST'
    ? item.acknowledgementRequiredForMe && !item.hasAcknowledged
    : item.sourceType === 'EVENT' && Boolean(item.eventAcknowledgement?.requiredForMe && !item.eventAcknowledgement.acknowledgedAt)
}

const readCardState: FeedCardViewState = {
  mode: 'read', menuOpen: false, commentsOpen: false, replyTo: null,
  comment: '', sending: false, liking: false, notice: '',
}

const renderFeedPerson: FeedPersonRenderer = (person, children, className, label) => person.id ? (
  <UserProfileLink userId={person.id} className={className} aria-label={label}>{children}</UserProfileLink>
) : <span className={className}>{children}</span>

export function FeedSourceCard({ item, isNew, onChanged }: { item: FeedSourceView; isNew: boolean; onChanged: () => void }) {
  const editorId = useId()
  const queryClient = useQueryClient()
  const pin = useMutation({
    mutationFn: () => api(`/feed/${item.sourceType === 'EVENT' ? 'events' : 'tasks'}/${encodeURIComponent(item.id)}/pin`, { method: item.pinnedByMe ? 'DELETE' : 'POST' }),
    onSuccess: onChanged,
  })
  const acknowledgeEvent = useMutation({
    mutationFn: () => api('/calendar/events/' + encodeURIComponent(item.id) + '/acknowledge', {
      method: 'POST', body: jsonBody({ expectedVersion: item.eventVersion }),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendar-event'] }),
        queryClient.invalidateQueries({ queryKey: ['feed'] }),
      ])
      onChanged()
    },
  })
  if (item.sourceType === 'FILE') return null
  const metadata: FeedCardModel['metadata'] = item.metadata
    .filter((entry) => item.sourceType !== 'EVENT' || entry === 'Увесь день')
    .map((entry) => {
      const separator = entry.indexOf(':')
      const label = separator < 0 ? 'Тривалість' : entry.slice(0, separator)
      const value = personNamesInLabel(separator < 0 ? entry : entry.slice(separator + 1).trim())
      const person = label === 'Постановник' ? item.taskReporter : label === 'Відповідальний' ? item.taskAssignee : null
      return { label, value, ...(person ? { person: { ...person, displayName: personName(person.displayName) } } : {}) }
    })
  const acknowledgement = item.eventAcknowledgement
  if (item.sourceType === 'EVENT' && item.summary) metadata.unshift({ label: 'Дата і час', value: item.summary })
  const model: FeedCardModel = {
    kind: item.sourceType, title: item.title, body: '',
    canPin: true, pinned: item.pinnedByMe, pinning: pin.isPending,
    date: formatDateTime(item.occurredAt), dateTime: item.occurredAt, audience: '',
    href: item.href, metadata, changes: item.taskChanges, historical: item.historical, isNew,
    author: item.sourceType === 'EVENT' && item.actor ? { ...item.actor, displayName: personName(item.actor.displayName) } : undefined,
    acknowledgement: acknowledgement && (acknowledgement.requiredForMe || acknowledgement.acknowledgedAt)
      ? { state: acknowledgement.acknowledgedAt ? 'done' : acknowledgeEvent.isPending ? 'loading' : acknowledgeEvent.isError ? 'error' : 'pending' }
      : undefined,
  }
  return <FeedCardDesign item={model} state={readCardState} editorId={editorId} headingLevel="h2"
    renderPerson={renderFeedPerson} onReply={() => {}} onFile={() => {}}
    onAction={(action) => {
      if (action === 'pin' && !pin.isPending) pin.mutate()
      if (action === 'acknowledge' && needsAcknowledgement(item) && !acknowledgeEvent.isPending) acknowledgeEvent.mutate()
    }}
    error={pin.isError ? 'Не вдалося змінити закріплення. Спробуйте ще раз.' : undefined}
  />
}

function isOwnFeedItem(item: FeedPostView | FeedSourceView, userId: string): boolean {
  return item.kind === 'POST' ? item.author.id === userId : item.actor?.id === userId
}

/** A task update the viewer has already read, for example in an open task, is not news. */
export function isNewsForViewer(item: FeedPostView | FeedSourceView, userId: string): boolean {
  if (isOwnFeedItem(item, userId)) return false
  if (item.kind === 'SOURCE' && item.sourceType === 'TASK') return Object.values(item.taskChanges ?? {}).some(Boolean)
  return true
}

/** Was this card unread when the person arrived? A first visit marks nothing: everything would be new. */
export function wasUnreadOnArrival(
  item: FeedPostView | FeedSourceView,
  userId: string | undefined,
  readPositions: FeedListResult['readPositions'] | null,
): boolean {
  const lastReadAt = readPositions?.find((position) => position.companyId === item.companyId)?.lastReadAt
  if (!lastReadAt || !userId) return false
  if (item.kind === 'SOURCE' && item.historical) return false
  const occurredAt = item.kind === 'POST' ? item.editedAt ?? item.publishedAt : item.occurredAt
  return Date.parse(occurredAt) > Date.parse(lastReadAt) && isNewsForViewer(item, userId)
}

export function FeedCard({ item, isNew, onChanged, loadedAt, viewerId }: { item: FeedPostView; isNew: boolean; onChanged: () => void; loadedAt: number; viewerId?: string }) {
  const notificationReadRef = useEntityNotificationRead('FEED_POST', item.id, loadedAt, true)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comment, setComment] = useState('')
  const commentPhotos = useFeedCommentPhotos(item.id)
  const photoInput = useRef<HTMLInputElement>(null)
  const [commentMentions, setCommentMentions] = useState<StructuredMentionInput[]>([])
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const editPhotoInput = useRef<HTMLInputElement>(null)
  const existingPhotoCount = item.attachments.filter((file) => FEED_PHOTO_MIME_TYPES.some((mime) => mime === file.mimeType)).length
  const editPhotoLimit = Math.max(0, Math.min(FEED_COMMENT_PHOTO_LIMIT - existingPhotoCount, 10 - item.attachments.length))
  const editPhotos = useFeedCommentPhotos(item.id, {
    uploadUrl: '/feed/attachments?company=' + encodeURIComponent(item.companyId), limit: editPhotoLimit,
  })
  const [editBody, setEditBody] = useState(item.body)
  const [editMentions, setEditMentions] = useState<StructuredMentionInput[]>(() =>
    editableMentions(item.body, item.mentions),
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const pin = useMutation({
    mutationFn: () => api(`/feed/posts/${encodeURIComponent(item.id)}/pin`, { method: item.pinnedByMe ? 'DELETE' : 'POST' }),
    onSuccess: onChanged,
  })
  const like = useMutation({
    mutationFn: () => api(`/feed/${item.id}/reactions/like`, { method: 'POST' }),
    onSuccess: onChanged,
  })
  const acknowledge = useMutation({
    mutationFn: () =>
      api(`/feed/${item.id}/acknowledge`, {
        method: 'POST',
        body: jsonBody({ acknowledgementVersion: item.acknowledgementVersion }),
      }),
    onSuccess: onChanged,
  })
  const addComment = useMutation({
    mutationFn: (value: { body: string; mentions: StructuredMentionInput[]; replyToCommentId: string | null; attachmentIds: string[] }) => api(`/feed/${item.id}/comments`, {
      method: 'POST', body: jsonBody(value),
    }),
    onSuccess: () => {
      setComment('')
      setCommentMentions([])
      setReplyTo(null)
      commentPhotos.clear()
      setCommentsOpen(true)
      onChanged()
    },
  })
  const update = useMutation({
    mutationFn: () => {
      const value = trimMentionValue(editBody, editMentions)
      return api(`/feed/${item.id}`, {
        method: 'PATCH',
        body: jsonBody({ ...value, expectedVersion: item.version,
          ...(editPhotos.photos.length ? { attachmentIds: editPhotos.photos.map((photo) => photo.attachment.id) } : {}),
        }),
      })
    },
    onSuccess: () => {
      setEditing(false)
      editPhotos.clear()
      setMenuOpen(false)
      onChanged()
    },
  })
  const archive = useMutation({
    mutationFn: () =>
      api(`/feed/${item.id}`, {
        method: 'DELETE',
        body: jsonBody({ expectedVersion: item.version }),
      }),
    onSuccess: onChanged,
  })
  function submitComment(event: FormEvent) {
    event.preventDefault()
    if (!addComment.isPending && !commentPhotos.uploading && (comment.trim() || commentPhotos.photos.length)) {
      addComment.mutate({
        ...trimMentionValue(comment, commentMentions), replyToCommentId: replyTo,
        attachmentIds: commentPhotos.photos.map((photo) => photo.attachment.id),
      })
    }
  }

  function startEditing() {
    editPhotos.clear()
    setEditBody(item.body)
    setEditMentions(editableMentions(item.body, item.mentions))
    setEditing(true)
    setMenuOpen(false)
  }

  function cancelEditing() {
    editPhotos.clear()
    setEditing(false)
    setEditBody(item.body)
    setEditMentions(editableMentions(item.body, item.mentions))
  }

  const editorId = useId()
  const reply = item.comments.find((entry) => entry.id === replyTo)
  const model: FeedCardModel = {
    kind: 'POST', author: { ...item.author, displayName: personName(item.author.displayName) },
    date: formatDateTime(item.publishedAt), dateTime: item.publishedAt,
    audience: personNamesInLabel(item.audienceLabel), body: editing ? editBody : item.body,
    mentions: item.mentions, attachments: item.attachments, photoLayout: item.photoLayout,
    comments: item.comments.map((entry) => ({ ...entry, author: { ...entry.author, displayName: personName(entry.author.displayName) } })),
    commentCount: item.commentCount, likes: item.likeCount, liked: item.likedByMe,
    canManage: item.canEdit, canPin: true, pinned: item.pinnedByMe, pinning: pin.isPending, isNew, edited: Boolean(item.editedAt),
    acknowledgement: !item.requiresAcknowledgement ? undefined
      : item.author.id === viewerId
        ? { state: 'summary', acknowledgedCount: item.acknowledgementCount, recipientCount: item.acknowledgementRecipientCount }
        : item.acknowledgementRequiredForMe || item.hasAcknowledged
          ? { state: item.hasAcknowledged ? 'done' : acknowledge.isPending ? 'loading' : acknowledge.isError ? 'error' : 'pending' }
          : undefined,
  }
  const state: FeedCardViewState = {
    ...readCardState, commentsOpen, menuOpen, replyTo, comment,
    sending: addComment.isPending, liking: like.isPending,
    mode: update.isPending || (editing && editPhotos.uploading) ? 'saving' : editing ? 'edit' : archive.isPending ? 'archiving' : confirmArchive ? 'archive' : 'read',
  }
  return <FeedCardDesign item={model} state={state} editorId={editorId} headingLevel="h2"
    headerRef={notificationReadRef} renderPerson={renderFeedPerson}
    renderAttachment={(attachment) => <FeedAttachment attachment={attachment} photoPreview />}
    renderInlinePhoto={(attachment) => <FeedInlinePhoto attachment={attachment} />}
    renderCommentExtra={(entry) => entry.attachments?.length ? <div className="stream-photo-previews">{entry.attachments.map((attachment) => <FeedAttachment key={attachment.id} attachment={attachment} photoPreview />)}</div> : null}
    onFile={() => {}}
    onReply={(id) => { setReplyTo(id); setComment(''); setCommentMentions([]) }}
    onAction={(action) => {
      if (action === 'pin' && !pin.isPending) { setMenuOpen(false); pin.mutate() }
      if (action === 'like' && !like.isPending) like.mutate()
      if (action === 'comments') setCommentsOpen((value) => !value)
      if (action === 'menu') setMenuOpen((value) => !value)
      if (action === 'edit') startEditing()
      if (action === 'cancel-edit') cancelEditing()
      if (action === 'save' && editBody.trim() && !update.isPending && !editPhotos.uploading) update.mutate()
      if (action === 'archive') { setConfirmArchive(true); setMenuOpen(false) }
      if (action === 'cancel-archive') setConfirmArchive(false)
      if (action === 'confirm-archive' && !archive.isPending) archive.mutate()
      if (action === 'acknowledge' && needsAcknowledgement(item) && !acknowledge.isPending) acknowledge.mutate()
    }}
    editor={<><MentionTextarea formatting label="Текст публікації" value={editBody} mentions={editMentions}
      candidateUrl={'/feed/' + encodeURIComponent(item.id) + '/mention-candidates'} rows={4} maxLength={10000}
      toolbarActions={<button type="button" className="stream-composer__insert-photo" aria-label="Вставити фото" title="Вставити фото · до 5 фото · до 10 МБ"
        disabled={update.isPending || editPhotos.uploading || editPhotos.photos.length >= editPhotoLimit} onClick={() => editPhotoInput.current?.click()}><ImagePlus size={16} /><span>Вставити фото</span></button>}
      onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); if (!update.isPending) void editPhotos.add(files) } }}
      disabled={update.isPending || editPhotos.uploading} onChange={(body, mentions) => { setEditBody(body); setEditMentions(mentions) }} />
      <input ref={editPhotoInput} type="file" hidden multiple accept={FEED_PHOTO_MIME_TYPES.join(',')} aria-label="Фото до публікації"
        disabled={update.isPending || editPhotos.uploading || editPhotos.photos.length >= editPhotoLimit}
        onChange={(event) => { void editPhotos.add(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      {editPhotos.photos.length > 0 && <FeedDraftPhotos photos={editPhotos.photos} onRemove={editPhotos.remove} disabled={update.isPending || editPhotos.uploading} />}
      {editPhotos.error && <p className="stream-photo-error" role="alert">{editPhotos.error}</p>}
    </>}
    commentComposer={<form className={'stream-comment-form' + (reply ? ' is-replying' : '')} onSubmit={submitComment}>
      {reply && <div className="stream-reply-to"><div><span>У відповідь <strong>{personName(reply.author.displayName)}</strong></span><p>{reply.body}</p></div><IconButton label="Скасувати відповідь" disabled={addComment.isPending} onClick={() => setReplyTo(null)}><X size={13} /></IconButton></div>}
      <MentionTextarea label={reply ? 'Ваша відповідь' : 'Новий коментар'} value={comment} mentions={commentMentions}
        candidateUrl={'/feed/' + encodeURIComponent(item.id) + '/mention-candidates'} rows={2} maxLength={4000}
        disabled={addComment.isPending || commentPhotos.uploading} placeholder="Додайте коментар або вставте скріншот…"
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files)
          if (files.length) { event.preventDefault(); if (!addComment.isPending) void commentPhotos.add(files) }
        }}
        onChange={(body, mentions) => { setComment(body); setCommentMentions(mentions) }} />
      <input ref={photoInput} type="file" hidden multiple accept={FEED_PHOTO_MIME_TYPES.join(',')} aria-label="Фото до коментаря"
        disabled={addComment.isPending || commentPhotos.uploading || commentPhotos.photos.length >= FEED_COMMENT_PHOTO_LIMIT}
        onChange={(event) => { void commentPhotos.add(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      {commentPhotos.photos.length > 0 && <FeedDraftPhotos photos={commentPhotos.photos} onRemove={commentPhotos.remove} disabled={addComment.isPending || commentPhotos.uploading} />}
      {commentPhotos.error && <p className="stream-photo-error" role="alert">{commentPhotos.error}</p>}
      <div className="stream-comment-actions"><Button type="button" variant="secondary" disabled={addComment.isPending || commentPhotos.uploading || commentPhotos.photos.length >= FEED_COMMENT_PHOTO_LIMIT} onClick={() => photoInput.current?.click()}><ImagePlus size={16} />{commentPhotos.uploading ? 'Додаємо фото…' : 'Фото'}</Button><Button disabled={(!comment.trim() && !commentPhotos.photos.length) || addComment.isPending || commentPhotos.uploading}>
        {addComment.isPending ? <LoaderCircle size={15} className="stream-spin" /> : <Send size={15} />}
        {addComment.isPending ? 'Надсилаємо…' : 'Надіслати'}
      </Button></div>
    </form>}
    error={pin.isError ? 'Не вдалося змінити закріплення. Спробуйте ще раз.' : update.isError ? 'Не вдалося зберегти зміни. Оновіть стрічку та спробуйте ще раз.'
      : archive.isError ? 'Не вдалося архівувати публікацію. Спробуйте ще раз.'
        : addComment.isError ? 'Не вдалося надіслати коментар. Спробуйте ще раз.'
          : like.isError ? 'Не вдалося зберегти реакцію. Спробуйте ще раз.' : undefined}
  />
}

export function FeedAttachment({ attachment, photoPreview = false }: { attachment: FeedAttachmentView; photoPreview?: boolean }) {
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
  const isPhoto = photoPreview && scanStatus === 'CLEAN' && FEED_PHOTO_MIME_TYPES.some((mime) => mime === attachment.mimeType)
  return <>
    {isPhoto ? <div className="stream-photo-preview"><button type="button" className="stream-photo-preview__open" aria-label={`Переглянути ${attachment.fileName}`} onClick={() => setPreviewOpen(true)}><FileThumbnail file={{ ...attachment, scanStatus }} /></button><a className="icon-button" aria-label={`Завантажити ${attachment.fileName}`} href={'/api/v1/files/' + encodeURIComponent(attachment.id) + '/download'}><Download size={15} /></a></div>
      : <FeedFileRow file={{ ...attachment, scanStatus }} onPreview={() => setPreviewOpen(true)}
        downloadHref={'/api/v1/files/' + encodeURIComponent(attachment.id) + '/download'} />}
    {previewOpen && scanStatus === 'CLEAN' && <FilePreviewModal file={attachment} onClose={() => setPreviewOpen(false)} />}
  </>
}

function FeedInlinePhoto({ attachment }: { attachment: FeedAttachmentView }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  return <>
    <button type="button" aria-label={`Переглянути ${attachment.fileName}`} disabled={attachment.scanStatus !== 'CLEAN'} onClick={() => setPreviewOpen(true)}><FileThumbnail file={attachment} /></button>
    {previewOpen && <FilePreviewModal file={attachment} onClose={() => setPreviewOpen(false)} />}
  </>
}

function parseFilter(value: string | null): FeedListFilter {
  return value === 'ACK_REQUIRED' || value === 'MINE' ? value : 'ALL'
}

function parseItemType(value: string | null): FeedItemType {
  return value === 'POST' || value === 'TASK' || value === 'EVENT' ? value : 'ALL'
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

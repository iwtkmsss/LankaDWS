import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  FeedAudienceFacetOption,
  FeedAttachmentView,
  FeedAuthorOption,
  FeedItemType,
  FeedListFilter,
  FeedListResult,
  FeedPostView,
  FeedSourceView,
  FeedSubscriptionMode,
} from '@bert-crm/contracts'
import {
  Archive,
  ArrowRight,
  Bell,
  BellOff,
  BellRing,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Heart,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Reply,
  Save,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareCheckBig,
  Star,
  X,
} from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDateTime } from '../shared/lib/format'
import { withCompanyScope } from '../shared/lib/navigation'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Modal,
  PageHeader,
  Skeleton,
  Tabs,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../shared/ui'
import { FeedComposerForm, formatBytes } from './FeedComposerForm'

interface SavedFeedView {
  id: string
  module: string
  name: string
  queryState: string
}

export function FeedPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const paramsRef = useRef(params)
  paramsRef.current = params
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
  const company = user?.company?.id ?? ''
  const filter = parseFilter(params.get('filter'))
  const itemType = parseItemType(params.get('type'))
  const authorId = parseIdParam(params.get('authorId'))
  const groupId = parseIdParam(params.get('groupId'))
  const audienceId = parseIdParam(params.get('audienceId'))
  const dateFrom = parseDateParam(params.get('dateFrom'))
  const dateTo = parseDateParam(params.get('dateTo'))
  const mentioned = params.get('mentioned') === 'true'
  const favorite = params.get('favorite') === 'true'
  const important = params.get('important') === 'true'
  const activeAdvancedCount = Number(Boolean(authorId))
    + Number(Boolean(groupId))
    + Number(Boolean(audienceId))
    + Number(Boolean(dateFrom || dateTo))
    + Number(mentioned)
    + Number(favorite)
    + Number(important)
  const [advancedOpen, setAdvancedOpen] = useState(activeAdvancedCount > 0)
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
      favorite,
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
      if (favorite) query.set('favorite', 'true')
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
  const authors = useQuery({
    queryKey: ['feed-authors', company],
    queryFn: () => api<{ items: FeedAuthorOption[] }>(
      `/feed/authors?company=${encodeURIComponent(company)}`,
    ),
    enabled: Boolean(user),
  })
  const audienceFacets = useQuery({
    queryKey: ['feed-facet-audiences', company],
    queryFn: () => api<{ items: FeedAudienceFacetOption[] }>(
      `/feed/facets/audiences?company=${encodeURIComponent(company)}`,
    ),
    enabled: Boolean(user),
  })
  const savedViews = useQuery({
    queryKey: ['saved-views', 'FEED'],
    queryFn: () => api<SavedFeedView[]>('/saved-views'),
  })
  const markRead = useMutation({
    mutationFn: (markers: FeedListResult['readMarkers']) =>
      api('/feed/read', { method: 'POST', body: jsonBody({ markers }) }),
  })
  const firstPage = pages.data?.pages[0]
  const items = pages.data?.pages.flatMap((page) => page.items) ?? []

  useEffect(() => {
    document.title = 'Жива стрічка — BERT CRM'
  }, [])

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
      || favorite
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
    favorite,
    filter,
    firstPage?.readMarkers,
    groupId,
    important,
    itemType,
    markRead,
    mentioned,
  ])

  function updateSearchParams(update: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(paramsRef.current)
    update(next)
    paramsRef.current = next
    setParams(next, { flushSync: true })
  }

  function selectFilter(value: string) {
    updateSearchParams((next) => {
      if (value === 'ALL') next.delete('filter')
      else next.set('filter', value)
      if (value === 'FOLLOWING') next.set('type', 'POST')
    })
  }

  function selectItemType(value: string) {
    updateSearchParams((next) => {
      if (value === 'ALL') next.delete('type')
      else next.set('type', value)
      if (filter === 'FOLLOWING' && value !== 'POST') next.delete('filter')
    })
  }

  function selectAuthor(value: string) {
    updateSearchParams((next) => {
      if (value) next.set('authorId', value)
      else next.delete('authorId')
    })
  }

  function selectGroup(value: string) {
    updateSearchParams((next) => {
      if (value) next.set('groupId', value)
      else next.delete('groupId')
    })
  }

  function selectAudience(value: string) {
    updateSearchParams((next) => {
      if (value) next.set('audienceId', value)
      else next.delete('audienceId')
    })
  }

  function selectDateFrom(value: string) {
    updateSearchParams((next) => {
      if (value) next.set('dateFrom', value)
      else next.delete('dateFrom')
      const currentTo = parseDateParam(next.get('dateTo'))
      if (value && currentTo && currentTo < value) next.set('dateTo', value)
    })
  }

  function selectDateTo(value: string) {
    updateSearchParams((next) => {
      if (value) next.set('dateTo', value)
      else next.delete('dateTo')
      const currentFrom = parseDateParam(next.get('dateFrom'))
      if (value && currentFrom && currentFrom > value) next.set('dateFrom', value)
    })
  }

  function selectMentioned(value: boolean) {
    updateSearchParams((next) => {
      if (value) next.set('mentioned', 'true')
      else next.delete('mentioned')
    })
  }

  function selectFavorite(value: boolean) {
    updateSearchParams((next) => {
      if (value) next.set('favorite', 'true')
      else next.delete('favorite')
    })
  }

  function selectImportant(value: boolean) {
    updateSearchParams((next) => {
      if (value) next.set('important', 'true')
      else next.delete('important')
    })
  }

  function clearAdvancedFilters() {
    updateSearchParams((next) => {
      next.delete('authorId')
      next.delete('groupId')
      next.delete('audienceId')
      next.delete('dateFrom')
      next.delete('dateTo')
      next.delete('mentioned')
      next.delete('favorite')
      next.delete('important')
    })
  }

  function clearAllFilters() {
    updateSearchParams((next) => {
      for (const key of [
        'filter',
        'type',
        'authorId',
        'groupId',
        'audienceId',
        'dateFrom',
        'dateTo',
        'mentioned',
        'favorite',
        'important',
      ]) {
        next.delete(key)
      }
    })
  }

  function applySavedView(id: string) {
    const view = savedViews.data?.find((item) => item.id === id)
    if (!view) return
    try {
      const state = JSON.parse(view.queryState) as {
        filter?: string
        type?: string
        authorId?: string
        groupId?: string
        audienceId?: string
        dateFrom?: string
        dateTo?: string
        mentioned?: boolean
        favorite?: boolean
        important?: boolean
      }
      const nextFilter = parseFilter(state.filter ?? null)
      const nextType = parseItemType(state.type ?? null)
      const nextAuthorId = parseIdParam(state.authorId ?? null)
      const nextGroupId = parseIdParam(state.groupId ?? null)
      const nextAudienceId = parseIdParam(state.audienceId ?? null)
      const parsedDateFrom = parseDateParam(state.dateFrom ?? null)
      const parsedDateTo = parseDateParam(state.dateTo ?? null)
      const validDateRange = !parsedDateFrom || !parsedDateTo || parsedDateFrom <= parsedDateTo
      const nextDateFrom = validDateRange ? parsedDateFrom : ''
      const nextDateTo = validDateRange ? parsedDateTo : ''
      updateSearchParams((next) => {
        if (nextFilter === 'ALL') next.delete('filter')
        else next.set('filter', nextFilter)
        if (nextType === 'ALL') next.delete('type')
        else next.set('type', nextType)
        if (nextAuthorId) next.set('authorId', nextAuthorId)
        else next.delete('authorId')
        if (nextGroupId) next.set('groupId', nextGroupId)
        else next.delete('groupId')
        if (nextAudienceId) next.set('audienceId', nextAudienceId)
        else next.delete('audienceId')
        if (nextDateFrom) next.set('dateFrom', nextDateFrom)
        else next.delete('dateFrom')
        if (nextDateTo) next.set('dateTo', nextDateTo)
        else next.delete('dateTo')
        if (state.mentioned === true) next.set('mentioned', 'true')
        else next.delete('mentioned')
        if (state.favorite === true) next.set('favorite', 'true')
        else next.delete('favorite')
        if (state.important === true) next.set('important', 'true')
        else next.delete('important')
      })
      setAdvancedOpen(Boolean(
        nextAuthorId
        || nextGroupId
        || nextAudienceId
        || nextDateFrom
        || nextDateTo
        || state.mentioned === true
        || state.favorite === true
        || state.important === true,
      ))
    } catch {
      // Invalid legacy saved state is ignored rather than breaking the feed.
    }
  }

  if (pages.isLoading || !user) {
    return (
      <>
        <PageHeader title="Жива стрічка" />
        <Skeleton rows={7} />
      </>
    )
  }
  if (pages.isError || !firstPage) return <ErrorState onRetry={() => void pages.refetch()} />
  const feedSavedViews = savedViews.data?.filter((item) => item.module === 'FEED') ?? []
  const authorOptions = authors.data?.items ?? []
  const selectedAuthor = authorOptions.find((author) => author.id === authorId)
  const facetOptions = audienceFacets.data?.items ?? []
  const groupOptions = facetOptions.filter((option) => option.type === 'GROUP')
  const recipientOptions = facetOptions.filter((option) => option.type !== 'GROUP')
  const selectedGroup = groupOptions.find((option) => option.id === groupId)
  const selectedAudience = recipientOptions.find((option) => option.id === audienceId)
  const hasAnyFilter = filter !== 'ALL'
    || itemType !== 'ALL'
    || activeAdvancedCount > 0

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
            Створити публікацію
          </Button>
        )}
      />
      <div className="feed-layout">
        <div className="feed-main">
          <section className="feed-toolbar" aria-label="Фільтри стрічки">
            <Tabs
              value={filter}
              items={[
                { value: 'ALL', label: 'Усі' },
                {
                  value: 'ACK_REQUIRED',
                  label: 'До підтвердження',
                  count: firstPage.attention.pendingAcknowledgements,
                },
                { value: 'MINE', label: 'Мої' },
                { value: 'FOLLOWING', label: 'Стежу' },
              ]}
              onChange={selectFilter}
            />
            <label className="feed-type-filter">
              <span className="sr-only">Тип події</span>
              <select value={itemType} onChange={(event) => selectItemType(event.target.value)}>
                <option value="ALL">Усі типи</option>
                <option value="POST">Публікації</option>
                <option value="TASK">Завдання</option>
                <option value="EVENT">Події</option>
                <option value="ANNOUNCEMENT">Оголошення</option>
                <option value="FILE">Файли</option>
              </select>
              <ChevronDown size={14} aria-hidden />
            </label>
            <Button
              type="button"
              variant="ghost"
              className="feed-advanced-toggle"
              aria-expanded={advancedOpen}
              aria-controls="feed-advanced-filters"
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              <SlidersHorizontal size={15} />
              Фільтри
              {activeAdvancedCount > 0 && <span>{activeAdvancedCount}</span>}
            </Button>
            <div className="feed-saved-filter">
              {feedSavedViews.length > 0 && (
                <label>
                  <span className="sr-only">Збережені фільтри</span>
                  <select defaultValue="" onChange={(event) => applySavedView(event.target.value)}>
                    <option value="" disabled>Збережені фільтри</option>
                    {feedSavedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden />
                </label>
              )}
              {hasAnyFilter && (
                <SaveFilterButton
                  filter={filter}
                  itemType={itemType}
                  authorId={authorId}
                  authorName={selectedAuthor?.displayName ?? null}
                  groupId={groupId}
                  groupName={selectedGroup?.label ?? null}
                  audienceId={audienceId}
                  audienceName={selectedAudience?.label ?? null}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  mentioned={mentioned}
                  favorite={favorite}
                  important={important}
                />
              )}
            </div>
          </section>

          {advancedOpen && (
            <section
              id="feed-advanced-filters"
              className="feed-filter-panel"
              aria-label="Додаткові фільтри стрічки"
            >
              <header>
                <div>
                  <span className="eyebrow">Точніше знайти оновлення</span>
                  <h2>Додаткові фільтри</h2>
                </div>
                <IconButton label="Закрити додаткові фільтри" onClick={() => setAdvancedOpen(false)}>
                  <X size={17} />
                </IconButton>
              </header>
              <div className="feed-filter-panel__fields">
                <label>
                  <span>Кому адресовано</span>
                  <select value={audienceId} onChange={(event) => selectAudience(event.target.value)}>
                    <option value="">Усі аудиторії</option>
                    {audienceId && !selectedAudience && (
                      <option value={audienceId}>Аудиторія зі збереженого фільтра</option>
                    )}
                    {recipientOptions.map((option) => (
                      <option key={`${option.type}:${option.id}`} value={option.id}>
                        {option.type === 'COMPANY' ? `Вся організація · ${option.label}` : option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Робоча група</span>
                  <select value={groupId} onChange={(event) => selectGroup(event.target.value)}>
                    <option value="">Усі групи</option>
                    {groupId && !selectedGroup && (
                      <option value={groupId}>Група зі збереженого фільтра</option>
                    )}
                    {groupOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Автор</span>
                  <select value={authorId} onChange={(event) => selectAuthor(event.target.value)}>
                    <option value="">Усі автори</option>
                    {authorId && !selectedAuthor && (
                      <option value={authorId}>Автор зі збереженого фільтра</option>
                    )}
                    {authorOptions.map((author) => (
                      <option key={author.id} value={author.id}>{author.displayName}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Від дати</span>
                  <input
                    type="date"
                    value={dateFrom}
                    max={dateTo || undefined}
                    onChange={(event) => selectDateFrom(event.target.value)}
                  />
                </label>
                <label>
                  <span>До дати</span>
                  <input
                    type="date"
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={(event) => selectDateTo(event.target.value)}
                  />
                </label>
                <label className="feed-checkbox-filter">
                  <input
                    type="checkbox"
                    checked={mentioned}
                    onChange={(event) => selectMentioned(event.target.checked)}
                  />
                  <span>
                    <strong>Мене згадали</strong>
                    <small>Лише публікації з вашою прямою згадкою</small>
                  </span>
                </label>
                <label className="feed-checkbox-filter feed-checkbox-filter--wide">
                  <input
                    type="checkbox"
                    checked={favorite}
                    onChange={(event) => selectFavorite(event.target.checked)}
                  />
                  <span>
                    <strong>Лише обране</strong>
                    <small>Картки, які ви зберегли для швидкого повернення</small>
                  </span>
                </label>
                <label className="feed-checkbox-filter feed-checkbox-filter--wide">
                  <input
                    type="checkbox"
                    checked={important}
                    onChange={(event) => selectImportant(event.target.checked)}
                  />
                  <span>
                    <strong>Важливі публікації</strong>
                    <small>Усі повідомлення з обов’язковим підтвердженням</small>
                  </span>
                </label>
              </div>
              <footer>
                <span role="status">
                  {activeAdvancedCount > 0
                    ? `Застосовано додаткових фільтрів: ${activeAdvancedCount}`
                    : 'Фільтри застосовуються одразу й зберігаються в адресі сторінки.'}
                </span>
                {activeAdvancedCount > 0 && (
                  <Button type="button" variant="ghost" onClick={clearAdvancedFilters}>
                    Очистити додаткові
                  </Button>
                )}
              </footer>
            </section>
          )}

          <section className="feed-list" aria-label="Оновлення стрічки">
            {items.length > 0 ? items.map((item) => (
              item.kind === 'POST'
                ? (
                    <FeedCard
                      key={item.itemId}
                      item={item}
                      onChanged={() => void queryClient.invalidateQueries({ queryKey: ['feed'] })}
                    />
                  )
                : (
                    <FeedSourceCard
                      key={item.itemId}
                      item={item}
                      onChanged={() => void queryClient.invalidateQueries({ queryKey: ['feed'] })}
                    />
                  )
            )) : (
              <Card>
                <EmptyState
                  title={!hasAnyFilter ? 'Оновлень ще немає' : 'За цим фільтром нічого немає'}
                  description={!hasAnyFilter
                    ? 'Опублікуйте корисне оновлення або створіть завдання для команди.'
                    : 'Спробуйте інший фільтр або поверніться до всіх публікацій.'}
                  action={hasAnyFilter
                    ? <Button variant="secondary" onClick={clearAllFilters}>Показати всі</Button>
                    : undefined}
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
          <Card>
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
          <p className="feed-unread-note">
            {firstPage.unreadCount > 0
              ? `${firstPage.unreadCount} нових подій позначено прочитаними. Підтвердження важливого завжди виконується окремо.`
              : 'Відкриття стрічки не підтверджує ознайомлення з важливими публікаціями.'}
          </p>
        </aside>
      </div>
      {composerOpen && (
        <Modal
          title="Створити публікацію"
          description="Поділіться важливим оновленням із потрібною аудиторією."
          closeDisabled={composerBusy}
          onRequestClose={composerCloseGuard.requestClose}
        >
          <FeedComposerForm
            company={company}
            canShareFiles
            onBusyChange={setComposerBusy}
            onDirtyChange={setComposerDirty}
            onFeedChanged={() => void queryClient.invalidateQueries({ queryKey: ['feed'] })}
            onPostCreated={() => composerCloseGuard.closeForSuccess(() => {
              setComposerDirty(false)
              setComposerOpen(false)
            })}
            onNavigate={(path) => {
              navigate(withCompanyScope(path, company))
            }}
          />
        </Modal>
      )}
      <UnsavedChangesDialog guard={composerCloseGuard} />
    </div>
  )
}

function FeedSourceCard({
  item,
  onChanged,
}: {
  item: FeedSourceView
  onChanged: () => void
}) {
  const [confirmRevoke, setConfirmRevoke] = useState(false)
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
        ? 'Завантажити'
        : 'Відкрити оголошення'
  return (
    <Card className={`feed-source-card feed-source-card--${item.sourceType.toLowerCase()}`}>
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
          {item.actor && <span>{item.actor.displayName}</span>}
        </div>
      </div>
      <div className="feed-source-card__actions">
        <FavoriteButton
          itemId={item.itemId}
          favorited={item.favoritedByMe}
          onChanged={onChanged}
        />
        {item.sourceType === 'FILE'
          ? item.actionState === 'AVAILABLE'
            ? (
                <a className="feed-source-card__action" href={item.href}>
                  <Download size={15} /> {actionLabel}
                </a>
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
    </Card>
  )
}

function FavoriteButton({
  itemId,
  favorited,
  onChanged,
}: {
  itemId: string
  favorited: boolean
  onChanged: () => void
}) {
  const favorite = useMutation({
    mutationFn: () => api(`/feed/items/${itemId}/favorite`, {
      method: favorited ? 'DELETE' : 'PUT',
    }),
    onSuccess: onChanged,
  })
  const label = favorited ? 'Прибрати з обраного' : 'Додати в обране'
  return (
    <button
      type="button"
      className={`feed-favorite-button ${favorited ? 'is-active' : ''}`}
      aria-label={label}
      aria-pressed={favorited}
      title={label}
      disabled={favorite.isPending}
      onClick={() => favorite.mutate()}
    >
      <Star size={17} fill={favorited ? 'currentColor' : 'none'} />
    </button>
  )
}

function FeedCard({ item, onChanged }: { item: FeedPostView; onChanged: () => void }) {
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(item.body)
  const [menuOpen, setMenuOpen] = useState(false)
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)
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
    mutationFn: () => api(`/feed/${item.id}/comments`, {
      method: 'POST',
      body: jsonBody({ body: comment, replyToCommentId: replyTo }),
    }),
    onSuccess: () => {
      setComment('')
      setReplyTo(null)
      setCommentsOpen(true)
      onChanged()
    },
  })
  const update = useMutation({
    mutationFn: () => api(`/feed/${item.id}`, {
      method: 'PATCH',
      body: jsonBody({ body: editBody, expectedVersion: item.version }),
    }),
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
  const subscription = useMutation({
    mutationFn: (notificationMode: FeedSubscriptionMode) => api(`/feed/${item.id}/subscription`, {
      method: 'PUT',
      body: jsonBody({ notificationMode }),
    }),
    onSuccess: () => {
      setSubscriptionOpen(false)
      onChanged()
    },
  })
  const SubscriptionIcon = item.subscriptionMode === 'ALL'
    ? BellRing
    : item.subscriptionMode === 'MENTIONS'
      ? Bell
      : BellOff

  function submitComment(event: FormEvent) {
    event.preventDefault()
    if (comment.trim()) addComment.mutate()
  }

  return (
    <Card className="feed-card">
      <header className="feed-card__header">
        <Avatar name={item.author.displayName} src={item.author.avatarAsset} />
        <div>
          <strong>{item.author.displayName}</strong>
          <span>{item.audienceLabel} · <time dateTime={item.publishedAt}>{formatDateTime(item.publishedAt)}</time></span>
        </div>
        <div className="feed-card__header-actions">
          <FavoriteButton
            itemId={item.itemId}
            favorited={item.favoritedByMe}
            onChanged={onChanged}
          />
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
                  <button role="menuitem" onClick={() => { setEditing(true); setMenuOpen(false) }}>
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
          <label>
            <span>Текст публікації</span>
            <textarea value={editBody} rows={4} maxLength={10_000} onChange={(event) => setEditBody(event.target.value)} />
          </label>
          <div>
            <Button type="button" variant="secondary" onClick={() => { setEditing(false); setEditBody(item.body) }}>Скасувати</Button>
            <Button disabled={!editBody.trim() || update.isPending}>Зберегти зміни</Button>
          </div>
        </form>
      ) : (
        <div className="feed-card__body">{item.body}</div>
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
        <div className="feed-subscription">
          <button
            className={item.subscriptionMode !== 'NONE' ? 'is-active' : ''}
            aria-expanded={subscriptionOpen}
            aria-haspopup="menu"
            onClick={() => setSubscriptionOpen((value) => !value)}
          >
            <SubscriptionIcon size={17} />
            {subscriptionModeLabel(item.subscriptionMode)}
          </button>
          {subscriptionOpen && (
            <div role="menu" aria-label="Сповіщення про цю публікацію">
              {([
                ['ALL', 'Усі нові коментарі', BellRing],
                ['MENTIONS', 'Лише згадки', Bell],
                ['NONE', 'Без сповіщень', BellOff],
              ] as const).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  role="menuitemradio"
                  aria-checked={item.subscriptionMode === mode}
                  disabled={subscription.isPending}
                  onClick={() => subscription.mutate(mode)}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                  {item.subscriptionMode === mode && <Check size={14} aria-hidden />}
                </button>
              ))}
            </div>
          )}
        </div>
        {item.editedAt && <small>Змінено {formatDateTime(item.editedAt)}</small>}
      </footer>

      {commentsOpen && (
        <section className="feed-comments" aria-label="Коментарі до публікації">
          {item.comments.length > 0 && (
            <div className="feed-comments__list">
              {item.comments.map((entry) => (
                <article key={entry.id} className={entry.replyToCommentId ? 'is-reply' : ''}>
                  <Avatar name={entry.author.displayName} src={entry.author.avatarAsset} size="sm" />
                  <div>
                    <header>
                      <strong>{entry.author.displayName}</strong>
                      <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                    </header>
                    <p>{entry.body}</p>
                    {!entry.replyToCommentId && (
                      <button onClick={() => { setReplyTo(entry.id); setComment('') }}>
                        <Reply size={13} /> Відповісти
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          <form onSubmit={submitComment}>
            <label>
              <span>{replyTo ? 'Відповідь на коментар' : 'Новий коментар'}</span>
              <textarea
                value={comment}
                rows={2}
                maxLength={4_000}
                placeholder={replyTo ? 'Напишіть коротку відповідь…' : 'Додайте корисний контекст…'}
                onChange={(event) => setComment(event.target.value)}
              />
            </label>
            <div>
              {replyTo && <Button type="button" variant="ghost" onClick={() => setReplyTo(null)}>Скасувати відповідь</Button>}
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

function FeedAttachment({ attachment }: { attachment: FeedAttachmentView }) {
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
      <a href={`/api/v1/files/${encodeURIComponent(attachment.id)}/download`}>
        <FileText size={17} />
        <span>
          <strong>{attachment.fileName}</strong>
          <small>{formatBytes(attachment.bytes)}</small>
        </span>
        <Download size={15} />
      </a>
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

function SaveFilterButton({
  filter,
  itemType,
  authorId,
  authorName,
  groupId,
  groupName,
  audienceId,
  audienceName,
  dateFrom,
  dateTo,
  mentioned,
  favorite,
  important,
}: {
  filter: FeedListFilter
  itemType: FeedItemType
  authorId: string
  authorName: string | null
  groupId: string
  groupName: string | null
  audienceId: string
  audienceName: string | null
  dateFrom: string
  dateTo: string
  mentioned: boolean
  favorite: boolean
  important: boolean
}) {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: () => api('/saved-views', {
      method: 'POST',
      body: jsonBody({
        module: 'FEED',
        name: savedViewName({
          filter,
          itemType,
          authorName: authorName ?? (authorId ? 'Автор' : null),
          groupName: groupName ?? (groupId ? 'Робоча група' : null),
          audienceName: audienceName ?? (audienceId ? 'Аудиторія' : null),
          dateFrom,
          dateTo,
          mentioned,
          favorite,
          important,
        }),
        queryState: {
          filter,
          type: itemType,
          ...(authorId ? { authorId } : {}),
          ...(groupId ? { groupId } : {}),
          ...(audienceId ? { audienceId } : {}),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
          ...(mentioned ? { mentioned: true } : {}),
          ...(favorite ? { favorite: true } : {}),
          ...(important ? { important: true } : {}),
        },
      }),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved-views', 'FEED'] }),
  })
  return (
    <Button variant="ghost" disabled={save.isPending || save.isSuccess} onClick={() => save.mutate()}>
      {save.isSuccess ? <Check size={15} /> : <Save size={15} />}
      {save.isSuccess ? 'Збережено' : 'Зберегти фільтр'}
    </Button>
  )
}

function parseFilter(value: string | null): FeedListFilter {
  return value === 'ACK_REQUIRED' || value === 'MINE' || value === 'FOLLOWING' ? value : 'ALL'
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

function savedViewName({
  filter,
  itemType,
  authorName,
  groupName,
  audienceName,
  dateFrom,
  dateTo,
  mentioned,
  favorite,
  important,
}: {
  filter: FeedListFilter
  itemType: FeedItemType
  authorName: string | null
  groupName: string | null
  audienceName: string | null
  dateFrom: string
  dateTo: string
  mentioned: boolean
  favorite: boolean
  important: boolean
}): string {
  const parts: string[] = []
  if (filter === 'ACK_REQUIRED') parts.push('До підтвердження')
  else if (filter === 'MINE') parts.push('Мої')
  else if (filter === 'FOLLOWING') parts.push('Стежу')
  else parts.push(itemType === 'ALL' ? 'Стрічка' : itemTypeLabel(itemType))
  if (filter !== 'ALL' && itemType !== 'ALL' && !(filter === 'FOLLOWING' && itemType === 'POST')) {
    parts.push(itemTypeLabel(itemType))
  }
  if (favorite) parts.push('Обране')
  if (important) parts.push('Важливі')
  if (mentioned) parts.push('Згадки')
  if (audienceName) parts.push(audienceName)
  if (groupName) parts.push(groupName)
  if (authorName) parts.push(authorName)
  if (dateFrom || dateTo) {
    parts.push(dateFrom && dateTo
      ? `${shortDate(dateFrom)}–${shortDate(dateTo)}`
      : dateFrom
        ? `від ${shortDate(dateFrom)}`
        : `до ${shortDate(dateTo)}`)
  }
  return parts.join(' · ').slice(0, 80)
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00.000Z`))
}

function itemTypeLabel(value: FeedItemType): string {
  return ({
    ALL: 'Усі типи',
    POST: 'Публікації',
    TASK: 'Завдання',
    EVENT: 'Події',
    ANNOUNCEMENT: 'Оголошення',
    FILE: 'Файли',
  } as const)[value]
}

function attachmentStateLabel(status: FeedAttachmentView['scanStatus']): string {
  if (status === 'INFECTED') return 'Файл заблоковано'
  if (status === 'UNSUPPORTED') return 'Формат не підтримується'
  if (status === 'FAILED') return 'Не вдалося перевірити'
  return 'Перевіряється перед завантаженням'
}

function subscriptionModeLabel(mode: FeedSubscriptionMode): string {
  if (mode === 'ALL') return 'Стежу'
  if (mode === 'MENTIONS') return 'Лише згадки'
  return 'Стежити'
}

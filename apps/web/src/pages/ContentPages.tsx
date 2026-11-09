import { FileFormatIcon } from '../shared/files/FileFormatIcon'
import { personName } from '../shared/lib/personName'
import './knowledge-reading.css'
import './knowledge-library.css'
import { KnowledgeFeedbackTickets } from './KnowledgeFeedbackTickets'
import { FormattedText } from '../shared/text/FormattedText'
import { FormattedTextarea } from '../shared/text/FormattedTextarea'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BookOpenCheck, Building2, Check, ChevronRight, Download, Eye, MessageCircle, Network, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { api, apiUrl, jsonBody, randomId } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { UserSearchCombobox } from '../features/employees/UserSearchCombobox'
import { CursorPager, useCursorPages } from '../features/organization/CursorPager'
import { FileDropzone } from '../shared/files/FileDropzone'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import {
  Avatar,
  Button,
  Card,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  Modal,
  PageDataLoader,
  PageHeader,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../shared/ui'

interface ArticleList { id: string; slug: string; title: string; changeSummary: string; reviewAt: string | null; version: number; createdAt: string; requiresAcknowledgement: boolean; hasAcknowledged: boolean; updatedAt: string; imageFileId?: string | null }
interface KnowledgeAttachment { id: string; safeFilename: string; bytes: number; mimeType: string | null; scanStatus: string }
interface ArticleDetail { id: string; slug: string; version: number; createdAt: string; requiresAcknowledgement: boolean; reviewAt?: string | null; currentVersion: { title: string; body: string; changeSummary: string; publishedAt: string } | null; acknowledgement: { confirmedAt?: string | null } | null; attachments: KnowledgeAttachment[]; companyIds: string[] }
interface KnowledgeCompanyOption { id: string; name: string; isActive: boolean }
interface Employee {
  id: string
  displayName: string
  jobTitle: string
  positionTitle?: string
  timezone: string
  avatarAsset: string | null
  presence: string
  contactEmail?: string | null
  orgUnit?: { id: string; name: string; parent: { id: string; name: string } | null } | null
  manager?: { id: string; displayName: string } | null
  approver?: { id?: string; displayName: string } | null
  upcomingPresence?: Array<{ state: string; startAt: string; endAt: string }>
}
interface EmployeeDirectory {
  items: Employee[]
  total: number
  nextCursor: string | null
  counts: { all: number; available: number; away: number }
  filters: {
    orgUnits: Array<{ id: string; name: string }>
    managers: Array<{ id: string; displayName: string }>
  }
}
export default function ContentPages() {
  const path = useLocation().pathname
  if (path.startsWith('/knowledge')) return <KnowledgePage />
  if (path.startsWith('/employees')) return <EmployeesPage />
  return null
}


type ReadingFilter = 'all' | 'unread' | 'read'
const readingFilters: Array<{ value: ReadingFilter; label: string }> = [
  { value: 'all', label: 'Усі' },
  { value: 'unread', label: 'До ознайомлення' },
  { value: 'read', label: 'Ознайомлені' },
]
const ukrainianPlural = new Intl.PluralRules('uk')
function plural(count: number, one: string, few: string, many: string) {
  const rule = ukrainianPlural.select(count)
  return rule === 'one' ? one : rule === 'few' ? few : many
}
const isPendingRequired = (item: ArticleList) => item.requiresAcknowledgement && !item.hasAcknowledged
const articleListQuery = (search: string, enabled: boolean) => ({
  queryKey: ['knowledge', 'articles', search],
  queryFn: () => api<{ items: ArticleList[] }>(`/knowledge/articles?search=${encodeURIComponent(search)}`),
  enabled,
  staleTime: 0,
  refetchOnMount: 'always' as const,
})

function KnowledgePage() {
  const { articleSlug } = useParams()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const search = (params.get('q') ?? '').trim()
  const [searchInput, setSearchInput] = useState(search)
  const statusParam = params.get('status')
  const filter: ReadingFilter = statusParam === 'unread' || statusParam === 'read' ? statusParam : 'all'
  const [deleting, setDeleting] = useState<ArticleList | null>(null)
  const client = useQueryClient()
  const canManage = user?.accountType === 'ADMIN'
  const managing = canManage && params.get('manage') === '1'
  const editor = managing ? params.get('edit') : null
  const updateParams = (change: (next: URLSearchParams) => void, replace = false) => setParams((previous) => {
    const next = new URLSearchParams(previous)
    change(next)
    return next
  }, { replace })
  // The URL keeps the search, so returning from an article restores the same list.
  useEffect(() => {
    const pending = searchInput.trim()
    if (pending === search) return
    const timer = window.setTimeout(() => setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (pending) next.set('q', pending)
      else next.delete('q')
      return next
    }, { replace: true }), 250)
    return () => window.clearTimeout(timer)
  }, [searchInput, search, setParams])
  // The unfiltered list feeds the reading progress; it is the same request as the list when nothing is searched.
  const overview = useQuery(articleListQuery('', !articleSlug))
  const query = useQuery({ ...articleListQuery(search, !articleSlug), placeholderData: keepPreviousData })
  const remove = useMutation({
    mutationFn: (article: ArticleList) => api(`/knowledge/articles/${article.slug}`, { method: 'DELETE', body: jsonBody({ expectedVersion: article.version }) }),
    onSuccess: async () => {
      setDeleting(null)
      await Promise.all([client.invalidateQueries({ queryKey: ['knowledge'] }), client.invalidateQueries({ queryKey: ['dashboard'] })])
    },
  })
  const openEditor = (slug: string) => updateParams((next) => { next.set('manage', '1'); next.set('edit', slug) })
  const closeEditor = () => updateParams((next) => next.delete('edit'))
  const toggleManaging = () => updateParams((next) => {
    if (managing) { next.delete('manage'); next.delete('edit') } else next.set('manage', '1')
  })
  const setFilter = (value: ReadingFilter) => updateParams((next) => { if (value === 'all') next.delete('status'); else next.set('status', value) }, true)
  const clearSearch = () => {
    setSearchInput('')
    updateParams((next) => next.delete('q'), true)
  }

  if (articleSlug) return <>
    <ArticlePage slug={articleSlug} backSearch={params.toString()} canManage={canManage} onEdit={() => openEditor(articleSlug)} />
    {editor && <KnowledgeEditor key={editor} slug={editor === 'new' ? undefined : editor} onClose={closeEditor} />}
  </>

  if (query.isLoading) return <div className="knowledge-page-loading"><PageDataLoader /></div>

  const items = query.data?.items ?? []
  const counts: Record<ReadingFilter, number> = {
    all: items.length,
    unread: items.filter((item) => !item.hasAcknowledged).length,
    read: items.filter((item) => item.hasAcknowledged).length,
  }
  // Required material the reader has not confirmed yet comes first; the server order is kept otherwise.
  const visibleItems = items
    .filter((item) => filter === 'all' || (filter === 'read') === Boolean(item.hasAcknowledged))
    .sort((left, right) => Number(isPendingRequired(right)) - Number(isPendingRequired(left)))
  const allItems = overview.data?.items ?? []
  const readTotal = allItems.filter((item) => item.hasAcknowledged).length
  const requiredPending = allItems.filter(isPendingRequired).length
  const searching = query.isFetching && query.isPlaceholderData

  let listContent: ReactNode
  if (query.isError && !query.data) listContent = <ErrorState onRetry={() => void query.refetch()} />
  else if (!items.length && search) listContent = <EmptyState
    illustration="search"
    title="Нічого не знайдено"
    description={`За запитом «${search}» матеріалів немає. Спробуйте інше слово або очистьте пошук.`}
    action={<Button variant="secondary" onClick={clearSearch}><X size={16} aria-hidden />Очистити пошук</Button>}
  />
  else if (!items.length) listContent = <EmptyState
    illustration="workspace"
    title="Матеріалів поки немає"
    description={canManage ? 'Додайте першу інструкцію чи політику — команда побачить її тут.' : 'Щойно адміністратори опублікують інструкції, вони з’являться тут.'}
    action={canManage && !managing && <Button onClick={() => openEditor('new')}><Plus size={17} aria-hidden />Додати матеріал</Button>}
  />
  else if (!visibleItems.length) listContent = <EmptyState
    title={filter === 'unread' ? 'Усе прочитано' : 'Ще нічого не прочитано'}
    description={filter === 'unread' ? 'Ви ознайомилися з усіма матеріалами в цьому списку.' : 'Відкрийте матеріал і підтвердьте ознайомлення — він з’явиться тут.'}
    action={<Button variant="secondary" onClick={() => setFilter('all')}>Показати всі матеріали</Button>}
  />
  else listContent = <ul className="knowledge-list" aria-label="Матеріали бази знань">
    {visibleItems.map((item) => <KnowledgeArticleRow
      key={item.id}
      item={item}
      search={params.toString()}
      managing={managing}
      onEdit={() => openEditor(item.slug)}
      onDelete={() => { remove.reset(); setDeleting(item) }}
    />)}
  </ul>

  return <div className="knowledge-page">
    <PageHeader title="База знань" action={canManage && <div className="knowledge-topbar-actions">
      {managing && <Button aria-label="Додати матеріал" onClick={() => openEditor('new')}><Plus size={17} aria-hidden />Додати<span className="knowledge-topbar-extra"> матеріал</span></Button>}
      <Button className="knowledge-manage-button" variant="secondary" aria-pressed={managing} aria-label={managing ? 'Завершити керування' : 'Керувати матеріалами'} onClick={toggleManaging}>{managing ? <Check size={17} aria-hidden /> : <Pencil size={17} aria-hidden />}{managing ? <>Завершити<span className="knowledge-topbar-extra"> керування</span></> : 'Керувати матеріалами'}</Button>
    </div>} />
    <div className="knowledge-workspace">
      <section className="card knowledge-library" aria-labelledby="knowledge-library-title">
        <header className="knowledge-library__header">
          <div className="knowledge-library__title">
            <h2 id="knowledge-library-title">Матеріали</h2>
            <p>Інструкції, політики та довідки для щоденної роботи</p>
          </div>
          <div className="search-field knowledge-search">
            <Search size={17} aria-hidden />
            <input
              type="search"
              aria-label="Пошук матеріалів"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape' && searchInput) { event.preventDefault(); clearSearch() } }}
              placeholder="Пошук за назвою або текстом"
              autoComplete="off"
              spellCheck={false}
            />
            {searchInput && <button type="button" className="knowledge-search__clear" aria-label="Очистити пошук" onClick={clearSearch}><X size={16} aria-hidden /></button>}
          </div>
        </header>
        <div className="knowledge-library__toolbar">
          <div className="knowledge-filters" role="group" aria-label="Статус ознайомлення">
            {readingFilters.map((option) => <button
              key={option.value}
              type="button"
              className={filter === option.value ? 'is-active' : ''}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >{option.label}<span className="knowledge-filters__count">{counts[option.value]}</span></button>)}
          </div>
          <p className="knowledge-library__summary" aria-live="polite">
            {searching ? 'Шукаємо…' : search && items.length ? `${items.length} ${plural(items.length, 'результат', 'результати', 'результатів')} за запитом «${search}»` : ''}
          </p>
        </div>
        {managing && <p className="knowledge-manage-note"><Pencil size={15} aria-hidden />Режим керування: редагуйте або видаляйте матеріали прямо в списку.</p>}
        <div className={`knowledge-library__body${searching ? ' is-refreshing' : ''}`} aria-busy={query.isFetching}>{listContent}</div>
      </section>
      <aside className="knowledge-aside" aria-label={canManage ? 'Ознайомлення та звернення' : 'Ознайомлення'}>
        {allItems.length > 0 && <section className="card knowledge-progress" aria-labelledby="knowledge-progress-title">
          <h2 id="knowledge-progress-title">Ваше ознайомлення</h2>
          <p className="knowledge-progress__value"><strong>{readTotal}</strong> з {allItems.length} {plural(allItems.length, 'матеріалу', 'матеріалів', 'матеріалів')}</p>
          <div className={`knowledge-progress__bar${readTotal === allItems.length ? ' is-complete' : ''}`} role="progressbar" aria-label="Прочитані матеріали" aria-valuemin={0} aria-valuemax={allItems.length} aria-valuenow={readTotal}>
            <span style={{ width: `${Math.round((readTotal / allItems.length) * 100)}%` }} />
          </div>
          {requiredPending > 0
            ? <button type="button" className="knowledge-progress__alert" onClick={() => setFilter('unread')}>
              <AlertTriangle size={17} aria-hidden />
              <span>{requiredPending} {plural(requiredPending, 'обов’язковий матеріал чекає', 'обов’язкові матеріали чекають', 'обов’язкових матеріалів чекають')} на ознайомлення</span>
              <ChevronRight size={16} aria-hidden />
            </button>
            : readTotal === allItems.length
              ? <p className="knowledge-progress__done"><Check size={16} aria-hidden />Усі матеріали прочитано</p>
              : <p className="knowledge-progress__hint">Обов’язкових матеріалів, що чекають на вас, немає.</p>}
        </section>}
        {canManage && <KnowledgeFeedbackTickets renderAttachment={(file) => <KnowledgeAttachmentPreview attachment={file} />} />}
      </aside>
    </div>
    {deleting && <ConfirmationDialog title="Видалити матеріал?" description={`«${deleting.title}» буде прибрано з бази знань. Його можна буде відновити лише через технічне втручання.`} onRequestClose={() => { if (!remove.isPending) setDeleting(null) }} onConfirm={() => remove.mutate(deleting)} confirmLabel={remove.isPending ? 'Видаляємо…' : 'Видалити'} confirmDisabled={remove.isPending}>
      {remove.isError && <p className="form-error" role="alert">Не вдалося видалити матеріал. Спробуйте ще раз.</p>}
    </ConfirmationDialog>}
    {editor && <KnowledgeEditor key={editor} slug={editor === 'new' ? undefined : editor} onClose={closeEditor} />}
  </div>
}

function KnowledgeArticleRow({ item, search, managing, onEdit, onDelete }: { item: ArticleList; search: string; managing: boolean; onEdit: () => void; onDelete: () => void }) {
  const required = isPendingRequired(item)
  return <li className={`knowledge-article-card${required ? ' is-required' : ''}`}>
    <Link className="knowledge-article-link" to={{ pathname: `/knowledge/${item.slug}`, search }}>
      <span className="knowledge-article-thumb">
        <KnowledgeImage fileId={item.imageFileId} className="knowledge-article-image" />
        {required && <span className="knowledge-required-marker" role="img" aria-label="Обов’язкове ознайомлення" title="Обов’язкове ознайомлення"><AlertTriangle size={12} aria-hidden="true" /></span>}
      </span>
      <span className="knowledge-article-content">
        <h3>{item.title}</h3>
        <span className={`knowledge-reading-status ${item.hasAcknowledged ? 'is-confirmed' : 'is-pending'}`}>{item.hasAcknowledged ? <Check size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}{item.hasAcknowledged ? 'Ознайомлено' : 'Не ознайомлено'}</span>
        <small className="knowledge-article-created">Створено {formatDate(item.createdAt)}</small>
      </span>
      <ChevronRight className="knowledge-article-chevron" size={18} aria-hidden />
    </Link>
    {managing && <div className="knowledge-article-actions">
      <Button variant="secondary" aria-label={`Редагувати ${item.title}`} title="Редагувати" onClick={onEdit}><Pencil size={16} aria-hidden /><span>Редагувати</span></Button>
      <Button variant="ghost" className="knowledge-article-delete" aria-label={`Видалити ${item.title}`} title="Видалити" onClick={onDelete}><Trash2 size={16} aria-hidden /><span>Видалити</span></Button>
    </div>}
  </li>
}

/** Private feedback to administrators; opened from the profile menu on any page. */
export function KnowledgeFeedbackDialog({ onClose, onSubmitted }: { onClose: () => void; onSubmitted?: () => void }) {
  return <KnowledgeEditor ticket onClose={onClose} onSubmitted={onSubmitted} />
}

function KnowledgeEditor({ slug, ticket = false, onClose, onSubmitted }: { slug?: string; ticket?: boolean; onClose: () => void; onSubmitted?: () => void }) {
  const client = useQueryClient()
  const [dirty, setDirty] = useState(false)
  const [newSlug] = useState(() => `article-${randomId()}`)
  const [draft, setDraft] = useState<ArticleDetail | null>(null)
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([])
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([])
  const originalImage = draft?.attachments.find(isKnowledgeImage)
  const existingImage = originalImage && !removedAttachmentIds.includes(originalImage.id) ? originalImage : null
  const existingFiles = (draft?.attachments ?? []).filter((file) => file.id !== originalImage?.id && !removedAttachmentIds.includes(file.id))
  function removeAttachment(fileId: string) {
    setRemovedAttachmentIds((current) => [...new Set([...current, fileId])])
    setDirty(true)
  }
  function selectImage(files: File[]) {
    if (!files[0]) return
    if (originalImage) removeAttachment(originalImage.id)
    setImageFile(files[0])
    setAttachmentFiles((current) => current.filter((file) => file.name !== files[0].name || file.size !== files[0].size))
    setDirty(true)
  }
  const closeGuard = useModalCloseGuard({ dirty, onRequestClose: onClose })
  const article = useQuery({ queryKey: ['article', slug], queryFn: () => api<ArticleDetail>(`/knowledge/articles/${slug}`), enabled: Boolean(slug) })
  useEffect(() => {
    if (article.data?.currentVersion) setDraft((current) => current ?? article.data)
  }, [article.data])
  const companies = useQuery({ queryKey: ['knowledge-company-options'], queryFn: () => api<{ items: KnowledgeCompanyOption[] }>('/admin/companies'), enabled: !ticket })
  const activeCompanies = (companies.data?.items ?? []).filter((company) => company.isActive)
  // Null means "not touched yet": a new article reaches every active company and
  // an existing one keeps the audience it was published with.
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[] | null>(null)
  const audienceCompanyIds = (selectedCompanyIds
    ?? (slug ? draft?.companyIds ?? [] : activeCompanies.map((company) => company.id)))
    .filter((companyId) => activeCompanies.some((company) => company.id === companyId))
  function toggleCompany(companyId: string, checked: boolean) {
    setSelectedCompanyIds(checked
      ? [...audienceCompanyIds, companyId]
      : audienceCompanyIds.filter((item) => item !== companyId))
  }
  async function uploadAttachments() {
    if (attachmentFiles.length === 0 && !imageFile) return []
    if (ticket && attachmentFiles.length + (imageFile ? 1 : 0) > 20) throw new Error('До звернення можна додати не більше 20 файлів.')
    const companyId = audienceCompanyIds[0] ?? activeCompanies[0]?.id
    if (!ticket && !companyId) throw new Error('Немає активної компанії для завантаження файлу.')
    const attachmentIds: string[] = []
    for (const file of [...(imageFile ? [imageFile] : []), ...attachmentFiles]) {
      const formData = new FormData()
      formData.set('file', file)
      const uploaded = await api<{ id: string; scanStatus: string }>(ticket ? '/knowledge/tickets/attachments' : `/files?company=${encodeURIComponent(companyId!)}`, { method: 'POST', body: formData })
      let scanStatus = uploaded.scanStatus
      for (let attempt = 0; scanStatus !== 'CLEAN' && attempt < 6; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 500))
        scanStatus = (await api<{ scanStatus: string }>(`/files/${uploaded.id}/status`)).scanStatus
      }
      if (scanStatus !== 'CLEAN') throw new Error(`Файл «${file.name}» ще проходить перевірку. Зачекайте кілька секунд і збережіть матеріал повторно.`)
      attachmentIds.push(uploaded.id)
    }
    return attachmentIds
  }
  const save = useMutation({
    mutationFn: async (data: FormData) => api(ticket ? '/knowledge/tickets' : slug ? `/knowledge/articles/${slug}` : '/knowledge/articles', {
      method: slug ? 'PATCH' : 'POST',
      body: jsonBody(ticket ? { title: data.get('title'), body: data.get('body'), attachmentIds: await uploadAttachments() } : { title: data.get('title'), body: data.get('body'), changeSummary: data.get('changeSummary') ?? '', attachmentIds: await uploadAttachments(), companyIds: audienceCompanyIds, requiresAcknowledgement: data.get('requiresAcknowledgement') === 'required', ...(slug ? { expectedVersion: Number(data.get('expectedVersion')), removedAttachmentIds } : { slug: newSlug }) }),
    }),
    onSuccess: async () => {
      if (ticket) {
        await client.invalidateQueries({ queryKey: ['feedback-tickets'] })
        onSubmitted?.()
      } else await Promise.all([client.invalidateQueries({ queryKey: ['knowledge'] }), client.invalidateQueries({ queryKey: ['article'] }), client.invalidateQueries({ queryKey: ['dashboard'] })])
      closeGuard.closeForSuccess(onClose)
    },
  })
  const ready = ticket || (slug ? Boolean(draft?.currentVersion) : activeCompanies.length > 0)
  return <>
    <Modal
      title={ticket ? 'Звернення до адміністратора' : slug ? 'Редагувати матеріал' : 'Додати матеріал'}
      description={ticket ? 'Поділіться ідеєю, відгуком або опишіть проблему. Запис бачитимуть лише адміністратори.' : slug ? 'Оновіть текст і аудиторію матеріалу.' : 'Опублікуйте інструкцію для потрібних компаній.'}
      size="xl"
      closeDisabled={save.isPending}
      onBeforeClose={closeGuard.shouldClose}
      onRequestClose={save.isPending ? () => {} : closeGuard.requestClose}
    >
      {(!ticket && (slug ? article.isLoading || companies.isLoading : companies.isLoading)) ? <PageDataLoader /> : !ready ? <ErrorState /> : <form className="entity-form knowledge-editor-form" onChange={() => setDirty(true)} onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(new FormData(event.currentTarget)) }}>
        {slug && <input type="hidden" name="expectedVersion" value={draft?.version ?? ''} />}
        <label className="span-2">{ticket ? 'Тема звернення' : 'Назва'}<input name="title" maxLength={ticket ? 200 : undefined} required defaultValue={draft?.currentVersion?.title ?? ''} autoFocus disabled={save.isPending} /></label>
        <div className="span-2"><FormattedTextarea label={ticket ? 'Текст звернення' : 'Текст матеріалу'} name="body" rows={4} required defaultValue={draft?.currentVersion?.body ?? ''} disabled={save.isPending} /></div>
        {!ticket && <><label className="knowledge-editor-acknowledgement">Ознайомлення<select name="requiresAcknowledgement" defaultValue={draft?.requiresAcknowledgement ? 'required' : 'optional'} disabled={save.isPending}>
          <option value="optional">Необов’язкове ознайомлення</option>
          <option value="required">Обов’язкове ознайомлення</option>
        </select></label>
        <fieldset className="knowledge-audience" disabled={save.isPending}>
          <legend>Хто побачить статтю</legend>
          <div className="knowledge-audience__companies">
            {activeCompanies.map((company) => <label className="check-label" key={company.id}>
              <input type="checkbox" checked={audienceCompanyIds.includes(company.id)} onChange={(event) => toggleCompany(company.id, event.target.checked)} />
              {company.name}
            </label>)}
          </div>
          {audienceCompanyIds.length === 0 && <p className="knowledge-audience__hint" role="alert">Оберіть щонайменше одну компанію.</p>}
        </fieldset></>}
        {!ticket && <div className="knowledge-image-upload">
          <strong>Картинка запису</strong>
          {imageFile || existingImage ? <div className="knowledge-image-slot">
            {imageFile ? <KnowledgeSelectedImage file={imageFile} /> : <KnowledgeImage fileId={existingImage?.id} className="knowledge-image-preview" />}
            <div className="knowledge-image-slot__details"><strong>{imageFile?.name ?? existingImage?.safeFilename}</strong><small>Картинку вибрано · 1 з 1</small>
              <div className="knowledge-image-slot__actions"><FileDropzone className="knowledge-image-replace" label="Замінити картинку" accept="image/png,image/jpeg,image/gif,image/webp" resetAfterSelect disabled={save.isPending} title="Замінити картинку" buttonLabel="Замінити" onFiles={selectImage} /><Button type="button" variant="ghost" aria-label="Прибрати картинку" disabled={save.isPending} onClick={() => { setImageFile(null); if (existingImage) removeAttachment(existingImage.id); setDirty(true) }}><X size={16} />Прибрати</Button></div>
            </div>
          </div> : <FileDropzone label="Додати картинку" accept="image/png,image/jpeg,image/gif,image/webp" resetAfterSelect disabled={save.isPending} title="Додайте одну картинку" hint="PNG, JPG, GIF або WebP · 1 файл" onFiles={selectImage} />}
        </div>}
        <div className={`knowledge-attachments-upload${ticket ? ' span-2' : ''}`}>
          <span className="knowledge-attachments-upload__label">Файли</span>
          <FileDropzone
            label="Додати файли"
            multiple
            resetAfterSelect
            disabled={save.isPending}
            title="Перетягніть файли сюди"
            hint={ticket ? 'Документи, знімки екрана чи фото · до 20 файлів. Їх буде прикріплено після перевірки безпеки.' : 'Файли буде прикріплено після перевірки безпеки.'}
            onFiles={(files) => { setDirty(true); setAttachmentFiles((current) => [
              ...current,
              ...files.filter((file) => !(imageFile?.name === file.name && imageFile.size === file.size) && !current.some((picked) => picked.name === file.name && picked.size === file.size)),
            ]) }}
          >
            {attachmentFiles.length > 0 && (
              <ul className="file-dropzone-files" aria-label="Вибрані файли">
                {attachmentFiles.map((file) => (
                  <li key={`${file.name}-${file.size}`}>
                    <FileFormatIcon mimeType={file.type} fileName={file.name} size={15} />
                    <span>{file.name}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Прибрати ${file.name}`}
                      disabled={save.isPending}
                      onClick={() => { setDirty(true); setAttachmentFiles((current) => current.filter((picked) => (
                        picked.name !== file.name || picked.size !== file.size
                      ))) }}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FileDropzone>
        </div>
        {existingFiles.length ? <section className="knowledge-existing-files" aria-label="Прикріплені файли"><strong>Прикріплені файли</strong><ul className="knowledge-file-list">{existingFiles.map((file) => <KnowledgeExistingFile key={file.id} file={file} disabled={save.isPending} onRemove={() => removeAttachment(file.id)} />)}</ul></section> : null}
        {save.isError && <p className="form-error span-2" role="alert">{save.error instanceof Error ? save.error.message : ticket ? 'Не вдалося надіслати звернення. Спробуйте ще раз.' : 'Не вдалося зберегти матеріал. Спробуйте ще раз.'}</p>}
        <Button type="submit" className="span-2 knowledge-save-button" disabled={save.isPending || (!ticket && audienceCompanyIds.length === 0)}>{save.isPending ? 'Зберігаємо…' : ticket ? 'Надіслати звернення' : slug ? 'Зберегти зміни' : 'Опублікувати матеріал'}</Button>
      </form>}
    </Modal>
    <UnsavedChangesDialog
      guard={closeGuard}
      title={ticket ? 'Закрити звернення?' : slug ? 'Закрити редагування матеріалу?' : 'Закрити створення матеріалу?'}
      description={ticket ? 'Незбережене звернення не буде надіслано.' : slug
        ? 'Незбережені зміни матеріалу буде втрачено.'
        : 'Новий матеріал не буде опубліковано.'}
    />
  </>
}

function ArticlePage({ slug, backSearch, canManage, onEdit }: { slug: string; backSearch: string; canManage: boolean; onEdit: () => void }) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['article', slug], queryFn: () => api<ArticleDetail>(`/knowledge/articles/${slug}`) })
  const ack = useMutation({
    mutationFn: () => api<{ confirmed: boolean; confirmedAt: string }>(`/knowledge/articles/${slug}/acknowledge`, { method: 'POST', body: jsonBody({ expectedVersion: query.data?.version }) }),
    onSuccess: async (result) => {
      const confirmedArticle = query.data
      if (confirmedArticle) {
        client.setQueryData<ArticleDetail>(['article', slug], (current) => current?.version === confirmedArticle.version ? { ...current, acknowledgement: { confirmedAt: result.confirmedAt } } : current)
        client.setQueriesData<{ items: ArticleList[] }>({ queryKey: ['knowledge', 'articles'] }, (current) => current ? { ...current, items: current.items.map((item) => item.id === confirmedArticle.id && item.version === confirmedArticle.version ? { ...item, hasAcknowledged: true } : item) } : current)
      }
      await Promise.all([client.invalidateQueries({ queryKey: ['article', slug] }), client.invalidateQueries({ queryKey: ['knowledge'], refetchType: 'all' }), client.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' })])
    },
  })
  const params = new URLSearchParams(backSearch)
  params.delete('edit')
  const article = query.data
  const version = article?.currentVersion
  const coverImage = article?.attachments.find(isKnowledgeImage)
  const attachedFiles = (article?.attachments ?? []).filter((file) => file.id !== coverImage?.id)
  return <div className="knowledge-reading-page">
    <nav className="knowledge-reading-nav" aria-label="Навігація статті">
      <Link to={{ pathname: '/knowledge', search: params.toString() }}>← База знань</Link>
      {canManage && version && <Button variant="secondary" onClick={onEdit}><Pencil size={16} />Редагувати матеріал</Button>}
    </nav>
    {query.isLoading ? <PageDataLoader /> : query.isError || !version || !article ? <ErrorState /> : <article className="knowledge-reading-card">
      <header className="knowledge-reading-header">
        <span className="eyebrow"><BookOpenCheck size={18} />Матеріал бази знань</span>
        <h1>{version.title}</h1>
        <div className="knowledge-reading-meta"><span>Створено {formatDateTime(article.createdAt)}</span>{article.requiresAcknowledgement && <span className="knowledge-required-label"><AlertTriangle size={16} />Обов’язкове ознайомлення</span>}</div>
      </header>
      {coverImage && <KnowledgeImage fileId={coverImage.id} className="knowledge-reading-image" />}
      <div className="knowledge-reading-body"><FormattedText body={version.body} /></div>
      {attachedFiles.length > 0 && <section className="knowledge-reading-files"><h2>Прикріплені файли</h2><div className="knowledge-attachment-list">{attachedFiles.map((file) => <KnowledgeAttachmentPreview key={file.id} attachment={file} />)}</div></section>}
      <footer className="knowledge-reading-footer">
        {article.acknowledgement?.confirmedAt ? <p className="success-note"><Check size={17} />Ви ознайомилися {formatDateTime(article.acknowledgement.confirmedAt)}</p> : <Button disabled={ack.isPending} onClick={() => ack.mutate()}><Check size={17} />{ack.isPending ? 'Підтверджуємо…' : 'Ознайомився'}</Button>}
        {ack.isError && <p className="form-error" role="alert">Не вдалося підтвердити ознайомлення. Спробуйте ще раз.</p>}
      </footer>
    </article>}
  </div>
}

function isKnowledgeImage(file: KnowledgeAttachment) {
  return file.scanStatus === 'CLEAN' && /^image\/(png|jpeg|gif|webp)$/.test(file.mimeType ?? '')
}

function KnowledgeImage({ fileId, className }: { fileId?: string | null; className: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  return fileId && failed !== fileId
    ? <img className={className} src={apiUrl(`/files/${encodeURIComponent(fileId)}/download?inline=true`)} alt="" loading="lazy" onError={() => setFailed(fileId)} />
    : <span className="article-icon"><BookOpenCheck size={20} /></span>
}

function KnowledgeSelectedImage({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url ? <img className="knowledge-image-preview" src={url} alt="Вибрана картинка запису" /> : null
}

function KnowledgeExistingFile({ file, disabled, onRemove }: { file: KnowledgeAttachment; disabled: boolean; onRemove: () => void }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  return (
    <li>
      <FileFormatIcon mimeType={file.mimeType} fileName={file.safeFilename} size={16} />
      {file.scanStatus === 'CLEAN' ? (
        <button type="button" className="knowledge-file-list__preview" onClick={() => setPreviewOpen(true)}>
          {file.safeFilename}
        </button>
      ) : <span className="knowledge-file-list__name">{file.safeFilename}</span>}
      <small>{file.scanStatus === 'CLEAN' ? 'Готовий' : 'Перевіряється'}</small>
      <button type="button" className="icon-button" aria-label={`Прибрати ${file.safeFilename}`} disabled={disabled} onClick={onRemove}><X size={16} /></button>
      {previewOpen && (
        <FilePreviewModal
          file={{ id: file.id, fileName: file.safeFilename, mimeType: file.mimeType, bytes: file.bytes }}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </li>
  )
}

function KnowledgeAttachmentPreview({ attachment }: { attachment: KnowledgeAttachment }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  return <section className="document-preview knowledge-attachment-preview" aria-label={`Прикріплений файл ${attachment.safeFilename}`}><div className="knowledge-attachment-preview__footer"><span title={attachment.safeFilename}>{attachment.safeFilename}</span><div><Button variant="ghost" aria-label={`Переглянути ${attachment.safeFilename}`} disabled={attachment.scanStatus !== 'CLEAN'} onClick={() => setPreviewOpen(true)}><Eye size={16} />Переглянути</Button><a className="icon-button" aria-label={`Завантажити ${attachment.safeFilename}`} href={`/api/v1/files/${attachment.id}/download`}><Download size={17} /></a></div></div>{previewOpen && <FilePreviewModal file={{ id: attachment.id, fileName: attachment.safeFilename, mimeType: attachment.mimeType, bytes: attachment.bytes }} onClose={() => setPreviewOpen(false)} />}</section>
}

function EmployeesPage() {
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const search = params.get('q') ?? ''
  const companyId = user?.company?.id ?? ''
  const orgUnitId = params.get('orgUnit') ?? ''
  const managerId = params.get('manager') ?? ''
  const presence = params.get('presence') ?? ''
  const requestQuery = new URLSearchParams()
  if (search) requestQuery.set('search', search)
  if (companyId) requestQuery.set('company', companyId)
  if (orgUnitId) requestQuery.set('orgUnit', orgUnitId)
  if (managerId) requestQuery.set('manager', managerId)
  if (presence) requestQuery.set('presence', presence)
  const pages = useCursorPages(requestQuery.toString())
  if (pages.cursor) requestQuery.set('cursor', pages.cursor)
  const query = useQuery({
    queryKey: ['employees', search, companyId, orgUnitId, managerId, presence, pages.cursor ?? ''],
    queryFn: () => api<EmployeeDirectory>(`/employees?${requestQuery.toString()}`),
  })
  const updateFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    if (name === 'company') {
      next.delete('orgUnit')
      next.delete('manager')
    }
    setParams(next, { replace: true })
  }
  const clearFilters = () => {
    const next = new URLSearchParams()
    if (companyId) next.set('company', companyId)
    setParams(next, { replace: true })
  }
  const hasFilters = Boolean(search || orgUnitId || managerId || presence)
  const orgUrl = '/employees/org'

  return (
    <div>
      <PageHeader
        title="Працівники"
        description="Знайдіть потрібну людину, команду або керівника без зайвих переходів"
        action={(
          <Link className="button button--secondary" to={orgUrl}>
            <Network size={17} />Структура організації
          </Link>
        )}
      />
      <Card className="directory-card">
        <div className="directory-toolbar">
          <label className="search-field">
            <span className="sr-only">Знайти працівника</span>
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Ім’я, посада або нікнейм"
              type="search"
            />
          </label>
          {(
            <>
              <label className="directory-filter">
                <span>Підрозділ</span>
                <select value={orgUnitId} onChange={(event) => updateFilter('orgUnit', event.target.value)}>
                  <option value="">Усі підрозділи</option>
                  {query.data?.filters.orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                </select>
              </label>
              <div className="directory-filter">
                <UserSearchCombobox label="Керівник" value={managerId} companyId={companyId || undefined} managersOnly
                  defaultUser={query.data?.filters.managers.find((manager) => manager.id === managerId)}
                  placeholder="Усі · введіть ім’я" onChange={(id) => updateFilter('manager', id)} />
              </div>
            </>
          )}
          <label className="directory-filter">
            <span>Доступність</span>
            <select value={presence} onChange={(event) => updateFilter('presence', event.target.value)}>
              <option value="">Усі</option>
              <option value="AVAILABLE">Доступні</option>
              <option value="AWAY">Відсутні</option>
            </select>
          </label>
        </div>
        <div className="directory-summary" aria-live="polite">
          <span><strong>{query.data?.total ?? 0}</strong> знайдено</span>
          {query.data && <span>{query.data.counts.available} доступні · {query.data.counts.away} відсутні</span>}
          {hasFilters && <button type="button" onClick={clearFilters}><X size={14} />Очистити</button>}
        </div>
        {query.isLoading ? <PageDataLoader /> : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <div className="employee-grid">
            {query.data.items.map((item) => (
                <article className="employee-card" key={item.id}>
                  <UserProfileLink
                    className="employee-card__profile"
                    userId={item.id}
                  >
                    <Avatar size="lg" name={personName(item.displayName)} src={item.avatarAsset} />
                    <span>
                      <strong>{personName(item.displayName)}</strong>
                      <small>{item.positionTitle || item.jobTitle}</small>
                      {item.orgUnit && <small className="employee-org"><Building2 size={12} />{item.orgUnit.parent ? `${item.orgUnit.parent.name} → ${item.orgUnit.name}` : item.orgUnit.name}</small>}
                      <em>
                        <i className={`presence presence--${item.presence.toLowerCase()}`} />
                        {item.presence === 'AVAILABLE' ? 'Доступний' : 'Відсутній'}
                      </em>
                    </span>
                  </UserProfileLink>
                  {item.id !== user?.id && (
                    <Link
                      className="employee-card__chat"
                      aria-label={`Написати ${personName(item.displayName)}`}
                      title={`Написати ${personName(item.displayName)}`}
                      to={`/messages?new=1&to=${encodeURIComponent(item.id)}`}
                    >
                      <MessageCircle size={17} />
                    </Link>
                  )}
                </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Нікого не знайдено"
            description="Змініть пошук або очистьте один із фільтрів."
            illustration="search"
            action={hasFilters && <Button variant="secondary" onClick={clearFilters}>Очистити фільтри</Button>}
          />
        )}
        <CursorPager label="Сторінки працівників" hasPrevious={pages.hasPrevious} nextCursor={query.data?.nextCursor} onPrevious={pages.previous} onNext={pages.next} />
      </Card>
    </div>
  )
}

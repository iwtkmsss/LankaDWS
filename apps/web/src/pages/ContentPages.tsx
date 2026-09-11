import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OrganizationCapability, type GroupDetailView, type GroupListResult } from '@lankadws/contracts'
import { Archive, BookOpenCheck, Building2, Check, CheckSquare2, Download, Eye, File as FileIcon, LockKeyhole, LogOut, MessageCircle, Network, Newspaper, Pencil, Plus, Search, Trash2, UserPlus, UsersRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, jsonBody, randomId } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { FileDropzone } from '../shared/files/FileDropzone'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import {
  Avatar,
  Button,
  Card,
  ConfirmationDialog,
  Drawer,
  EmptyState,
  ErrorState,
  Modal,
  PageDataLoader,
  PageHeader,
  Skeleton,
  StatusBadge,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../shared/ui'

interface ArticleList { id: string; slug: string; title: string; changeSummary: string; reviewAt: string | null; version: number; updatedAt: string }
interface KnowledgeAttachment { id: string; safeFilename: string; bytes: number; mimeType: string | null; scanStatus: string }
interface ArticleDetail { id: string; slug: string; version: number; reviewAt?: string | null; currentVersion: { title: string; body: string; changeSummary: string; publishedAt: string } | null; acknowledgement: { confirmedAt?: string | null } | null; attachments: KnowledgeAttachment[]; companyIds: string[] }
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
  counts: { all: number; available: number; away: number }
  filters: {
    orgUnits: Array<{ id: string; name: string }>
    managers: Array<{ id: string; displayName: string }>
  }
}
export default function ContentPages() {
  const path = useLocation().pathname
  if (path.startsWith('/groups')) return <GroupsPage />
  if (path.startsWith('/knowledge')) return <KnowledgePage />
  if (path.startsWith('/employees')) return <EmployeesPage />
  return null
}

function GroupsPage() {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const { canUseCapability, user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [creating, setCreating] = useState(false)
  const requestedCreate = params.get('new') === '1'
  const status = params.get('status') === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'
  const company = user?.company?.id ?? ''
  const queryParams = new URLSearchParams({ status, limit: '50' })
  if (company) queryParams.set('company', company)
  if (search.trim()) queryParams.set('query', search.trim())
  const query = useQuery({
    queryKey: ['groups', company, status, search],
    queryFn: () => api<GroupListResult>(`/groups?${queryParams.toString()}`),
  })
  const createCompanyId = company
  const canCreate = canUseCapability(OrganizationCapability.GroupsUi) && Boolean(company)
  useEffect(() => {
    if (!requestedCreate || !canCreate) return
    setCreating(true)
    setParams((current) => {
      current.delete('new')
      return current
    }, { replace: true })
  }, [canCreate, requestedCreate, setParams])
  const selectStatus = (nextStatus: 'ACTIVE' | 'ARCHIVED') => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (nextStatus === 'ARCHIVED') next.set('status', nextStatus)
      else next.delete('status')
      return next
    }, { replace: true })
  }
  return (
    <div>
      <PageHeader
        title="Робочі групи"
        description="Команди та проєкти без зайвих вкладок і налаштувань"
        action={canCreate && <Button onClick={() => setCreating(true)}><Plus size={17} />Нова група</Button>}
      />
      <Card className="list-card">
        <div className="list-toolbar group-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Знайти групу" />
          </label>
          <div className="segmented-control" aria-label="Стан груп">
            <button className={status === 'ACTIVE' ? 'is-active' : ''} onClick={() => selectStatus('ACTIVE')}>Активні</button>
            <button className={status === 'ARCHIVED' ? 'is-active' : ''} onClick={() => selectStatus('ARCHIVED')}>Архів</button>
          </div>
        </div>
        {query.isLoading ? <PageDataLoader /> : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <div className="group-grid">
            {query.data.items.map((group) => (
              <Link to={`/groups/${group.id}?${params.toString()}`} key={group.id}>
                <span className="group-icon">{group.discoverability === 'HIDDEN' ? <LockKeyhole size={20} /> : <UsersRound size={20} />}</span>
                <div>
                  <strong>{group.name}</strong>
                  <p>{group.description || 'Робочий простір команди'}</p>
                  <small>{group.memberCount} учасн. · {group.currentUserRole ? 'Ви учасник' : group.joinPolicy === 'OPEN' ? 'Відкрита' : 'За запитом'}</small>
                </div>
              </Link>
            ))}
          </div>
        ) : <EmptyState title="Груп не знайдено" description="Спробуйте іншу назву або відкрийте активні групи." />}
      </Card>
      {groupId && <GroupDrawer id={groupId} company={company} onClose={() => navigate(`/groups?${params.toString()}`)} />}
      {creating && (
        <GroupCreate
          companyId={createCompanyId}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            navigate(`/groups/${id}?${params.toString()}`)
          }}
        />
      )}
    </div>
  )
}

function GroupCreate({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const closeGuard = useModalCloseGuard({ dirty, onRequestClose: () => onClose() })
  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) => api<{ id: string }>('/groups', {
      method: 'POST',
      body: jsonBody(input),
    }),
    onSuccess: (result) => closeGuard.closeForSuccess(() => onCreated(result.id)),
    onError: () => setError('Не вдалося створити групу. Перевірте назву й доступ.'),
  })
  return (
    <>
      <Drawer
        title="Нова робоча група"
        onBeforeClose={closeGuard.shouldClose}
        onRequestClose={closeGuard.requestClose}
      >
        <form className="entity-form" onChange={() => setDirty(true)} onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          create.mutate({
            companyId,
            name: data.get('name'),
            description: data.get('description') || undefined,
            discoverability: data.get('discoverability'),
            joinPolicy: data.get('joinPolicy'),
          })
        }}>
          <label className="span-2">Назва<input name="name" required minLength={2} maxLength={120} autoFocus /></label>
          <label className="span-2">Опис<textarea name="description" rows={4} maxLength={1000} /></label>
          <label>Видимість<select name="discoverability" defaultValue="LISTED"><option value="LISTED">Видима всім</option><option value="HIDDEN">Прихована</option></select></label>
          <label>Вступ<select name="joinPolicy" defaultValue="REQUEST"><option value="OPEN">Вільний</option><option value="REQUEST">За заявкою</option><option value="INVITE_ONLY">За запрошенням</option></select></label>
          {error && <p className="form-error span-2">{error}</p>}
          <Button className="span-2" disabled={create.isPending}>{create.isPending ? 'Створюємо…' : 'Створити групу'}</Button>
        </form>
      </Drawer>
      <UnsavedChangesDialog
        guard={closeGuard}
        title="Закрити створення групи?"
        description="Нова робоча група не буде створена."
      />
    </>
  )
}

function GroupDrawer({ id, company, onClose }: { id: string; company: string; onClose: () => void }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [settingsError, setSettingsError] = useState('')
  const [settingsDirty, setSettingsDirty] = useState(false)
  const closeGuard = useModalCloseGuard({
    dirty: settingsDirty,
    onRequestClose: () => onClose(),
  })
  const suffix = company ? `?company=${encodeURIComponent(company)}` : ''
  const query = useQuery({ queryKey: ['group', id, company], queryFn: () => api<GroupDetailView>(`/groups/${id}${suffix}`) })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['group', id] })
    void client.invalidateQueries({ queryKey: ['groups'] })
  }
  const join = useMutation({ mutationFn: () => api(`/groups/${id}/join`, { method: 'POST' }), onSuccess: refresh })
  const leave = useMutation({ mutationFn: () => api(`/groups/${id}/leave`, { method: 'POST' }), onSuccess: refresh })
  const decide = useMutation({
    mutationFn: (input: { requestId: string; decision: 'APPROVED' | 'REJECTED' }) =>
      api(`/groups/${id}/requests/${input.requestId}`, { method: 'POST', body: jsonBody({ decision: input.decision }) }),
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) => api(`/groups/${id}`, { method: 'PATCH', body: jsonBody(input) }),
    onSuccess: () => {
      setSettingsError('')
      setSettingsDirty(false)
      refresh()
    },
    onError: () => setSettingsError('Зміни не збережено. Оновіть групу й спробуйте ще раз.'),
  })
  const archive = useMutation({
    mutationFn: () => api(`/groups/${id}/archive`, {
      method: 'POST',
      body: jsonBody({ expectedVersion: query.data?.version }),
    }),
    onSuccess: refresh,
    onError: () => setSettingsError('Не вдалося архівувати групу.'),
  })
  const openChat = useMutation({
    mutationFn: () => api<{ id: string }>(`/messages/groups/${id}/thread`, { method: 'POST' }),
    onSuccess: (result) => {
      const context = new URLSearchParams({ company: query.data!.companyId })
      navigate(`/messages/${result.id}?${context.toString()}`)
    },
  })
  const footer = query.data?.status === 'ACTIVE' && !query.data.currentUserRole ? (
    <Button
      disabled={join.isPending || query.data.currentUserRequestStatus === 'PENDING' || query.data.joinPolicy === 'INVITE_ONLY'}
      onClick={() => join.mutate()}
    >
      <UserPlus size={17} />
      {query.data.currentUserRequestStatus === 'PENDING'
        ? 'Заявку надіслано'
        : query.data.joinPolicy === 'OPEN'
          ? 'Приєднатися'
          : query.data.joinPolicy === 'REQUEST'
            ? 'Подати заявку'
            : 'Лише за запрошенням'}
    </Button>
  ) : query.data?.status === 'ACTIVE' && query.data.currentUserRole !== 'OWNER' ? (
    <Button variant="secondary" disabled={leave.isPending} onClick={() => leave.mutate()}><LogOut size={17} />Вийти з групи</Button>
  ) : undefined
  return (
    <>
      <Drawer
        title="Робоча група"
        onBeforeClose={closeGuard.shouldClose}
        onRequestClose={closeGuard.requestClose}
        footer={footer}
      >
        {query.isLoading ? <Skeleton /> : query.isError || !query.data ? <ErrorState /> : (
        <div className="detail-stack group-detail">
          <span className="group-icon">{query.data.discoverability === 'HIDDEN' ? <LockKeyhole size={22} /> : <UsersRound size={22} />}</span>
          <div>
            <StatusBadge status={query.data.status} />
            <h3>{query.data.name}</h3>
            <p>{query.data.description || 'Опис групи не додано.'}</p>
          </div>
          <dl className="detail-grid">
            <div><dt>Власник</dt><dd>{query.data.owner.displayName}</dd></div>
            <div><dt>Учасники</dt><dd>{query.data.memberCount}</dd></div>
            <div><dt>Доступ</dt><dd>{query.data.discoverability === 'HIDDEN' ? 'Прихована' : 'Видима'}</dd></div>
            <div><dt>Вступ</dt><dd>{query.data.joinPolicy === 'OPEN' ? 'Вільний' : query.data.joinPolicy === 'REQUEST' ? 'За запитом' : 'За запрошенням'}</dd></div>
          </dl>
          {query.data.currentUserRole && query.data.status === 'ACTIVE' && (
            <section className="group-workspace">
              <h4>Робота групи</h4>
              <div>
                <Link to={`/feed?groupId=${encodeURIComponent(id)}`}>
                  <Newspaper size={19} />
                  <span><strong>Стрічка</strong><small>Оновлення групи</small></span>
                </Link>
                {(
                  <Link to={`/tasks?company=${encodeURIComponent(query.data.companyId)}&groupId=${encodeURIComponent(id)}`}>
                    <CheckSquare2 size={19} />
                    <span><strong>Завдання</strong><small>Робота команди</small></span>
                  </Link>
                )}
                {(
                  <Link to={`/tasks/new?company=${encodeURIComponent(query.data.companyId)}&groupId=${encodeURIComponent(id)}`}>
                    <Plus size={19} />
                    <span><strong>Нове завдання</strong><small>У контексті групи</small></span>
                  </Link>
                )}
                {(
                  <button type="button" disabled={openChat.isPending} onClick={() => openChat.mutate()}>
                    <MessageCircle size={19} />
                    <span><strong>Чат</strong><small>{openChat.isPending ? 'Відкриваємо…' : 'Спільний діалог'}</small></span>
                  </button>
                )}
              </div>
              {openChat.isError && <p className="form-error">Не вдалося відкрити чат групи.</p>}
            </section>
          )}
          <section>
            <h4>Учасники</h4>
            <div className="group-member-list">
              {query.data.members.map((member) => (
                <article key={member.id}>
                  <UserProfileLink className="group-person" userId={member.user.id}>
                    <Avatar size="sm" name={member.user.displayName} src={member.user.avatarAsset} />
                    <span><strong>{member.user.displayName}</strong><small>{member.role === 'OWNER' ? 'Власник' : member.role === 'MODERATOR' ? 'Модератор' : 'Учасник'}</small></span>
                  </UserProfileLink>
                </article>
              ))}
            </div>
          </section>
          {query.data.canManageMembers && query.data.pendingRequests.length > 0 && (
            <section>
              <h4>Заявки на вступ</h4>
              <div className="group-request-list">
                {query.data.pendingRequests.map((request) => (
                  <article key={request.id}>
                    <UserProfileLink className="group-person" userId={request.requester.id}>
                      <Avatar size="sm" name={request.requester.displayName} src={request.requester.avatarAsset} />
                      <strong>{request.requester.displayName}</strong>
                    </UserProfileLink>
                    <button aria-label="Прийняти" onClick={() => decide.mutate({ requestId: request.id, decision: 'APPROVED' })}><Check size={16} /></button>
                    <button aria-label="Відхилити" onClick={() => decide.mutate({ requestId: request.id, decision: 'REJECTED' })}><X size={16} /></button>
                  </article>
                ))}
              </div>
            </section>
          )}
          {query.data.canEdit && query.data.status === 'ACTIVE' && (
            <details className="group-settings">
              <summary>Налаштування групи</summary>
              <form onChange={() => setSettingsDirty(true)} onSubmit={(event) => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                update.mutate({
                  name: data.get('name'),
                  description: data.get('description') || undefined,
                  discoverability: data.get('discoverability'),
                  joinPolicy: data.get('joinPolicy'),
                  expectedVersion: query.data!.version,
                })
              }}>
                <label>Назва<input name="name" defaultValue={query.data.name} required minLength={2} maxLength={120} /></label>
                <label>Опис<textarea name="description" defaultValue={query.data.description ?? ''} rows={3} maxLength={1000} /></label>
                <label>Видимість<select name="discoverability" defaultValue={query.data.discoverability}><option value="LISTED">Видима</option><option value="HIDDEN">Прихована</option></select></label>
                <label>Вступ<select name="joinPolicy" defaultValue={query.data.joinPolicy}><option value="OPEN">Вільний</option><option value="REQUEST">За заявкою</option><option value="INVITE_ONLY">За запрошенням</option></select></label>
                {settingsError && <p className="form-error">{settingsError}</p>}
                <div>
                  <Button disabled={update.isPending}>{update.isPending ? 'Зберігаємо…' : 'Зберегти'}</Button>
                  <Button type="button" variant="ghost" disabled={archive.isPending} onClick={() => archive.mutate()}><Archive size={16} />Архівувати</Button>
                </div>
              </form>
            </details>
          )}
          {query.data.status === 'ARCHIVED' && <p className="privacy-note"><Archive size={17} />Група доступна лише для перегляду.</p>}
        </div>
        )}
      </Drawer>
      <UnsavedChangesDialog
        guard={closeGuard}
        title="Закрити налаштування групи?"
        description="Незбережені зміни групи буде втрачено."
      />
    </>
  )
}

function KnowledgePage() {
  const { articleSlug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<ArticleList | null>(null)
  const client = useQueryClient()
  const canManage = user?.accountType === 'ADMIN'
  const managing = canManage && params.get('manage') === '1'
  const editor = managing ? params.get('edit') : null
  const query = useQuery({ queryKey: ['knowledge', search], queryFn: () => api<{ items: ArticleList[] }>(`/knowledge/articles?search=${encodeURIComponent(search)}`) })
  const remove = useMutation({
    mutationFn: (article: ArticleList) => api(`/knowledge/articles/${article.slug}`, { method: 'DELETE', body: jsonBody({ expectedVersion: article.version }) }),
    onSuccess: async () => {
      setDeleting(null)
      await client.invalidateQueries({ queryKey: ['knowledge'] })
    },
  })
  const openEditor = (slug: string) => setParams((previous) => { const next = new URLSearchParams(previous); next.set('edit', slug); return next })
  const closeEditor = () => setParams((previous) => { const next = new URLSearchParams(previous); next.delete('edit'); return next })

  return <div>
    <PageHeader title="База знань" description="Інструкції, політики та матеріали для щоденної роботи" action={canManage && <Button className="knowledge-manage-button" variant="secondary" aria-pressed={managing} onClick={() => setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (managing) { next.delete('manage'); next.delete('edit') } else next.set('manage', '1')
      return next
    })}>{managing ? <Check size={17} /> : <Pencil size={17} />}{managing ? 'Завершити керування' : 'Керувати матеріалами'}</Button>} />
    <div className="knowledge-layout">
      <Card className="knowledge-feature"><BookOpenCheck size={30} /><span className="eyebrow">Знання команди</span><h2>Знайдіть відповідь без зайвих запитів</h2><label className="search-field"><Search size={18} /><input aria-label="Пошук матеріалів" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Введіть тему або ключове слово" /></label></Card>
      <section className="article-grid" aria-label="Матеріали бази знань">
        {query.isLoading ? <PageDataLoader /> : query.isError ? <ErrorState /> : <>
          {query.data?.items.map((item) => <div className="knowledge-article-card" key={item.id}>
            <Link to={{ pathname: `/knowledge/${item.slug}`, search: params.toString() }}><span className="article-icon"><BookOpenCheck size={20} /></span><div><h3>{item.title}</h3><p>{item.changeSummary || 'Актуальна інструкція LankaDWS'}</p><small>Оновлено {formatDate(item.updatedAt)} · версія {item.version}</small></div></Link>
            {managing && <div className="knowledge-article-actions"><Button variant="secondary" aria-label={`Редагувати ${item.title}`} onClick={() => openEditor(item.slug)}><Pencil size={16} />Редагувати</Button><Button variant="danger" aria-label={`Видалити ${item.title}`} onClick={() => setDeleting(item)}><Trash2 size={16} />Видалити</Button></div>}
          </div>)}
          {!query.data?.items.length && <p className="knowledge-empty">{search ? 'За вашим запитом матеріалів не знайдено.' : 'Матеріалів поки немає.'}</p>}
          {managing && <button type="button" className="knowledge-add-card" onClick={() => openEditor('new')}><span><Plus size={32} /></span><strong>Додати матеріал</strong><small>Створіть нову інструкцію для команди</small></button>}
        </>}
      </section>
    </div>
    {deleting && <ConfirmationDialog title="Видалити матеріал?" description={`«${deleting.title}» буде прибрано з бази знань. Його можна буде відновити лише через технічне втручання.`} onRequestClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} confirmLabel={remove.isPending ? 'Видаляємо…' : 'Видалити'} confirmDisabled={remove.isPending} />}
    {editor ? <KnowledgeEditor key={editor} slug={editor === 'new' ? undefined : editor} onClose={closeEditor} /> : articleSlug && <ArticleDrawer slug={articleSlug} onClose={() => navigate({ pathname: '/knowledge', search: params.toString() })} />}
  </div>
}

function KnowledgeEditor({ slug, onClose }: { slug?: string; onClose: () => void }) {
  const client = useQueryClient()
  const [dirty, setDirty] = useState(false)
  const [newSlug] = useState(() => `article-${randomId()}`)
  const [draft, setDraft] = useState<ArticleDetail | null>(null)
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([])
  const closeGuard = useModalCloseGuard({ dirty, onRequestClose: onClose })
  const article = useQuery({ queryKey: ['article', slug], queryFn: () => api<ArticleDetail>(`/knowledge/articles/${slug}`), enabled: Boolean(slug) })
  useEffect(() => {
    if (article.data?.currentVersion) setDraft((current) => current ?? article.data)
  }, [article.data])
  const companies = useQuery({ queryKey: ['knowledge-company-options'], queryFn: () => api<{ items: KnowledgeCompanyOption[] }>('/admin/companies') })
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
    if (attachmentFiles.length === 0) return []
    const companyId = audienceCompanyIds[0] ?? activeCompanies[0]?.id
    if (!companyId) throw new Error('Немає активної компанії для завантаження файлу.')
    const attachmentIds: string[] = []
    for (const file of attachmentFiles) {
      const formData = new FormData()
      formData.set('file', file)
      const uploaded = await api<{ id: string; scanStatus: string }>(`/files?company=${encodeURIComponent(companyId)}`, { method: 'POST', body: formData })
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
    mutationFn: async (data: FormData) => api(slug ? `/knowledge/articles/${slug}` : '/knowledge/articles', {
      method: slug ? 'PATCH' : 'POST',
      body: jsonBody({ title: data.get('title'), body: data.get('body'), changeSummary: data.get('changeSummary') ?? '', attachmentIds: await uploadAttachments(), companyIds: audienceCompanyIds, ...(slug ? { expectedVersion: Number(data.get('expectedVersion')) } : { slug: newSlug }) }),
    }),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['knowledge'] }), client.invalidateQueries({ queryKey: ['article'] })])
      closeGuard.closeForSuccess(onClose)
    },
  })
  const ready = slug ? Boolean(draft?.currentVersion) : activeCompanies.length > 0
  return <>
    <Modal
      title={slug ? 'Редагувати матеріал' : 'Додати матеріал'}
      description={slug ? 'Оновіть текст і аудиторію матеріалу.' : 'Опублікуйте інструкцію для потрібних компаній.'}
      size="lg"
      closeDisabled={save.isPending}
      onBeforeClose={closeGuard.shouldClose}
      onRequestClose={save.isPending ? () => {} : closeGuard.requestClose}
    >
      {(slug ? article.isLoading || companies.isLoading : companies.isLoading) ? <PageDataLoader /> : !ready ? <ErrorState /> : <form className="entity-form" onChange={() => setDirty(true)} onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(new FormData(event.currentTarget)) }}>
        {slug && <input type="hidden" name="expectedVersion" value={draft?.version ?? ''} />}
        <label className="span-2">Назва<input name="title" required defaultValue={draft?.currentVersion?.title ?? ''} autoFocus disabled={save.isPending} /></label>
        <label className="span-2">Текст матеріалу<textarea name="body" rows={12} required defaultValue={draft?.currentVersion?.body ?? ''} disabled={save.isPending} /></label>
        {slug && <label className="span-2">Короткий опис змін<input name="changeSummary" placeholder="Що оновлено в цій версії" disabled={save.isPending} /></label>}
        <fieldset className="knowledge-audience span-2" disabled={save.isPending}>
          <legend>Хто побачить статтю</legend>
          <div className="knowledge-audience__companies">
            {activeCompanies.map((company) => <label className="check-label" key={company.id}>
              <input type="checkbox" checked={audienceCompanyIds.includes(company.id)} onChange={(event) => toggleCompany(company.id, event.target.checked)} />
              {company.name}
            </label>)}
          </div>
          {audienceCompanyIds.length === 0 && <p className="knowledge-audience__hint" role="alert">Оберіть щонайменше одну компанію.</p>}
        </fieldset>
        <div className="span-2 knowledge-attachments-upload">
          <span className="knowledge-attachments-upload__label">Файли</span>
          <FileDropzone
            label="Додати файли"
            multiple
            resetAfterSelect
            disabled={save.isPending}
            title="Перетягніть файли сюди"
            hint="Файли буде прикріплено після перевірки безпеки."
            onFiles={(files) => setAttachmentFiles((current) => [
              ...current,
              ...files.filter((file) => !current.some((picked) => picked.name === file.name && picked.size === file.size)),
            ])}
          >
            {attachmentFiles.length > 0 && (
              <ul className="file-dropzone-files" aria-label="Вибрані файли">
                {attachmentFiles.map((file) => (
                  <li key={`${file.name}-${file.size}`}>
                    <FileIcon size={15} aria-hidden="true" />
                    <span>{file.name}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Прибрати ${file.name}`}
                      disabled={save.isPending}
                      onClick={() => setAttachmentFiles((current) => current.filter((picked) => (
                        picked.name !== file.name || picked.size !== file.size
                      )))}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FileDropzone>
        </div>
        {draft?.attachments.length ? <section className="knowledge-existing-files" aria-label="Прикріплені файли"><strong>Прикріплені файли</strong><ul className="knowledge-file-list">{draft.attachments.map((file) => <KnowledgeExistingFile key={file.id} file={file} />)}</ul></section> : null}
        {save.isError && <p className="form-error span-2" role="alert">{save.error instanceof Error ? save.error.message : 'Не вдалося зберегти матеріал. Спробуйте ще раз.'}</p>}
        <Button type="submit" className="span-2 knowledge-save-button" disabled={save.isPending || audienceCompanyIds.length === 0}>{save.isPending ? 'Зберігаємо…' : slug ? 'Зберегти зміни' : 'Опублікувати матеріал'}</Button>
      </form>}
    </Modal>
    <UnsavedChangesDialog
      guard={closeGuard}
      title={slug ? 'Закрити редагування матеріалу?' : 'Закрити створення матеріалу?'}
      description={slug
        ? 'Незбережені зміни матеріалу буде втрачено.'
        : 'Новий матеріал не буде опубліковано.'}
    />
  </>
}

function ArticleDrawer({ slug, onClose }: { slug: string; onClose: () => void }) {
  const client = useQueryClient(); const query = useQuery({ queryKey: ['article', slug], queryFn: () => api<ArticleDetail>(`/knowledge/articles/${slug}`) })
  const ack = useMutation({ mutationFn: () => api(`/knowledge/articles/${slug}/acknowledge`, { method: 'POST', body: jsonBody({ expectedVersion: query.data?.version }) }), onSuccess: () => void client.invalidateQueries({ queryKey: ['article', slug] }) })
  return <Drawer title="Стаття" onRequestClose={() => onClose()} footer={query.data && !query.data.acknowledgement?.confirmedAt && <Button onClick={() => ack.mutate()}><Check size={17} />Підтвердити ознайомлення</Button>}>{query.isLoading ? <Skeleton /> : query.isError || !query.data?.currentVersion ? <ErrorState /> : <article className="article-detail"><span className="eyebrow">Версія {query.data.version}</span><h2>{query.data.currentVersion.title}</h2><p className="article-meta">Опубліковано {formatDateTime(query.data.currentVersion.publishedAt)}</p><div className="article-body">{query.data.currentVersion.body.split('\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>{query.data.attachments.length > 0 && <section className="knowledge-existing-files"><strong>Прикріплені файли</strong><div className="knowledge-attachment-list">{query.data.attachments.map((file) => <KnowledgeAttachmentPreview key={file.id} attachment={file} />)}</div></section>}{query.data.acknowledgement?.confirmedAt && <p className="success-note"><Check size={17} />Ви ознайомилися {formatDateTime(query.data.acknowledgement.confirmedAt)}</p>}</article>}</Drawer>
}

function KnowledgeExistingFile({ file }: { file: KnowledgeAttachment }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  return (
    <li>
      <FileIcon size={16} />
      {file.scanStatus === 'CLEAN' ? (
        <button type="button" className="knowledge-file-list__preview" onClick={() => setPreviewOpen(true)}>
          {file.safeFilename}
        </button>
      ) : <span className="knowledge-file-list__name">{file.safeFilename}</span>}
      <small>{file.scanStatus === 'CLEAN' ? 'Готовий' : 'Перевіряється'}</small>
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
  const query = useQuery({
    queryKey: ['employees', search, companyId, orgUnitId, managerId, presence],
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
              <label className="directory-filter">
                <span>Керівник</span>
                <select value={managerId} onChange={(event) => updateFilter('manager', event.target.value)}>
                  <option value="">Усі керівники</option>
                  {query.data?.filters.managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.displayName}</option>)}
                </select>
              </label>
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
          <span><strong>{query.data?.items.length ?? 0}</strong> знайдено</span>
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
                    <Avatar size="lg" name={item.displayName} src={item.avatarAsset} />
                    <span>
                      <strong>{item.displayName}</strong>
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
                      aria-label={`Написати ${item.displayName}`}
                      title={`Написати ${item.displayName}`}
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
      </Card>
    </div>
  )
}

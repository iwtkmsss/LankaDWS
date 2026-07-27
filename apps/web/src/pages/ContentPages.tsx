import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OrganizationCapability, type DocumentListItem, type GroupDetailView, type GroupListResult } from '@bert-crm/contracts'
import { Archive, ArchiveRestore, BarChart3, BookOpenCheck, Building2, CalendarClock, Check, CheckSquare2, Download, File as FileIcon, FileCheck2, FileImage, FilePlus2, Files, LockKeyhole, LogOut, MessageCircle, Network, Newspaper, Plus, Search, ShieldCheck, UserPlus, UsersRound, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { Avatar, Button, Card, Drawer, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '../shared/ui'

interface ArticleList { id: string; slug: string; title: string; changeSummary: string; reviewAt: string | null; version: number; updatedAt: string }
interface ArticleDetail { id: string; slug: string; version: number; reviewAt?: string | null; currentVersion: { title: string; body: string; changeSummary: string; publishedAt: string } | null; acknowledgement: { confirmedAt?: string | null } | null }
interface Employee {
  id: string
  displayName: string
  displayRole: string
  jobTitle: string
  positionTitle?: string
  timezone: string
  avatarAsset: string | null
  presence: string
  contactEmail?: string | null
  orgUnit?: { id: string; name: string } | null
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
type DriveSection = 'ALL' | 'MINE' | 'SHARED' | 'DRAFTS' | 'ARCHIVED'
interface DriveDocument extends DocumentListItem {
  ownerId: string
  isOwner: boolean
  versionCount: number
  sizeBytes: number | null
  fileType: 'DOCUMENT' | 'IMAGE' | 'OTHER'
  archivedAt: string | null
}
interface DriveResult {
  items: DriveDocument[]
  counts: Record<DriveSection, number>
}

export default function ContentPages() {
  const path = useLocation().pathname
  if (path.startsWith('/groups')) return <GroupsPage />
  if (path.startsWith('/drive')) return <DocumentsPage basePath="/drive" title="Диск" />
  if (path.startsWith('/documents')) return <DocumentsPage basePath="/documents" title="Документи" />
  if (path.startsWith('/knowledge')) return <KnowledgePage />
  if (path.startsWith('/employees')) return <EmployeesPage />
  return <AnalyticsPage />
}

function DocumentsPage({ basePath, title }: { basePath: '/drive' | '/documents'; title: string }) {
  const { documentId } = useParams()
  const navigate = useNavigate()
  const { can, canUseCapability, user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const search = params.get('q') ?? ''
  const companyId = user?.organization.id ?? ''
  const requestedCreate = params.get('new') === '1'
  const section = (params.get('section') ?? 'ALL') as DriveSection
  const fileType = params.get('type') ?? 'ALL'
  const sort = params.get('sort') ?? 'RECENT'
  const requestQuery = new URLSearchParams({ section, type: fileType, sort })
  if (search) requestQuery.set('search', search)
  if (companyId) requestQuery.set('company', companyId)
  const query = useQuery({
    queryKey: ['documents', search, companyId, section, fileType, sort],
    queryFn: () => api<DriveResult>(`/documents?${requestQuery.toString()}`),
  })
  const featureEnabled = basePath === '/documents' || canUseCapability(OrganizationCapability.Drive)
  const createCompanyId = companyId
  const canCreate = can('documents.manage') && featureEnabled && Boolean(companyId)
  useEffect(() => {
    if (!requestedCreate || !canCreate) return
    setCreating(true)
    setParams((current) => {
      current.delete('new')
      return current
    }, { replace: true })
  }, [canCreate, requestedCreate, setParams])
  const updateFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value && value !== 'ALL' && value !== 'RECENT') next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }
  const currentQuery = params.toString()
  const sections: Array<{ id: DriveSection; label: string }> = [
    { id: 'ALL', label: 'Усі файли' },
    { id: 'MINE', label: 'Мої' },
    { id: 'SHARED', label: 'Спільні' },
    { id: 'DRAFTS', label: 'Чернетки' },
    { id: 'ARCHIVED', label: 'Архів' },
  ]
  return (
    <div>
      <PageHeader
        title={title}
        description="Робочі файли, актуальні версії та зрозумілий доступ в одному місці"
        action={canCreate && (
          <Button onClick={() => setCreating(true)}><FilePlus2 size={17} />Завантажити файл</Button>
        )}
      />
      <Card className="drive-card">
        <div className="tabs drive-sections" role="tablist" aria-label="Розділи диска">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={section === item.id}
              className={section === item.id ? 'is-active' : ''}
              onClick={() => updateFilter('section', item.id)}
            >
              {item.label}<span>{query.data?.counts[item.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="drive-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Назва або номер файлу"
            />
          </label>
          <label>
            <span>Тип</span>
            <select value={fileType} onChange={(event) => updateFilter('type', event.target.value)}>
              <option value="ALL">Усі типи</option>
              <option value="DOCUMENT">Документи</option>
              <option value="IMAGE">Зображення</option>
              <option value="OTHER">Інші</option>
            </select>
          </label>
          <label>
            <span>Сортування</span>
            <select value={sort} onChange={(event) => updateFilter('sort', event.target.value)}>
              <option value="RECENT">Нещодавно змінені</option>
              <option value="NAME">За назвою</option>
              <option value="OWNER">За власником</option>
            </select>
          </label>
        </div>
        {query.isLoading ? <Skeleton rows={6} /> : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <div className="responsive-table drive-table">
            <table>
              <thead><tr><th>Файл</th><th>Власник</th><th>Версії</th><th>Оновлено</th><th>Статус</th></tr></thead>
              <tbody>
                {query.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`${basePath}/${item.id}${currentQuery ? `?${currentQuery}` : ''}`}>
                        <span className={`drive-file-icon drive-file-icon--${item.fileType.toLowerCase()}`}>
                          {item.fileType === 'IMAGE' ? <FileImage size={19} /> : item.fileType === 'DOCUMENT' ? <FileIcon size={19} /> : <Files size={19} />}
                        </span>
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.number} · {formatFileSize(item.sizeBytes)}</small>
                        </span>
                      </Link>
                    </td>
                    <td>{item.isOwner ? 'Ви' : item.ownerName}</td>
                    <td>{item.versionCount}</td>
                    <td>{formatDateTime(item.updatedAt)}</td>
                    <td><StatusBadge status={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={section === 'ARCHIVED' ? 'Архів порожній' : 'Файлів не знайдено'}
            description={search || fileType !== 'ALL' ? 'Змініть пошук або тип файлу.' : 'Завантажте перший робочий файл.'}
            illustration={search || fileType !== 'ALL' ? 'search' : 'workspace'}
            action={canCreate && section !== 'ARCHIVED' && <Button onClick={() => setCreating(true)}><FilePlus2 size={17} />Завантажити</Button>}
          />
        )}
      </Card>
      {documentId && (
        <DocumentDrawer
          id={documentId}
          onClose={() => navigate(`${basePath}${currentQuery ? `?${currentQuery}` : ''}`)}
        />
      )}
      {creating && (
        <DocumentCreate
          companyId={createCompanyId}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            navigate(`${basePath}/${id}${currentQuery ? `?${currentQuery}` : ''}`)
          }}
        />
      )}
    </div>
  )
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return 'розмір невідомий'
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function GroupsPage() {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const { can, canUseCapability, user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [creating, setCreating] = useState(false)
  const requestedCreate = params.get('new') === '1'
  const status = params.get('status') === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'
  const company = user?.organization.id ?? ''
  const queryParams = new URLSearchParams({ status, limit: '50' })
  if (company) queryParams.set('company', company)
  if (search.trim()) queryParams.set('query', search.trim())
  const query = useQuery({
    queryKey: ['groups', company, status, search],
    queryFn: () => api<GroupListResult>(`/groups?${queryParams.toString()}`),
  })
  const createCompanyId = company
  const canCreate = can('groups.create') && canUseCapability(OrganizationCapability.GroupsUi) && Boolean(company)
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
        {query.isLoading ? <Skeleton rows={6} /> : query.isError ? (
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
  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) => api<{ id: string }>('/groups', {
      method: 'POST',
      body: jsonBody(input),
    }),
    onSuccess: (result) => onCreated(result.id),
    onError: () => setError('Не вдалося створити групу. Перевірте назву й доступ.'),
  })
  return (
    <Drawer title="Нова робоча група" onClose={onClose}>
      <form className="entity-form" onSubmit={(event) => {
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
  )
}

function GroupDrawer({ id, company, onClose }: { id: string; company: string; onClose: () => void }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const { can, canUseCapability } = useAuth()
  const [settingsError, setSettingsError] = useState('')
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
    <Drawer title="Робоча група" onClose={onClose} footer={footer}>
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
                {can('feed.read') && canUseCapability(OrganizationCapability.Feed) && (
                  <Link to={`/overview?company=${encodeURIComponent(query.data.companyId)}&groupId=${encodeURIComponent(id)}`}>
                    <Newspaper size={19} />
                    <span><strong>Стрічка</strong><small>Оновлення групи</small></span>
                  </Link>
                )}
                {can('tasks.read') && (
                  <Link to={`/tasks?company=${encodeURIComponent(query.data.companyId)}&groupId=${encodeURIComponent(id)}`}>
                    <CheckSquare2 size={19} />
                    <span><strong>Завдання</strong><small>Робота команди</small></span>
                  </Link>
                )}
                {can('tasks.create') && (
                  <Link to={`/tasks/new?company=${encodeURIComponent(query.data.companyId)}&groupId=${encodeURIComponent(id)}`}>
                    <Plus size={19} />
                    <span><strong>Нове завдання</strong><small>У контексті групи</small></span>
                  </Link>
                )}
                {can('messages.write') && (
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
                  <Avatar size="sm" name={member.user.displayName} src={member.user.avatarAsset} />
                  <span><strong>{member.user.displayName}</strong><small>{member.role === 'OWNER' ? 'Власник' : member.role === 'MODERATOR' ? 'Модератор' : 'Учасник'}</small></span>
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
                    <Avatar size="sm" name={request.requester.displayName} src={request.requester.avatarAsset} />
                    <strong>{request.requester.displayName}</strong>
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
              <form onSubmit={(event) => {
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
  )
}

function DocumentCreate({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { user } = useAuth()
  const selectedCompany = companyId || user?.organization.id || ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const file = data.get('file') as globalThis.File
    try {
      const upload = new FormData()
      upload.set('file', file)
      const uploaded = await api<{ id: string; status: string }>(`/files?company=${selectedCompany}`, { method: 'POST', body: upload })
      let status = uploaded.status
      for (let attempt = 0; attempt < 10 && status !== 'CLEAN'; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 600))
        status = (await api<{ status: string }>(`/files/${uploaded.id}/status`)).status
      }
      if (status !== 'CLEAN') throw new Error('scan')
      const document = await api<{ id: string }>('/documents', {
        method: 'POST',
        body: jsonBody({
          companyId: selectedCompany,
          name: data.get('name'),
          fileId: uploaded.id,
          changeSummary: data.get('summary'),
        }),
      })
      onCreated(document.id)
    } catch {
      setError('Файл не пройшов перевірку або документ не вдалося створити.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Drawer title="Новий документ" onClose={onClose}>
      <form className="entity-form" onSubmit={submit}>
        <label className="span-2">Назва<input name="name" required maxLength={180} /></label>
        <label className="span-2 file-input">
          <FilePlus2 /><span>PDF, DOCX, TXT, PNG, JPEG або WEBP · до 25 МБ</span>
          <input type="file" name="file" required accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp" />
        </label>
        <label className="span-2">Що у версії<input name="summary" placeholder="Перша версія" maxLength={180} /></label>
        {error && <div className="form-error span-2">{error}</div>}
        <Button className="span-2" disabled={busy}>{busy ? 'Перевіряємо файл…' : 'Завантажити на Диск'}</Button>
      </form>
    </Drawer>
  )
}

function DocumentDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  interface Detail {
    id: string
    number: string
    companyId: string
    name: string
    status: string
    version: number
    confidentiality: string
    archivedAt: string | null
    versions: Array<{ id: string; fileId: string; version: number; changeSummary: string; createdAt: string; status: string }>
  }
  const client = useQueryClient()
  const { can } = useAuth()
  const [versionError, setVersionError] = useState('')
  const query = useQuery({ queryKey: ['document', id], queryFn: () => api<Detail>(`/documents/${id}`) })
  const refresh = async () => {
    await Promise.all([
      query.refetch(),
      client.invalidateQueries({ queryKey: ['documents'] }),
    ])
  }
  const publish = useMutation({
    mutationFn: () => api(`/documents/${id}/publish`, {
      method: 'POST',
      body: jsonBody({ expectedVersion: query.data?.version }),
    }),
    onSuccess: refresh,
  })
  const archive = useMutation({
    mutationFn: () => api(`/documents/${id}/archive`, {
      method: 'POST',
      body: jsonBody({ expectedVersion: query.data?.version }),
    }),
    onSuccess: refresh,
  })
  const restore = useMutation({
    mutationFn: () => api(`/documents/${id}/restore`, {
      method: 'POST',
      body: jsonBody({ expectedVersion: query.data?.version }),
    }),
    onSuccess: refresh,
  })
  const addVersion = useMutation({
    mutationFn: async ({ file, summary }: { file: globalThis.File; summary: string }) => {
      const upload = new FormData()
      upload.set('file', file)
      const uploaded = await api<{ id: string; status: string }>(`/files?company=${query.data?.companyId}`, { method: 'POST', body: upload })
      let status = uploaded.status
      for (let attempt = 0; attempt < 10 && status !== 'CLEAN'; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 600))
        status = (await api<{ status: string }>(`/files/${uploaded.id}/status`)).status
      }
      if (status !== 'CLEAN') throw new Error('scan')
      return api(`/documents/${id}/versions`, {
        method: 'POST',
        body: jsonBody({ fileId: uploaded.id, changeSummary: summary || undefined, expectedVersion: query.data?.version }),
      })
    },
    onSuccess: () => {
      setVersionError('')
      void query.refetch()
      void client.invalidateQueries({ queryKey: ['documents'] })
    },
    onError: () => setVersionError('Нову версію не додано. Оновіть документ або перевірте файл.'),
  })
  const footer = query.data && can('documents.manage') ? (
    <div className="document-drawer-actions">
      {query.data.archivedAt ? (
        <Button variant="secondary" disabled={restore.isPending} onClick={() => restore.mutate()}>
          <ArchiveRestore size={17} />Відновити
        </Button>
      ) : (
        <>
          <Button variant="ghost" disabled={archive.isPending} onClick={() => archive.mutate()}>
            <Archive size={17} />В архів
          </Button>
          {query.data.status === 'DRAFT' && (
            <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
              <FileCheck2 size={17} />Опублікувати
            </Button>
          )}
        </>
      )}
    </div>
  ) : undefined
  return (
    <Drawer title={query.data?.number ?? 'Документ'} onClose={onClose} footer={footer}>
      {query.isLoading ? <Skeleton /> : query.isError || !query.data ? <ErrorState /> : (
        <div className="detail-stack">
          <div>
            <StatusBadge status={query.data.archivedAt ? 'ARCHIVED' : query.data.status} />
            <h3>{query.data.name}</h3>
            <p className="privacy-note"><ShieldCheck size={17} />Доступ перевіряється під час кожного відкриття.</p>
          </div>
          {can('documents.manage') && !query.data.archivedAt && (
            <form
              className="document-version-form"
              onSubmit={(event) => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                const file = data.get('file')
                if (file instanceof globalThis.File && file.size > 0) {
                  addVersion.mutate({ file, summary: String(data.get('summary') ?? '') })
                }
              }}
            >
              <h4>Додати нову версію</h4>
              <label className="file-input">
                <FilePlus2 /><span>Оберіть оновлений файл</span>
                <input type="file" name="file" required accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp" />
              </label>
              <input name="summary" placeholder="Що змінилося" maxLength={180} />
              {versionError && <p className="form-error">{versionError}</p>}
              <Button variant="secondary" disabled={addVersion.isPending}>
                {addVersion.isPending ? 'Перевіряємо…' : 'Додати версію'}
              </Button>
            </form>
          )}
          <section>
            <h4>Версії</h4>
            <div className="version-list">
              {query.data.versions.map((version) => (
                <article key={version.id}>
                  <FileIcon size={20} />
                  <span>
                    <strong>Версія {version.version}</strong>
                    <small>{version.changeSummary} · {formatDateTime(version.createdAt)}</small>
                  </span>
                  <a className="icon-button" aria-label="Завантажити" href={`/api/v1/files/${version.fileId}/download`}>
                    <Download size={17} />
                  </a>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  )
}

function KnowledgePage() {
  const { articleSlug } = useParams(); const navigate = useNavigate(); const { can } = useAuth(); const [search, setSearch] = useState('')
  const query = useQuery({ queryKey: ['knowledge', search], queryFn: () => api<{ items: ArticleList[] }>(`/knowledge/articles?search=${encodeURIComponent(search)}`) })
  return <div><PageHeader title="База знань" description="Інструкції, політики та матеріали для щоденної роботи" action={can('knowledge.manage') && <Link to="/admin/system?tab=directories" className="button button--secondary">Керувати матеріалами</Link>} /><div className="knowledge-layout"><Card className="knowledge-feature"><BookOpenCheck size={30} /><span className="eyebrow">Знання команди</span><h2>Знайдіть відповідь без зайвих запитів</h2><label className="search-field"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Введіть тему або ключове слово" /></label></Card><section className="article-grid">{query.isLoading ? <Skeleton rows={6} /> : query.isError ? <ErrorState /> : query.data?.items.map((item) => <Link to={`/knowledge/${item.slug}`} key={item.id}><span className="article-icon"><BookOpenCheck size={20} /></span><div><h3>{item.title}</h3><p>{item.changeSummary || 'Актуальна інструкція BERT CRM'}</p><small>Оновлено {formatDate(item.updatedAt)} · версія {item.version}</small></div></Link>)}</section></div>{articleSlug && <ArticleDrawer slug={articleSlug} onClose={() => navigate('/knowledge')} />}</div>
}

function ArticleDrawer({ slug, onClose }: { slug: string; onClose: () => void }) {
  const client = useQueryClient(); const query = useQuery({ queryKey: ['article', slug], queryFn: () => api<ArticleDetail>(`/knowledge/articles/${slug}`) })
  const ack = useMutation({ mutationFn: () => api(`/knowledge/articles/${slug}/acknowledge`, { method: 'POST', body: jsonBody({ expectedVersion: query.data?.version }) }), onSuccess: () => void client.invalidateQueries({ queryKey: ['article', slug] }) })
  return <Drawer title="Стаття" onClose={onClose} footer={query.data && !query.data.acknowledgement?.confirmedAt && <Button onClick={() => ack.mutate()}><Check size={17} />Підтвердити ознайомлення</Button>}>{query.isLoading ? <Skeleton /> : query.isError || !query.data?.currentVersion ? <ErrorState /> : <article className="article-detail"><span className="eyebrow">Версія {query.data.version}</span><h2>{query.data.currentVersion.title}</h2><p className="article-meta">Опубліковано {formatDateTime(query.data.currentVersion.publishedAt)}</p><div className="article-body">{query.data.currentVersion.body.split('\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>{query.data.acknowledgement?.confirmedAt && <p className="success-note"><Check size={17} />Ви ознайомилися {formatDateTime(query.data.acknowledgement.confirmedAt)}</p>}</article>}</Drawer>
}

function EmployeesPage() {
  const { employeeId } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { can, user } = useAuth()
  const search = params.get('q') ?? ''
  const companyId = user?.organization.id ?? ''
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
  const currentQuery = params.toString()
  const orgUrl = '/employees/org'

  return (
    <div>
      <PageHeader
        title="Працівники"
        description="Знайдіть потрібну людину, команду або керівника без зайвих переходів"
        action={can('employees.org.read') && (
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
          {can('employees.org.read') && (
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
        {query.isLoading ? <Skeleton rows={6} /> : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <div className="employee-grid">
            {query.data.items.map((item) => (
                <article className="employee-card" key={item.id}>
                  <Link
                    className="employee-card__profile"
                    to={`/employees/${item.id}${currentQuery ? `?${currentQuery}` : ''}`}
                  >
                    <Avatar size="lg" name={item.displayName} src={item.avatarAsset} />
                    <span>
                      <strong>{item.displayName}</strong>
                      <small>{item.positionTitle || item.jobTitle}</small>
                      {item.orgUnit && <small className="employee-org"><Building2 size={12} />{item.orgUnit.name}</small>}
                      <em>
                        <i className={`presence presence--${item.presence.toLowerCase()}`} />
                        {item.presence === 'AVAILABLE' ? 'Доступний' : 'Відсутній'}
                      </em>
                    </span>
                  </Link>
                  {can('messages.write') && item.id !== user?.id && (
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
      {employeeId && (
        <EmployeeDrawer
          id={employeeId}
          onClose={() => navigate(`/employees${currentQuery ? `?${currentQuery}` : ''}`)}
        />
      )}
    </div>
  )
}

function EmployeeDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user, can, canUseCapability } = useAuth()
  const query = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api<Employee>(`/employees/${id}`),
  })
  return (
    <Drawer title="Профіль працівника" onClose={onClose}>
      {query.isLoading ? <Skeleton /> : query.isError || !query.data ? <ErrorState /> : (
        <div className="employee-detail">
          <Avatar size="lg" name={query.data.displayName} src={query.data.avatarAsset} />
          <h3>{query.data.displayName}</h3>
          <p>{query.data.positionTitle || query.data.jobTitle} · {query.data.displayRole}</p>
          <div className="employee-actions">
            {can('messages.write') && query.data.id !== user?.id && (
              <Link
                className="button button--primary"
                to={`/messages?new=1&to=${encodeURIComponent(query.data.id)}`}
              >
                <MessageCircle size={16} />
                Написати
              </Link>
            )}
            {can('tasks.create') && (
              <Link
                className="button button--secondary"
                to={`/tasks/new?assigneeId=${encodeURIComponent(query.data.id)}`}
              >
                <CheckSquare2 size={16} />
                Поставити завдання
              </Link>
            )}
            {can('calendar.manage')
              && canUseCapability(OrganizationCapability.CalendarWrite)
              && (
                <Link
                  className="button button--secondary"
                  to={`/calendar?new=1&title=${encodeURIComponent(`Зустріч: ${query.data.displayName}`)}`}
                >
                  <CalendarClock size={16} />
                  Запланувати час
                </Link>
              )}
          </div>
          <dl className="detail-grid">
            {query.data.orgUnit && <div><dt>Підрозділ</dt><dd>{query.data.orgUnit.name}</dd></div>}
            <div><dt>Керівник</dt><dd>{query.data.approver?.displayName ?? 'Не вказано'}</dd></div>
            <div><dt>Часовий пояс</dt><dd>{query.data.timezone}</dd></div>
            {query.data.contactEmail && <div><dt>Контакт</dt><dd><a href={`mailto:${query.data.contactEmail}`}>{query.data.contactEmail}</a></dd></div>}
          </dl>
          <section>
            <h4>Найближча присутність</h4>
            {query.data.upcomingPresence?.length ? query.data.upcomingPresence.map((item) => (
              <p key={item.startAt}><CalendarClock size={16} />{item.state} · {formatDate(item.startAt)} — {formatDate(item.endAt)}</p>
            )) : <p className="muted">Особливих статусів немає.</p>}
          </section>
        </div>
      )}
    </Drawer>
  )
}

function AnalyticsPage() {
  interface Data { kpis: { taskCompletion: number; taskOverdue: number; requestTotal: number; activeLifecycle: number }; requests: Array<{ decisionStatus: string; _count: { id: number } }>; lifecycle: Array<{ processType: string; status: string; _count: { id: number }; _avg: { progress: number | null } }> }
  const query = useQuery({ queryKey: ['analytics'], queryFn: () => api<Data>('/analytics') })
  if (query.isLoading) return <><PageHeader title="Аналітика" /><Skeleton rows={7} /></>
  if (query.isError || !query.data) return <ErrorState />
  const max = Math.max(1, ...query.data.requests.map((item) => item._count.id))
  return <div><PageHeader title="Аналітика" description="Агреговані показники лише в межах доступного company scope" /><div className="kpi-grid"><Kpi icon={Check} label="Виконання задач" value={`${query.data.kpis.taskCompletion}%`} /><Kpi icon={CalendarClock} label="Прострочені" value={query.data.kpis.taskOverdue} /><Kpi icon={FileIcon} label="Усього заявок" value={query.data.kpis.requestTotal} /><Kpi icon={UsersRound} label="Активні процеси" value={query.data.kpis.activeLifecycle} /></div><div className="analytics-grid"><Card><h2>Рішення за заявками</h2><div className="bar-chart">{query.data.requests.map((item) => <div key={item.decisionStatus}><span>{item.decisionStatus}</span><i><b style={{ width: `${item._count.id / max * 100}%` }} /></i><strong>{item._count.id}</strong></div>)}</div></Card><Card><h2>Онбординг і офбординг</h2>{query.data.lifecycle.length ? query.data.lifecycle.map((item) => <article className="lifecycle-stat" key={`${item.processType}:${item.status}`}><BarChart3 size={19} /><span><strong>{item.processType}</strong><small>{item.status} · середній прогрес {Math.round(item._avg.progress ?? 0)}%</small></span><b>{item._count.id}</b></article>) : <EmptyState title="Процесів немає" description="Дані з’являться після запуску процесу." />}</Card></div></div>
}

function Kpi({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string | number }) { return <Card className="kpi-card"><span><Icon size={20} /></span><div><strong>{value}</strong><small>{label}</small></div></Card> }

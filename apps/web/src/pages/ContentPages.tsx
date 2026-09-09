import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OrganizationCapability, type DocumentListItem, type GroupDetailView, type GroupListResult } from '@bert-crm/contracts'
import { Archive, ArchiveRestore, BookOpenCheck, Building2, Check, CheckSquare2, Download, Eye, File as FileIcon, FileCheck2, FileImage, FilePlus2, Files, LockKeyhole, LogOut, MessageCircle, Network, Newspaper, Pencil, Plus, Search, Trash2, UserPlus, UsersRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, jsonBody, randomId } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { formatDate, formatDateTime } from '../shared/lib/format'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { FilePreviewModal } from '../shared/files/FilePreviewModal'
import {
  Avatar,
  Button,
  Card,
  ConfirmationDialog,
  Drawer,
  EmptyState,
  ErrorState,
  PageDataLoader,
  PageHeader,
  Skeleton,
  StatusBadge,
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../shared/ui'

interface ArticleList { id: string; slug: string; title: string; changeSummary: string; reviewAt: string | null; version: number; updatedAt: string }
interface KnowledgeAttachment { id: string; safeFilename: string; bytes: number; mimeType: string | null; scanStatus: string }
interface ArticleDetail { id: string; slug: string; version: number; reviewAt?: string | null; currentVersion: { title: string; body: string; changeSummary: string; publishedAt: string } | null; acknowledgement: { confirmedAt?: string | null } | null; attachments: KnowledgeAttachment[] }
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
  return null
}

function DocumentsPage({ basePath, title }: { basePath: '/drive' | '/documents'; title: string }) {
  const { documentId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const search = params.get('q') ?? ''
  const companyId = user?.company?.id ?? ''
  const requestedCreate = params.get('new') === '1'
  const section = (params.get('section') ?? 'ALL') as DriveSection
  const fileType = params.get('type') ?? 'ALL'
  const sort = params.get('sort') ?? 'RECENT'
  const requestQuery = new URLSearchParams({ section, type: fileType, sort })
  if (search) requestQuery.set('search', search)
  if (basePath !== '/drive' && companyId) requestQuery.set('company', companyId)
  const query = useQuery({
    queryKey: ['documents', basePath === '/drive' ? 'all' : companyId, search, section, fileType, sort],
    queryFn: () => api<DriveResult>(`/documents?${requestQuery.toString()}`),
  })
  const createCompanyId = companyId
  const isGlobalAdmin = user?.accountType === 'ADMIN' && !user.company
  const canCreate = Boolean(companyId) || isGlobalAdmin
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
          <Button onClick={() => setCreating(true)}>
            <FilePlus2 size={17} />
            {basePath === '/drive' ? 'Додати файл' : 'Завантажити файл'}
          </Button>
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
        {query.isLoading ? <PageDataLoader /> : query.isError ? (
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
      <Drawer title="Нова робоча група" onRequestClose={closeGuard.requestClose}>
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
      <UnsavedChangesDialog guard={closeGuard} />
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
      <Drawer title="Робоча група" onRequestClose={closeGuard.requestClose} footer={footer}>
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
      <UnsavedChangesDialog guard={closeGuard} />
    </>
  )
}

function DocumentCreate({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [documentName, setDocumentName] = useState('')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const closeGuard = useModalCloseGuard({ dirty, onRequestClose: () => onClose() })
  const selectFile = (file: File | undefined) => {
    if (!file) return
    setSelectedFileName(file.name)
    setDocumentName((current) => current || file.name.replace(/\.[^/.]+$/, ''))
    setDirty(true)
  }
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.currentTarget.files?.[0])
  }
  const handleFileDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setIsDraggingFile(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    if (fileInputRef.current) fileInputRef.current.files = event.dataTransfer.files
    selectFile(file)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const file = data.get('file') as globalThis.File
    try {
      const upload = new FormData()
      upload.set('file', file)
      const uploaded = await api<{ id: string; scanStatus: string }>(`/files${companyId ? `?company=${encodeURIComponent(companyId)}` : ''}`, { method: 'POST', body: upload })
      let scanStatus = uploaded.scanStatus
      for (let attempt = 0; attempt < 10 && scanStatus !== 'CLEAN'; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 600))
        scanStatus = (await api<{ scanStatus: string }>(`/files/${uploaded.id}/status`)).scanStatus
      }
      if (scanStatus !== 'CLEAN') throw new Error('scan')
      const document = await api<{ id: string }>('/documents', {
        method: 'POST',
        body: jsonBody({
          ...(companyId ? { companyId } : {}),
          name: data.get('name'),
          fileId: uploaded.id,
        }),
      })
      closeGuard.closeForSuccess(() => onCreated(document.id))
    } catch {
      setError('Файл не пройшов перевірку або документ не вдалося створити.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Drawer
        title="Новий документ"
        closeDisabled={busy}
        onRequestClose={closeGuard.requestClose}
      >
        <form className="entity-form" onChange={() => setDirty(true)} onSubmit={submit}>
          <label className="span-2">Назва<input name="name" required maxLength={180} value={documentName} onChange={(event) => setDocumentName(event.target.value)} /></label>
          <label
            className={`span-2 file-input${isDraggingFile ? ' file-input--drag-active' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setIsDraggingFile(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDraggingFile(false) }}
            onDrop={handleFileDrop}
          >
            <FilePlus2 /><span>PDF, DOCX, TXT, PNG, JPEG або WEBP · до 25 МБ</span>
            <small className="file-input__hint">Перетягніть файл сюди або виберіть його з комп’ютера</small>
            {selectedFileName && <strong className="file-input__name">{selectedFileName}</strong>}
            <input ref={fileInputRef} type="file" name="file" required accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp" onChange={handleFileChange} />
          </label>
          {error && <div className="form-error span-2">{error}</div>}
          <Button className="span-2" disabled={busy}>{busy ? 'Перевіряємо файл…' : 'Завантажити на Диск'}</Button>
        </form>
      </Drawer>
      <UnsavedChangesDialog guard={closeGuard} />
    </>
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
    versions: Array<{
      id: string
      fileId: string
      version: number
      changeSummary: string
      createdAt: string
      status: string
      file: { name: string; mimeType: string; bytes: number; scanStatus: string } | null
    }>
  }
  const client = useQueryClient()
  const [versionError, setVersionError] = useState('')
  const [versionDirty, setVersionDirty] = useState(false)
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null)
  const closeGuard = useModalCloseGuard({
    dirty: versionDirty,
    onRequestClose: () => onClose(),
  })
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
      const uploaded = await api<{ id: string; scanStatus: string }>(`/files?company=${query.data?.companyId}`, { method: 'POST', body: upload })
      let scanStatus = uploaded.scanStatus
      for (let attempt = 0; attempt < 10 && scanStatus !== 'CLEAN'; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 600))
        scanStatus = (await api<{ scanStatus: string }>(`/files/${uploaded.id}/status`)).scanStatus
      }
      if (scanStatus !== 'CLEAN') throw new Error('scan')
      return api(`/documents/${id}/versions`, {
        method: 'POST',
        body: jsonBody({ fileId: uploaded.id, changeSummary: summary || undefined, expectedVersion: query.data?.version }),
      })
    },
    onSuccess: () => {
      setVersionError('')
      setVersionDirty(false)
      void query.refetch()
      void client.invalidateQueries({ queryKey: ['documents'] })
    },
    onError: () => setVersionError('Нову версію не додано. Оновіть документ або перевірте файл.'),
  })
  const footer = query.data ? (
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
  const previewVersion = query.data?.versions.find((version) => version.id === previewVersionId)
    ?? query.data?.versions[0]
  return (
    <>
      <Drawer title={query.data?.number ?? 'Документ'} size="lg" onRequestClose={closeGuard.requestClose} footer={footer}>
        {query.isLoading ? <Skeleton /> : query.isError || !query.data ? <ErrorState /> : (
        <div className="detail-stack">
          <div>
            <StatusBadge status={query.data.archivedAt ? 'ARCHIVED' : query.data.status} />
            <h3>{query.data.name}</h3>
          </div>
          {previewVersion && <DocumentPreview version={previewVersion} />}
          {!query.data.archivedAt && (
            <form
              className="document-version-form"
              onChange={() => setVersionDirty(true)}
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
                  <Button
                    variant={previewVersion?.id === version.id ? 'secondary' : 'ghost'}
                    aria-label={`Переглянути версію ${version.version}`}
                    onClick={() => setPreviewVersionId(version.id)}
                  >
                    <Eye size={17} />Переглянути
                  </Button>
                  <a className="icon-button" aria-label={`Завантажити версію ${version.version}`} href={`/api/v1/files/${version.fileId}/download`}>
                    <Download size={17} />
                  </a>
                </article>
              ))}
            </div>
          </section>
        </div>
        )}
      </Drawer>
      <UnsavedChangesDialog guard={closeGuard} />
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
            <Link to={{ pathname: `/knowledge/${item.slug}`, search: params.toString() }}><span className="article-icon"><BookOpenCheck size={20} /></span><div><h3>{item.title}</h3><p>{item.changeSummary || 'Актуальна інструкція Lanka'}</p><small>Оновлено {formatDate(item.updatedAt)} · версія {item.version}</small></div></Link>
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
  const companies = useQuery({ queryKey: ['knowledge-company-options'], queryFn: () => api<{ items: Array<{ id: string; isActive: boolean }> }>('/admin/companies') })
  async function uploadAttachments() {
    if (attachmentFiles.length === 0) return []
    const companyId = companies.data?.items.find((company) => company.isActive)?.id
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
      body: jsonBody({ title: data.get('title'), body: data.get('body'), changeSummary: data.get('changeSummary') ?? '', attachmentIds: await uploadAttachments(), ...(slug ? { expectedVersion: Number(data.get('expectedVersion')) } : { slug: newSlug, companyIds: companies.data?.items.filter((company) => company.isActive).map((company) => company.id) ?? [] }) }),
    }),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ['knowledge'] }), client.invalidateQueries({ queryKey: ['article'] })])
      closeGuard.closeForSuccess(onClose)
    },
  })
  const ready = slug ? Boolean(draft?.currentVersion) : Boolean(companies.data?.items.some((company) => company.isActive))
  return <>
    <Drawer title={slug ? 'Редагувати матеріал' : 'Додати матеріал'} onRequestClose={save.isPending ? () => {} : closeGuard.requestClose}>
      {(slug ? article.isLoading : companies.isLoading) ? <PageDataLoader /> : !ready ? <ErrorState /> : <form className="entity-form" onChange={() => setDirty(true)} onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(new FormData(event.currentTarget)) }}>
        {slug && <input type="hidden" name="expectedVersion" value={draft?.version ?? ''} />}
        <label className="span-2">Назва<input name="title" required defaultValue={draft?.currentVersion?.title ?? ''} autoFocus disabled={save.isPending} /></label>
        <label className="span-2">Текст матеріалу<textarea name="body" rows={12} required defaultValue={draft?.currentVersion?.body ?? ''} disabled={save.isPending} /></label>
        {slug && <label className="span-2">Короткий опис змін<input name="changeSummary" placeholder="Що оновлено в цій версії" disabled={save.isPending} /></label>}
        <label className="span-2 knowledge-attachments-upload">Файли
          <input aria-label="Додати файли" type="file" multiple onChange={(event) => setAttachmentFiles(Array.from(event.currentTarget.files ?? []))} disabled={save.isPending} />
          <small>Файли буде прикріплено після перевірки безпеки.</small>
        </label>
        {attachmentFiles.length > 0 && <ul className="knowledge-file-list" aria-label="Вибрані файли">{attachmentFiles.map((file) => <li key={`${file.name}-${file.size}`}><FileIcon size={16} />{file.name}</li>)}</ul>}
        {draft?.attachments.length ? <section className="knowledge-existing-files" aria-label="Прикріплені файли"><strong>Прикріплені файли</strong><ul className="knowledge-file-list">{draft.attachments.map((file) => <KnowledgeExistingFile key={file.id} file={file} />)}</ul></section> : null}
        {save.isError && <p className="form-error span-2" role="alert">{save.error instanceof Error ? save.error.message : 'Не вдалося зберегти матеріал. Спробуйте ще раз.'}</p>}
        <Button type="submit" className="span-2 knowledge-save-button" disabled={save.isPending}>{save.isPending ? 'Зберігаємо…' : slug ? 'Зберегти зміни' : 'Опублікувати матеріал'}</Button>
      </form>}
    </Drawer>
    <UnsavedChangesDialog guard={closeGuard} />
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

function DocumentPreview({ version }: { version: { fileId: string; version: number; file: { name: string; mimeType: string; bytes: number; scanStatus: string } | null } }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const file = version.file
  const url = `/api/v1/files/${version.fileId}/download?inline=true`
  const canPreview = file?.scanStatus === 'CLEAN' && (file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/'))
  return (
    <section className="document-preview" aria-label={`Перегляд версії ${version.version}`}>
      <div className="document-preview__header">
        <span><Eye size={18} />Перегляд · версія {version.version}</span>
        <div>
          {file && <Button variant="secondary" onClick={() => setPreviewOpen(true)}><Eye size={16} />Відкрити переглядач</Button>}
          <a className="icon-button" aria-label="Завантажити файл" href={`/api/v1/files/${version.fileId}/download`}><Download size={17} /></a>
        </div>
      </div>
      {canPreview ? file.mimeType.startsWith('image/') ? (
        <img src={url} alt={file.name} />
      ) : (
        <iframe title={`Перегляд ${file.name}`} src={url} />
      ) : (
        <div className="document-preview__unsupported">
          <FileIcon size={28} />
          <strong>{file?.name ?? 'Файл недоступний'}</strong>
          <span>{file ? `${formatFileSize(file.bytes)} · перегляд цього формату недоступний у браузері` : 'Не вдалося знайти дані файлу.'}</span>
          <a className="button button--secondary" href={`/api/v1/files/${version.fileId}/download`}><Download size={16} />Завантажити файл</a>
        </div>
      )}
      {previewOpen && file && <FilePreviewModal file={{ id: version.fileId, fileName: file.name, mimeType: file.mimeType, bytes: file.bytes }} onClose={() => setPreviewOpen(false)} />}
    </section>
  )
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

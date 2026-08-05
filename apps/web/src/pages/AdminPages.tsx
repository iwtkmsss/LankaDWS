import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ImportReadinessView } from '@bert-crm/contracts'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  Database,
  FileClock,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  ShieldAlert,
  Users,
  UsersRound,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { formatDateTime } from '../shared/lib/format'
import {
  Avatar,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  Tabs,
} from '../shared/ui'

interface AdminOverview {
  users: { active: number; inactive: number }
  departments: number
  administrators: number
  twoFactorCoverage: number
  attention: { without2fa: number; failedJobs: number }
  recentAudit: AuditEvent[]
}
interface AdminUser {
  id: string
  displayName: string
  username: string
  jobTitle: string
  isActive: boolean
  accountType: 'ADMIN' | 'USER'
  company: { id: string; name: string } | null
  twoFactor: boolean
  activeSessionCount: number
  avatarAsset: string | null
  updatedAt: string
}
interface AuditEvent {
  id: string
  action: string
  entityType: string
  entityId?: string | null
  actorId?: string | null
  result: string
  risk: string
  correlationId: string
  createdAt: string
}
interface Job {
  id: string
  type: string
  state: string
  attempts: number
  maxAttempts: number
  lastErrorCode?: string | null
  updatedAt: string
}

export default function AdminPages() {
  const path = useLocation().pathname
  if (path === '/admin') return <AdminOverviewPage />
  if (path.startsWith('/admin/users')) return <UsersPage />
  if (path.startsWith('/admin/security')) return <SecurityPage />
  if (path.startsWith('/admin/audit')) return <AuditPage />
  if (path.startsWith('/admin/import')) return <ImportReadinessPage />
  return <SystemPage />
}

function AdminOverviewPage() {
  const query = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api<AdminOverview>('/admin'),
  })
  if (query.isLoading)
    return (
      <>
        <PageHeader title="Адміністрування" />
        <Skeleton rows={7} />
      </>
    )
  if (query.isError || !query.data) return <ErrorState />
  const data = query.data
  const scoped = (path: string) => path
  const attentionItems = [
    {
      id: 'failed-jobs',
      count: data.attention.failedJobs,
      label: 'Фонових робіт з помилкою',
      action: 'Перевірити фонові роботи',
      href: scoped('/admin/system?tab=jobs'),
      icon: ServerCog,
    },
    {
      id: 'without-2fa',
      count: data.attention.without2fa,
      label: 'Активних акаунтів без 2FA',
      action: 'Перевірити захист акаунтів',
      href: scoped('/admin/security'),
      icon: LockKeyhole,
    },
  ].filter((item) => item.count > 0)
  const attentionTotal = attentionItems.reduce((total, item) => total + item.count, 0)
  const primaryAttention = attentionItems[0]
  return (
    <div className="admin-overview">
      <PageHeader title="Адміністрування" description="Користувачі, доступи та безпека в одному робочому огляді" />
      <section className="admin-hero">
        <div className="admin-hero__intro">
          <span className="eyebrow">
            <ShieldCheck size={15} /> Системний фокус
          </span>
          <h2>{attentionTotal ? 'Спочатку усуньте критичні ризики.' : 'Критичних ризиків не виявлено.'}</h2>
          <p>
            {attentionTotal
              ? `${attentionTotal} ${attentionTotal === 1 ? 'запис потребує' : 'записів потребують'} перевірки.`
              : 'Стан користувачів, доступів і фонових робіт стабільний.'}
          </p>
        </div>
        <div className="admin-hero__next">
          <span>{primaryAttention ? 'Пріоритетна дія' : 'Наступний крок'}</span>
          <strong>{primaryAttention?.label ?? 'Перегляньте останні системні зміни'}</strong>
          <Link className="button button--primary" to={primaryAttention?.href ?? scoped('/admin/audit')}>
            {primaryAttention?.action ?? 'Відкрити журнал'} <ArrowRight size={16} />
          </Link>
        </div>
      </section>
      <div className="kpi-grid">
        <Kpi icon={Users} value={data.users.active} label="Активні користувачі" href={scoped('/admin/users')} />
        <Kpi icon={Building2} value={data.departments} label="Підрозділи" href="/employees/org" />
        <Kpi
          icon={UsersRound}
          value={data.administrators}
          label="Глобальні адміністратори"
          href={scoped('/admin/users?accountType=ADMIN')}
        />
        <Kpi
          icon={ShieldCheck}
          value={`${data.twoFactorCoverage}%`}
          label="Покриття 2FA"
          href={scoped('/admin/security')}
          attention={data.twoFactorCoverage < 100}
        />
      </div>
      <div className="admin-grid">
        <Card>
          <header className="card-title">
            <h2>Потребує уваги</h2>
          </header>
          <div className="attention-list">
            {attentionItems.length ? (
              attentionItems.map((item) => {
                const Icon = item.icon
                return (
                  <Link to={item.href} key={item.id}>
                    <Icon />
                    <span>
                      <strong>{item.count}</strong>
                      <small>{item.label}</small>
                    </span>
                    <ChevronRight />
                  </Link>
                )
              })
            ) : (
              <div className="attention-list__clear">
                <ShieldCheck size={22} />
                <span>
                  <strong>Усе гаразд</strong>
                  <small>Активних блокерів немає.</small>
                </span>
              </div>
            )}
          </div>
        </Card>
        <Card>
          <header className="card-title">
            <h2>Останні дії</h2>
            <Link to={scoped('/admin/audit')}>Відкрити журнал</Link>
          </header>
          <AuditList items={data.recentAudit} />
        </Card>
      </div>
    </div>
  )
}

function UsersPage() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filterSearch = params.toString()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(params.get('new') === '1')
  const query = useQuery({
    queryKey: ['admin-users', search, params.get('isActive'), params.get('companyId'), params.get('accountType')],
    queryFn: () =>
      api<{ items: AdminUser[] }>(
        `/admin/users?search=${encodeURIComponent(search)}&isActive=${params.get('isActive') ?? ''}&companyId=${params.get('companyId') ?? ''}&accountType=${params.get('accountType') ?? ''}`,
      ),
  })
  function closeCreate() {
    setCreating(false)
    if (params.has('new')) {
      const next = new URLSearchParams(params)
      next.delete('new')
      setParams(next, { replace: true })
    }
  }
  return (
    <div>
      <PageHeader
        title="Користувачі"
        description="Глобальні адміністратори та користувачі ізольованих компаній"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={17} />
            Додати користувача
          </Button>
        }
      />
      <Card className="list-card admin-users-card">
        <div className="list-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ім’я, нікнейм або посада"
            />
          </label>
          <UserFilters params={params} onChange={setParams} />
        </div>
        {query.isLoading ? (
          <Skeleton rows={7} />
        ) : query.isError ? (
          <ErrorState />
        ) : query.data?.items.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Користувач</th>
                  <th>Тип / компанія</th>
                  <th>2FA</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <Link to={`/admin/users/${user.id}${filterSearch ? `?${filterSearch}` : ''}`}>
                        <Avatar name={user.displayName} src={user.avatarAsset} />
                        <span>
                          <strong>{user.displayName}</strong>
                          <small>
                            @{user.username} · {user.jobTitle}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <strong>{user.accountType === 'ADMIN' ? 'Глобальний ADMIN' : 'USER'}</strong>
                      <small>{user.company?.name ?? 'Без прив’язки до компанії'}</small>
                    </td>
                    <td>
                      {user.twoFactor ? (
                        <span className="success-note">
                          <Check size={15} />
                          Увімкнено
                        </span>
                      ) : (
                        'Немає'
                      )}
                    </td>
                    <td>
                      <StatusBadge status={user.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Користувачів немає" description="Змініть фільтр або створіть обліковий запис." />
        )}
      </Card>
      {userId && (
        <UserDrawer id={userId} onClose={() => navigate(`/admin/users${filterSearch ? `?${filterSearch}` : ''}`)} />
      )}
      {creating && <CreateUserDrawer defaultCompanyId={params.get('companyId') ?? ''} onClose={closeCreate} />}
    </div>
  )
}

function UserFilters({ params, onChange }: { params: URLSearchParams; onChange: (next: URLSearchParams) => void }) {
  const companies = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: Array<{ id: string; name: string; isActive: boolean }> }>('/admin/companies'),
  })
  function set(name: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    onChange(next)
  }
  return (
    <div className="admin-user-filters">
      <select
        aria-label="Фільтр за компанією"
        value={params.get('companyId') ?? ''}
        onChange={(event) => set('companyId', event.target.value)}
      >
        <option value="">Усі компанії</option>
        {companies.data?.items.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Фільтр за типом"
        value={params.get('accountType') ?? ''}
        onChange={(event) => set('accountType', event.target.value)}
      >
        <option value="">Усі типи</option>
        <option value="USER">USER</option>
        <option value="ADMIN">ADMIN</option>
      </select>
      <select
        aria-label="Фільтр за станом"
        value={params.get('isActive') ?? ''}
        onChange={(event) => set('isActive', event.target.value)}
      >
        <option value="">Усі стани</option>
        <option value="true">Активні</option>
        <option value="false">Деактивовані</option>
      </select>
    </div>
  )
}

function CreateUserDrawer({ onClose, defaultCompanyId = '' }: { onClose: () => void; defaultCompanyId?: string }) {
  const client = useQueryClient()
  const [accountType, setAccountType] = useState<'USER' | 'ADMIN'>('USER')
  const [result, setResult] = useState<{ username: string; temporaryPassword: string; expiresAt: string } | null>(null)
  const companies = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: Array<{ id: string; name: string; isActive: boolean }> }>('/admin/companies'),
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const created = await api<typeof result>('/admin/users', {
      method: 'POST',
      body: jsonBody({
        firstName: data.get('firstName'),
        lastName: data.get('lastName'),
        middleName: data.get('middleName') || undefined,
        username: data.get('username'),
        accountType,
        companyId: accountType === 'USER' ? data.get('companyId') : undefined,
        isActive: true,
      }),
    })
    setResult(created)
    void client.invalidateQueries({ queryKey: ['admin-users'] })
  }

  return (
    <Drawer size="lg" title="Новий обліковий запис" onRequestClose={onClose}>
      {result ? (
        <div className="credential-result">
          <KeyRound size={28} />
          <h3>Доступ створено</h3>
          <p>Передайте тимчасовий пароль захищеним каналом. Повторно він не показується.</p>
          <dl>
            <div>
              <dt>Логін</dt>
              <dd>@{result.username}</dd>
            </div>
            <div>
              <dt>Тимчасовий пароль</dt>
              <dd>
                <code>{result.temporaryPassword}</code>
              </dd>
            </div>
            <div>
              <dt>Дійсний до</dt>
              <dd>{formatDateTime(result.expiresAt)}</dd>
            </div>
          </dl>
          <Button onClick={onClose}>Готово</Button>
        </div>
      ) : (
        <form className="entity-form account-form" onSubmit={(event) => void submit(event)}>
          <div className="form-section">
            <span className="eyebrow">Основне</span>
            <p>Лише дані, потрібні для першого входу. Контакти та посаду людина додає у своєму профілі.</p>
          </div>
          <label>
            Ім’я
            <input name="firstName" required autoComplete="given-name" />
          </label>
          <label>
            Прізвище
            <input name="lastName" required autoComplete="family-name" />
          </label>
          <label className="span-2">
            По батькові <small>(необов’язково)</small>
            <input name="middleName" />
          </label>
          <label>
            Логін
            <input name="username" required pattern="[a-z0-9._-]{3,32}" autoComplete="username" />
          </label>
          <label>
            Тип облікового запису
            <select value={accountType} onChange={(event) => setAccountType(event.target.value as 'USER' | 'ADMIN')}>
              <option value="USER">Користувач компанії</option>
              <option value="ADMIN">Глобальний адміністратор</option>
            </select>
          </label>
          {accountType === 'USER' && (
            <label className="span-2">
              Компанія
              <select name="companyId" required defaultValue={defaultCompanyId}>
                <option disabled value="">
                  Оберіть компанію
                </option>
                {companies.data?.items
                  .filter((company) => company.isActive)
                  .map((company) => (
                    <option value={company.id} key={company.id}>
                      {company.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <Button className="span-2">Створити доступ</Button>
        </form>
      )}
    </Drawer>
  )
}

function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  interface Detail {
    id: string
    displayName: string
    username: string
    jobTitle: string
    isActive: boolean
    timezone: string
    version: number
    accountType: 'ADMIN' | 'USER'
    company: { id: string; name: string } | null
    contactEmail: string | null
    security: {
      twoFactor: boolean
      activeSessions: number
      mustEnroll2FA: boolean
    }
  }
  const query = useQuery({
    queryKey: ['admin-user', id],
    queryFn: () => api<Detail>(`/admin/users/${id}`),
  })
  const [editing, setEditing] = useState(false)
  return (
    <>
      <Drawer title="Користувач" onRequestClose={() => onClose()}>
        {query.isLoading ? (
          <Skeleton />
        ) : query.isError || !query.data ? (
          <ErrorState />
        ) : (
          <div className="detail-stack">
            <div className="user-detail-head">
              <Avatar size="lg" name={query.data.displayName} />
              <div>
                <StatusBadge status={query.data.isActive ? 'ACTIVE' : 'INACTIVE'} />
                <h3>{query.data.displayName}</h3>
                <p>
                  @{query.data.username} · {query.data.jobTitle}
                </p>
              </div>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Тип доступу</dt>
                <dd>
                  {query.data.accountType === 'ADMIN'
                    ? 'Глобальний ADMIN'
                    : `USER · ${query.data.company?.name ?? '—'}`}
                </dd>
              </div>
              <div>
                <dt>2FA</dt>
                <dd>{query.data.security.twoFactor ? 'Увімкнено' : 'Не налаштовано'}</dd>
              </div>
              <div>
                <dt>Активні сесії</dt>
                <dd>{query.data.security.activeSessions}</dd>
              </div>
            </dl>
            <p className="privacy-note">
              <ShieldCheck size={16} />
              Перевірка доступу не створює сесію від імені користувача.
            </p>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Редагувати користувача
            </Button>
          </div>
        )}
      </Drawer>
      {editing && query.data && (
        <UserEditor
          user={query.data}
          onClose={() => {
            setEditing(false)
            void query.refetch()
          }}
        />
      )}
    </>
  )
}

function UserEditor({
  user,
  onClose,
}: {
  user: {
    id: string
    displayName: string
    username: string
    accountType: 'ADMIN' | 'USER'
    company: { id: string; name: string } | null
    contactEmail: string | null
    jobTitle: string
    isActive: boolean
  }
  onClose: () => void
}) {
  const client = useQueryClient()
  const [accountType, setAccountType] = useState(user.accountType)
  const companies = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: Array<{ id: string; name: string; isActive: boolean }> }>('/admin/companies'),
  })
  const mutation = useMutation({
    mutationFn: (body: object) => api(`/admin/users/${user.id}`, { method: 'PATCH', body: jsonBody(body) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-users'] })
      void client.invalidateQueries({ queryKey: ['admin-user', user.id] })
      onClose()
    },
  })
  const names = user.displayName.split(' ')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({
      firstName: data.get('firstName'),
      lastName: data.get('lastName'),
      middleName: data.get('middleName') || undefined,
      username: data.get('username'),
      accountType,
      companyId: accountType === 'USER' ? data.get('companyId') : undefined,
      isActive: data.get('isActive') === 'on',
      contactEmail: data.get('contactEmail') || null,
      jobTitle: data.get('jobTitle'),
    })
  }
  return (
    <Drawer size="lg" title="Редагувати користувача" onRequestClose={onClose}>
      <form className="entity-form account-form" onSubmit={submit}>
        <label>
          Ім’я
          <input name="firstName" required defaultValue={names[1] ?? names[0]} />
        </label>
        <label>
          Прізвище
          <input name="lastName" required defaultValue={names.length > 1 ? names[0] : ''} />
        </label>
        <label className="span-2">
          По батькові
          <input name="middleName" defaultValue={names.slice(2).join(' ')} />
        </label>
        <label>
          Логін
          <input name="username" required defaultValue={user.username} />
        </label>
        <label>
          Посада
          <input name="jobTitle" defaultValue={user.jobTitle} />
        </label>
        <label className="span-2">
          Email
          <input name="contactEmail" type="email" defaultValue={user.contactEmail ?? ''} />
        </label>
        <label>
          Тип
          <select value={accountType} onChange={(event) => setAccountType(event.target.value as 'ADMIN' | 'USER')}>
            <option value="USER">Користувач компанії</option>
            <option value="ADMIN">Глобальний адміністратор</option>
          </select>
        </label>
        {accountType === 'USER' && (
          <label>
            Компанія
            <select name="companyId" required defaultValue={user.company?.id ?? ''}>
              <option value="" disabled>
                Оберіть компанію
              </option>
              {companies.data?.items
                .filter((company) => company.isActive)
                .map((company) => (
                  <option value={company.id} key={company.id}>
                    {company.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="check-row span-2">
          <input name="isActive" type="checkbox" defaultChecked={user.isActive} />
          Обліковий запис активний
        </label>
        {mutation.isError && <p className="form-error span-2">Не вдалося зберегти зміни.</p>}
        <Button className="span-2" disabled={mutation.isPending}>
          Зберегти зміни
        </Button>
      </form>
    </Drawer>
  )
}

function SecurityPage() {
  interface Policy {
    require2faAccountTypes: Array<'ADMIN' | 'USER'>
    temporaryPasswordHours: number
    sessionHours: number
    version: number
    effectiveAt?: string
  }
  const query = useQuery({
    queryKey: ['security-policy'],
    queryFn: () => api<Policy>('/admin/security-policy'),
  })
  return (
    <div>
      <PageHeader title="Безпека" description="Політики доступу, 2FA та контрольованого відновлення" />
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError || !query.data ? (
        <ErrorState />
      ) : (
        <div className="security-admin-grid">
          <Card>
            <span className="settings-icon">
              <ShieldCheck />
            </span>
            <h2>Двофакторна автентифікація</h2>
            <p>Обов’язкова для типів облікових записів:</p>
            <div className="tag-list">
              {query.data.require2faAccountTypes.map((accountType) => (
                <span key={accountType}>
                  {accountType === 'ADMIN' ? 'Глобальний адміністратор' : 'Користувач компанії'}
                </span>
              ))}
            </div>
          </Card>
          <Card>
            <span className="settings-icon">
              <KeyRound />
            </span>
            <h2>Тимчасові доступи</h2>
            <strong className="large-value">{query.data.temporaryPasswordHours} год</strong>
            <p>Дані показуються адміністратору лише один раз.</p>
          </Card>
          <Card>
            <span className="settings-icon">
              <LockKeyhole />
            </span>
            <h2>Сесії</h2>
            <strong className="large-value">{query.data.sessionHours} год</strong>
            <p>Абсолютна тривалість із серверною ротацією.</p>
          </Card>
          <Card>
            <span className="settings-icon">
              <UsersRound />
            </span>
            <h2>Reset адміністратора</h2>
            <p>Для повних адміністраторів потрібні дві різні особи; для останнього — break-glass CLI.</p>
          </Card>
        </div>
      )}
    </div>
  )
}

function AuditPage() {
  const [params, setParams] = useSearchParams()
  const { eventId } = useParams()
  const navigate = useNavigate()
  const page = Number(params.get('page') ?? 1)
  const [exportId, setExportId] = useState('')
  const query = useQuery({
    queryKey: ['audit', page],
    queryFn: () =>
      api<{
        items: AuditEvent[]
        page: number
        pageSize: number
        total: number
      }>(`/admin/audit?page=${page}`),
  })
  const startExport = useMutation({
    mutationFn: () =>
      api<{ exportId: string }>('/admin/audit/exports', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey('audit-export') },
      }),
    onSuccess: (result) => setExportId(result.exportId),
  })
  const exportStatus = useQuery({
    queryKey: ['audit-export', exportId],
    queryFn: () =>
      api<{
        state: string
        progress: number
        fileId: string | null
        expiresAt: string | null
      }>(`/admin/audit/exports/${exportId}`),
    enabled: Boolean(exportId),
    refetchInterval: (current) =>
      current.state.data?.state === 'SUCCEEDED' || current.state.data?.state === 'FAILED' ? false : 1_000,
  })
  return (
    <div>
      <PageHeader
        title="Журнал дій"
        description="Append-only слід критичних і робочих операцій"
        action={
          <Button variant="secondary" disabled={startExport.isPending} onClick={() => startExport.mutate()}>
            <Download size={17} />
            Експортувати CSV
          </Button>
        }
      />
      {exportId && (
        <Card className="export-status">
          <div>
            <StatusBadge status={exportStatus.data?.state ?? 'QUEUED'} />
            <strong>Експорт журналу</strong>
            <small>
              {exportStatus.data?.fileId
                ? `Доступний до ${formatDateTime(exportStatus.data.expiresAt ?? '')}`
                : `Підготовка · ${exportStatus.data?.progress ?? 0}%`}
            </small>
          </div>
          {exportStatus.data?.fileId && (
            <a className="button button--primary" href={`/api/v1/files/${exportStatus.data.fileId}/download`}>
              <Download size={16} />
              Завантажити
            </a>
          )}
        </Card>
      )}
      <Card className="audit-card">
        {query.isLoading ? (
          <Skeleton rows={8} />
        ) : query.isError ? (
          <ErrorState />
        ) : (
          <>
            <AuditList items={query.data?.items ?? []} />
            <footer className="pagination">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })}>
                Назад
              </Button>
              <span>Сторінка {page}</span>
              <Button
                variant="secondary"
                disabled={!query.data || page * query.data.pageSize >= query.data.total}
                onClick={() => setParams({ page: String(page + 1) })}
              >
                Далі
              </Button>
            </footer>
          </>
        )}
      </Card>
      {eventId && (
        <Drawer title="Подія журналу" onRequestClose={() => navigate(`/admin/audit?${params.toString()}`)}>
          {query.isLoading ? (
            <Skeleton />
          ) : query.data?.items.find((item) => item.id === eventId) ? (
            <AuditEventDetail event={query.data.items.find((item) => item.id === eventId)!} />
          ) : (
            <EmptyState
              title="Подію не знайдено"
              description="Запис відсутній на поточній сторінці журналу або недоступний."
            />
          )}
        </Drawer>
      )}
    </div>
  )
}
function AuditList({ items }: { items: AuditEvent[] }) {
  return (
    <div className="audit-list">
      {items.map((item) => (
        <Link key={item.id} to={`/admin/audit/${item.id}`}>
          <article>
            <span className={`risk risk--${item.risk.toLowerCase()}`}>
              <Activity size={17} />
            </span>
            <div>
              <strong>{item.action}</strong>
              <small>
                {item.entityType} · {item.entityId ?? 'system'}
              </small>
            </div>
            <StatusBadge status={item.result} />
            <time>{formatDateTime(item.createdAt)}</time>
          </article>
        </Link>
      ))}
    </div>
  )
}

function AuditEventDetail({ event }: { event: AuditEvent }) {
  return (
    <dl className="detail-list">
      <div>
        <dt>Дія</dt>
        <dd>{event.action}</dd>
      </div>
      <div>
        <dt>Сутність</dt>
        <dd>
          {event.entityType} · {event.entityId ?? 'system'}
        </dd>
      </div>
      <div>
        <dt>Результат</dt>
        <dd>
          <StatusBadge status={event.result} />
        </dd>
      </div>
      <div>
        <dt>Ризик</dt>
        <dd>{event.risk}</dd>
      </div>
      <div>
        <dt>Час</dt>
        <dd>{formatDateTime(event.createdAt)}</dd>
      </div>
      <div>
        <dt>Correlation ID</dt>
        <dd>
          <code>{event.correlationId}</code>
        </dd>
      </div>
    </dl>
  )
}

function ImportReadinessPage() {
  const query = useQuery({
    queryKey: ['admin-import-readiness'],
    queryFn: () => api<ImportReadinessView>('/admin/import/readiness'),
  })

  if (query.isLoading) {
    return (
      <div>
        <PageHeader title="Готовність імпорту" />
        <Skeleton rows={8} />
      </div>
    )
  }
  if (query.isError || !query.data) {
    return (
      <div>
        <PageHeader title="Готовність імпорту" />
        <ErrorState title="Не вдалося перевірити готовність імпорту" onRetry={() => void query.refetch()} />
      </div>
    )
  }

  const data = query.data
  const blockingGates = data.gates.filter((gate) => gate.status === 'BLOCKING').length
  const metrics = [
    { label: 'Пакети даних', value: data.counters.datasets },
    { label: 'Запечатані пакети', value: data.counters.sealedDatasets },
    { label: 'Запуски', value: data.counters.runs },
    { label: 'Блокувальні проблеми', value: data.counters.unresolvedBlockingIssues },
  ]

  return (
    <div className="import-readiness">
      <PageHeader
        title="Готовність імпорту"
        description="Безпечна підготовка перенесення даних із Bitrix24 без передчасного запуску production APPLY"
      />
      <Card className="import-readiness__hero">
        <span className="import-readiness__hero-icon" aria-hidden="true">
          <ShieldAlert size={27} />
        </span>
        <div>
          <span className="eyebrow">
            <LockKeyhole size={15} /> Production APPLY вимкнено
          </span>
          <h2>Спочатку закриваємо {blockingGates} критичних рішень</h2>
          <p>
            Контрольна площина вже захищає маніфести, ланцюжки та журнал змін. Запуск імпорту з’явиться лише після
            формального закриття всіх блокерів і успішної репетиції.
          </p>
        </div>
        <StatusBadge status={data.state} />
      </Card>

      <dl className="import-readiness__metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>

      <div className="import-readiness__layout">
        <Card className="import-gates">
          <header className="card-title">
            <div>
              <span className="eyebrow">Preflight gates</span>
              <h2>Що потрібно вирішити</h2>
            </div>
            <StatusBadge status={blockingGates ? 'BLOCKED' : 'READY'} />
          </header>
          <div className="import-gates__list">
            {data.gates.map((gate) => (
              <article key={gate.id} className={gate.status === 'READY' ? 'is-ready' : ''}>
                <span className="import-gates__icon" aria-hidden="true">
                  {gate.status === 'READY' ? <Check size={18} /> : <AlertTriangle size={18} />}
                </span>
                <div>
                  <small>{gate.id}</small>
                  <h3>{gate.title}</h3>
                  <p>{gate.detail}</p>
                </div>
                <StatusBadge status={gate.status === 'READY' ? 'READY' : 'BLOCKED'} />
              </article>
            ))}
          </div>
        </Card>

        <Card className="import-safety">
          <span className="settings-icon">
            <Database />
          </span>
          <span className="eyebrow">Control plane v{data.controlPlaneVersion}</span>
          <h2>Що вже захищено</h2>
          <ul>
            <li>
              <Check size={16} /> Sealed-пакети не можна переписати
            </li>
            <li>
              <Check size={16} /> Delta продовжує лише сумісний ланцюжок
            </li>
            <li>
              <Check size={16} /> APPLY потребує окремого lease
            </li>
            <li>
              <Check size={16} /> Change journal працює append-only
            </li>
            <li>
              <Check size={16} /> Дані та ID maps ізольовані за workspace
            </li>
          </ul>
          <p className="import-safety__note">
            Остання перевірка: <time dateTime={data.checkedAt}>{formatDateTime(data.checkedAt)}</time>
          </p>
        </Card>
      </div>
    </div>
  )
}

function SystemPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'processes'
  const client = useQueryClient()
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api<{ items: Job[] }>('/admin/system/jobs'),
    enabled: tab === 'jobs',
  })
  const retry = useMutation({
    mutationFn: (id: string) => api(`/admin/system/jobs/${id}/retry`, { method: 'POST' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['jobs'] }),
  })
  return (
    <div>
      <PageHeader title="Система" description="Конфігурація внутрішніх workflow і фонових процесів" />
      <Card className="list-card">
        <div className="list-toolbar">
          <Tabs
            value={tab}
            onChange={(value) => setParams({ tab: value })}
            items={[
              { value: 'processes', label: 'Процеси' },
              { value: 'directories', label: 'Довідники' },
              { value: 'notifications', label: 'Сповіщення' },
              { value: 'brand', label: 'Бренд' },
              { value: 'jobs', label: 'Фонові роботи' },
            ]}
          />
        </div>
        {tab === 'jobs' ? (
          jobs.isLoading ? (
            <Skeleton rows={7} />
          ) : jobs.isError ? (
            <ErrorState />
          ) : jobs.data?.items.length ? (
            <div className="responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>Робота</th>
                    <th>Спроби</th>
                    <th>Оновлено</th>
                    <th>Стан</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {jobs.data.items.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <span className="job-name">
                          <ServerCog size={18} />
                          <span>
                            <strong>{job.type}</strong>
                            <small>{job.id}</small>
                          </span>
                        </span>
                      </td>
                      <td>
                        {job.attempts} / {job.maxAttempts}
                      </td>
                      <td>{formatDateTime(job.updatedAt)}</td>
                      <td>
                        <StatusBadge status={job.state} />
                      </td>
                      <td>
                        {job.state === 'FAILED' && (
                          <Button variant="secondary" onClick={() => retry.mutate(job.id)}>
                            <RefreshCw size={15} />
                            Повторити
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Фонових робіт немає" description="Черга порожня." />
          )
        ) : (
          <SystemTab tab={tab} />
        )}
      </Card>
    </div>
  )
}
function SystemTab({ tab }: { tab: string }) {
  const content: Record<string, { icon: typeof ServerCog; title: string; text: string; items: string[] }> = {
    processes: {
      icon: FileClock,
      title: 'Процеси',
      text: 'Активні версійовані маршрути заявок та шаблони життєвого циклу.',
      items: ['Маршрут відсутності', 'Шаблон онбордингу', 'Шаблон офбордингу'],
    },
    directories: {
      icon: Building2,
      title: 'Довідники',
      text: 'Активні типи заявок, категорії документів та оголошень.',
      items: ['Типи заявок', 'Категорії документів', 'Причини відсутності'],
    },
    notifications: {
      icon: CircleAlert,
      title: 'Матриця сповіщень',
      text: 'Безпечні канали й пріоритети для кожної категорії подій.',
      items: ['Погодження', 'Безпека', 'Задачі та згадки'],
    },
    brand: {
      icon: ShieldCheck,
      title: 'Бренд BERT',
      text: 'Runtime wordmark, кольори та локальні assets застосунку.',
      items: ['Cobalt #1F5EFF', 'Roboto', 'BERT CRM'],
    },
  }
  const value = content[tab] ?? content.processes!
  const Icon = value.icon
  return (
    <div className="system-summary">
      <Icon size={30} />
      <h2>{value.title}</h2>
      <p>{value.text}</p>
      <div>
        {value.items.map((item) => (
          <span key={item}>
            <Check size={15} />
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function Kpi({
  icon: Icon,
  value,
  label,
  href,
  attention = false,
}: {
  icon: typeof Users
  value: string | number
  label: string
  href: string
  attention?: boolean
}) {
  return (
    <Link to={href} className={`kpi-link ${attention ? 'kpi-link--attention' : ''}`}>
      <span>
        <Icon size={20} />
      </span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
      <ChevronRight size={18} />
    </Link>
  )
}

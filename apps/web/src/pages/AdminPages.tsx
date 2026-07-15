import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Building2,
  Check,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Download,
  FileClock,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
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
  users: { active: number; pending: number; deactivated: number }
  companies: number
  roles: number
  twoFactorCoverage: number
  attention: { pendingUsers: number; without2fa: number; failedJobs: number }
  recentAudit: AuditEvent[]
}
interface AdminUser {
  id: string
  displayName: string
  username: string
  jobTitle: string
  status: string
  company: { id: string; name: string }
  roles: Array<{ id: string; name: string }>
  displayRole: string
  twoFactor: boolean
  activeSessionCount: number
  avatarAsset: string | null
  updatedAt: string
}
interface Company {
  id: string
  displayName: string
  legalName: string
  code: string
  timezone: string
  status: string
  activeUserCount: number
  createdAt: string
}
type RoleScope = 'OWN' | 'SELECTED_COMPANIES' | 'ALL_COMPANIES'
interface Role {
  id: string
  name: string
  description: string
  version: number
  isSystem: boolean
  isFullAdmin: boolean
  userCount: number
  permissions: Array<{ id: string; permissionCode: string; scope: RoleScope }>
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
  if (path.startsWith('/admin/companies')) return <CompaniesPage />
  if (path.startsWith('/admin/roles')) return <RolesPage />
  if (path.startsWith('/admin/security')) return <SecurityPage />
  if (path.startsWith('/admin/audit')) return <AuditPage />
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
  return (
    <div className="admin-overview">
      <PageHeader title="Адміністрування" description="Системний огляд окремо від вашого особистого dashboard" />
      <section className="admin-hero">
        <div>
          <span className="eyebrow">
            <ShieldCheck size={15} /> Системний контур
          </span>
          <h2>Доступи, компанії й безпека під контролем.</h2>
          <p>
            {data.attention.pendingUsers + data.attention.without2fa + data.attention.failedJobs} пунктів потребують
            перевірки.
          </p>
        </div>
        <img src="/assets/heroes/admin-system.webp" alt="" width="420" height="280" />
      </section>
      <div className="kpi-grid">
        <Kpi icon={Users} value={data.users.active} label="Активні користувачі" href="/admin/users" />
        <Kpi icon={Building2} value={data.companies} label="Компанії" href="/admin/companies" />
        <Kpi icon={UsersRound} value={data.roles} label="Активні ролі" href="/admin/roles" />
        <Kpi icon={ShieldCheck} value={`${data.twoFactorCoverage}%`} label="Покриття 2FA" href="/admin/security" />
      </div>
      <div className="admin-grid">
        <Card>
          <header className="card-title">
            <h2>Потребує уваги</h2>
          </header>
          <div className="attention-list">
            <Link to="/admin/users?status=PENDING_FIRST_LOGIN">
              <KeyRound />
              <span>
                <strong>{data.attention.pendingUsers}</strong>
                <small>Очікують першого входу</small>
              </span>
              <ChevronRight />
            </Link>
            <Link to="/admin/security">
              <LockKeyhole />
              <span>
                <strong>{data.attention.without2fa}</strong>
                <small>Активних акаунтів без 2FA</small>
              </span>
              <ChevronRight />
            </Link>
            <Link to="/admin/system?tab=jobs">
              <ServerCog />
              <span>
                <strong>{data.attention.failedJobs}</strong>
                <small>Фонових робіт з помилкою</small>
              </span>
              <ChevronRight />
            </Link>
          </div>
        </Card>
        <Card>
          <header className="card-title">
            <h2>Останні дії</h2>
            <Link to="/admin/audit">Журнал</Link>
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
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const query = useQuery({
    queryKey: ['admin-users', search, params.get('status')],
    queryFn: () =>
      api<{ items: AdminUser[] }>(
        `/admin/users?search=${encodeURIComponent(search)}&status=${params.get('status') ?? ''}`,
      ),
  })
  return (
    <div>
      <PageHeader
        title="Користувачі"
        description="Акаунти, ролі, компанії та security-стан"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={17} />
            Додати користувача
          </Button>
        }
      />
      <Card className="list-card">
        <div className="list-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ім’я, нікнейм або посада"
            />
          </label>
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
                  <th>Компанія</th>
                  <th>Ролі</th>
                  <th>2FA</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <Link to={`/admin/users/${user.id}`}>
                        <Avatar name={user.displayName} src={user.avatarAsset} />
                        <span>
                          <strong>{user.displayName}</strong>
                          <small>
                            @{user.username} · {user.jobTitle}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>{user.company.name}</td>
                    <td>{user.roles.map((role) => role.name).join(', ')}</td>
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
                      <StatusBadge status={user.status} />
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
      {userId && <UserDrawer id={userId} onClose={() => navigate('/admin/users')} />}
      {creating && <CreateUserDrawer onClose={() => setCreating(false)} />}
    </div>
  )
}

function CreateUserDrawer({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const roles = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api<{ items: Role[] }>('/admin/roles'),
  })
  const companies = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: Company[] }>('/admin/companies'),
  })
  const [result, setResult] = useState<{
    username: string
    temporaryPassword: string
    expiresAt: string
  } | null>(null)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    try {
      const created = await api<typeof result>('/admin/users', {
        method: 'POST',
        body: jsonBody({
          displayName: data.get('displayName'),
          username: data.get('username'),
          jobTitle: data.get('jobTitle'),
          roleId: data.get('roleId'),
          companyId: data.get('companyId'),
        }),
      })
      setResult(created)
      void client.invalidateQueries({ queryKey: ['admin-users'] })
    } catch {
      setError('Не вдалося створити користувача. Перевірте унікальність нікнейма.')
    }
  }
  return (
    <Drawer title="Новий користувач" onClose={onClose}>
      {result ? (
        <div className="credential-result">
          <KeyRound size={28} />
          <h3>Доступ створено</h3>
          <p>Скопіюйте тимчасові дані зараз. Пароль більше не буде показано.</p>
          <dl>
            <div>
              <dt>Нікнейм</dt>
              <dd>@{result.username}</dd>
            </div>
            <div>
              <dt>Тимчасовий пароль</dt>
              <dd>
                <code>{result.temporaryPassword}</code>
                <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(result.temporaryPassword)}>
                  <Clipboard size={16} />
                  Копіювати
                </Button>
              </dd>
            </div>
            <div>
              <dt>Діє до</dt>
              <dd>{formatDateTime(result.expiresAt)}</dd>
            </div>
          </dl>
          <Button onClick={onClose}>Готово</Button>
        </div>
      ) : (
        <form className="entity-form" onSubmit={submit}>
          <label className="span-2">
            Ім’я
            <input name="displayName" required />
          </label>
          <label>
            Нікнейм
            <input name="username" required pattern="[a-z0-9._-]{3,32}" />
          </label>
          <label>
            Посада
            <input name="jobTitle" />
          </label>
          <label>
            Компанія
            <select name="companyId" required defaultValue="">
              <option disabled value="">
                Оберіть
              </option>
              {companies.data?.items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Роль
            <select name="roleId" required defaultValue="">
              <option disabled value="">
                Оберіть
              </option>
              {roles.data?.items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {error && <div className="form-error span-2">{error}</div>}
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
    displayRole: string
    status: string
    timezone: string
    version: number
    primaryCompany: Company
    companies: Company[]
    roles: Role[]
    security: {
      twoFactor: boolean
      activeSessions: number
      mustChangePassword: boolean
      mustEnroll2FA: boolean
    }
  }
  const query = useQuery({
    queryKey: ['admin-user', id],
    queryFn: () => api<Detail>(`/admin/users/${id}`),
  })
  return (
    <Drawer title="Користувач" onClose={onClose}>
      {query.isLoading ? (
        <Skeleton />
      ) : query.isError || !query.data ? (
        <ErrorState />
      ) : (
        <div className="detail-stack">
          <div className="user-detail-head">
            <Avatar size="lg" name={query.data.displayName} />
            <div>
              <StatusBadge status={query.data.status} />
              <h3>{query.data.displayName}</h3>
              <p>
                @{query.data.username} · {query.data.jobTitle}
              </p>
            </div>
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Основна компанія</dt>
              <dd>{query.data.primaryCompany.displayName}</dd>
            </div>
            <div>
              <dt>Роль</dt>
              <dd>{query.data.displayRole}</dd>
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
          <section>
            <h4>Доступні компанії</h4>
            <div className="tag-list">
              {query.data.companies.map((item) => (
                <span key={item.id}>{item.displayName}</span>
              ))}
            </div>
          </section>
          <p className="privacy-note">
            <ShieldCheck size={16} />
            Перевірка доступу не створює сесію від імені користувача.
          </p>
        </div>
      )}
    </Drawer>
  )
}

function CompaniesPage() {
  const { companyId } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [creating, setCreating] = useState(false)
  const query = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: Company[] }>('/admin/companies'),
  })
  return (
    <div>
      <PageHeader
        title="Компанії"
        description="Плоский перелік юридичних та операційних компаній"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={17} />
            Додати компанію
          </Button>
        }
      />
      <div className="company-grid">
        {query.isLoading ? (
          <Skeleton rows={5} />
        ) : query.isError ? (
          <ErrorState />
        ) : (
          query.data?.items.map((company) => (
            <Link to={`/admin/companies/${company.id}`} key={company.id}>
              <span>
                <Building2 />
              </span>
              <div>
                <h2>{company.displayName}</h2>
                <p>{company.legalName}</p>
                <small>
                  {company.code} · {company.timezone}
                </small>
              </div>
              <b>{company.activeUserCount} людей</b>
            </Link>
          ))
        )}
      </div>
      {companyId && (
        <Drawer title="Компанія" onClose={() => navigate('/admin/companies')}>
          {query.data?.items.find((item) => item.id === companyId) ? (
            <CompanyDetail company={query.data.items.find((item) => item.id === companyId)!} />
          ) : (
            <Skeleton />
          )}
        </Drawer>
      )}
      {creating && (
        <Drawer title="Нова компанія" onClose={() => setCreating(false)}>
          <form
            className="entity-form"
            onSubmit={async (event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              await api('/admin/companies', {
                method: 'POST',
                body: jsonBody(Object.fromEntries(data)),
              })
              setCreating(false)
              void client.invalidateQueries({ queryKey: ['admin-companies'] })
            }}
          >
            <label className="span-2">
              Відображувана назва
              <input name="displayName" required />
            </label>
            <label className="span-2">
              Юридична назва
              <input name="legalName" required />
            </label>
            <label>
              Код
              <input name="code" pattern="[a-z0-9-]{2,24}" required />
            </label>
            <label>
              Часовий пояс
              <input name="timezone" defaultValue="Europe/Kyiv" required />
            </label>
            <Button className="span-2">Створити</Button>
          </form>
        </Drawer>
      )}
    </div>
  )
}
function CompanyDetail({ company }: { company: Company }) {
  return (
    <div className="detail-stack">
      <span className="settings-icon">
        <Building2 />
      </span>
      <h3>{company.displayName}</h3>
      <p>{company.legalName}</p>
      <dl className="detail-grid">
        <div>
          <dt>Код</dt>
          <dd>{company.code}</dd>
        </div>
        <div>
          <dt>Часовий пояс</dt>
          <dd>{company.timezone}</dd>
        </div>
        <div>
          <dt>Активні працівники</dt>
          <dd>{company.activeUserCount}</dd>
        </div>
        <div>
          <dt>Статус</dt>
          <dd>
            <StatusBadge status={company.status} />
          </dd>
        </div>
      </dl>
    </div>
  )
}

function RolesPage() {
  const { roleId } = useParams()
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api<{ items: Role[] }>('/admin/roles'),
  })
  const selected = query.data?.items.find((role) => role.id === roleId)
  return (
    <div>
      <PageHeader title="Ролі та права" description="Permission, scope та контрольований вплив змін" />
      <div className="role-grid">
        {query.isLoading ? (
          <Skeleton rows={6} />
        ) : query.isError ? (
          <ErrorState />
        ) : (
          query.data?.items.map((role) => (
            <Link to={`/admin/roles/${role.id}`} key={role.id}>
              <span>
                <ShieldCheck />
              </span>
              <div>
                <h2>{role.name}</h2>
                <p>{role.description}</p>
                <small>
                  {role.permissions.length} прав · {role.userCount} користувачів
                </small>
              </div>
              {role.isSystem && <b>Системна</b>}
            </Link>
          ))
        )}
      </div>
      {roleId && (
        <Drawer title="Редактор ролі" onClose={() => navigate('/admin/roles')}>
          {selected ? <RoleDetail role={selected} /> : <Skeleton />}
        </Drawer>
      )}
    </div>
  )
}
function RoleDetail({ role }: { role: Role }) {
  const client = useQueryClient()
  const [permissions, setPermissions] = useState(
    role.permissions.map((item) => ({
      code: item.permissionCode,
      scope: item.scope,
    })),
  )
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/roles/${role.id}`, {
        method: 'PATCH',
        body: jsonBody({ expectedVersion: role.version, permissions }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin-roles'] }),
  })
  return (
    <div className="detail-stack">
      <div>
        <StatusBadge status="ACTIVE" />
        <h3>{role.name}</h3>
        <p>{role.description}</p>
      </div>
      <p className="impact-note">
        <AlertTriangle size={17} />
        Зміна прав оновить authorization version {role.userCount} користувачів і змусить сесії перевірити права
        повторно.
      </p>
      <section>
        <h4>Дозволи й scope</h4>
        <div className="permission-list">
          {permissions.map((item) => (
            <article key={item.code}>
              <code>{item.code}</code>
              <select
                aria-label={`Scope для ${item.code}`}
                value={item.scope}
                onChange={(event) =>
                  setPermissions((current) =>
                    current.map((entry) =>
                      entry.code === item.code ? { ...entry, scope: event.target.value as RoleScope } : entry,
                    ),
                  )
                }
              >
                <option value="OWN">Власні</option>
                <option value="SELECTED_COMPANIES">Обрані компанії</option>
                <option value="ALL_COMPANIES">Усі доступні</option>
              </select>
            </article>
          ))}
        </div>
      </section>
      {role.isSystem && (
        <p className="privacy-note">
          <ShieldCheck size={16} />
          Критичну основу системної ролі не можна прибрати.
        </p>
      )}
      <Button disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isSuccess ? <Check size={16} /> : <ShieldCheck size={16} />}
        {save.isSuccess ? 'Збережено' : 'Зберегти scope'}
      </Button>
      {save.isError && (
        <p className="form-error">
          Роль змінилася паралельно або критичний дозвіл не можна прибрати. Оновіть сторінку.
        </p>
      )}
    </div>
  )
}

function SecurityPage() {
  interface Policy {
    require2faRoles: string[]
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
            <p>Обов’язкова для ролей:</p>
            <div className="tag-list">
              {query.data.require2faRoles.map((role) => (
                <span key={role}>{role}</span>
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
    </div>
  )
}
function AuditList({ items }: { items: AuditEvent[] }) {
  return (
    <div className="audit-list">
      {items.map((item) => (
        <article key={item.id}>
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
      ))}
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
      items: ['Cobalt #1F5EFF', 'Onest', 'BERT CRM'],
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
}: {
  icon: typeof Users
  value: string | number
  label: string
  href: string
}) {
  return (
    <Link to={href} className="kpi-link">
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

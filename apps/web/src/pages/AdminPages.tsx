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
  Clipboard,
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
  UnsavedChangesDialog,
  useModalCloseGuard,
} from '../shared/ui'

interface AdminOverview {
  users: { active: number; pending: number; deactivated: number }
  departments: number
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
  roles: Array<{ id: string; name: string }>
  displayRole: string
  twoFactor: boolean
  activeSessionCount: number
  avatarAsset: string | null
  updatedAt: string
}
type RoleScope = 'OWN' | 'ALL_COMPANIES'
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
  if (path.startsWith('/admin/roles')) return <RolesPage />
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
    {
      id: 'pending-users',
      count: data.attention.pendingUsers,
      label: 'Очікують першого входу',
      action: 'Перевірити нові акаунти',
      href: scoped('/admin/users?status=PENDING_FIRST_LOGIN'),
      icon: KeyRound,
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
          <Link
            className="button button--primary"
            to={primaryAttention?.href ?? scoped('/admin/audit')}
          >
            {primaryAttention?.action ?? 'Відкрити журнал'} <ArrowRight size={16} />
          </Link>
        </div>
      </section>
      <div className="kpi-grid">
        <Kpi icon={Users} value={data.users.active} label="Активні користувачі" href={scoped('/admin/users')} />
        <Kpi icon={Building2} value={data.departments} label="Підрозділи" href="/employees/org" />
        <Kpi icon={UsersRound} value={data.roles} label="Активні ролі" href={scoped('/admin/roles')} />
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
            {attentionItems.length ? attentionItems.map((item) => {
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
            }) : (
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
        description="Акаунти, ролі, підрозділи та security-стан"
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
  const [result, setResult] = useState<{
    username: string
    temporaryPassword: string
    expiresAt: string
  } | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const closeGuard = useModalCloseGuard({
    dirty: dirty && !result,
    onRequestClose: () => onClose(),
  })
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
        }),
      })
      setResult(created)
      void client.invalidateQueries({ queryKey: ['admin-users'] })
    } catch {
      setError('Не вдалося створити користувача. Перевірте унікальність нікнейма.')
    }
  }
  return (
    <>
      <Drawer title="Новий користувач" onRequestClose={closeGuard.requestClose}>
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
          <form className="entity-form" onChange={() => setDirty(true)} onSubmit={submit}>
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
      <UnsavedChangesDialog guard={closeGuard} />
    </>
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
              <StatusBadge status={query.data.status} />
              <h3>{query.data.displayName}</h3>
              <p>
                @{query.data.username} · {query.data.jobTitle}
              </p>
            </div>
          </div>
          <dl className="detail-grid">
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
          <p className="privacy-note">
            <ShieldCheck size={16} />
            Перевірка доступу не створює сесію від імені користувача.
          </p>
        </div>
      )}
    </Drawer>
  )
}

function RolesPage() {
  const { roleId } = useParams()
  const navigate = useNavigate()
  const [roleDirty, setRoleDirty] = useState(false)
  const closeGuard = useModalCloseGuard({
    dirty: Boolean(roleId && roleDirty),
    onRequestClose: () => {
      setRoleDirty(false)
      navigate('/admin/roles')
    },
  })
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
        <Drawer title="Редактор ролі" onRequestClose={closeGuard.requestClose}>
          {selected ? (
            <RoleDetail role={selected} onDirtyChange={setRoleDirty} />
          ) : <Skeleton />}
        </Drawer>
      )}
      <UnsavedChangesDialog guard={closeGuard} />
    </div>
  )
}
function RoleDetail({
  role,
  onDirtyChange,
}: {
  role: Role
  onDirtyChange: (dirty: boolean) => void
}) {
  const client = useQueryClient()
  const [permissions, setPermissions] = useState(
    role.permissions.map((item) => ({
      code: item.permissionCode,
      scope: (item.scope === 'OWN' ? 'OWN' : 'ALL_COMPANIES') as RoleScope,
    })),
  )
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/roles/${role.id}`, {
        method: 'PATCH',
        body: jsonBody({ expectedVersion: role.version, permissions }),
      }),
    onSuccess: () => {
      onDirtyChange(false)
      void client.invalidateQueries({ queryKey: ['admin-roles'] })
    },
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
                  setPermissions((current) => {
                    onDirtyChange(true)
                    return current.map((entry) =>
                      entry.code === item.code ? { ...entry, scope: event.target.value as RoleScope } : entry,
                    )
                  })
                }
              >
                <option value="OWN">Власні</option>
                <option value="ALL_COMPANIES">Вся організація</option>
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
        <Drawer
          title="Подія журналу"
          onRequestClose={() => navigate(`/admin/audit?${params.toString()}`)}
        >
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
      <div><dt>Дія</dt><dd>{event.action}</dd></div>
      <div><dt>Сутність</dt><dd>{event.entityType} · {event.entityId ?? 'system'}</dd></div>
      <div><dt>Результат</dt><dd><StatusBadge status={event.result} /></dd></div>
      <div><dt>Ризик</dt><dd>{event.risk}</dd></div>
      <div><dt>Час</dt><dd>{formatDateTime(event.createdAt)}</dd></div>
      <div><dt>Correlation ID</dt><dd><code>{event.correlationId}</code></dd></div>
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
            Контрольна площина вже захищає маніфести, ланцюжки та журнал змін. Запуск імпорту
            з’явиться лише після формального закриття всіх блокерів і успішної репетиції.
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
            <li><Check size={16} /> Sealed-пакети не можна переписати</li>
            <li><Check size={16} /> Delta продовжує лише сумісний ланцюжок</li>
            <li><Check size={16} /> APPLY потребує окремого lease</li>
            <li><Check size={16} /> Change journal працює append-only</li>
            <li><Check size={16} /> Дані та ID maps ізольовані за workspace</li>
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

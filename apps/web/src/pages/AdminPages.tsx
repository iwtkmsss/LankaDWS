import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Check,
  Download,
  KeyRound,
  Plus,
  Search,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { removeWhitespace } from '../shared/lib/credentials'
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
} from '../shared/ui'

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
export default function AdminPages() {
  const path = useLocation().pathname
  return path.startsWith('/admin/users') ? <UsersPage /> : <AuditPage />
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
                      <strong>{!user.isActive ? 'Неактивний користувач' : user.accountType === 'ADMIN' ? 'Глобальний ADMIN' : 'USER'}</strong>
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

interface UserAccountProfile {
  orgUnit: { id: string; name: string } | null
  firstName: string
  lastName: string
  middleName: string | null
  username: string
  contactEmail: string | null
  phone: string | null
  gender: string | null
  birthDate: string | null
  jobTitle: string
  company: { id: string; name: string } | null
}

function UserAccountFields({ user, isActive, setIsActive, accountType, onAccountTypeChange, companyId, onCompanyChange, companies, units, unitsLoading }: {
  user?: UserAccountProfile
  isActive: boolean
  setIsActive: (value: boolean) => void
  accountType: 'USER' | 'ADMIN'
  onAccountTypeChange: (value: 'USER' | 'ADMIN') => void
  companyId: string
  onCompanyChange: (value: string) => void
  companies: Array<{ id: string; name: string; isActive: boolean }>
  units: Array<{ id: string; name: string }>
  unitsLoading: boolean
}) {
  const [orgSelection, setOrgSelection] = useState({ companyId, id: user?.orgUnit?.id ?? '' })
  return (
    <>
      <label>
        Тип облікового запису
        <select value={isActive ? accountType : 'INACTIVE'} onChange={(event) => {
          const value = event.target.value
          setIsActive(value !== 'INACTIVE')
          if (value === 'ADMIN' || value === 'USER') onAccountTypeChange(value)
        }}>
          <option value="USER">Користувач компанії</option>
          <option value="ADMIN">Глобальний адміністратор</option>
          <option value="INACTIVE">Неактивний користувач</option>
        </select>
      </label>
      <label>
        Логін
        <input name="username" defaultValue={user?.username ?? ''} required pattern="[a-z0-9._\-]{3,32}" autoComplete="username" onInput={(event) => { event.currentTarget.value = removeWhitespace(event.currentTarget.value) }} />
      </label>
      <label>
        Ім’я
        <input name="firstName" defaultValue={user?.firstName ?? ''} required autoComplete="given-name" />
      </label>
      <label>
        Прізвище
        <input name="lastName" defaultValue={user?.lastName ?? ''} required autoComplete="family-name" />
      </label>
      <label>
        По батькові
        <input name="middleName" defaultValue={user?.middleName ?? ''} />
      </label>
      <label>
        Стать
        <select name="gender" defaultValue={user?.gender ?? ''}><option value="">Не вказувати</option><option value="FEMALE">Жінка</option><option value="MALE">Чоловік</option><option value="OTHER">Інше</option></select>
      </label>
      <label>
        Телефон
        <input name="phone" defaultValue={user?.phone ?? ''} type="tel" />
      </label>
      <label>
        Email
        <input name="contactEmail" defaultValue={user?.contactEmail ?? ''} type="email" required={!user} autoComplete="email" />
      </label>
      <label>
        {user ? 'Новий пароль (за потреби)' : 'Пароль'}
        <input name="password" type="password" required={!user} minLength={15} autoComplete="new-password" onInput={(event) => { event.currentTarget.value = removeWhitespace(event.currentTarget.value) }} />
      </label>
      <label>
        {user ? 'Підтвердження нового паролю' : 'Підтвердження паролю'}
        <input name="passwordConfirmation" type="password" required={!user} minLength={15} autoComplete="new-password" onInput={(event) => { event.currentTarget.value = removeWhitespace(event.currentTarget.value) }} />
      </label>
      <label>
        День народження
        <input name="birthDate" defaultValue={user?.birthDate ?? ''} type="date" />
      </label>
      <label>
        Фотографія
        <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" />
      </label>
      <label className="span-2">
        Посада
        <input name="jobTitle" defaultValue={user?.jobTitle ?? ''} />
      </label>
      {accountType === 'USER' && (
        <label className="span-2">
          Компанія
          <select name="companyId" required value={companyId} onChange={(event) => onCompanyChange(event.target.value)}>
            <option disabled value="">
              Оберіть компанію
            </option>
            {companies
              .filter((company) => company.isActive)
              .map((company) => (
                <option value={company.id} key={company.id}>
                  {company.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {accountType === 'USER' && (
        <label className="span-2">
          Підрозділ
          <select name="orgUnitId" disabled={!companyId || unitsLoading} value={orgSelection.companyId === companyId ? orgSelection.id : ''} onChange={(event) => setOrgSelection({ companyId, id: event.target.value })}>
            <option value="">Оберіть підрозділ</option>
            {units.map((unit) => <option value={unit.id} key={unit.id}>{unit.name}</option>)}
          </select>
          {!companyId && <small>Спочатку оберіть компанію.</small>}
        </label>
      )}
    </>
  )
}

function CreateUserDrawer({ onClose, defaultCompanyId = '' }: { onClose: () => void; defaultCompanyId?: string }) {
  const client = useQueryClient()
  const [accountType, setAccountType] = useState<'USER' | 'ADMIN'>('USER')
  const [isActive, setIsActive] = useState(true)
  const [result, setResult] = useState<{ userId: string; username: string } | null>(null)
  const [companyId, setCompanyId] = useState(defaultCompanyId)
  const companies = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: Array<{ id: string; name: string; isActive: boolean }> }>('/admin/companies'),
  })
  const units = useQuery({
    queryKey: ['org-units', companyId],
    queryFn: () => api<{ items: Array<{ id: string; name: string }> }>(`/org/units?company=${encodeURIComponent(companyId)}`),
    enabled: accountType === 'USER' && Boolean(companyId),
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const created = await api<{ userId: string; username: string }>('/admin/users', {
      method: 'POST',
      body: jsonBody({
        firstName: data.get('firstName'),
        lastName: data.get('lastName'),
        middleName: data.get('middleName') || undefined,
        contactEmail: data.get('contactEmail'),
        phone: data.get('phone') || undefined,
        gender: data.get('gender') || null,
        birthDate: data.get('birthDate') || null,
        jobTitle: data.get('jobTitle') || undefined,
        username: data.get('username'),
        password: data.get('password'),
        passwordConfirmation: data.get('passwordConfirmation'),
        accountType,
        companyId: accountType === 'USER' ? companyId : undefined,
        orgUnitId: accountType === 'USER' ? (data.get('orgUnitId') || undefined) : undefined,
        isActive,
      }),
    })
    const photo = data.get('photo')
    if (photo instanceof File && photo.size > 0) {
      const avatar = new FormData()
      avatar.set('file', photo)
      await api(`/admin/users/${created.userId}/avatar`, { method: 'POST', body: avatar })
    }
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
                <code>Встановлено адміністратором</code>
              </dd>
            </div>
            <div>
              <dt>Дійсний до</dt>
              <dd>Постійний пароль</dd>
            </div>
          </dl>
          <Button onClick={onClose}>Готово</Button>
        </div>
      ) : (
        <form className="entity-form account-form" onSubmit={(event) => void submit(event)}>
          <UserAccountFields isActive={isActive} setIsActive={setIsActive} accountType={accountType} onAccountTypeChange={setAccountType} companyId={companyId} onCompanyChange={setCompanyId} companies={companies.data?.items ?? []} units={units.data?.items ?? []} unitsLoading={units.isLoading} />
          <Button className="span-2">Створити доступ</Button>
        </form>
      )}
    </Drawer>
  )
}

function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  interface Detail extends UserAccountProfile {
    id: string
    displayName: string
    username: string
    jobTitle: string
    isActive: boolean
    timezone: string
    version: number
    accountType: 'ADMIN' | 'USER'
    company: { id: string; name: string } | null
    orgUnit: { id: string; name: string } | null
    contactEmail: string | null
    leadership: {
      companies: Array<{ id: string; name: string }>
      orgUnits: Array<{ id: string; name: string; companyId: string }>
    }
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
  if (query.isLoading || query.isError || !query.data) {
    return (
      <Drawer size="lg" title="Редагувати користувача" onRequestClose={onClose}>
        {query.isLoading ? <Skeleton /> : <ErrorState />}
      </Drawer>
    )
  }
  return <UserEditor key={id} user={query.data} onClose={onClose} />
}

function UserEditor({
  user,
  onClose,
}: {
  user: UserAccountProfile & {
    id: string
    displayName: string
    username: string
    accountType: 'ADMIN' | 'USER'
    company: { id: string; name: string } | null
    orgUnit: { id: string; name: string } | null
    contactEmail: string | null
    jobTitle: string
    isActive: boolean
    leadership: {
      companies: Array<{ id: string; name: string }>
      orgUnits: Array<{ id: string; name: string; companyId: string }>
    }
  }
  onClose: () => void
}) {
  const client = useQueryClient()
  const [accountType, setAccountType] = useState(user.accountType)
  const [isActive, setIsActive] = useState(user.isActive)
  const [companyId, setCompanyId] = useState(user.company?.id ?? '')
  const companies = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: Array<{ id: string; name: string; isActive: boolean }> }>('/admin/companies'),
  })
  const units = useQuery({
    queryKey: ['org-units', companyId],
    queryFn: () => api<{ items: Array<{ id: string; name: string }> }>(`/org/units?company=${encodeURIComponent(companyId)}`),
    enabled: accountType === 'USER' && Boolean(companyId),
  })
  const mutation = useMutation({
    mutationFn: async ({ body, photo }: { body: object; photo: FormDataEntryValue | null }) => {
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body: jsonBody(body) })
      if (photo instanceof File && photo.size > 0) {
        const avatar = new FormData()
        avatar.set('file', photo)
        await api(`/admin/users/${user.id}/avatar`, { method: 'POST', body: avatar })
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-users'] })
      void client.invalidateQueries({ queryKey: ['admin-user', user.id] })
      void client.invalidateQueries({ queryKey: ['admin-companies'] })
      void client.invalidateQueries({ queryKey: ['admin-org-units'] })
      void client.invalidateQueries({ queryKey: ['org-units'] })
      onClose()
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({ photo: data.get('photo'), body: {
      firstName: data.get('firstName'),
      lastName: data.get('lastName'),
      middleName: data.get('middleName') || undefined,
      username: data.get('username'),
      accountType,
      companyId: accountType === 'USER' ? companyId : undefined,
      orgUnitId: accountType === 'USER' ? (data.get('orgUnitId') || undefined) : undefined,
      isActive,
      contactEmail: data.get('contactEmail') || null,
      phone: data.get('phone') || null,
      gender: data.get('gender') || null,
      birthDate: data.get('birthDate') || null,
      jobTitle: data.get('jobTitle'),
      password: data.get('password') || undefined,
      passwordConfirmation: data.get('passwordConfirmation') || undefined,
    } })
  }
  return (
    <Drawer size="lg" title="Редагувати користувача" onRequestClose={onClose}>
      <form className="entity-form account-form" onSubmit={submit}>
        <UserAccountFields isActive={isActive} setIsActive={setIsActive} user={user} accountType={accountType} onAccountTypeChange={setAccountType} companyId={companyId} onCompanyChange={setCompanyId} companies={companies.data?.items ?? []} units={units.data?.items ?? []} unitsLoading={units.isLoading} />
        {(user.leadership.companies.length + user.leadership.orgUnits.length) > 0 && <p className="privacy-note span-2">
          Зміна компанії, типу доступу або деактивація очистить керівні маркери: {[
            ...user.leadership.companies.map((company) => company.name),
            ...user.leadership.orgUnits.map((unit) => unit.name),
          ].join(', ')}.
        </p>}
        {!isActive && <p className="privacy-note span-2">Вхід і доступ до системи заблоковано. Після збереження всі сеанси користувача будуть завершені.</p>}
        {mutation.isError && <p className="form-error span-2">Не вдалося зберегти зміни.</p>}
        <Button className="span-2" disabled={mutation.isPending}>
          Зберегти зміни
        </Button>
      </form>
    </Drawer>
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

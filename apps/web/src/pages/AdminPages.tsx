import { DateTimePicker } from '../shared/ui/DateTimePicker'
import { personName } from '../shared/lib/personName'
import { UNASSIGNED_DEPARTMENT_LABEL } from '../shared/lib/organization'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Download,
  KeyRound,
  Plus,
  Search,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { adminUserInputSchema, adminUserUpdateInputSchema, PASSWORD_MIN_LENGTH } from '@lankadws/contracts'
import { removeWhitespace } from '../shared/lib/credentials'
import { FileDropzone } from '../shared/files/FileDropzone'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, idempotencyKey, jsonBody } from '../shared/api/client'
import { useDebouncedSearchValue } from '../shared/lib/useDebouncedSearchValue'
import { UserSearchCombobox } from '../features/employees/UserSearchCombobox'
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

function errorMessage(error: unknown) {
  const problem = error && typeof error === 'object' && 'problem' in error
    ? error.problem as { detail?: string; title?: string } : undefined
  return problem?.detail ?? problem?.title ?? (error instanceof Error ? error.message : 'Не вдалося виконати дію.')
}

function accountErrors(error: unknown): Record<string, string[]> {
  const problem = error && typeof error === 'object' && 'problem' in error
    ? error.problem as { errors?: Record<string, string[]>; code?: string; detail?: string } : undefined
  if (problem?.errors) return problem.errors
  if (problem?.code === 'password_policy' || problem?.code === 'password_blocklisted') return { password: [problem.detail ?? 'Оберіть інший пароль.'] }
  if (problem?.code === 'user_assignment') return { companyId: ['Перевірте, чи доступні обрані компанія та підрозділ.'] }
  if (problem?.detail === 'username_taken' || problem?.detail === 'Нікнейм уже використаний або зарезервований.') return { username: ['Цей логін уже використаний або зарезервований. Оберіть інший.'] }
  return {}
}

function validateAccountBody(body: Record<string, unknown>, editing = false) {
  const parsed = (editing ? adminUserUpdateInputSchema : adminUserInputSchema).safeParse(body)
  const errors: Record<string, string[]> = {}
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const name = String(issue.path[0])
    const messages = errors[name] ??= []
    messages.push(issue.message)
  }
  if (body.accountType === 'USER' && !body.companyId) errors.companyId = ['Оберіть компанію.']
  if (Object.keys(errors).length) throw Object.assign(new Error('Перевірте виділені поля.'), {
    problem: { detail: 'Перевірте виділені поля.', errors },
  })
}

function RequiredMark() { return <span className="account-required" aria-hidden="true"> *</span> }

function UsersPage() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filterSearch = params.toString()
  const search = params.get('search') ?? ''
  const debounce = useDebouncedSearchValue(search)
  const waitingForSearch = debounce.isComposing || search.trim() !== debounce.debouncedValue
  const parsedPage = Number(params.get('page') ?? 1)
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const columns = [
    { key: 'displayName', label: 'Користувач' },
    { key: 'accountType', label: 'Тип / компанія' },
    { key: 'twoFactor', label: '2FA' },
    { key: 'isActive', label: 'Статус' },
  ]
  const sort = columns.some((column) => column.key === params.get('sort')) ? params.get('sort')! : 'displayName'
  const direction = params.get('direction') === 'desc' ? 'desc' : 'asc'
  const [creating, setCreating] = useState(params.get('new') === '1')
  const query = useQuery({
    queryKey: ['admin-users', debounce.debouncedValue, params.get('isActive'), params.get('companyId'), params.get('accountType'), page, sort, direction],
    queryFn: ({ signal }) => {
      const filters = new URLSearchParams({ search: debounce.debouncedValue, page: String(page) })
      filters.set('sort', sort)
      filters.set('direction', direction)
      for (const key of ['isActive', 'companyId', 'accountType']) {
        const value = params.get(key)
        if (value) filters.set(key, value)
      }
      return api<{ items: AdminUser[]; page: number; pageSize: number; total: number }>(`/admin/users?${filters}`, { signal })
    },
    enabled: !waitingForSearch,
  })
  const lastPage = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : undefined
  useEffect(() => {
    if (!waitingForSearch && lastPage !== undefined && page > lastPage) {
      setParams((current) => {
        const next = new URLSearchParams(current)
        if (Number(current.get('page') ?? 1) > lastPage) next.set('page', String(lastPage))
        return next
      }, { replace: true })
    }
  }, [lastPage, page, params, setParams, waitingForSearch])
  function setSearch(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('search', value)
    else next.delete('search')
    next.delete('page')
    setParams(next, { replace: true })
  }
  function setPage(value: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(value))
    setParams(next)
  }
  function setSort(key: string) {
    const next = new URLSearchParams(params)
    next.set('sort', key)
    next.set('direction', sort === key && direction === 'asc' ? 'desc' : 'asc')
    next.delete('page')
    setParams(next)
  }
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
        description="Адміністратори та користувачі організації"
        action={
          <div className="admin-user-filters">
            <Button className="admin-users-create" onClick={() => setCreating(true)}><Plus size={17} />Додати користувача</Button>
          </div>
        }
      />
      <Card className="list-card admin-users-card">
        <div className="list-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Пошук користувачів"
              onCompositionStart={debounce.onCompositionStart}
              onCompositionEnd={debounce.onCompositionEnd}
              placeholder="Ім’я, нікнейм або посада"
            />
          </label>
          <UserFilters params={params} onChange={setParams} />
        </div>
        {query.isLoading || waitingForSearch ? (
          <Skeleton rows={7} />
        ) : query.isError ? (
          <ErrorState />
        ) : query.data?.items.length ? (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => {
                    const active = sort === column.key
                    const SortIcon = active ? direction === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown
                    return <th key={column.key} scope="col" aria-sort={active ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
                      <button type="button" onClick={() => setSort(column.key)}>
                        {column.label}<SortIcon size={13} aria-hidden="true" />
                      </button>
                    </th>
                  })}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <Link to={`/admin/users/${user.id}${filterSearch ? `?${filterSearch}` : ''}`}>
                        <Avatar name={personName(user.displayName)} src={user.avatarAsset} />
                        <span>
                          <strong>{personName(user.displayName)}</strong>
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
      {query.data && query.data.total > query.data.pageSize && !waitingForSearch && <nav aria-label="Сторінки користувачів" className="list-toolbar">
        <Button variant="secondary" disabled={page <= 1 || query.isFetching} onClick={() => setPage(page - 1)}>Попередня</Button>
        <span>Сторінка {page} з {Math.ceil(query.data.total / query.data.pageSize)} · {query.data.total} користувачів</span>
        <Button variant="secondary" disabled={page * query.data.pageSize >= query.data.total || query.isFetching} onClick={() => setPage(page + 1)}>Наступна</Button>
      </nav>}
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
    next.delete('page')
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

function UserAccountFields({ user, isActive, setIsActive, accountType, onAccountTypeChange, companyId, onCompanyChange, companies, units, unitsLoading, errors = {} }: {
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
  errors?: Record<string, string[]>
}) {
  const [orgSelection, setOrgSelection] = useState({ companyId, id: user?.orgUnit?.id ?? '' })
  const [photoName, setPhotoName] = useState('')
  const errorId = useId()
  const firstError = Object.keys(errors)[0]
  useEffect(() => {
    if (firstError) document.getElementById(`${errorId}-${firstError}`)?.closest('label')?.querySelector<HTMLElement>('input, select, button')?.focus()
  }, [errorId, firstError])
  function errorProps(name: string, label: string) {
    return { 'aria-label': label, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `${errorId}-${name}` : undefined }
  }
  function fieldError(name: string) {
    return errors[name] && <small className="account-field-error" id={`${errorId}-${name}`}>{errors[name][0]}</small>
  }
  return (
    <>
      <label>
        <span>Тип облікового запису<RequiredMark /></span>
        <select aria-label="Тип облікового запису" required value={isActive ? accountType : 'INACTIVE'} onChange={(event) => {
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
        <span>Логін<RequiredMark /></span>
        <input {...errorProps('username', 'Логін')} name="username" defaultValue={user?.username ?? ''} required pattern="[a-z0-9._\-]{3,32}" autoComplete="username" onInput={(event) => { event.currentTarget.value = removeWhitespace(event.currentTarget.value) }} />
        {fieldError('username')}
      </label>
      <label>
        <span>Ім’я<RequiredMark /></span>
        <input {...errorProps('firstName', 'Ім’я')} name="firstName" defaultValue={user?.firstName ?? ''} required autoComplete="given-name" />
        {fieldError('firstName')}
      </label>
      <label>
        <span>Прізвище<RequiredMark /></span>
        <input {...errorProps('lastName', 'Прізвище')} name="lastName" defaultValue={user?.lastName ?? ''} required autoComplete="family-name" />
        {fieldError('lastName')}
      </label>
      <label>
        По батькові
        <input {...errorProps('middleName', 'По батькові')} name="middleName" defaultValue={user?.middleName ?? ''} />
        {fieldError('middleName')}
      </label>
      <label>
        Стать
        <select name="gender" defaultValue={user?.gender ?? ''}><option value="">Не вказувати</option><option value="FEMALE">Жінка</option><option value="MALE">Чоловік</option><option value="OTHER">Інше</option></select>
      </label>
      <label>
        Телефон
        <input {...errorProps('phone', 'Телефон')} name="phone" defaultValue={user?.phone ?? ''} type="tel" />
        {fieldError('phone')}
      </label>
      <label>
        <span>Email{!user && <RequiredMark />}</span>
        <input {...errorProps('contactEmail', 'Email')} name="contactEmail" defaultValue={user?.contactEmail ?? ''} type="email" required={!user} autoComplete="email" />
        {fieldError('contactEmail')}
      </label>
      <label>
        <span>{user ? 'Новий пароль (за потреби)' : 'Пароль'}{!user && <RequiredMark />}</span>
        <input {...errorProps('password', user ? 'Новий пароль (за потреби)' : 'Пароль')} aria-describedby={errors.password ? `${errorId}-password` : `${errorId}-password-hint`} name="password" type="password" required={!user} minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" onInput={(event) => { event.currentTarget.value = removeWhitespace(event.currentTarget.value) }} />
        {fieldError('password') || <small id={`${errorId}-password-hint`}>Від {PASSWORD_MIN_LENGTH} до 128 символів без пробілів.</small>}
      </label>
      <label>
        <span>{user ? 'Підтвердження нового паролю' : 'Підтвердження паролю'}{!user && <RequiredMark />}</span>
        <input {...errorProps('passwordConfirmation', user ? 'Підтвердження нового паролю' : 'Підтвердження паролю')} name="passwordConfirmation" type="password" required={!user} minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" onInput={(event) => { event.currentTarget.value = removeWhitespace(event.currentTarget.value) }} />
        {fieldError('passwordConfirmation')}
      </label>
      <label>
        День народження
        <DateTimePicker {...errorProps('birthDate', 'День народження')} name="birthDate" defaultValue={user?.birthDate ?? ''} type="date" />
        {fieldError('birthDate')}
      </label>
      <div className="admin-photo-field">
        <span className="admin-photo-field__label">Фотографія</span>
        <FileDropzone
          label="Фотографія"
          name="photo"
          accept="image/png,image/jpeg,image/webp"
          title="Перетягніть файл сюди"
          buttonLabel={null}
          onFiles={(files) => setPhotoName(files[0]?.name ?? '')}
        >
          {photoName && <small className="admin-photo-field__filename" role="status" title={photoName}>{photoName}</small>}
        </FileDropzone>
      </div>
      <label className="span-2">
        Посада
        <input {...errorProps('jobTitle', 'Посада')} name="jobTitle" defaultValue={user?.jobTitle ?? ''} />
        {fieldError('jobTitle')}
      </label>
      {accountType === 'USER' && (
        <label className="span-2">
          <span>Компанія<RequiredMark /></span>
          <select {...errorProps('companyId', 'Компанія')} name="companyId" required value={companyId} onChange={(event) => onCompanyChange(event.target.value)}>
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
          {fieldError('companyId')}
        </label>
      )}
      {accountType === 'USER' && (
        <label className="span-2">
          Підрозділ (необов’язково)
          <select {...errorProps('orgUnitId', 'Підрозділ')} name="orgUnitId" disabled={!companyId || unitsLoading} value={orgSelection.companyId === companyId ? orgSelection.id : ''} onChange={(event) => setOrgSelection({ companyId, id: event.target.value })}>
            <option value="">{UNASSIGNED_DEPARTMENT_LABEL}</option>
            {units.map((unit) => <option value={unit.id} key={unit.id}>{unit.name}</option>)}
          </select>
          {fieldError('orgUnitId')}
          {!companyId && <small>Спочатку оберіть компанію.</small>}
          {companyId && <small>«{UNASSIGNED_DEPARTMENT_LABEL}» належить обраній компанії. Решта даних користувача зберігається.</small>}
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
  const creatingRef = useRef(false)
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

  const photoRef = useRef<File | null>(null)
  const photoMutation = useMutation({
    mutationFn: async (created: { userId: string }) => {
      if (!photoRef.current) return
      const avatar = new FormData()
      avatar.set('file', photoRef.current)
      await api(`/admin/users/${created.userId}/avatar`, { method: 'POST', body: avatar })
      void client.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })
  const mutation = useMutation({ mutationFn: async ({ data, photo }: { data: FormData; photo: FormDataEntryValue | null }) => {
    const body = {
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
    }
    validateAccountBody(body)
    const created = await api<{ userId: string; username: string }>('/admin/users', {
      method: 'POST',
      body: jsonBody(body),
    })
    setResult(created)
    void client.invalidateQueries({ queryKey: ['admin-users'] })
    if (photo instanceof File && photo.size > 0) {
      photoRef.current = photo
      photoMutation.mutate(created)
    }
  }, onSettled: () => { creatingRef.current = false } })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creatingRef.current || result) return
    creatingRef.current = true
    const data = new FormData(event.currentTarget)
    mutation.mutate({ data, photo: data.get('photo') })
  }

  return (
    <Drawer size="lg" title="Новий обліковий запис" onRequestClose={onClose}>
      {result ? (
        <div className="credential-result">
          <KeyRound size={28} />
          <h3>Доступ створено</h3>
          <p>Передайте встановлений пароль користувачу захищеним каналом.</p>
          <dl>
            <div>
              <dt>Логін</dt>
              <dd>@{result.username}</dd>
            </div>
            <div>
              <dt>Пароль</dt>
              <dd>
                <code>Встановлено адміністратором</code>
              </dd>
            </div>
            <div>
              <dt>Дійсний до</dt>
              <dd>Постійний пароль</dd>
            </div>
          </dl>
          {photoMutation.isPending && <p role="status">Фото завантажується…</p>}
          {photoMutation.isError && <p role="alert" className="form-error">Акаунт створено, але фото не завантажено. {errorMessage(photoMutation.error)}</p>}
          {photoMutation.isError && <Button disabled={photoMutation.isPending} onClick={() => photoMutation.mutate(result)}>Повторити завантаження фото</Button>}
          <Button disabled={photoMutation.isPending} onClick={onClose}>Готово</Button>
        </div>
      ) : (
        <form className="entity-form account-form" noValidate onSubmit={(event) => void submit(event)}>
          <UserAccountFields errors={accountErrors(mutation.error)} isActive={isActive} setIsActive={setIsActive} accountType={accountType} onAccountTypeChange={setAccountType} companyId={companyId} onCompanyChange={setCompanyId} companies={companies.data?.items ?? []} units={units.data?.items ?? []} unitsLoading={units.isLoading} />
          {mutation.isError && <p role="alert" className="form-error span-2">{Object.keys(accountErrors(mutation.error)).length ? 'Перевірте виділені поля.' : errorMessage(mutation.error)}</p>}
          {units.isError && <p role="alert" className="form-error span-2">Не вдалося завантажити підрозділи.</p>}
          <Button className="span-2" disabled={mutation.isPending || companies.isLoading || (accountType === 'USER' && Boolean(companyId) && (units.isLoading || units.isError))}>{mutation.isPending ? 'Створення…' : 'Створити доступ'}</Button>
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
  return (
    <Drawer size="lg" title="Редагувати користувача" onRequestClose={onClose}>
      {query.isLoading ? <Skeleton /> : query.isError || !query.data ? <ErrorState /> :
        <UserEditor key={id} user={query.data} onClose={onClose} />}
    </Drawer>
  )
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
  const [newOwnerId, setNewOwnerId] = useState('')
  const photoRef = useRef<File | null>(null)
  const companies = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: Array<{ id: string; name: string; isActive: boolean }> }>('/admin/companies'),
  })
  const units = useQuery({
    queryKey: ['org-units', companyId],
    queryFn: () => api<{ items: Array<{ id: string; name: string }> }>(`/org/units?company=${encodeURIComponent(companyId)}`),
    enabled: accountType === 'USER' && Boolean(companyId),
  })
  function invalidateUser() {
    void client.invalidateQueries({ queryKey: ['admin-users'] })
    void client.invalidateQueries({ queryKey: ['admin-user', user.id] })
    void client.invalidateQueries({ queryKey: ['admin-companies'] })
    void client.invalidateQueries({ queryKey: ['admin-org-units'] })
    void client.invalidateQueries({ queryKey: ['org-units'] })
  }
  const photoMutation = useMutation({
    mutationFn: async () => {
      if (!photoRef.current) return
      const avatar = new FormData()
      avatar.set('file', photoRef.current)
      await api(`/admin/users/${user.id}/avatar`, { method: 'POST', body: avatar })
    },
    onSuccess: () => { invalidateUser(); onClose() },
  })
  const mutation = useMutation({
    mutationFn: async ({ body }: { body: Record<string, unknown>; photo: FormDataEntryValue | null }) => {
      validateAccountBody(body, true)
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body: jsonBody(body) })
    },
    onSuccess: (_, { photo }) => {
      invalidateUser()
      if (photo instanceof File && photo.size > 0) {
        photoRef.current = photo
        photoMutation.mutate()
      } else onClose()
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutation.isPending || photoMutation.isPending) return
    const data = new FormData(event.currentTarget)
    mutation.mutate({ photo: data.get('photo'), body: {
      firstName: data.get('firstName'),
      lastName: data.get('lastName'),
      middleName: data.get('middleName') || undefined,
      username: data.get('username'),
      accountType,
      companyId: accountType === 'USER' ? companyId : undefined,
      orgUnitId: accountType === 'USER' ? (data.get('orgUnitId') || null) : null,
      newOwnerId: !isActive && newOwnerId ? newOwnerId : undefined,
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
      <form className="entity-form account-form" noValidate onSubmit={submit}>
        <UserAccountFields errors={accountErrors(mutation.error)} isActive={isActive} setIsActive={setIsActive} user={user} accountType={accountType} onAccountTypeChange={setAccountType} companyId={companyId} onCompanyChange={setCompanyId} companies={companies.data?.items ?? []} units={units.data?.items ?? []} unitsLoading={units.isLoading} />
        {(user.leadership.companies.length + user.leadership.orgUnits.length) > 0 && <p className="privacy-note span-2">
          Зміна компанії, типу доступу або деактивація очистить керівні маркери: {[
            ...user.leadership.companies.map((company) => company.name),
            ...user.leadership.orgUnits.map((unit) => unit.name),
          ].join(', ')}.
        </p>}
        {!isActive && <p className="privacy-note span-2">Вхід і доступ до системи заблоковано. Після збереження всі сеанси користувача будуть завершені.</p>}
        {!isActive && user.isActive && <div className="span-2">
          <UserSearchCombobox label="Новий відповідальний за задачі та документи" value={newOwnerId} onChange={setNewOwnerId} excludeIds={[user.id]} />
          <small>Потрібен, якщо є активні задачі або документи.</small>
        </div>}
        {mutation.isError && <p role="alert" className="form-error span-2">{Object.keys(accountErrors(mutation.error)).length ? 'Перевірте виділені поля.' : errorMessage(mutation.error)}</p>}
        {photoMutation.isError && <><p role="alert" className="form-error span-2">Зміни збережено, але фото не завантажено. {errorMessage(photoMutation.error)}</p><Button type="button" disabled={photoMutation.isPending} onClick={() => photoMutation.mutate()}>Повторити завантаження фото</Button></>}
        {units.isError && <p role="alert" className="form-error span-2">Не вдалося завантажити підрозділи.</p>}
        <Button className="span-2" disabled={mutation.isPending || photoMutation.isPending || photoMutation.isError || companies.isLoading || (accountType === 'USER' && Boolean(companyId) && (units.isLoading || units.isError))}>
          Зберегти зміни
        </Button>
      </form>
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

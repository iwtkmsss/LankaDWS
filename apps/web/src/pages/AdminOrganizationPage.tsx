import type { AdminOrgUnitView, OrgCompanyView, OrgUnitEmployeeView } from '@bert-crm/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Building2, Eye, List, Pencil, PencilRuler, Plus, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { OrganizationMap } from '../features/organization/OrganizationMap'
import { useTopbarContent } from '../layout/TopbarContent'
import { CompanyEditor } from './CompaniesPage'
import { api, jsonBody } from '../shared/api/client'
import { Button, Card, ConfirmationDialog, Drawer, EmptyState, ErrorState, Skeleton, StatusBadge } from '../shared/ui'

interface AdminUserOption {
  id: string
  displayName: string
  jobTitle: string
  accountType: 'ADMIN' | 'USER'
}

interface CompanySettings {
  id: string
  name: string
  slug: string
  description: string | null
  timezone: string
  isActive: boolean
  version: number
}

interface CompanyOption {
  id: string
  name: string
}

function descendantIds(unitId: string, units: AdminOrgUnitView[]) {
  const ids = new Set<string>()
  const pending = [unitId]
  while (pending.length) {
    const parentId = pending.pop()!
    for (const unit of units) {
      if (unit.parentId !== parentId || ids.has(unit.id)) continue
      ids.add(unit.id)
      pending.push(unit.id)
    }
  }
  return ids
}

export default function AdminOrganizationPage() {
  const { companyId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const client = useQueryClient()
  const [editor, setEditor] = useState<{ unit?: AdminOrgUnitView; parentId?: string | null } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState(() => params.get('editing') === '1')
  const [creatingCompany, setCreatingCompany] = useState(false)
  const [companySelected, setCompanySelected] = useState(false)
  const [pendingMove, setPendingMove] = useState<{ employeeId: string; employeeName: string; target: AdminOrgUnitView } | null>(null)
  const query = useQuery({
    queryKey: ['admin-org-units', companyId],
    queryFn: () => api<{ company: OrgCompanyView; items: AdminOrgUnitView[] }>(`/admin/companies/${companyId}/org-units?status=ALL`),
    enabled: Boolean(companyId),
  })
  const users = useQuery({
    queryKey: ['admin-users', 'manager-options', companyId],
    queryFn: () => api<{ items: AdminUserOption[] }>(`/admin/users?companyId=${encodeURIComponent(companyId)}&isActive=true&accountType=USER`),
    enabled: Boolean(companyId),
  })
  const administrators = useQuery({
    queryKey: ['admin-users', 'manager-options', 'administrators'],
    queryFn: () => api<{ items: AdminUserOption[] }>('/admin/users?isActive=true&accountType=ADMIN'),
  })
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api<{ items: CompanyOption[] }>('/companies'),
  })
  const archived = query.data?.items.filter((unit) => unit.status === 'ARCHIVED') ?? []
  const selectedId = params.get('unit')
  const selected = query.data?.items.find((unit) => unit.id === selectedId) ?? null
  const managerCandidates = [...(users.data?.items ?? []), ...(administrators.data?.items ?? [])]
  const editStructureAction = useMemo(() => <button className={`topbar-action admin-org-edit-toggle ${editing ? 'is-active' : ''}`} type="button" aria-pressed={editing} onClick={() => setEditing((value) => !value)}>{editing ? <PencilRuler size={17} /> : <Eye size={17} />}{editing ? 'Завершити редагування' : 'Редагувати структуру'}</button>, [editing])
  useTopbarContent(editStructureAction)
  const moveEmployee = useMutation({
    mutationFn: ({ employeeId, target }: { employeeId: string; target: AdminOrgUnitView }) => api(`/admin/companies/${companyId}/org-units/${target.id}/employees`, {
      method: 'PUT', body: jsonBody({ employeeIds: [employeeId], expectedVersion: target.version }),
    }),
    onSuccess: async () => {
      setPendingMove(null)
      await refresh()
      await client.invalidateQueries({ queryKey: ['admin-org-unit-employees', companyId] })
      await client.invalidateQueries({ queryKey: ['org-unit-employees'] })
    },
  })

  const selectUnit = (unitId: string) => {
    setCompanySelected(false)
    const next = new URLSearchParams(params)
    next.set('unit', unitId)
    setParams(next)
  }

  const clearSelection = () => {
    if (!selectedId) return
    const next = new URLSearchParams(params)
    next.delete('unit')
    setParams(next, { replace: true })
  }

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['admin-org-units', companyId] })
    await client.invalidateQueries({ queryKey: ['admin-company', companyId] })
    await client.invalidateQueries({ queryKey: ['org-units'] })
    await client.invalidateQueries({ queryKey: ['companies'] })
    await client.invalidateQueries({ queryKey: ['admin-companies'] })
  }

  if (query.isLoading) return <Skeleton rows={7} />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()} />

  return (
    <div className="admin-org-page" onClick={(event) => {
      const target = event.target as HTMLElement
      if (target.closest('.organization-map__panel, .organization-map__node, .admin-org-archive--map button')) return
      setCompanySelected(false)
      clearSelection()
    }}>
      <Card className="organization-context-bar admin-org-context-bar">
        <label><span>Оберіть компанію</span><select value={companyId} onChange={(event) => {
          setCompanySelected(false)
          setEditor(null)
          setPendingMove(null)
          navigate(`/admin/companies/${encodeURIComponent(event.target.value)}/structure${editing ? '?editing=1' : ''}`)
        }}>{(companies.data?.items ?? [query.data.company]).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
          <div className="organization-heading-actions admin-org-context-actions">
          <div className="admin-org-map-actions">
            {editing && <Button className="admin-org-create-company" type="button" aria-label="Нова компанія" onClick={() => setCreatingCompany(true)}><Plus size={17} />Нова компанія</Button>}
            {editing && <Button onClick={() => setEditor({ parentId: selected?.status === 'ACTIVE' ? selected.id : null })}><Plus size={17} />Новий підрозділ</Button>}
            <button className="button button--secondary" type="button" onClick={() => setShowArchived((value) => !value)}><Archive size={16} />Архів ({archived.length})</button>
          </div>
          <div className="organization-view-switch" role="group" aria-label="Режим перегляду">
            <Link to={`/organization?companyId=${encodeURIComponent(companyId)}&view=people`}><List size={16} />Працівники</Link>
            <Link className="is-active" to={`/organization?companyId=${encodeURIComponent(companyId)}&view=structure`}><Building2 size={16} />Структура</Link>
          </div>
        </div>
      </Card>
      <OrganizationMap
        company={query.data.company}
        units={query.data.items.filter((unit) => unit.status === 'ACTIVE')}
        selectedId={selected?.status === 'ACTIVE' ? selected.id : null}
        onSelect={selectUnit}
        onSelectCompany={() => {
          setCompanySelected(true)
          clearSelection()
        }}
        editing={editing}
        compactOutline="none"
        onAddRoot={() => setEditor({ parentId: null })}
        onAddChild={(parentId) => setEditor({ parentId })}
        onEmployeeDrop={editing ? (unitId, employeeId) => {
          if (unitId === selected?.id) return
          const target = query.data.items.find((unit) => unit.id === unitId && unit.status === 'ACTIVE')
          const employee = users.data?.items.find((user) => user.id === employeeId)
          if (target && employee) setPendingMove({ employeeId, employeeName: employee.displayName, target })
        } : undefined}
        emptyState={<EmptyState title="Підрозділів ще немає" description="Увімкніть редагування та створіть перший відділ." />}
        sidePanel={companySelected ? <CompanyDetail
          key={`${query.data.company.id}:${query.data.company.version}`}
          company={query.data.company}
          users={managerCandidates}
          companyId={companyId}
          editing={editing}
          onSaved={refresh}
        /> : selected ? editing ? <UnitDetail
          unit={selected}
          units={query.data.items}
          companyId={companyId}
          onEdit={() => setEditor({ unit: selected })}
          onChanged={refresh}
        /> : <header className="admin-org-preview">
          <span className="eyebrow">{selected.status === 'ACTIVE' ? 'Підрозділ' : 'Архівований підрозділ'}</span>
          <h2>{selected.name}</h2>
          <p>{selected.description?.trim() || (selected.manager ? `Керівник: ${selected.manager.displayName}` : 'Керівника не призначено')}</p>
          <dl className="admin-org-stats"><div><dt>Працівники</dt><dd>{selected.activeEmployeeCount}</dd></div><div><dt>Дочірні вузли</dt><dd>{selected.childCount}</dd></div></dl>
          <small>Увімкніть редагування, щоб змінити, перенести або архівувати цей вузол.</small>
        </header> : undefined}
      />
      {showArchived && <Card className="admin-org-archive admin-org-archive--map" aria-label="Архівовані підрозділи">
        <strong>Архівовані</strong>
        {archived.length ? archived.map((unit) => <button type="button" key={unit.id} className={selected?.id === unit.id ? 'is-selected' : ''} onClick={() => selectUnit(unit.id)}>
          <span>{unit.name}</span><StatusBadge status="ARCHIVED" />
        </button>) : <small>Архів порожній.</small>}
      </Card>}
      {editor && <UnitEditor
        companyId={companyId}
        unit={editor.unit}
        defaultParentId={editor.parentId}
        companies={companies.data?.items ?? [query.data.company]}
        users={users.data?.items ?? []}
        managerCandidates={managerCandidates}
        onClose={() => setEditor(null)}
        onSaved={async (unitId, targetCompanyId) => {
          await refresh()
          setEditor(null)
          if (targetCompanyId !== companyId) {
            navigate(`/admin/companies/${encodeURIComponent(targetCompanyId)}/structure?editing=1&unit=${encodeURIComponent(unitId)}`)
            return
          }
          selectUnit(unitId)
        }}
      />}
      {creatingCompany && <CompanyEditor
        onClose={() => setCreatingCompany(false)}
        onCreated={(company) => navigate(`/admin/companies/${encodeURIComponent(company.id)}/structure?editing=1`)}
      />}
      {pendingMove && <ConfirmationDialog
        title="Перевести працівника?"
        description={`${pendingMove.employeeName} буде переведений до підрозділу «${pendingMove.target.name}».`}
        confirmLabel="Перевести"
        confirmVariant="primary"
        confirmDisabled={moveEmployee.isPending}
        onConfirm={() => moveEmployee.mutate({ employeeId: pendingMove.employeeId, target: pendingMove.target })}
        onRequestClose={() => { if (!moveEmployee.isPending) setPendingMove(null) }}
      >
        <p>Попередній основний підрозділ буде збережено в історії призначень.</p>
        {moveEmployee.isError && <p role="alert">Не вдалося перевести працівника. Оновіть структуру та повторіть.</p>}
      </ConfirmationDialog>}
    </div>
  )
}

function CompanyDetail({ company, users, companyId, editing, onSaved }: { company: OrgCompanyView; users: AdminUserOption[]; companyId: string; editing: boolean; onSaved: () => Promise<void> }) {
  const client = useQueryClient()
  const [managerId, setManagerId] = useState<string | null>(company.manager?.id ?? null)
  const [managerQuery, setManagerQuery] = useState(company.manager?.displayName ?? '')
  const [name, setName] = useState(company.name)
  const [description, setDescription] = useState(company.description ?? '')
  const settings = useQuery({
    queryKey: ['admin-company', companyId],
    queryFn: () => api<CompanySettings>(`/admin/companies/${companyId}`),
    enabled: editing,
  })
  useEffect(() => {
    if (!settings.data) return
    setName(settings.data.name)
    setDescription(settings.data.description ?? '')
  }, [settings.data?.id, settings.data?.version])
  const normalizedManagerQuery = managerQuery.trim().toLocaleLowerCase('uk')
  const managerOptions = normalizedManagerQuery.length
    ? users.filter((user) => `${user.displayName} ${user.jobTitle}`.toLocaleLowerCase('uk').includes(normalizedManagerQuery))
    : []
  const mutation = useMutation({
    mutationFn: async ({ name, description, nextManagerId }: { name: string; description: string; nextManagerId: string | null }) => {
      let version = company.version
      let currentSettings = settings.data ?? await api<CompanySettings>(`/admin/companies/${companyId}`)
      if (name !== currentSettings.name || description !== (currentSettings.description ?? '')) {
        currentSettings = await api<CompanySettings>(`/admin/companies/${companyId}`, {
          method: 'PATCH', body: jsonBody({ name, slug: currentSettings.slug, description, timezone: currentSettings.timezone, isActive: currentSettings.isActive }),
        })
        version = currentSettings.version
      }
      if (nextManagerId !== (company.manager?.id ?? null)) {
        const manager = await api<{ version: number }>(`/admin/companies/${companyId}/manager`, {
          method: 'PATCH', body: jsonBody({ managerId: nextManagerId, expectedVersion: version }),
        })
        currentSettings = { ...currentSettings, version: manager.version }
      }
      return currentSettings
    },
    onSuccess: async (saved) => {
      client.setQueryData(['admin-company', companyId], saved)
      await onSaved()
    },
  })
  if (!editing) return <header className="admin-org-preview"><span className="eyebrow">Компанія</span><h2>{company.name}</h2><p>{company.description?.trim() || (company.manager ? `Керівник: ${company.manager.displayName}` : 'Керівника не призначено')}</p><small>Увімкніть редагування, щоб змінити назву або призначити керівника.</small></header>
  if (settings.isLoading || !settings.data) return <header className="admin-org-preview"><span className="eyebrow">Компанія</span><h2>{company.name}</h2><p>{settings.isError ? 'Не вдалося завантажити параметри компанії.' : 'Завантажуємо параметри компанії…'}</p></header>
  return <>
    <header><span className="eyebrow">Компанія</span><h2>{company.name}</h2><p>Редагуйте назву, опис та керівника безпосередньо для головного вузла.</p></header>
    <form className="entity-form admin-org-form admin-org-company-form" onSubmit={(event) => {
      event.preventDefault()
      mutation.mutate({ name: name.trim(), description: description.trim(), nextManagerId: managerId })
    }}>
      <label>Назва<input name="name" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="span-2">Опис<textarea name="description" rows={4} maxLength={320} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Чим займається компанія та за що відповідає команда" /></label>
      <div className="admin-org-person-picker">
        <label>Керівник<input type="search" value={managerQuery} onChange={(event) => { setManagerQuery(event.target.value); setManagerId(null) }} placeholder="Почніть вводити ім’я або посаду" aria-autocomplete="list" aria-controls="company-manager-options" /></label>
        {managerId && <button type="button" className="admin-org-person-picker__clear" aria-label="Очистити керівника" onClick={() => { setManagerId(null); setManagerQuery('') }}><X size={15} /></button>}
        {normalizedManagerQuery.length > 0 && !managerId && <div id="company-manager-options" className="admin-org-person-picker__options" role="listbox" aria-label="Варіанти керівника">
          {managerOptions.length ? managerOptions.map((user) => <button key={user.id} type="button" role="option" onClick={() => { setManagerId(user.id); setManagerQuery(user.displayName) }}><strong>{user.displayName}</strong><small>{user.accountType === 'ADMIN' ? 'Адміністратор' : user.jobTitle || 'Без посади'}</small></button>) : <p>Користувача не знайдено.</p>}
        </div>}
      </div>
      {mutation.isError && <p role="alert">{mutation.error instanceof Error ? mutation.error.message : 'Не вдалося зберегти зміни. Оновіть структуру та повторіть.'}</p>}
      <Button disabled={mutation.isPending}>Зберегти зміни</Button>
    </form>
  </>
}

function UnitEditor({ companyId, unit, defaultParentId, companies, users, managerCandidates, onClose, onSaved }: {
  companyId: string; unit?: AdminOrgUnitView; defaultParentId?: string | null; companies: CompanyOption[]; users: AdminUserOption[]; managerCandidates: AdminUserOption[]
  onClose: () => void; onSaved: (unitId: string, targetCompanyId: string) => Promise<void>
}) {
  const [targetCompanyId, setTargetCompanyId] = useState(companyId)
  const [managerId, setManagerId] = useState<string | null>(unit?.manager?.id ?? null)
  const [managerQuery, setManagerQuery] = useState(unit?.manager?.displayName ?? '')
  const [description, setDescription] = useState(unit?.description ?? '')
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [addedEmployeeIds, setAddedEmployeeIds] = useState<string[]>([])
  const targetUsers = useQuery({
    queryKey: ['admin-users', 'manager-options', targetCompanyId],
    queryFn: () => api<{ items: AdminUserOption[] }>(`/admin/users?companyId=${encodeURIComponent(targetCompanyId)}&isActive=true&accountType=USER`),
    enabled: !unit && targetCompanyId !== companyId,
  })
  const targetUsersList = targetCompanyId === companyId ? users : (targetUsers.data?.items ?? [])
  const targetManagerCandidates = targetCompanyId === companyId ? managerCandidates : [
    ...targetUsersList,
    ...managerCandidates.filter((user) => user.accountType === 'ADMIN'),
  ]
  const employees = useQuery({
    queryKey: ['admin-org-unit-employees', companyId, unit?.id],
    queryFn: () => api<{ items: OrgUnitEmployeeView[] }>(`/org/units/${unit!.id}/employees?company=${encodeURIComponent(companyId)}`),
    enabled: Boolean(unit?.id),
  })
  const normalizedManagerQuery = managerQuery.trim().toLocaleLowerCase('uk')
  const managerOptions = normalizedManagerQuery.length
    ? targetManagerCandidates.filter((user) => `${user.displayName} ${user.jobTitle}`.toLocaleLowerCase('uk').includes(normalizedManagerQuery))
    : []
  const normalizedEmployeeQuery = employeeQuery.trim().toLocaleLowerCase('uk')
  const currentEmployeeIds = new Set(employees.data?.items.map((employee) => employee.id) ?? [])
  const selectedEmployees = [
    ...(employees.data?.items ?? []).map((employee) => ({ id: employee.id, displayName: employee.displayName, jobTitle: employee.positionTitle || employee.jobTitle })),
    ...addedEmployeeIds.filter((employeeId) => !currentEmployeeIds.has(employeeId)).map((employeeId) => targetUsersList.find((user) => user.id === employeeId)).filter((user): user is AdminUserOption => Boolean(user)),
  ]
  const employeeOptions = normalizedEmployeeQuery.length
    ? targetUsersList.filter((user) => !currentEmployeeIds.has(user.id) && !addedEmployeeIds.includes(user.id) && `${user.displayName} ${user.jobTitle}`.toLocaleLowerCase('uk').includes(normalizedEmployeeQuery))
    : []
  const mutation = useMutation({
    mutationFn: async (body: object) => {
      const saved = await api<{ id: string; version: number }>(unit
        ? `/admin/companies/${companyId}/org-units/${unit.id}`
        : `/admin/companies/${targetCompanyId}/org-units`, {
        method: unit ? 'PATCH' : 'POST', body: jsonBody(body),
      })
      if (addedEmployeeIds.length) {
        await api(`/admin/companies/${unit ? companyId : targetCompanyId}/org-units/${saved.id}/employees`, {
          method: 'PUT', body: jsonBody({ employeeIds: addedEmployeeIds, expectedVersion: saved.version }),
        })
      }
      return saved
    },
    onSuccess: (result) => onSaved(result.id, unit ? companyId : targetCompanyId),
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({
      name: data.get('name'),
      description: description.trim(),
      parentId: unit?.parentId ?? defaultParentId ?? null,
      managerId,
      ...(unit ? { expectedVersion: unit.version } : {}),
    })
  }
  return <Drawer title={unit ? 'Редагувати підрозділ' : 'Новий підрозділ'} onRequestClose={onClose}>
    <form className="entity-form admin-org-form" onSubmit={submit}>
      <label className="span-2">Назва<input name="name" required maxLength={120} defaultValue={unit?.name} /></label>
      {!unit && <label className="span-2">Компанія<select value={targetCompanyId} onChange={(event) => {
        setTargetCompanyId(event.target.value)
        setManagerId(null)
        setManagerQuery('')
        setEmployeeQuery('')
        setAddedEmployeeIds([])
      }} disabled={defaultParentId !== null && defaultParentId !== undefined}>
        {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select></label>}
      <label className="span-2">Опис<textarea name="description" rows={4} maxLength={320} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Чим займається цей відділ" /></label>
      <div className="span-2 admin-org-person-picker">
        <label>Керівник<input type="search" value={managerQuery} onChange={(event) => { setManagerQuery(event.target.value); setManagerId(null) }} placeholder="Почніть вводити ім’я або посаду" aria-autocomplete="list" aria-controls="manager-options" /></label>
        {managerId && <button type="button" className="admin-org-person-picker__clear" aria-label="Очистити керівника" onClick={() => { setManagerId(null); setManagerQuery('') }}><X size={15} /></button>}
        {normalizedManagerQuery.length > 0 && !managerId && <div id="manager-options" className="admin-org-person-picker__options" role="listbox" aria-label="Варіанти керівника">
          {managerOptions.length ? managerOptions.map((user) => <button key={user.id} type="button" role="option" onClick={() => { setManagerId(user.id); setManagerQuery(user.displayName) }}><strong>{user.displayName}</strong><small>{user.accountType === 'ADMIN' ? 'Адміністратор' : user.jobTitle || 'Без посади'}</small></button>) : <p>Користувача не знайдено.</p>}
        </div>}
      </div>
      <section className="span-2 admin-org-employees-picker">
        <label>Працівники<input type="search" value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} placeholder="Почніть вводити ім’я або посаду" aria-autocomplete="list" aria-controls="employee-options" /></label>
        {normalizedEmployeeQuery.length > 0 && <div id="employee-options" className="admin-org-person-picker__options" role="listbox" aria-label="Варіанти працівників">
          {employeeOptions.length ? employeeOptions.map((user) => <button key={user.id} type="button" role="option" onClick={() => { setAddedEmployeeIds((ids) => [...ids, user.id]); setEmployeeQuery('') }}><strong>{user.displayName}</strong><small>{user.jobTitle || 'Без посади'}</small></button>) : <p>Працівника не знайдено.</p>}
        </div>}
        {employees.isLoading ? <small>Завантажуємо працівників…</small> : selectedEmployees.length ? <div className="admin-org-employees-picker__list">
          {selectedEmployees.map((employee) => <article key={employee.id}><span>{employee.displayName.slice(0, 1)}</span><div><strong>{employee.displayName}</strong><small>{employee.jobTitle || 'Без посади'}</small></div></article>)}
        </div> : <small>У підрозділі ще немає працівників.</small>}
      </section>
      {mutation.isError && <p className="span-2" role="alert">Не вдалося зберегти. Перевірте назву, вибраних працівників і актуальність даних.</p>}
      <Button className="span-2" disabled={mutation.isPending}>{unit ? 'Зберегти зміни' : 'Створити підрозділ'}</Button>
    </form>
  </Drawer>
}

function UnitDetail({ unit, units, companyId, onEdit, onChanged }: {
  unit: AdminOrgUnitView; units: AdminOrgUnitView[]; companyId: string; onEdit: () => void; onChanged: () => Promise<void>
}) {
  const [targetId, setTargetId] = useState('')
  const employees = useQuery({
    queryKey: ['admin-org-unit-employees', companyId, unit.id],
    queryFn: () => api<{ items: OrgUnitEmployeeView[] }>(`/org/units/${unit.id}/employees?company=${encodeURIComponent(companyId)}`),
    enabled: unit.status === 'ACTIVE',
  })
  const parent = units.find((candidate) => candidate.id === unit.parentId)
  const excluded = descendantIds(unit.id, units)
  excluded.add(unit.id)
  const targets = units.filter((candidate) => candidate.status === 'ACTIVE' && !excluded.has(candidate.id))
  const archive = useMutation({
    mutationFn: () => api(`/admin/companies/${companyId}/org-units/${unit.id}/archive`, {
      method: 'POST', body: jsonBody({ expectedVersion: unit.version, ...(unit.parentId ? {} : { targetUnitId: targetId }) }),
    }),
    onSuccess: onChanged,
  })
  const restore = useMutation({
    mutationFn: (body: object) => api(`/admin/companies/${companyId}/org-units/${unit.id}/restore`, { method: 'POST', body: jsonBody(body) }),
    onSuccess: onChanged,
  })
  if (unit.status === 'ARCHIVED') return <>
    <header><span className="eyebrow">Архівований підрозділ</span><h2>{unit.name}</h2><p>Відновиться порожнім; попередні переміщення не відкочуються.</p></header>
    <form className="entity-form admin-org-form" onSubmit={(event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      restore.mutate({ expectedVersion: unit.version, name: data.get('name'), parentId: data.get('parentId')?.toString() || null })
    }}>
      <label className="span-2">Назва<input name="name" required maxLength={120} defaultValue={unit.name} /></label>
      <label className="span-2">Батьківський підрозділ<select name="parentId" defaultValue={unit.parentId ?? ''}><option value="">Компанія · верхній рівень</option>{targets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
      {restore.isError && <p className="span-2" role="alert">Відновлення заблоковано. Перевірте батьківський вузол і назву.</p>}
      <Button className="span-2" disabled={restore.isPending}><RotateCcw size={16} />Відновити</Button>
    </form>
  </>
  const destinationName = parent?.name ?? targets.find((candidate) => candidate.id === targetId)?.name
  return <>
    <header><span className="eyebrow">Активний підрозділ</span><h2>{unit.name}</h2><p>{unit.description?.trim() || (unit.manager ? `Керівник: ${unit.manager.displayName}` : 'Керівника не призначено')}</p></header>
    <dl className="admin-org-stats"><div><dt>Працівники</dt><dd>{unit.activeEmployeeCount}</dd></div><div><dt>Дочірні вузли</dt><dd>{unit.childCount}</dd></div></dl>
    <section className="admin-org-draggable-employees" aria-label="Працівники підрозділу">
      <strong>Працівники</strong>
      {employees.isLoading ? <small>Завантажуємо…</small> : employees.data?.items.length ? <div>
        {employees.data.items.map((employee) => <article
          key={employee.id}
          draggable
          tabIndex={0}
          onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-bert-employee', employee.id); event.dataTransfer.setData('text/plain', employee.id) }}
          aria-label={`${employee.displayName}. Перетягніть на інший підрозділ`}
        ><span>{employee.displayName.slice(0, 1)}</span><div><strong>{employee.displayName}</strong><small>{employee.positionTitle || employee.jobTitle || 'Без посади'}</small></div></article>)}
      </div> : <small>У цьому підрозділі працівників немає.</small>}
    </section>
    <div className="drawer-actions"><Button onClick={onEdit}><Pencil size={16} />Редагувати</Button></div>
    <details className="admin-org-danger">
      <summary>Архівація</summary>
      <p>Прямі працівники та дочірні вузли перейдуть до: <b>{destinationName ?? 'оберіть ціль'}</b>.</p>
      {!unit.parentId && <label>Цільовий підрозділ<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Оберіть ціль</option>{targets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>}
      {archive.isError && <p role="alert">Архівацію заблоковано через конфлікт структури або версії.</p>}
      <Button variant="danger" disabled={archive.isPending || (!unit.parentId && !targetId)} onClick={() => archive.mutate()}><Archive size={16} />Архівувати</Button>
    </details>
  </>
}

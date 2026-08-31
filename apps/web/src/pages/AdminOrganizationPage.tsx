import type { AdminOrgUnitView, OrgCompanyView, OrgUnitEmployeeView } from '@bert-crm/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Eye, Pencil, PencilRuler, Plus, RotateCcw, UserRound, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { OrganizationMap } from '../features/organization/OrganizationMap'
import { api, jsonBody } from '../shared/api/client'
import { Button, Card, ConfirmationDialog, Drawer, EmptyState, ErrorState, Skeleton, StatusBadge } from '../shared/ui'

interface AdminUserOption {
  id: string
  displayName: string
  jobTitle: string
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
  const [params, setParams] = useSearchParams()
  const client = useQueryClient()
  const [editor, setEditor] = useState<{ unit?: AdminOrgUnitView; parentId?: string | null } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState(() => params.get('editing') === '1')
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
  const archived = query.data?.items.filter((unit) => unit.status === 'ARCHIVED') ?? []
  const selectedId = params.get('unit')
  const selected = query.data?.items.find((unit) => unit.id === selectedId) ?? null
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
  }

  if (query.isLoading) return <Skeleton rows={7} />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()} />

  return (
    <div className="admin-org-page" onClick={(event) => {
      const target = event.target as HTMLElement
      if (target.closest('.organization-map__panel, .organization-map__node, .admin-org-archive--map button')) return
      clearSelection()
    }}>
      <div className="admin-org-subtoolbar">
        <Link className="admin-org-back" to={`/organization?companyId=${encodeURIComponent(companyId)}&view=structure`}>← До структури</Link>
        <div className="admin-org-map-actions">
          {editing ? (
            <Link className="admin-org-edit-toggle is-active" to={`/organization?companyId=${encodeURIComponent(companyId)}&view=structure`}>
              <PencilRuler size={17} />Редагування увімкнено
            </Link>
          ) : (
            <button className="admin-org-edit-toggle" type="button" aria-pressed="false" onClick={() => setEditing(true)}>
              <Eye size={17} />Режим перегляду
            </button>
          )}
          {editing && <Button onClick={() => setEditor({ parentId: selected?.status === 'ACTIVE' ? selected.id : null })}><Plus size={17} />Новий підрозділ</Button>}
          <button className="button button--secondary" type="button" onClick={() => setShowArchived((value) => !value)}><Archive size={16} />Архів ({archived.length})</button>
        </div>
      </div>
      {editing && <CompanyManagerCard company={query.data.company} users={users.data?.items ?? []} companyId={companyId} onSaved={refresh} />}
      <OrganizationMap
        company={query.data.company}
        units={query.data.items.filter((unit) => unit.status === 'ACTIVE')}
        selectedId={selected?.status === 'ACTIVE' ? selected.id : null}
        onSelect={selectUnit}
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
        sidePanel={selected ? editing ? <UnitDetail
          unit={selected}
          units={query.data.items}
          companyId={companyId}
          onEdit={() => setEditor({ unit: selected })}
          onChanged={refresh}
        /> : <header className="admin-org-preview">
          <span className="eyebrow">{selected.status === 'ACTIVE' ? 'Підрозділ' : 'Архівований підрозділ'}</span>
          <h2>{selected.name}</h2>
          <p>{selected.manager ? `Керівник: ${selected.manager.displayName}` : 'Керівника не призначено'}</p>
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
        users={users.data?.items ?? []}
        onClose={() => setEditor(null)}
        onSaved={async (unitId) => { await refresh(); selectUnit(unitId); setEditor(null) }}
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

function CompanyManagerCard({ company, users, companyId, onSaved }: { company: OrgCompanyView; users: AdminUserOption[]; companyId: string; onSaved: () => Promise<void> }) {
  const mutation = useMutation({
    mutationFn: (managerId: string | null) => api(`/admin/companies/${companyId}/manager`, {
      method: 'PATCH', body: jsonBody({ managerId, expectedVersion: company.version }),
    }),
    onSuccess: onSaved,
  })
  return <Card className="admin-org-company-manager">
    <div><UserRound size={20} /><span><strong>Керівник компанії</strong><small>{company.manager?.displayName ?? 'Керівника не призначено'}</small></span></div>
    <form key={`${company.version}-${company.manager?.id ?? 'none'}-${users.length}`} onSubmit={(event) => {
      event.preventDefault()
      const value = new FormData(event.currentTarget).get('managerId')?.toString() || null
      mutation.mutate(value)
    }}>
      <select name="managerId" aria-label="Керівник компанії" defaultValue={company.manager?.id ?? ''}>
        <option value="">Не призначено</option>
        {users.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.jobTitle || 'без посади'}</option>)}
      </select>
      <Button disabled={mutation.isPending}>Зберегти</Button>
    </form>
    {mutation.isError && <p role="alert">Не вдалося змінити керівника. Оновіть сторінку й повторіть.</p>}
  </Card>
}

function UnitEditor({ companyId, unit, defaultParentId, users, onClose, onSaved }: {
  companyId: string; unit?: AdminOrgUnitView; defaultParentId?: string | null; users: AdminUserOption[]
  onClose: () => void; onSaved: (unitId: string) => Promise<void>
}) {
  const [managerId, setManagerId] = useState<string | null>(unit?.manager?.id ?? null)
  const [managerQuery, setManagerQuery] = useState(unit?.manager?.displayName ?? '')
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [addedEmployeeIds, setAddedEmployeeIds] = useState<string[]>([])
  const employees = useQuery({
    queryKey: ['admin-org-unit-employees', companyId, unit?.id],
    queryFn: () => api<{ items: OrgUnitEmployeeView[] }>(`/org/units/${unit!.id}/employees?company=${encodeURIComponent(companyId)}`),
    enabled: Boolean(unit?.id),
  })
  const normalizedManagerQuery = managerQuery.trim().toLocaleLowerCase('uk')
  const managerOptions = normalizedManagerQuery.length
    ? users.filter((user) => `${user.displayName} ${user.jobTitle}`.toLocaleLowerCase('uk').includes(normalizedManagerQuery))
    : []
  const normalizedEmployeeQuery = employeeQuery.trim().toLocaleLowerCase('uk')
  const currentEmployeeIds = new Set(employees.data?.items.map((employee) => employee.id) ?? [])
  const selectedEmployees = [
    ...(employees.data?.items ?? []).map((employee) => ({ id: employee.id, displayName: employee.displayName, jobTitle: employee.positionTitle || employee.jobTitle })),
    ...addedEmployeeIds.filter((employeeId) => !currentEmployeeIds.has(employeeId)).map((employeeId) => users.find((user) => user.id === employeeId)).filter((user): user is AdminUserOption => Boolean(user)),
  ]
  const employeeOptions = normalizedEmployeeQuery.length
    ? users.filter((user) => !currentEmployeeIds.has(user.id) && !addedEmployeeIds.includes(user.id) && `${user.displayName} ${user.jobTitle}`.toLocaleLowerCase('uk').includes(normalizedEmployeeQuery))
    : []
  const mutation = useMutation({
    mutationFn: async (body: object) => {
      const saved = await api<{ id: string; version: number }>(unit
        ? `/admin/companies/${companyId}/org-units/${unit.id}`
        : `/admin/companies/${companyId}/org-units`, {
        method: unit ? 'PATCH' : 'POST', body: jsonBody(body),
      })
      if (addedEmployeeIds.length) {
        await api(`/admin/companies/${companyId}/org-units/${saved.id}/employees`, {
          method: 'PUT', body: jsonBody({ employeeIds: addedEmployeeIds, expectedVersion: saved.version }),
        })
      }
      return saved
    },
    onSuccess: (result) => onSaved(result.id),
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({
      name: data.get('name'),
      parentId: unit?.parentId ?? defaultParentId ?? null,
      managerId,
      ...(unit ? { expectedVersion: unit.version } : {}),
    })
  }
  return <Drawer title={unit ? 'Редагувати підрозділ' : 'Новий підрозділ'} onRequestClose={onClose}>
    <form className="entity-form admin-org-form" onSubmit={submit}>
      <label className="span-2">Назва<input name="name" required maxLength={120} defaultValue={unit?.name} /></label>
      <div className="span-2 admin-org-person-picker">
        <label>Керівник<input type="search" value={managerQuery} onChange={(event) => { setManagerQuery(event.target.value); setManagerId(null) }} placeholder="Почніть вводити ім’я або посаду" aria-autocomplete="list" aria-controls="manager-options" /></label>
        {managerId && <button type="button" className="admin-org-person-picker__clear" aria-label="Очистити керівника" onClick={() => { setManagerId(null); setManagerQuery('') }}><X size={15} /></button>}
        {normalizedManagerQuery.length > 0 && !managerId && <div id="manager-options" className="admin-org-person-picker__options" role="listbox" aria-label="Варіанти керівника">
          {managerOptions.length ? managerOptions.map((user) => <button key={user.id} type="button" role="option" onClick={() => { setManagerId(user.id); setManagerQuery(user.displayName) }}><strong>{user.displayName}</strong><small>{user.jobTitle || 'Без посади'}</small></button>) : <p>Працівника не знайдено.</p>}
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
    <header><span className="eyebrow">Активний підрозділ</span><h2>{unit.name}</h2><p>{unit.manager ? `Керівник: ${unit.manager.displayName}` : 'Керівника не призначено'}</p></header>
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

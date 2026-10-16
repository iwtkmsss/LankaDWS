import { UnitIconPicker, UnitIcon, CompanyLogo } from '../features/organization/OrganizationVisuals'
import { CompanyLogoPicker } from '../features/organization/CompanyLogoPicker'
import { UserSearchCombobox, type UserSearchOption } from '../features/employees/UserSearchCombobox'
import { personName } from '../shared/lib/personName'
import { UNASSIGNED_DEPARTMENT_LABEL } from '../shared/lib/organization'
import type { AdminOrgUnitView, OrgCompanyView, OrgUnitEmployeeView, OrgUnitIcon } from '@lankadws/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Building2, List, Network, PencilRuler, Plus, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { OrganizationMap } from '../features/organization/OrganizationMap'
import { useTopbarContent } from '../layout/TopbarContent'
import { CompanyCreateForm } from '../features/organization/CompanyCreateForm'
import { UnassignedEmployees } from '../features/organization/UnassignedEmployees'
import { api, jsonBody } from '../shared/api/client'
import { Avatar, Button, Card, ConfirmationDialog, EmptyState, ErrorState, Skeleton, StatusBadge } from '../shared/ui'

interface CompanySettings {
  counts: { users: number; units: number }
  logoFileId: string | null
  logoAsset: string | null
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
  isActive?: boolean
  logoAsset?: string | null
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
  useEffect(() => {
    if (!params.has('editing')) return
    const next = new URLSearchParams(params)
    next.delete('editing')
    setParams(next, { replace: true })
  }, [params, setParams])
  const [creatingCompany, setCreatingCompany] = useState(false)
  const [companySelected, setCompanySelected] = useState(false)
  const [showUnassigned, setShowUnassigned] = useState(false)
  const [pendingMove, setPendingMove] = useState<{ employeeId: string; employeeName: string; target: AdminOrgUnitView } | null>(null)
  const [moveLookupError, setMoveLookupError] = useState(false)
  const query = useQuery({
    queryKey: ['admin-org-units', companyId],
    queryFn: () => api<{ company: OrgCompanyView; items: AdminOrgUnitView[] }>(`/admin/companies/${companyId}/org-units?status=ALL`),
    enabled: Boolean(companyId),
  })
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api<{ items: CompanyOption[] }>('/companies'),
  })
  const archived = query.data?.items.filter((unit) => unit.status === 'ARCHIVED') ?? []
  const archivedCompanies = companies.data?.items.filter((company) => company.isActive === false) ?? []
  const selectedId = params.get('unit')
  const selected = query.data?.items.find((unit) => unit.id === selectedId) ?? null
  const editStructureAction = useMemo(() => <button className="topbar-action admin-org-edit-toggle is-active" type="button" onClick={() => {
    const next = new URLSearchParams({ companyId, view: 'structure' })
    if (selected?.status === 'ACTIVE') next.set('unitId', selected.id)
    navigate(`/organization?${next.toString()}`, { replace: true })
  }}><PencilRuler size={17} />Завершити редагування</button>, [companyId, navigate, selected])
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
    setShowUnassigned(false)
    setShowArchived(false)
    setEditor(null)
    setCreatingCompany(false)
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

  const closePanel = () => {
    setShowUnassigned(false)
    setShowArchived(false)
    setEditor(null)
    setCreatingCompany(false)
    setCompanySelected(false)
    clearSelection()
  }

  const openUnitEditor = (value: NonNullable<typeof editor>) => {
    setShowUnassigned(false)
    setShowArchived(false)
    setCreatingCompany(false)
    setCompanySelected(false)
    setEditor(value)
  }

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['admin-org-unit-employees', companyId] })
    await client.invalidateQueries({ queryKey: ['admin-org-units', companyId] })
    await client.invalidateQueries({ queryKey: ['admin-company', companyId] })
    await client.invalidateQueries({ queryKey: ['org-units'] })
    await client.invalidateQueries({ queryKey: ['companies'] })
    await client.invalidateQueries({ queryKey: ['admin-companies'] })
    await client.invalidateQueries({ queryKey: ['company-unassigned-employees', companyId] })
    await client.invalidateQueries({ queryKey: ['employees'] })
  }

  if (query.isLoading) return <Skeleton rows={7} />
  if (query.isError || !query.data) return <ErrorState onRetry={() => void query.refetch()} />

  return (
    <div className="admin-org-page">
      <h1 className="sr-only">Структура · {query.data.company.name}</h1>
      <Card className="organization-context-bar admin-org-context-bar">
        <label><span>Оберіть компанію</span><select value={companyId} onChange={(event) => {
          setShowUnassigned(false)
          setCompanySelected(false)
          setEditor(null)
          setPendingMove(null)
          navigate(`/admin/companies/${encodeURIComponent(event.target.value)}/structure`)
        }}>{(companies.data?.items ?? [query.data.company]).filter((company) => !('isActive' in company) || company.isActive !== false || company.id === companyId).map((company) => <option key={company.id} value={company.id}>{company.name}{'isActive' in company && company.isActive === false ? ' · Архівована' : ''}</option>)}</select></label>
          <div className="organization-heading-actions admin-org-context-actions">
          <div className="admin-org-map-actions">
            <Button variant="secondary" type="button" onClick={() => { setShowArchived(false); setEditor(null); setCreatingCompany(false); setCompanySelected(false); setShowUnassigned(true); clearSelection() }}>{UNASSIGNED_DEPARTMENT_LABEL}</Button>
            <Button className="admin-org-create-company" type="button" aria-label="Нова компанія" onClick={() => { setShowUnassigned(false); setShowArchived(false); setEditor(null); setCompanySelected(false); setCreatingCompany(true) }}><Plus size={17} />Нова компанія</Button>
            <Button onClick={() => openUnitEditor({ parentId: selected?.status === 'ACTIVE' ? selected.id : null })}><Plus size={17} />Новий підрозділ</Button>
            <button className="button button--secondary" type="button" aria-expanded={showArchived} onClick={() => { setShowUnassigned(false); setShowArchived((value) => !value) }}><Archive size={16} />Архів ({archived.length + archivedCompanies.length})</button>
          </div>
          <div className="organization-view-control">
            <span className="organization-view-label">Оберіть вигляд</span>
            <div className="organization-view-switch" role="group" aria-label="Режим перегляду">
              <Link to={`/organization?companyId=${encodeURIComponent(companyId)}&view=people`}><List size={16} />Працівники</Link>
              <Link className="is-active" to={`/organization?companyId=${encodeURIComponent(companyId)}&view=structure`}><Network size={16} />Структура</Link>
            </div>
          </div>
        </div>
      </Card>
      <OrganizationMap
        company={query.data.company}
        units={query.data.items.filter((unit) => unit.status === 'ACTIVE')}
        selectedId={selected?.status === 'ACTIVE' ? selected.id : null}
        onSelect={selectUnit}
        onSelectCompany={() => {
          setShowUnassigned(false)
          setShowArchived(false)
          setEditor(null)
          setCreatingCompany(false)
          setCompanySelected(true)
          clearSelection()
        }}
        onBackgroundClick={closePanel}
        editing
        compactOutline="none"
        onAddRoot={() => openUnitEditor({ parentId: null })}
        onAddChild={(parentId) => openUnitEditor({ parentId })}
        onEmployeeDrop={async (unitId, employeeId) => {
          if (unitId === selected?.id) return
          const target = query.data.items.find((unit) => unit.id === unitId && unit.status === 'ACTIVE')
          if (!target) return
          setMoveLookupError(false)
          const knownEmployee = client.getQueriesData<{ items: OrgUnitEmployeeView[] }>({ queryKey: ['admin-org-unit-employees', companyId] })
            .flatMap(([, data]) => data?.items ?? []).find((employee) => employee.id === employeeId)
          try {
            const employee = knownEmployee ?? await client.fetchQuery<UserSearchOption>({ queryKey: ['user-selector-value', employeeId], queryFn: () => api<UserSearchOption>(`/employees/${encodeURIComponent(employeeId)}`) })
            setPendingMove({ employeeId, employeeName: personName(employee.displayName), target })
          } catch {
            setMoveLookupError(true)
          }
        }}
        emptyState={<EmptyState title="Підрозділів ще немає" description="Створіть перший відділ." />}
        sidePanel={showUnassigned || showArchived || creatingCompany || editor || companySelected || selected ? <div onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"]')) closePanel()
        }}>
          <div className="admin-org-panel-actions"><button type="button" aria-label="Закрити панель" onClick={closePanel}><X size={18} /></button></div>
          {showUnassigned ? <>
            <header><span className="eyebrow">Компанія</span><h2>{query.data.company.name}</h2></header>
            <UnassignedEmployees key={companyId} companyId={companyId} units={query.data.items.filter((unit) => unit.status === 'ACTIVE')} onAssign={(employee, target) => {
              const unit = query.data.items.find((item) => item.id === target.id)
              if (unit) setPendingMove({ employeeId: employee.id, employeeName: personName(employee.displayName), target: unit })
            }} />
          </> : showArchived ? <section className="admin-org-archive" aria-label="Архів компаній та підрозділів">
        <section className="admin-org-archive-group">
        <header><Building2 size={17} aria-hidden /><h3>Компанії в архіві</h3><span>{archivedCompanies.length}</span></header>
        {archivedCompanies.length ? archivedCompanies.map((company) => <button type="button" key={company.id} className={companyId === company.id && companySelected ? 'is-selected' : ''} onClick={() => {
          setEditor(null)
          setCreatingCompany(false)
          setCompanySelected(true)
          setShowArchived(false)
          navigate(`/admin/companies/${encodeURIComponent(company.id)}/structure`)
        }}><CompanyLogo src={company.logoAsset} size={24} /><span>{company.name}</span><StatusBadge status="ARCHIVED" /></button>) : <p className="admin-org-archive-empty">Немає архівованих компаній.</p>}
        </section>
        <section className="admin-org-archive-group">
        <header><Network size={17} aria-hidden /><h3>Підрозділи в архіві</h3><span>{archived.length}</span></header>
        <p className="admin-org-archive-company">{query.data.company.name}</p>
        {archived.length ? archived.map((unit) => <button type="button" key={unit.id} className={selected?.id === unit.id ? 'is-selected' : ''} onClick={() => selectUnit(unit.id)}>
          <UnitIcon icon={unit.icon} /><span>{unit.name}</span><StatusBadge status="ARCHIVED" />
        </button>) : <p className="admin-org-archive-empty">Немає архівованих підрозділів.</p>}
        </section>
      </section> : creatingCompany ? <CompanyCreateForm onClose={() => setCreatingCompany(false)} onCreated={(company) => navigate(`/admin/companies/${encodeURIComponent(company.id)}/structure`)} /> : editor ? <UnitEditor
            key={`${editor.unit?.id ?? 'new'}:${editor.parentId ?? 'root'}`}
            companyId={companyId}
            unit={editor.unit}
            defaultParentId={editor.parentId}
            companies={companies.data?.items ?? [query.data.company]}
            onSaved={async (unitId, targetCompanyId) => {
              await refresh()
              setEditor(null)
              if (targetCompanyId !== companyId) {
                navigate(`/admin/companies/${encodeURIComponent(targetCompanyId)}/structure?unit=${encodeURIComponent(unitId)}`)
                return
              }
              selectUnit(unitId)
            }}
          /> : companySelected ? <CompanyDetail
          key={`${query.data.company.id}:${query.data.company.version}`}
          company={query.data.company}
          companyId={companyId}
          childCount={query.data.items.filter((unit) => unit.status === 'ACTIVE' && unit.parentId === null).length}
          onSaved={refresh}
          onArchived={() => setShowArchived(true)}
        /> : selected ? <UnitDetail
          key={`${selected.id}:${selected.version}`}
          unit={selected}
          units={query.data.items}
          companyId={companyId}
          companies={companies.data?.items ?? [query.data.company]}
          onChanged={refresh}
        /> : null}
        </div> : undefined}
      />
      {moveLookupError && <p role="alert">Не вдалося завантажити працівника. Повторіть перенесення.</p>}
      {pendingMove && <ConfirmationDialog
        title="Перевести працівника?"
        description={`${pendingMove.employeeName} буде переведений до підрозділу «${pendingMove.target.name}».`}
        confirmLabel="Перевести"
        confirmVariant="primary"
        confirmDisabled={moveEmployee.isPending}
        onConfirm={() => moveEmployee.mutate({ employeeId: pendingMove.employeeId, target: pendingMove.target })}
        onRequestClose={() => { if (!moveEmployee.isPending) setPendingMove(null) }}
      >
        {moveEmployee.isError && <p role="alert">Не вдалося перевести працівника. Оновіть структуру та повторіть.</p>}
      </ConfirmationDialog>}
    </div>
  )
}

function CompanyDetail({ company, companyId, childCount, onSaved, onArchived }: { company: OrgCompanyView; companyId: string; childCount: number; onSaved: () => Promise<void>; onArchived: () => void }) {
  const client = useQueryClient()
  const [managerId, setManagerId] = useState<string | null>(company.manager?.id ?? null)
  const [name, setName] = useState(company.name)
  const [description, setDescription] = useState(company.description ?? '')
  const [logoFileId, setLogoFileId] = useState<string | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const settings = useQuery({
    queryKey: ['admin-company', companyId],
    queryFn: () => api<CompanySettings>(`/admin/companies/${companyId}`),
  })
  useEffect(() => {
    if (!settings.data) return
    setName(settings.data.name)
    setDescription(settings.data.description ?? '')
    setLogoFileId(settings.data.logoFileId ?? null)
  }, [settings.data?.id, settings.data?.version])
  const mutation = useMutation({
    mutationFn: async ({ name, description, nextManagerId }: { name: string; description: string; nextManagerId: string | null }) => {
      let currentSettings = settings.data ?? await api<CompanySettings>(`/admin/companies/${companyId}`)
      if (name !== currentSettings.name || description !== (currentSettings.description ?? '') || logoFileId !== (currentSettings.logoFileId ?? null)) {
        currentSettings = { ...currentSettings, ...await api<Omit<CompanySettings, 'counts'>>(`/admin/companies/${companyId}`, {
          method: 'PATCH', body: jsonBody({ name, description, logoFileId, slug: currentSettings.slug, timezone: currentSettings.timezone, isActive: currentSettings.isActive }),
        }) }
      }
      if (nextManagerId !== (company.manager?.id ?? null)) {
        const manager = await api<{ version: number }>(`/admin/companies/${companyId}/manager`, {
          method: 'PATCH', body: jsonBody({ managerId: nextManagerId, expectedVersion: currentSettings.version }),
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
  const status = useMutation({
    mutationFn: (active: boolean) => api(`/admin/companies/${companyId}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' }),
    onSuccess: async (_result, active) => {
      setConfirmArchive(false)
      await onSaved()
      if (!active) onArchived()
    },
  })
  if (settings.isLoading) return <Skeleton rows={5} />
  if (settings.isError || !settings.data) return <ErrorState onRetry={() => void settings.refetch()} />
  return <>
    <header><span className="eyebrow">Компанія · {settings.data.isActive ? 'Активна' : 'Архівована'}</span><h2>Редагувати компанію</h2></header>
    <form className="entity-form admin-org-form admin-org-company-form" onSubmit={(event) => {
      event.preventDefault()
      if (logoBusy) return
      mutation.mutate({ name: name.trim(), description: description.trim(), nextManagerId: managerId })
    }}>
      <div className="organization-panel-identity span-2"><span className="organization-panel-symbol"><CompanyLogo src={logoFileId ? settings.data.logoAsset : null} size={32} /></span><label>Назва<input name="name" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label></div>
      <details className="organization-panel-visual-picker"><summary>Змінити логотип</summary><CompanyLogoPicker value={logoFileId} src={settings.data.logoAsset} onChange={setLogoFileId} onBusyChange={setLogoBusy} disabled={mutation.isPending || status.isPending} /></details>
      <label className="span-2">Опис<textarea name="description" rows={3} maxLength={320} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Чим займається компанія та за що відповідає команда" /></label>
      <dl className="organization-unit-stats" aria-label="Показники компанії"><div><dt>Працівники</dt><dd>{settings.data.counts.users}</dd></div><div><dt>Підрозділи</dt><dd>{childCount}</dd></div></dl>
      <div className="admin-org-person-picker organization-panel-section">
        <UserSearchCombobox label="Керівник" value={managerId ?? ''} defaultUser={company.manager}
          placeholder="Без керівника · знайти" companyId={companyId} includeAdmins={false} onChange={(id) => setManagerId(id || null)} />
        {managerId && <button type="button" className="admin-org-person-picker__clear" aria-label="Очистити керівника" onClick={() => setManagerId(null)}><X size={15} /></button>}
      </div>
      <section className="organization-panel-section"><h3>Працівники</h3>{settings.data.counts.users ? <Link to={`/organization?companyId=${encodeURIComponent(companyId)}&view=people`}>Переглянути працівників компанії</Link> : <p>У компанії ще немає працівників.</p>}</section>
      {mutation.isError && <p role="alert">{mutation.error instanceof Error ? mutation.error.message : 'Не вдалося зберегти зміни. Оновіть структуру та повторіть.'}</p>}
      <Button disabled={logoBusy || mutation.isPending || status.isPending}>Зберегти зміни</Button>
    </form>
    <details className="admin-org-danger">
      <summary><Archive size={14} aria-hidden /> {settings.data.isActive ? 'Архівація' : 'Відновлення'}</summary>
      <p>{settings.data.isActive ? 'Архівована компанія зникає зі звичайного вибору компаній. Її дані зберігаються; відновлення доступне тут.' : 'Компанія в архіві. Відновіть її, щоб повернути до звичайного вибору компаній.'}</p>
      <Button variant="secondary" disabled={status.isPending || mutation.isPending} onClick={() => settings.data!.isActive ? setConfirmArchive(true) : status.mutate(true)}>{settings.data.isActive ? <Archive size={16} /> : <RotateCcw size={16} />}{settings.data.isActive ? 'Архівувати компанію' : 'Відновити компанію'}</Button>
      {status.isError && <p role="alert">Не вдалося змінити стан компанії. Повторіть спробу.</p>}
    </details>
    {confirmArchive && <ConfirmationDialog title="Архівувати компанію?" description={`Компанію «${company.name}» буде приховано зі звичайного вибору компаній. Дані та структура збережуться.`} confirmLabel="Архівувати" confirmDisabled={status.isPending} onConfirm={() => status.mutate(false)} onRequestClose={() => { if (!status.isPending) setConfirmArchive(false) }}>{status.isError && <p role="alert">Не вдалося архівувати компанію. Повторіть спробу.</p>}</ConfirmationDialog>}
  </>
}

function UnitEditor({ companyId, unit, defaultParentId, companies, onSaved }: {
  companyId: string; unit?: AdminOrgUnitView; defaultParentId?: string | null; companies: CompanyOption[];
  onSaved: (unitId: string, targetCompanyId: string) => Promise<void>
}) {
  const [targetCompanyId, setTargetCompanyId] = useState(companyId)
  const [managerId, setManagerId] = useState<string | null>(unit?.manager?.id ?? null)
  const [description, setDescription] = useState(unit?.description ?? '')
  const [icon, setIcon] = useState<OrgUnitIcon | null>(unit?.icon ?? null)
  const [addedEmployeeIds, setAddedEmployeeIds] = useState<string[]>([])
  const employees = useQuery({
    queryKey: ['admin-org-unit-employees', companyId, unit?.id],
    queryFn: () => api<{ items: OrgUnitEmployeeView[] }>(`/org/units/${unit!.id}/employees?company=${encodeURIComponent(companyId)}`),
    enabled: Boolean(unit?.id),
  })
  const [addedPeople, setAddedPeople] = useState<UserSearchOption[]>([])
  const currentEmployeeIds = new Set(employees.data?.items.map((employee) => employee.id) ?? [])
  const selectedEmployees = [
    ...(employees.data?.items ?? []).map((employee) => ({ id: employee.id, displayName: personName(employee.displayName), jobTitle: employee.positionTitle || employee.jobTitle, avatarAsset: employee.avatarAsset })),
    ...addedPeople.filter((person) => !currentEmployeeIds.has(person.id)),
  ]
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
      icon,
      parentId: unit?.parentId ?? defaultParentId ?? null,
      managerId,
      ...(unit ? { expectedVersion: unit.version } : {}),
    })
  }
  return <>
    <header><span className="eyebrow">Підрозділ</span><h2>{unit ? 'Редагувати підрозділ' : 'Новий підрозділ'}</h2></header>
    <form className="entity-form admin-org-form" onSubmit={submit}>
      <div className="organization-panel-identity span-2"><span className="organization-panel-symbol"><UnitIcon icon={icon} size={28} /></span><label>Назва<input name="name" required maxLength={120} defaultValue={unit?.name} /></label></div>
      <details className="organization-panel-visual-picker span-2"><summary>Змінити значок</summary><UnitIconPicker value={icon} onChange={setIcon} /></details>
      {!unit && <label className="span-2">Компанія<select value={targetCompanyId} onChange={(event) => {
        setTargetCompanyId(event.target.value)
        setManagerId(null)
        setAddedPeople([])
        setAddedEmployeeIds([])
      }} disabled={defaultParentId !== null && defaultParentId !== undefined}>
        {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select></label>}
      <label className="span-2">Опис<textarea name="description" rows={3} maxLength={320} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Чим займається цей відділ" /></label>
      {unit && <dl className="organization-unit-stats span-2" aria-label="Показники підрозділу"><div><dt>Працівники</dt><dd>{unit.activeEmployeeCount}</dd></div><div><dt>Підрозділи</dt><dd>{unit.childCount}</dd></div></dl>}
      <div className="span-2 admin-org-person-picker organization-panel-section">
        <UserSearchCombobox label="Керівник" value={managerId ?? ''} defaultUser={unit?.manager}
          placeholder="Без керівника · знайти" companyId={targetCompanyId} includeAdmins={true} onChange={(id) => setManagerId(id || null)} />
        {managerId && <button type="button" className="admin-org-person-picker__clear" aria-label="Очистити керівника" onClick={() => setManagerId(null)}><X size={15} /></button>}
      </div>
      <section className="span-2 admin-org-employees-picker organization-panel-section">
        <h3>Працівники</h3>
        <UserSearchCombobox label="Додати працівника" value="" clearOnSelect includeAdmins={false} companyId={targetCompanyId}
          excludeOrgUnitId={unit?.id} excludeIds={addedEmployeeIds}
          onSelect={(person) => { setAddedEmployeeIds((ids) => [...ids, person.id]); setAddedPeople((people) => [...people, person]) }} />
        {employees.isLoading ? <small>Завантажуємо працівників…</small> : selectedEmployees.length ? <div className="admin-org-employees-picker__list">
          {selectedEmployees.map((employee) => <article key={employee.id} draggable={currentEmployeeIds.has(employee.id)} tabIndex={currentEmployeeIds.has(employee.id) ? 0 : undefined} aria-label={personName(employee.displayName)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-lankadws-employee', employee.id); event.dataTransfer.setData('text/plain', employee.id) }}><Avatar name={personName(employee.displayName)} src={employee.avatarAsset} size="sm" /><div><strong title={personName(employee.displayName)}>{personName(employee.displayName)}</strong><small>{employee.jobTitle || 'Без посади'}</small></div></article>)}
        </div> : <small>У підрозділі ще немає працівників.</small>}
      </section>
      {mutation.isError && <p className="span-2" role="alert">Не вдалося зберегти. Перевірте назву, вибраних працівників і актуальність даних.</p>}
      <Button className="span-2" disabled={mutation.isPending}>{unit ? 'Зберегти зміни' : 'Створити підрозділ'}</Button>
    </form>
  </>
}

function UnitDetail({ unit, units, companyId, companies, onChanged }: {
  unit: AdminOrgUnitView; units: AdminOrgUnitView[]; companyId: string; companies: CompanyOption[]; onChanged: () => Promise<void>
}) {
  const [archiveBranch, setArchiveBranch] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const excluded = descendantIds(unit.id, units)
  const [restoreParentId, setRestoreParentId] = useState(unit.parentId ?? '')
  excluded.add(unit.id)
  const targets = units.filter((candidate) => candidate.status === 'ACTIVE' && !excluded.has(candidate.id))
  const archive = useMutation({
    mutationFn: () => api(`/admin/companies/${companyId}/org-units/${unit.id}/archive`, {
      method: 'POST', body: jsonBody({ expectedVersion: unit.version, ...(archiveBranch ? { archiveBranch: true } : {}) }),
    }),
    onSuccess: onChanged,
  })
  const restore = useMutation({
    mutationFn: (body: object) => api(`/admin/companies/${companyId}/org-units/${unit.id}/restore`, { method: 'POST', body: jsonBody(body) }),
    onSuccess: onChanged,
  })
  if (unit.status === 'ARCHIVED') return <>
    <header><span className="eyebrow">Архівований підрозділ</span><h2>{unit.name}</h2><p>Відновиться вся збережена гілка з попередніми зв’язками. Працівники залишаться в «{UNASSIGNED_DEPARTMENT_LABEL}» своєї компанії. Їхні призначення автоматично не відновлюються.</p></header>
    <form className="entity-form admin-org-form" onSubmit={(event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      restore.mutate({ expectedVersion: unit.version, name: data.get('name'), parentId: restoreParentId || null })
    }}>
      <label className="span-2">Назва<input name="name" required maxLength={120} defaultValue={unit.name} /></label>
      <label className="span-2">Батьківський підрозділ<select name="parentId" value={restoreParentId} onChange={(event) => setRestoreParentId(event.target.value)}><option value="">Компанія · верхній рівень</option>{unit.parentId && !targets.some((candidate) => candidate.id === unit.parentId) && <option value={unit.parentId} disabled>{units.find((candidate) => candidate.id === unit.parentId)?.name ?? 'Попередній підрозділ'} · спочатку відновіть батьківську гілку</option>}{targets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
      {restore.isError && <p className="span-2" role="alert">{restore.error instanceof Error ? restore.error.message : 'Відновлення заблоковано. Перевірте батьківський вузол і назву.'}</p>}
      <Button className="span-2" disabled={restore.isPending}><RotateCcw size={16} />Відновити структуру</Button>
    </form>
  </>
  return <>
    <UnitEditor companyId={companyId} unit={unit} companies={companies} onSaved={onChanged} />
    <details className="admin-org-danger">
      <summary><Archive size={14} aria-hidden /> Архівація</summary>
      <p>У працівників зміниться лише підрозділ на «{UNASSIGNED_DEPARTMENT_LABEL}». Компанія, посада, активність та інші дані збережуться.</p>
      <fieldset className="admin-org-archive-mode">
        <legend>Що архівувати?</legend>
        <label className={!archiveBranch ? 'is-selected' : ''}><input type="radio" name="archive-mode" checked={!archiveBranch} onChange={() => setArchiveBranch(false)} /><span><strong>Лише цей підрозділ</strong><small>Працівники залишаться в компанії без підрозділу. Дочірні вузли піднімуться на рівень вище.</small></span></label>
        <label className={archiveBranch ? 'is-selected' : ''}><input type="radio" name="archive-mode" checked={archiveBranch} onChange={() => setArchiveBranch(true)} /><span><strong>Усю гілку</strong><small>Цей підрозділ та всі дочірні підрозділи. Працівники залишаться в компанії без підрозділу.</small></span></label>
      </fieldset>
      {archiveBranch ? <p>До архіву перейде підрозділів: <b>{units.filter((candidate) => candidate.status === 'ACTIVE' && excluded.has(candidate.id)).length}</b>. Структура збережеться. Працівники залишаться активними в компанії без підрозділу.</p> : <p>Працівники залишаться в компанії без призначення до підрозділу. Їх можна буде додати до потрібного відділу. Дочірні підрозділи піднімуться на рівень вище.</p>}
      {archive.isError && <p role="alert">Архівацію заблоковано через конфлікт структури або версії.</p>}
      <Button variant="danger" disabled={archive.isPending} onClick={() => setConfirmArchive(true)}><Archive size={16} />{archiveBranch ? 'Архівувати всю гілку' : 'Архівувати підрозділ'}</Button>
    </details>
    {confirmArchive && <ConfirmationDialog title={archiveBranch ? 'Архівувати всю гілку?' : 'Архівувати підрозділ?'} description={archiveBranch ? `«${unit.name}» та всі дочірні підрозділи перейдуть до архіву. Структура збережеться. Працівники залишаться в компанії без підрозділу.` : `«${unit.name}» перейде до архіву. Працівники залишаться в компанії без підрозділу. Дочірні підрозділи піднімуться на рівень вище.`} confirmLabel="Архівувати" confirmDisabled={archive.isPending} onConfirm={() => archive.mutate()} onRequestClose={() => { if (!archive.isPending) setConfirmArchive(false) }}>{archive.isError && <p role="alert">Не вдалося архівувати. Оновіть структуру та повторіть спробу.</p>}</ConfirmationDialog>}
  </>
}

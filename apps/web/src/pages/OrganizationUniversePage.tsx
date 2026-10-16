import { CompanyLogo, UnitIcon } from '../features/organization/OrganizationVisuals'
import { personName } from '../shared/lib/personName'
import { UNASSIGNED_DEPARTMENT_LABEL } from '../shared/lib/organization'
import type { OrgCompanyView, OrgUnitEmployeeView, OrgUnitView } from '@lankadws/contracts'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronDown, ChevronRight, List, MessageCircle, Network, PencilRuler, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { createOrganizationOutline, OrganizationMap } from '../features/organization/OrganizationMap'
import { OrganizationSearchEmptyState } from '../features/organization/OrganizationSearchEmptyState'
import { UnassignedEmployees } from '../features/organization/UnassignedEmployees'
import { UserSearchCombobox } from '../features/employees/UserSearchCombobox'
import { useTopbarContent } from '../layout/TopbarContent'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { Avatar, Card, EmptyState, ErrorState, Skeleton } from '../shared/ui'

interface Company { id: string; name: string; description: string | null; isActive: boolean; userCount: number }
interface Employee {
  id: string
  displayName: string
  jobTitle: string
  positionTitle?: string
  avatarAsset: string | null
  presence: string
  contactEmail?: string | null
  timezone: string
  orgUnit?: { id: string; name: string; parent: { id: string; name: string } | null } | null
  approver?: { id?: string; displayName: string } | null
}
interface EmployeeDirectory {
  items: Employee[]
  counts: { all: number; available: number; away: number }
  filters: { orgUnits: Array<{ id: string; name: string }>; managers: Array<{ id: string; displayName: string }> }
}

export default function OrganizationUniversePage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const requestedView = params.get('view')
  const view = requestedView === 'structure' ? 'structure' : 'people'
  const companyId = params.get('companyId') ?? ''
  const selectedUnitId = params.get('unitId')
  const search = params.get('q') ?? ''
  const orgUnitId = params.get('orgUnit') ?? ''
  const managerId = params.get('manager') ?? ''
  const presence = params.get('presence') ?? ''
  const editStructureAction = useMemo(() => user?.accountType === 'ADMIN' && companyId
    ? <Link className="button button--secondary topbar-action" to={`/admin/companies/${encodeURIComponent(companyId)}/structure${selectedUnitId ? `?unit=${encodeURIComponent(selectedUnitId)}` : ''}`}><PencilRuler size={16} />Редагувати структуру</Link>
    : null, [companyId, selectedUnitId, user?.accountType])
  useTopbarContent(editStructureAction)

  const companiesQuery = useQuery({ queryKey: ['companies'], queryFn: () => api<{ items: Company[] }>('/companies') })
  const allCompanies = companiesQuery.data?.items ?? []
  const companies = useMemo(() => (companiesQuery.data?.items ?? []).filter((company) => company.isActive), [companiesQuery.data])
  const selectedCompany = companies.find((company) => company.id === companyId)
  const companyAvailable = Boolean(selectedCompany)
  useEffect(() => {
    if (companyAvailable || !companies.length) return
    const preferred = companies.find((company) => company.id === user?.company?.id) ?? companies[0]
    const next = new URLSearchParams(params)
    next.set('companyId', preferred!.id)
    for (const key of ['unitId', 'orgUnit', 'manager', 'employeeId']) next.delete(key)
    setParams(next, { replace: true })
  }, [companies, companyAvailable, params, setParams, user?.company?.id])

  const unitsQuery = useQuery({
    queryKey: ['org-units', companyId],
    queryFn: () => api<{ company: OrgCompanyView; items: OrgUnitView[] }>(`/org/units?company=${encodeURIComponent(companyId)}`),
    enabled: companyAvailable,
  })
  const request = new URLSearchParams({ company: companyId })
  if (search) request.set('search', search)
  if (orgUnitId) request.set('orgUnit', orgUnitId)
  if (managerId) request.set('manager', managerId)
  if (presence) request.set('presence', presence)
  const directoryQuery = useQuery({
    queryKey: ['employees', search, companyId, orgUnitId, managerId, presence],
    queryFn: () => api<EmployeeDirectory>(`/employees?${request.toString()}`),
    enabled: companyAvailable && view === 'people' && orgUnitId !== 'unassigned',
  })
  const units = unitsQuery.data?.items ?? []
  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units])
  const selectedUnit = selectedUnitId ? unitById.get(selectedUnitId) ?? null : null
  const selectedDirectoryUnit = orgUnitId ? unitById.get(orgUnitId) ?? null : null
  const unitEmployees = useQuery({
    queryKey: ['org-unit-employees', selectedUnitId, companyId],
    queryFn: () => api<{ items: OrgUnitEmployeeView[] }>(`/org/units/${selectedUnitId}/employees?company=${encodeURIComponent(companyId)}`),
    enabled: Boolean(companyAvailable && view === 'structure' && selectedUnitId && selectedUnit),
  })

  function update(name: string, value: string, clear: string[] = []) {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    clear.forEach((key) => next.delete(key))
    setParams(next, { replace: true })
  }
  function chooseView(nextView: 'people' | 'structure') {
    update('view', nextView)
  }
  function clearDirectoryFilters() {
    const next = new URLSearchParams(params)
    const directoryFilterKeys = ['q', 'orgUnit', 'manager', 'presence']
    directoryFilterKeys.forEach((key) => next.delete(key))
    setParams(next, { replace: true })
  }

  if (companiesQuery.isLoading) return <Skeleton rows={8} />
  if (companiesQuery.isError) return <ErrorState onRetry={() => void companiesQuery.refetch()} />
  if (!companies.length) return <>
    <EmptyState title={allCompanies.length ? 'Усі компанії архівовані' : 'Немає активних компаній'} description="Працівники та структура доступні для активних компаній." />
    {user?.accountType === 'ADMIN' && allCompanies.length > 0 && <div className="drawer-actions">{allCompanies.map((company) => <Link key={company.id} className="button button--secondary" to={`/admin/companies/${encodeURIComponent(company.id)}/structure`}>Відновити: {company.name}</Link>)}</div>}
  </>
  if (!selectedCompany) return <Skeleton rows={8} />

  return (
    <div className="organization-universe-page">
      <Card className="organization-context-bar">
        <label><span>Оберіть компанію</span><select value={companyId} onChange={(event) => update('companyId', event.target.value, ['unitId', 'orgUnit', 'manager', 'employeeId'])}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <div className="organization-heading-actions"><span className="organization-view-label">Оберіть вигляд</span>
          <div className="organization-view-switch" role="group" aria-label="Режим перегляду">
            <button type="button" className={view === 'people' ? 'is-active' : ''} onClick={() => chooseView('people')}><List size={16} />Працівники</button>
            <button type="button" className={view === 'structure' ? 'is-active' : ''} onClick={() => chooseView('structure')}><Network size={16} />Структура</button>
          </div>
        </div>
      </Card>
      {view === 'people' ? (
        <section className="organization-people-workspace" aria-label="Працівники організації">
          {unitsQuery.isLoading ? <Card className="organization-navigator"><Skeleton rows={7} /></Card> : unitsQuery.isError || !unitsQuery.data ? <Card className="organization-navigator"><ErrorState onRetry={() => void unitsQuery.refetch()} /></Card> : <OrganizationNavigator
            company={unitsQuery.data.company}
            units={units}
            selectedId={orgUnitId || null}
            allSelected={!orgUnitId}
            onSelectAll={() => update('orgUnit', '')}
            onSelect={(id) => update('orgUnit', id)}
          />}
          {orgUnitId === 'unassigned' ? <UnassignedEmployees key={companyId} companyId={companyId} onOpen={(id) => update('employeeId', id)} /> : <DirectoryView
            query={directoryQuery}
            search={search}
            orgUnitId={orgUnitId}
            scopeName={selectedDirectoryUnit?.name}
            managerId={managerId}
            companyId={companyId}
            presence={presence}
            onUpdate={update}
            onClear={clearDirectoryFilters}
            onOpen={(id) => update('employeeId', id)}
          />}
        </section>
      ) : unitsQuery.isLoading ? <Skeleton rows={8} /> : unitsQuery.isError || !unitsQuery.data ? <ErrorState onRetry={() => void unitsQuery.refetch()} /> : (
        <section className="organization-structure-workspace" aria-label="Структура організації">
          <OrganizationMap
            company={unitsQuery.data.company}
            units={units}
            selectedId={selectedUnitId}
            onSelect={(id) => update('unitId', id)}
            onSelectCompany={() => update('unitId', 'company')}
            onBackgroundClick={() => update('unitId', '')}
            compactOutline="none"
            emptyState={<EmptyState title="Підрозділів ще немає" description="Структура з’явиться після створення першого відділу." />}
            sidePanel={selectedUnitId === 'company' ? <>
              <div className="admin-org-panel-actions"><span className="eyebrow organization-panel-kind">Компанія</span><button type="button" aria-label="Закрити панель" onClick={() => update('unitId', '')}><X size={18} /></button></div>
              <header className="organization-unit-header">
                <div className="organization-panel-company-heading"><span className="organization-panel-company-logo"><CompanyLogo src={unitsQuery.data.company.logoAsset} size={28} /></span><h2 className="organization-panel-title">{unitsQuery.data.company.name}</h2>{unitsQuery.data.company.description && <p>{unitsQuery.data.company.description}</p>}</div>
                <OrganizationStats label="Показники компанії" employeeCount={selectedCompany.userCount} childCount={units.filter((unit) => unit.parentId === null).length} />
              </header>
              <section className="organization-panel-section organization-panel-manager"><h3>Керівник</h3>{unitsQuery.data.company.manager ? <div className="org-people org-people--manager"><button type="button" onClick={() => update('employeeId', unitsQuery.data.company.manager!.id)}><Avatar name={personName(unitsQuery.data.company.manager.displayName)} src={unitsQuery.data.company.manager.avatarAsset} /><span><strong>{personName(unitsQuery.data.company.manager.displayName)}</strong><small>{unitsQuery.data.company.manager.jobTitle || 'Без посади'}</small></span></button></div> : <p>Без керівника</p>}</section>
              <UnassignedEmployees key={companyId} companyId={companyId} onOpen={(id) => update('employeeId', id)} />
            </> : selectedUnit ? <>
              <div className="admin-org-panel-actions"><span className="eyebrow organization-panel-kind">Підрозділ</span><button type="button" aria-label="Закрити панель" onClick={() => update('unitId', '')}><X size={18} /></button></div>
              <header className="organization-unit-header">
                <div><h2 className="organization-panel-title"><UnitIcon icon={selectedUnit.icon} size={28} /><span>{selectedUnit.name}</span></h2>{selectedUnit.description && <p>{selectedUnit.description}</p>}</div>
                <OrganizationStats label="Показники підрозділу" employeeCount={selectedUnit.activeEmployeeCount} childCount={selectedUnit.childCount} />
              </header>
              <section className="organization-panel-section organization-panel-manager"><h3>Керівник</h3>
              {selectedUnit.manager ? <div className="org-people org-people--manager"><button type="button" onClick={() => update('employeeId', selectedUnit.manager!.id)}><Avatar name={personName(selectedUnit.manager.displayName)} src={selectedUnit.manager.avatarAsset} /><span><strong>{personName(selectedUnit.manager.displayName)}</strong><small>Керівник{selectedUnit.manager.jobTitle ? ` · ${selectedUnit.manager.jobTitle}` : ''}</small></span></button></div> : <p>Без керівника</p>}</section>
              <section className="organization-unassigned organization-panel-employees"><h3>Працівники</h3>
              {unitEmployees.isLoading ? <Skeleton rows={4} /> : unitEmployees.isError ? <ErrorState onRetry={() => void unitEmployees.refetch()} /> : unitEmployees.data?.items.length ? (
                <div className="org-people">{unitEmployees.data.items.map((employee) => <button type="button" key={employee.id} onClick={() => update('employeeId', employee.id)}><Avatar name={personName(employee.displayName)} src={employee.avatarAsset} /><span><strong>{personName(employee.displayName)}</strong><small>{employee.positionTitle ?? employee.jobTitle}</small></span></button>)}</div>
              ) : <p>У підрозділі ще немає працівників.</p>}
              </section>
            </> : undefined}
          />
        </section>
      )}
    </div>
  )
}

function OrganizationStats({ label, employeeCount, childCount }: { label: string; employeeCount: number; childCount: number }) {
  return <dl className="organization-unit-stats" aria-label={label}>
    <div><dt>Працівники</dt><dd>{employeeCount}</dd></div>
    <div><dt>Підрозділи</dt><dd>{childCount}</dd></div>
  </dl>
}

function OrganizationNavigator({ company, units, selectedId, allSelected, onSelectAll, onSelect }: {
  company: OrgCompanyView
  units: OrgUnitView[]
  selectedId: string | null
  allSelected: boolean
  onSelectAll: () => void
  onSelect: (id: string) => void
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const outline = useMemo(() => createOrganizationOutline(units, expandedIds), [expandedIds, units])

  useEffect(() => {
    const unitById = new Map(units.map((unit) => [unit.id, unit]))
    setExpandedIds((current) => {
      const next = new Set(current)
      units.filter((unit) => unit.parentId === null).forEach((unit) => next.add(unit.id))
      let currentUnit = selectedId ? unitById.get(selectedId) : undefined
      while (currentUnit?.parentId) {
        next.add(currentUnit.parentId)
        currentUnit = unitById.get(currentUnit.parentId)
      }
      return next
    })
  }, [selectedId, units])

  return <Card className="organization-navigator">
    <header>
      <button type="button" className={allSelected ? 'is-selected' : ''} onClick={onSelectAll}><span className="organization-navigator__company-icon" aria-hidden><CompanyLogo src={company.logoAsset} size={28} /></span><span><small>Уся компанія</small><strong>{company.name}</strong></span></button>
      <div className="organization-navigator__company-summary"><span>Структура компанії</span><small><strong>{units.length}</strong> підрозділів</small></div>
      <button type="button" className={selectedId === 'unassigned' ? 'is-selected' : ''} onClick={() => onSelect('unassigned')}><span className="organization-navigator__company-icon" aria-hidden><List size={20} /></span><span><strong>{UNASSIGNED_DEPARTMENT_LABEL}</strong><small>{company.name}</small></span></button>
    </header>
    <div className="organization-navigator__tree" role="tree" aria-label="Компактна структура організації">
      {outline.map(({ unit, depth, hasChildren }) => {
        const expanded = expandedIds.has(unit.id)
        const selected = selectedId === unit.id
        return <div
          key={unit.id}
          className={`organization-navigator__row ${selected ? 'is-selected' : ''}`}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={selected}
          {...(hasChildren ? { 'aria-expanded': expanded } : {})}
          style={{ '--navigator-depth': depth } as React.CSSProperties}
        >
          {hasChildren ? <button className="organization-navigator__toggle" type="button" aria-label={`${expanded ? 'Згорнути' : 'Розгорнути'} ${unit.name}`} onClick={() => setExpandedIds((current) => {
            const next = new Set(current)
            if (next.has(unit.id)) next.delete(unit.id)
            else next.add(unit.id)
            return next
          })}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button> : <span className="organization-navigator__spacer" aria-hidden />}
          <button className="organization-navigator__select" type="button" onClick={() => onSelect(unit.id)}>
            <UnitIcon icon={unit.icon} size={18} /><span><strong>{unit.name}</strong><small>{personName(unit.manager?.displayName) ?? 'Керівника не призначено'}</small></span>
            <em>{unit.activeEmployeeCount}</em>
          </button>
        </div>
      })}
    </div>
  </Card>
}

function DirectoryView({ query, search, orgUnitId, scopeName, managerId, companyId, presence, onUpdate, onClear, onOpen }: {
  query: ReturnType<typeof useQuery<EmployeeDirectory>>
  search: string
  orgUnitId: string
  scopeName?: string
  managerId: string
  companyId: string
  presence: string
  onUpdate: (name: string, value: string, clear?: string[]) => void
  onClear: () => void
  onOpen: (id: string) => void
}) {
  const { user } = useAuth()
  const hasFilters = Boolean(search || orgUnitId || managerId || presence)
  return (
    <Card className="directory-card directory-card--people">
      <header className="directory-people-heading">
        <div className="directory-people-title">
          <span className="eyebrow">Команда</span>
          <div className="directory-people-title__summary">
            <div><h2>{scopeName ?? 'Усі працівники'}</h2><p>{scopeName ? 'Працівники вибраного підрозділу та його доступна робоча інформація.' : 'Каталог працівників усієї компанії.'}</p></div>
            <div className="directory-people-count"><strong>{query.data?.items.length ?? 0}</strong><span>Знайдено.</span></div>
          </div>
        </div>
      </header>
      <div className="directory-toolbar">
        <label className="search-field"><span className="sr-only">Знайти працівника</span><Search size={17} /><input value={search} onChange={(event) => onUpdate('q', event.target.value)} placeholder="Ім’я, посада або нікнейм" type="search" /></label>
        <div className="directory-filter"><UserSearchCombobox label="Керівник" value={managerId} companyId={companyId} managersOnly
          defaultUser={query.data?.filters.managers.find((manager) => manager.id === managerId)}
          placeholder="Усі · введіть ім’я" onChange={(id) => onUpdate('manager', id)} /></div>
        <label className="directory-filter"><span>Доступність</span><select value={presence} onChange={(event) => onUpdate('presence', event.target.value)}><option value="">Усі</option><option value="AVAILABLE">Доступні</option><option value="AWAY">Відсутні</option></select></label>
      </div>
      <div className="directory-summary">{scopeName && <span><Building2 size={13} />{scopeName}</span>}{query.data && <span>{query.data.counts.available} доступні · {query.data.counts.away} відсутні</span>}{hasFilters && <button type="button" onClick={onClear}>Очистити фільтри</button>}</div>
      {query.isLoading ? <Skeleton rows={6} /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.data?.items.length ? (
        <div className="directory-people-list">{query.data.items.map((employee) => <article className="directory-person" key={employee.id}>
          <button type="button" className="directory-person__profile" onClick={() => onOpen(employee.id)}><Avatar name={personName(employee.displayName)} src={employee.avatarAsset} /><span><strong>{personName(employee.displayName)}</strong><small>{employee.positionTitle || employee.jobTitle}</small></span></button>
          <span className="directory-person__unit employee-org"><Building2 size={13} />{employee.orgUnit ? employee.orgUnit.parent ? `${employee.orgUnit.parent.name} → ${employee.orgUnit.name}` : employee.orgUnit.name : UNASSIGNED_DEPARTMENT_LABEL}</span>
          <span className="directory-person__presence"><i className={`presence presence--${employee.presence.toLowerCase()}`} />{employee.presence === 'AVAILABLE' ? 'Доступний' : 'Відсутній'}</span>
          {employee.id !== user?.id ? <Link className="directory-person__chat" aria-label={`Написати ${personName(employee.displayName)}`} to={`/messages?new=1&to=${encodeURIComponent(employee.id)}`}><MessageCircle size={17} /></Link> : <span className="directory-person__self">Ви</span>}
        </article>)}</div>
      ) : <OrganizationSearchEmptyState />}
    </Card>
  )
}

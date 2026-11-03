import { CompanyLogo, UnitIcon } from '../features/organization/OrganizationVisuals'
import { personName } from '../shared/lib/personName'
import { UNASSIGNED_DEPARTMENT_LABEL } from '../shared/lib/organization'
import type { OrgCompanyView, OrgUnitEmployeeView, OrgUnitView } from '@lankadws/contracts'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronDown, ChevronRight, FilterX, List, MessageCircle, Network, PencilRuler, Search, UserRoundX, Users, UsersRound, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { createOrganizationOutline, OrganizationMap } from '../features/organization/OrganizationMap'
import { OrganizationSearchEmptyState } from '../features/organization/OrganizationSearchEmptyState'
import { UnassignedEmployees } from '../features/organization/UnassignedEmployees'
import { UserSearchCombobox } from '../features/employees/UserSearchCombobox'
import { useTopbarContent } from '../layout/TopbarContent'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { Avatar, Card, EmptyState, ErrorState, Skeleton } from '../shared/ui'
import '../features/organization/organization-people.css'

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
        <label className="organization-company-picker"><span className="sr-only">Оберіть компанію</span><Building2 size={18} aria-hidden="true" /><select value={companyId} onChange={(event) => update('companyId', event.target.value, ['unitId', 'orgUnit', 'manager', 'employeeId'])}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></label>
        <div className="organization-heading-actions">
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
            employeeCount={selectedCompany.userCount}
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
                <OrganizationPanelHeading symbol={<CompanyLogo src={unitsQuery.data.company.logoAsset} size={28} />} name={unitsQuery.data.company.name} description={unitsQuery.data.company.description} />
                <OrganizationStats label="Показники компанії" employeeCount={selectedCompany.userCount} childCount={units.filter((unit) => unit.parentId === null).length} />
              </header>
              <section className="organization-panel-section organization-panel-manager"><h3>Керівник</h3>{unitsQuery.data.company.manager ? <div className="org-people org-people--manager"><button type="button" onClick={() => update('employeeId', unitsQuery.data.company.manager!.id)}><Avatar name={personName(unitsQuery.data.company.manager.displayName)} src={unitsQuery.data.company.manager.avatarAsset} /><span><strong>{personName(unitsQuery.data.company.manager.displayName)}</strong><small>{unitsQuery.data.company.manager.jobTitle || 'Без посади'}</small></span></button></div> : <p>Без керівника</p>}</section>
              <section className="organization-panel-section organization-company-employees" aria-label="Працівники компанії">{selectedCompany.userCount ? <Link className="organization-company-employees-link" to={`/organization?companyId=${encodeURIComponent(companyId)}&view=people`}><Users size={16} aria-hidden="true" />Переглянути працівників компанії</Link> : <p>У компанії ще немає працівників.</p>}</section>
              <UnassignedEmployees key={companyId} companyId={companyId} onOpen={(id) => update('employeeId', id)} />
            </> : selectedUnit ? <>
              <div className="admin-org-panel-actions"><span className="eyebrow organization-panel-kind">Підрозділ</span><button type="button" aria-label="Закрити панель" onClick={() => update('unitId', '')}><X size={18} /></button></div>
              <header className="organization-unit-header">
                <OrganizationPanelHeading symbol={<UnitIcon icon={selectedUnit.icon} size={28} />} name={selectedUnit.name} description={selectedUnit.description} />
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

function OrganizationPanelHeading({ symbol, name, description }: { symbol: ReactNode; name: string; description?: string | null }) {
  return <div className="organization-panel-heading">
    <span className="organization-panel-heading__symbol">{symbol}</span>
    <h2 className="organization-panel-title">{name}</h2>
    {description && <p>{description}</p>}
  </div>
}

function OrganizationStats({ label, employeeCount, childCount }: { label: string; employeeCount: number; childCount: number }) {
  return <dl className="organization-unit-stats" aria-label={label}>
    <div><dt>Працівники</dt><dd>{employeeCount}</dd></div>
    <div><dt>Підрозділи</dt><dd>{childCount}</dd></div>
  </dl>
}

function OrganizationNavigator({ company, employeeCount, units, selectedId, allSelected, onSelectAll, onSelect }: {
  company: OrgCompanyView
  employeeCount: number
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
      <button type="button" className={allSelected ? 'is-selected' : ''} aria-current={allSelected ? 'true' : undefined} onClick={onSelectAll}><span className="organization-navigator__company-icon" aria-hidden><CompanyLogo src={company.logoAsset} size={24} /></span><span><small>Уся компанія</small><strong>{company.name}</strong></span><em aria-label={`Працівників: ${employeeCount}`}>{employeeCount}</em></button>
      <button type="button" className={`organization-navigator__unassigned ${selectedId === 'unassigned' ? 'is-selected' : ''}`} aria-current={selectedId === 'unassigned' ? 'true' : undefined} onClick={() => onSelect('unassigned')}><span className="organization-navigator__company-icon" aria-hidden><UserRoundX size={18} /></span><span><strong>{UNASSIGNED_DEPARTMENT_LABEL}</strong><small>Без призначеного відділу</small></span></button>
    </header>
    <div className="organization-navigator__company-summary"><span>Підрозділи</span><small aria-label={`Підрозділів: ${units.length}`}>{units.length}</small></div>
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
            <span className="organization-navigator__unit-icon"><UnitIcon icon={unit.icon} size={16} /></span><span><strong>{unit.name}</strong><small className={unit.manager ? undefined : 'is-missing'}>{personName(unit.manager?.displayName) ?? 'Керівника не призначено'}</small></span>
            <em className={unit.activeEmployeeCount ? undefined : 'is-empty'} aria-label={`Працівників: ${unit.activeEmployeeCount}`}>{unit.activeEmployeeCount}</em>
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
        <span className="directory-people-heading__icon" aria-hidden="true">{scopeName ? <Building2 size={20} /> : <UsersRound size={20} />}</span>
        <div className="directory-people-title">
          <h2>{scopeName ?? 'Усі працівники'}<span className="directory-people-count" aria-label={`Показано: ${query.data?.items.length ?? 0}`}>{query.data?.items.length ?? 0}</span></h2>
          <p>{scopeName ? 'Працівники вибраного підрозділу.' : 'Каталог працівників вибраної компанії та її підрозділів.'}</p>
        </div>
      </header>
      <div className="directory-toolbar">
        <label className="directory-filter directory-filter--search"><span>Пошук</span><span className="search-field"><Search size={16} aria-hidden="true" /><input aria-label="Знайти працівника" value={search} onChange={(event) => onUpdate('q', event.target.value)} placeholder="Ім’я, посада або нікнейм" type="search" /></span></label>
        <div className="directory-filter"><UserSearchCombobox label="Керівник" value={managerId} companyId={companyId} managersOnly
          defaultUser={query.data?.filters.managers.find((manager) => manager.id === managerId)}
          placeholder="Усі · введіть ім’я" onChange={(id) => onUpdate('manager', id)} /></div>
        <label className="directory-filter"><span>Доступність</span><select value={presence} onChange={(event) => onUpdate('presence', event.target.value)}><option value="">Усі</option><option value="AVAILABLE">Доступні</option><option value="AWAY">Відсутні</option></select></label>
      </div>
      <div className="directory-summary">
        {query.data && <>
          <span className="directory-summary__stat is-available"><i aria-hidden="true" />Доступні: <strong>{query.data.counts.available}</strong></span>
          <span className="directory-summary__stat is-away"><i aria-hidden="true" />Відсутні: <strong>{query.data.counts.away}</strong></span>
        </>}
        {hasFilters && <button type="button" onClick={onClear}><FilterX size={14} aria-hidden="true" />Очистити фільтри</button>}
      </div>
      {query.isLoading ? <Skeleton rows={6} /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.data?.items.length ? (
        <div className="directory-people-list">
          <div className="directory-people-list__head" aria-hidden="true"><span>Працівник</span><span>Підрозділ</span><span>Статус</span><span /></div>
          {query.data.items.map((employee) => {
            const away = employee.presence !== 'AVAILABLE'
            return <article className="directory-person" key={employee.id}>
              <button type="button" className="directory-person__profile" onClick={() => onOpen(employee.id)}><span className="directory-person__avatar"><Avatar name={personName(employee.displayName)} src={employee.avatarAsset} /><i className={`presence presence--${employee.presence.toLowerCase()}`} aria-hidden="true" /></span><span><strong>{personName(employee.displayName)}</strong><small>{employee.positionTitle || employee.jobTitle || 'Посаду не вказано'}</small></span></button>
              <span className={`directory-person__unit employee-org ${employee.orgUnit ? '' : 'is-unassigned'}`}>{employee.orgUnit ? <Building2 size={14} aria-hidden="true" /> : <UserRoundX size={14} aria-hidden="true" />}<span>{employee.orgUnit ? employee.orgUnit.parent ? <>{employee.orgUnit.parent.name}<ChevronRight size={12} aria-hidden="true" /><span className="sr-only"> → </span>{employee.orgUnit.name}</> : employee.orgUnit.name : UNASSIGNED_DEPARTMENT_LABEL}</span></span>
              <span className={`directory-person__presence ${away ? 'is-away' : 'is-available'}`}>{away ? 'Відсутній' : 'Доступний'}</span>
              {employee.id !== user?.id ? <Link className="directory-person__chat" aria-label={`Написати ${personName(employee.displayName)}`} title="Написати" to={`/messages?new=1&to=${encodeURIComponent(employee.id)}`}><MessageCircle size={17} aria-hidden="true" /></Link> : <span className="directory-person__self">Ви</span>}
            </article>
          })}
        </div>
      ) : <OrganizationSearchEmptyState />}
    </Card>
  )
}

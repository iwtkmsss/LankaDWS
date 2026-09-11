import type { OrgCompanyView, OrgUnitEmployeeView, OrgUnitView } from '@lankadws/contracts'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronDown, ChevronRight, List, MessageCircle, Network, PencilRuler, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { createOrganizationOutline, OrganizationMap } from '../features/organization/OrganizationMap'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { Avatar, Card, EmptyState, ErrorState, Skeleton } from '../shared/ui'

interface Company { id: string; name: string; description: string | null }
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

  const companiesQuery = useQuery({ queryKey: ['companies'], queryFn: () => api<{ items: Company[] }>('/companies') })
  const companies = companiesQuery.data?.items ?? []
  useEffect(() => {
    if (companyId || !companies.length) return
    const preferred = companies.find((company) => company.id === user?.company?.id) ?? companies[0]
    const next = new URLSearchParams(params)
    next.set('companyId', preferred!.id)
    setParams(next, { replace: true })
  }, [companies, companyId, params, setParams, user?.company?.id])

  const unitsQuery = useQuery({
    queryKey: ['org-units', companyId],
    queryFn: () => api<{ company: OrgCompanyView; items: OrgUnitView[] }>(`/org/units?company=${encodeURIComponent(companyId)}`),
    enabled: Boolean(companyId),
  })
  const request = new URLSearchParams({ company: companyId })
  if (search) request.set('search', search)
  if (orgUnitId) request.set('orgUnit', orgUnitId)
  if (managerId) request.set('manager', managerId)
  if (presence) request.set('presence', presence)
  const directoryQuery = useQuery({
    queryKey: ['employees', search, companyId, orgUnitId, managerId, presence],
    queryFn: () => api<EmployeeDirectory>(`/employees?${request.toString()}`),
    enabled: Boolean(companyId && view === 'people'),
  })
  const units = unitsQuery.data?.items ?? []
  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units])
  const selectedUnit = selectedUnitId ? unitById.get(selectedUnitId) ?? null : null
  const selectedDirectoryUnit = orgUnitId ? unitById.get(orgUnitId) ?? null : null
  const unitEmployees = useQuery({
    queryKey: ['org-unit-employees', selectedUnitId, companyId],
    queryFn: () => api<{ items: OrgUnitEmployeeView[] }>(`/org/units/${selectedUnitId}/employees?company=${encodeURIComponent(companyId)}`),
    enabled: Boolean(view === 'structure' && selectedUnitId && companyId && selectedUnit),
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
  if (!companies.length) return <EmptyState title="Компаній ще немає" description="Структура з’явиться після створення першої компанії." />

  return (
    <div className="organization-universe-page">
      <Card className="organization-context-bar">
        <label><span>Оберіть компанію</span><select value={companyId} onChange={(event) => update('companyId', event.target.value, ['unitId', 'orgUnit', 'manager', 'employeeId'])}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <div className="organization-heading-actions">
          {user?.accountType === 'ADMIN' && companyId && <Link className="button button--secondary" to={`/admin/companies/${encodeURIComponent(companyId)}/structure?editing=1`}><PencilRuler size={16} />Редагувати структуру</Link>}
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
          <DirectoryView
            query={directoryQuery}
            search={search}
            orgUnitId={orgUnitId}
            scopeName={selectedDirectoryUnit?.name}
            managerId={managerId}
            presence={presence}
            onUpdate={update}
            onClear={clearDirectoryFilters}
            onOpen={(id) => update('employeeId', id)}
          />
        </section>
      ) : unitsQuery.isLoading ? <Skeleton rows={8} /> : unitsQuery.isError || !unitsQuery.data ? <ErrorState onRetry={() => void unitsQuery.refetch()} /> : (
        <section className="organization-structure-workspace" aria-label="Структура організації">
          <OrganizationMap
            company={unitsQuery.data.company}
            units={units}
            selectedId={selectedUnitId}
            onSelect={(id) => update('unitId', id)}
            compactOutline="none"
            emptyState={<EmptyState title="Підрозділів ще немає" description="Структура з’явиться після створення першого відділу." />}
            sidePanel={selectedUnit ? <>
              <header><span className="eyebrow">Підрозділ</span><h2>{selectedUnit.name}</h2><p>{selectedUnit.manager ? `Керівник: ${selectedUnit.manager.displayName}` : 'Керівника ще не призначено'}</p></header>
              {unitEmployees.isLoading ? <Skeleton rows={4} /> : unitEmployees.isError ? <ErrorState onRetry={() => void unitEmployees.refetch()} /> : unitEmployees.data?.items.length ? (
                <div className="org-people">{unitEmployees.data.items.map((employee) => <button type="button" key={employee.id} onClick={() => update('employeeId', employee.id)}><Avatar name={employee.displayName} src={employee.avatarAsset} /><span><strong>{employee.displayName}</strong><small>{employee.positionTitle ?? employee.jobTitle}</small></span><ChevronRight size={17} aria-hidden /></button>)}</div>
              ) : <EmptyState title="У підрозділі поки нікого немає" description="Активні призначення з’являться тут автоматично." />}
            </> : undefined}
          />
        </section>
      )}
    </div>
  )
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
      <button type="button" className={allSelected ? 'is-selected' : ''} onClick={onSelectAll}><Building2 size={17} /><span><strong>{company.name}</strong><small>Уся компанія</small></span></button>
      <small>{units.length} підрозділів</small>
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
            <span><strong>{unit.name}</strong><small>{unit.manager?.displayName ?? 'Керівника не призначено'}</small></span>
            <em>{unit.activeEmployeeCount}</em>
          </button>
        </div>
      })}
    </div>
  </Card>
}

function DirectoryView({ query, search, orgUnitId, scopeName, managerId, presence, onUpdate, onClear, onOpen }: {
  query: ReturnType<typeof useQuery<EmployeeDirectory>>
  search: string
  orgUnitId: string
  scopeName?: string
  managerId: string
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
          <div><span className="eyebrow">Команда</span><h2>{scopeName ?? 'Усі працівники'}</h2><p>{scopeName ? 'Працівники вибраного підрозділу та його доступна робоча інформація.' : 'Каталог працівників усієї компанії.'}</p></div>
          <div className="directory-people-count"><strong>{query.data?.items.length ?? 0}</strong><span>знайдено</span></div>
        </div>
      </header>
      <div className="directory-toolbar">
        <label className="search-field"><span className="sr-only">Знайти працівника</span><Search size={17} /><input value={search} onChange={(event) => onUpdate('q', event.target.value)} placeholder="Ім’я, посада або нікнейм" type="search" /></label>
        <label className="directory-filter"><span>Керівник</span><select value={managerId} onChange={(event) => onUpdate('manager', event.target.value)}><option value="">Усі керівники</option>{query.data?.filters.managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.displayName}</option>)}</select></label>
        <label className="directory-filter"><span>Доступність</span><select value={presence} onChange={(event) => onUpdate('presence', event.target.value)}><option value="">Усі</option><option value="AVAILABLE">Доступні</option><option value="AWAY">Відсутні</option></select></label>
      </div>
      <div className="directory-summary">{scopeName && <span><Building2 size={13} />{scopeName}</span>}{query.data && <span>{query.data.counts.available} доступні · {query.data.counts.away} відсутні</span>}{hasFilters && <button type="button" onClick={onClear}>Очистити фільтри</button>}</div>
      {query.isLoading ? <Skeleton rows={6} /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.data?.items.length ? (
        <div className="directory-people-list">{query.data.items.map((employee) => <article className="directory-person" key={employee.id}>
          <button type="button" className="directory-person__profile" onClick={() => onOpen(employee.id)}><Avatar name={employee.displayName} src={employee.avatarAsset} /><span><strong>{employee.displayName}</strong><small>{employee.positionTitle || employee.jobTitle}</small></span></button>
          <span className="directory-person__unit employee-org"><Building2 size={13} />{employee.orgUnit ? employee.orgUnit.parent ? `${employee.orgUnit.parent.name} → ${employee.orgUnit.name}` : employee.orgUnit.name : 'Підрозділ не вказано'}</span>
          <span className="directory-person__presence"><i className={`presence presence--${employee.presence.toLowerCase()}`} />{employee.presence === 'AVAILABLE' ? 'Доступний' : 'Відсутній'}</span>
          {employee.id !== user?.id ? <Link className="directory-person__chat" aria-label={`Написати ${employee.displayName}`} to={`/messages?new=1&to=${encodeURIComponent(employee.id)}`}><MessageCircle size={17} /></Link> : <span className="directory-person__self">Ви</span>}
        </article>)}</div>
      ) : <EmptyState title="Нікого не знайдено" description="Змініть локальні фільтри або пошуковий запит." illustration="search" />}
    </Card>
  )
}

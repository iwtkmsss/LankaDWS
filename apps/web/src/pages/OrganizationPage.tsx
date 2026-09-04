import { useQuery } from '@tanstack/react-query'
import type { OrgCompanyView, OrgUnitEmployeeView, OrgUnitView } from '@bert-crm/contracts'
import { Building2, ChevronDown, ChevronRight, Search, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { Avatar, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../shared/ui'

interface OrgTreeRow {
  unit: OrgUnitView
  depth: number
  hasChildren: boolean
}

function createOrgTree(units: OrgUnitView[], search: string, expanded: Set<string>): OrgTreeRow[] {
  const children = new Map<string | null, OrgUnitView[]>()
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  for (const unit of units) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit])
  for (const values of children.values()) values.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'uk'))

  const normalizedSearch = search.trim().toLocaleLowerCase('uk')
  const visible = new Set<string>()
  if (normalizedSearch) {
    for (const unit of units) {
      if (![unit.name, unit.manager?.displayName ?? ''].some((value) => value.toLocaleLowerCase('uk').includes(normalizedSearch))) continue
      let current: OrgUnitView | undefined = unit
      while (current && !visible.has(current.id)) {
        visible.add(current.id)
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
    }
  }

  const result: OrgTreeRow[] = []
  const visited = new Set<string>()
  const append = (unit: OrgUnitView, depth: number) => {
    if (visited.has(unit.id)) return
    visited.add(unit.id)
    const childUnits = children.get(unit.id) ?? []
    const isVisible = !normalizedSearch || visible.has(unit.id)
    if (isVisible) result.push({ unit, depth, hasChildren: childUnits.length > 0 })
    const shouldTraverse = !normalizedSearch ? expanded.has(unit.id) : childUnits.some((child) => visible.has(child.id))
    if (shouldTraverse) for (const child of childUnits) append(child, depth + 1)
  }
  for (const root of children.get(null) ?? []) append(root, 0)
  for (const unit of units) append(unit, 0)
  return result
}

export default function OrganizationPage() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [expandedUnitIds, setExpandedUnitIds] = useState<Set<string>>(new Set())
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedUnitId = searchParams.get('unit')
  const organizationId = user?.company?.id
  const unitsQuery = useQuery({
    queryKey: ['org-units', organizationId],
    queryFn: () => api<{ company: OrgCompanyView; items: OrgUnitView[] }>('/org/units'),
    enabled: Boolean(organizationId),
  })
  const units = unitsQuery.data?.items ?? []
  const orgTree = useMemo(() => createOrgTree(units, search, expandedUnitIds), [units, search, expandedUnitIds])
  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units])
  const selectedUnit = selectedUnitId ? unitById.get(selectedUnitId) ?? null : null
  const employeesQuery = useQuery({
    queryKey: ['org-unit-employees', selectedUnitId, organizationId],
    queryFn: () => api<{ items: OrgUnitEmployeeView[] }>(`/org/units/${selectedUnitId}/employees`),
    enabled: Boolean(selectedUnitId && organizationId && selectedUnit),
  })

  const selectUnit = (unitId: string, replace = false) => {
    const next = new URLSearchParams(searchParams)
    next.set('unit', unitId)
    setSearchParams(next, { replace })
  }

  useEffect(() => {
    if (!units.length) return
    setExpandedUnitIds((current) => current.size ? current : new Set(units.filter((unit) => unit.parentId === null).map((unit) => unit.id)))
    if (selectedUnitId && unitById.has(selectedUnitId)) return
    const normalizedSearch = search.trim().toLocaleLowerCase('uk')
    const matchingUnit = normalizedSearch
      ? units.find((unit) => [unit.name, unit.manager?.displayName ?? ''].some((value) => value.toLocaleLowerCase('uk').includes(normalizedSearch)))
      : undefined
    selectUnit((matchingUnit ?? units[0])!.id, true)
  }, [search, selectedUnitId, units, unitById])

  const toggleUnit = (unitId: string) => {
    setExpandedUnitIds((current) => {
      const next = new Set(current)
      if (next.has(unitId)) next.delete(unitId)
      else next.add(unitId)
      return next
    })
  }

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, unitId: string, hasChildren: boolean) => {
    const buttons = Array.from(event.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLButtonElement>('.org-tree__select') ?? [])
    const index = buttons.indexOf(event.currentTarget)
    const focus = (target: HTMLButtonElement | undefined) => target?.focus()
    if (event.key === 'ArrowDown') { event.preventDefault(); focus(buttons[index + 1]); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); focus(buttons[index - 1]); return }
    if (event.key === 'Home') { event.preventDefault(); focus(buttons[0]); return }
    if (event.key === 'End') { event.preventDefault(); focus(buttons.at(-1)); return }
    if (event.key === 'ArrowRight' && hasChildren && !expandedUnitIds.has(unitId)) { event.preventDefault(); toggleUnit(unitId); return }
    if (event.key === 'ArrowLeft' && hasChildren && expandedUnitIds.has(unitId)) { event.preventDefault(); toggleUnit(unitId) }
  }

  return (
    <div>
      <PageHeader title="Структура організації" description="Відділи, підвідділи, керівники та робочі ролі без приватних контактів" action={<Link className="button button--secondary" to="/employees"><UserRound size={17} />Відкрити довідник людей</Link>} />
      {unitsQuery.data?.company && <Card className="org-company-summary">
        <Building2 size={20} />
        <span><strong>{unitsQuery.data.company.name}</strong><small>{unitsQuery.data.company.manager ? `Керівник компанії: ${unitsQuery.data.company.manager.displayName}` : 'Керівника компанії не призначено'}</small></span>
      </Card>}
      <p className="privacy-note org-privacy-note"><ShieldCheck size={17} />Показуємо лише безпечні робочі дані працівників організації.</p>
      <Card className="org-card">
        <section className="org-browser" aria-label="Підрозділи організації">
          <div className="org-browser__header">
            <div><Building2 size={18} /><strong>Підрозділи</strong></div>
            <label className="search-field"><span className="sr-only">Знайти підрозділ або керівника</span><Search size={17} aria-hidden /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Підрозділ або керівник" type="search" /></label>
          </div>
          {unitsQuery.isLoading ? <Skeleton rows={6} /> : unitsQuery.isError ? <ErrorState onRetry={() => void unitsQuery.refetch()} /> : orgTree.length ? (
            <div className="org-tree" role="tree" aria-label="Структура підрозділів">
              {orgTree.map(({ unit, depth, hasChildren }) => {
                const isExpanded = expandedUnitIds.has(unit.id)
                const isSelected = selectedUnitId === unit.id
                return <div key={unit.id} className={`org-tree__item ${isSelected ? 'is-selected' : ''}`} role="treeitem" aria-level={depth + 1} aria-selected={isSelected} {...(hasChildren ? { 'aria-expanded': isExpanded } : {})} style={{ '--org-indent': `${10 + depth * 18}px` } as React.CSSProperties}>
                  {hasChildren ? <button className="org-tree__toggle" type="button" aria-label={`${isExpanded ? 'Згорнути' : 'Розгорнути'} ${unit.name}`} onClick={() => toggleUnit(unit.id)}><ChevronDown size={16} aria-hidden /></button> : <span className="org-tree__toggle-spacer" aria-hidden />}
                  <button className="org-tree__select" type="button" aria-current={isSelected ? 'true' : undefined} onClick={() => selectUnit(unit.id)} onKeyDown={(event) => handleTreeKeyDown(event, unit.id, hasChildren)}>
                    <span className="org-tree__icon"><UsersRound size={17} /></span>
                    <span><strong>{unit.name}</strong><small>{unit.manager?.displayName ?? 'Керівника не вказано'} · {unit.activeEmployeeCount} ос.</small></span>
                    <ChevronRight size={17} aria-hidden />
                  </button>
                </div>
              })}
            </div>
          ) : <EmptyState title="Підрозділів не знайдено" description={search ? 'Спробуйте коротший або інший запит.' : 'Структура з’явиться після синхронізації довідника.'} />}
        </section>
        <section className="org-team" aria-live="polite">
          {selectedUnit ? <><header><span className="eyebrow">Обраний підрозділ</span><h2>{selectedUnit.name}</h2><p>{selectedUnit.manager ? `Керівник: ${selectedUnit.manager.displayName}` : 'Керівника ще не призначено'}</p></header>
            {employeesQuery.isLoading ? <Skeleton rows={4} /> : employeesQuery.isError ? <ErrorState onRetry={() => void employeesQuery.refetch()} /> : employeesQuery.data?.items.length ? <div className="org-people">{employeesQuery.data.items.map((employee) => <UserProfileLink key={employee.id} userId={employee.id}><Avatar name={employee.displayName} src={employee.avatarAsset} /><span><strong>{employee.displayName}</strong><small>{employee.positionTitle ?? employee.jobTitle}</small></span><ChevronRight size={17} aria-hidden /></UserProfileLink>)}</div> : <EmptyState title="У підрозділі поки нікого немає" description="Активні призначення з’являться тут автоматично." />}
          </> : <EmptyState title="Оберіть підрозділ" description="Ліворуч показано доступну структуру організації." />}
        </section>
      </Card>
    </div>
  )
}

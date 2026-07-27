import { useQuery } from '@tanstack/react-query'
import type { OrgUnitEmployeeView, OrgUnitView } from '@bert-crm/contracts'
import { Building2, ChevronRight, Search, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { Avatar, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../shared/ui'

function orderedUnits(units: OrgUnitView[], search: string): Array<{ unit: OrgUnitView; depth: number }> {
  const children = new Map<string | null, OrgUnitView[]>()
  for (const unit of units) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit])
  for (const values of children.values()) values.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'uk'))

  const normalizedSearch = search.trim().toLocaleLowerCase('uk')
  const visible = new Set<string>()
  if (normalizedSearch) {
    const byId = new Map(units.map((unit) => [unit.id, unit]))
    for (const unit of units) {
      if (![unit.name, unit.manager?.displayName ?? ''].some((value) => value.toLocaleLowerCase('uk').includes(normalizedSearch))) continue
      let current: OrgUnitView | undefined = unit
      while (current && !visible.has(current.id)) {
        visible.add(current.id)
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
    }
  }

  const result: Array<{ unit: OrgUnitView; depth: number }> = []
  const visited = new Set<string>()
  const append = (unit: OrgUnitView, depth: number) => {
    if (visited.has(unit.id)) return
    visited.add(unit.id)
    if (!normalizedSearch || visible.has(unit.id)) result.push({ unit, depth })
    for (const child of children.get(unit.id) ?? []) append(child, depth + 1)
  }
  for (const root of children.get(null) ?? []) append(root, 0)
  for (const unit of units) append(unit, 0)
  return result
}

export default function OrganizationPage() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const organizationId = user?.organization.id
  const unitsQuery = useQuery({
    queryKey: ['org-units', organizationId],
    queryFn: () => api<{ items: OrgUnitView[] }>('/org/units'),
    enabled: Boolean(organizationId),
  })
  const units = unitsQuery.data?.items ?? []
  const visibleUnits = useMemo(() => orderedUnits(units, search), [units, search])
  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) ?? null
  const employeesQuery = useQuery({
    queryKey: ['org-unit-employees', selectedUnitId, organizationId],
    queryFn: () => api<{ items: OrgUnitEmployeeView[] }>(`/org/units/${selectedUnitId}/employees`),
    enabled: Boolean(selectedUnitId && organizationId),
  })

  useEffect(() => {
    if (visibleUnits.length === 0) {
      setSelectedUnitId(null)
      return
    }
    const normalizedSearch = search.trim().toLocaleLowerCase('uk')
    const directMatch = normalizedSearch
      ? visibleUnits.find(({ unit }) => [unit.name, unit.manager?.displayName ?? ''].some((value) => value.toLocaleLowerCase('uk').includes(normalizedSearch)))
      : undefined
    if (directMatch && directMatch.unit.id !== selectedUnitId) {
      setSelectedUnitId(directMatch.unit.id)
      return
    }
    if (selectedUnitId && visibleUnits.some(({ unit }) => unit.id === selectedUnitId)) return
    setSelectedUnitId((directMatch ?? visibleUnits[0])!.unit.id)
  }, [visibleUnits, selectedUnitId, search])

  return (
    <div>
      <PageHeader
        title="Структура організації"
        description="Відділи, підвідділи, керівники та робочі ролі без приватних контактів"
        action={<Link className="button button--secondary" to="/employees"><UserRound size={17} />Відкрити довідник людей</Link>}
      />
      <p className="privacy-note org-privacy-note"><ShieldCheck size={17} />Показуємо лише безпечні робочі дані працівників організації.</p>
      <Card className="org-card">
        <section className="org-browser" aria-label="Підрозділи організації">
          <div className="org-browser__header">
            <div><Building2 size={18} /><strong>Підрозділи</strong></div>
            <label className="search-field">
              <span className="sr-only">Знайти підрозділ або керівника</span>
              <Search size={17} aria-hidden />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Підрозділ або керівник" type="search" />
            </label>
          </div>
          {unitsQuery.isLoading ? <Skeleton rows={6} /> : unitsQuery.isError ? <ErrorState onRetry={() => void unitsQuery.refetch()} /> : visibleUnits.length ? (
            <div className="org-tree">
              {visibleUnits.map(({ unit, depth }) => (
                <button
                  key={unit.id}
                  className={selectedUnitId === unit.id ? 'is-selected' : ''}
                  style={{ '--org-indent': `${10 + depth * 18}px` } as CSSProperties}
                  aria-pressed={selectedUnitId === unit.id}
                  onClick={() => setSelectedUnitId(unit.id)}
                >
                  <span className="org-tree__icon"><UsersRound size={17} /></span>
                  <span><strong>{unit.name}</strong><small>{unit.manager?.displayName ?? 'Керівника не вказано'} · {unit.activeEmployeeCount} ос.</small></span>
                  <ChevronRight size={17} aria-hidden />
                </button>
              ))}
            </div>
          ) : <EmptyState title="Підрозділів не знайдено" description={search ? 'Спробуйте коротший або інший запит.' : 'Структура з’явиться після синхронізації довідника.'} />}
        </section>
        <section className="org-team" aria-live="polite">
          {selectedUnit ? (
            <>
              <header>
                <span className="eyebrow">Обраний підрозділ</span>
                <h2>{selectedUnit.name}</h2>
                <p>{selectedUnit.manager ? `Керівник: ${selectedUnit.manager.displayName}` : 'Керівника ще не призначено'}</p>
              </header>
              {employeesQuery.isLoading ? <Skeleton rows={4} /> : employeesQuery.isError ? <ErrorState onRetry={() => void employeesQuery.refetch()} /> : employeesQuery.data?.items.length ? (
                <div className="org-people">
                  {employeesQuery.data.items.map((employee) => (
                    <Link key={employee.id} to={`/employees/${employee.id}`}>
                      <Avatar name={employee.displayName} src={employee.avatarAsset} />
                      <span><strong>{employee.displayName}</strong><small>{employee.positionTitle ?? employee.jobTitle}</small></span>
                      <ChevronRight size={17} aria-hidden />
                    </Link>
                  ))}
                </div>
              ) : <EmptyState title="У підрозділі поки нікого немає" description="Активні призначення з’являться тут автоматично." />}
            </>
          ) : <EmptyState title="Оберіть підрозділ" description="Ліворуч показано доступну структуру організації." />}
        </section>
      </Card>
    </div>
  )
}

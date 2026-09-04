import type { OrgCompanyView, OrgUnitView } from '@bert-crm/contracts'
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  LocateFixed,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  UsersRound,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type DragEvent as ReactDragEvent,
} from 'react'

const nodeWidth = 168
const nodeHeight = 70
const companyWidth = 190
const companyHeight = 76
const horizontalGap = 46
const verticalGap = 154
const worldPadding = 94

interface PositionedUnit {
  unit: OrgUnitView
  x: number
  y: number
  depth: number
}

interface MapLayout {
  company: { x: number; y: number }
  units: PositionedUnit[]
  byId: Map<string, PositionedUnit>
  width: number
  height: number
}

interface OutlineRow {
  unit: OrgUnitView
  depth: number
  hasChildren: boolean
}

interface Camera {
  x: number
  y: number
  zoom: number
}

export interface OrganizationMapProps {
  company: OrgCompanyView
  units: OrgUnitView[]
  selectedId: string | null
  onSelect(unitId: string): void
  onSelectCompany?(): void
  sidePanel?: ReactNode
  editing?: boolean
  onAddRoot?(): void
  onAddChild?(parentId: string): void
  onEmployeeDrop?(unitId: string, employeeId: string): void
  emptyState?: ReactNode
  compactOutline?: 'overlay' | 'none'
}

function sortedChildren(units: OrgUnitView[]) {
  const children = new Map<string | null, OrgUnitView[]>()
  for (const unit of units) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit])
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'uk'))
  }
  return children
}

export function createOrganizationOutline(units: OrgUnitView[], expanded: Set<string>): OutlineRow[] {
  const children = sortedChildren(units)
  const rows: OutlineRow[] = []
  const visited = new Set<string>()
  const append = (unit: OrgUnitView, depth: number) => {
    if (visited.has(unit.id)) return
    visited.add(unit.id)
    const childUnits = children.get(unit.id) ?? []
    rows.push({ unit, depth, hasChildren: childUnits.length > 0 })
    if (expanded.has(unit.id)) childUnits.forEach((child) => append(child, depth + 1))
  }
  const roots = children.get(null) ?? []
  roots.forEach((unit) => append(unit, 0))
  const unitIds = new Set(units.map((unit) => unit.id))
  units.filter((unit) => unit.parentId && !unitIds.has(unit.parentId)).forEach((unit) => append(unit, 0))
  return rows
}

export function createOrganizationMapLayout(units: OrgUnitView[]): MapLayout {
  const children = sortedChildren(units)
  const positioned = new Map<string, PositionedUnit>()
  const visited = new Set<string>()
  let leafIndex = 0
  let maxDepth = 0

  const place = (unit: OrgUnitView, depth: number): number => {
    if (visited.has(unit.id)) return positioned.get(unit.id)?.x ?? leafIndex * (nodeWidth + horizontalGap)
    visited.add(unit.id)
    maxDepth = Math.max(maxDepth, depth)
    const descendants = (children.get(unit.id) ?? []).filter((candidate) => !visited.has(candidate.id))
    const childCenters = descendants.map((child) => place(child, depth + 1))
    const x = childCenters.length
      ? (childCenters[0]! + childCenters.at(-1)!) / 2
      : leafIndex++ * (nodeWidth + horizontalGap)
    positioned.set(unit.id, { unit, x, y: companyHeight + verticalGap * (depth + 1), depth })
    return x
  }

  for (const root of children.get(null) ?? []) place(root, 0)
  for (const unit of units) {
    if (!visited.has(unit.id)) place(unit, 0)
  }

  const raw = [...positioned.values()]
  const minX = Math.min(0, ...raw.map((item) => item.x - nodeWidth / 2))
  const maxX = Math.max(nodeWidth, ...raw.map((item) => item.x + nodeWidth / 2))
  const contentWidth = Math.max(760, maxX - minX + worldPadding * 2)
  const shiftX = worldPadding - minX
  const companyX = raw.length
    ? (Math.min(...raw.filter((item) => item.depth === 0).map((item) => item.x))
      + Math.max(...raw.filter((item) => item.depth === 0).map((item) => item.x))) / 2 + shiftX
    : contentWidth / 2
  const shifted = raw.map((item) => ({ ...item, x: item.x + shiftX, y: item.y + worldPadding / 2 }))
  const byId = new Map(shifted.map((item) => [item.unit.id, item]))
  return {
    company: { x: companyX, y: worldPadding / 2 },
    units: shifted,
    byId,
    width: contentWidth,
    height: Math.max(560, companyHeight + verticalGap * (maxDepth + 2) + worldPadding),
  }
}

function branchIds(selectedId: string | null, units: OrgUnitView[]) {
  if (!selectedId) return new Set<string>()
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const children = sortedChildren(units)
  const result = new Set<string>([selectedId])
  let current = byId.get(selectedId)
  while (current?.parentId) {
    result.add(current.parentId)
    current = byId.get(current.parentId)
  }
  const append = (unitId: string) => {
    for (const child of children.get(unitId) ?? []) {
      if (result.has(child.id)) continue
      result.add(child.id)
      append(child.id)
    }
  }
  append(selectedId)
  return result
}

function initials(value: string) {
  return value.split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('uk')
}

export function OrganizationMap({
  company,
  units,
  selectedId,
  onSelect,
  onSelectCompany,
  sidePanel,
  editing = false,
  onAddRoot,
  onAddChild,
  onEmployeeDrop,
  emptyState,
  compactOutline = 'overlay',
}: OrganizationMapProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const fittedKeyRef = useRef('')
  const dragRef = useRef<{ pointerId: number; x: number; y: number; camera: Camera; moved: boolean } | null>(null)
  const focusTimerRef = useRef<number | null>(null)
  const [search, setSearch] = useState('')
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  const [dragging, setDragging] = useState(false)
  const [focusing, setFocusing] = useState(false)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [expandedOutlineIds, setExpandedOutlineIds] = useState<Set<string>>(new Set())
  const [viewportSize, setViewportSize] = useState({ width: 960, height: 620 })
  const layout = useMemo(() => createOrganizationMapLayout(units), [units])
  const branch = useMemo(() => branchIds(selectedId, units), [selectedId, units])
  const outline = useMemo(() => createOrganizationOutline(units, expandedOutlineIds), [expandedOutlineIds, units])
  const normalizedSearch = search.trim().toLocaleLowerCase('uk')
  const reservesPanelSpace = Boolean(sidePanel)
  const cameraRef = useRef(camera)

  useLayoutEffect(() => {
    cameraRef.current = camera
  }, [camera])

  const fit = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const width = viewport.clientWidth
    const height = viewport.clientHeight
    const panelWidth = reservesPanelSpace && width > 820 ? Math.min(348, width * .4) : 0
    const availableWidth = width - panelWidth
    const zoom = Math.max(.42, Math.min(1, (availableWidth - 36) / layout.width, (height - 36) / layout.height))
    setFocusing(false)
    setCamera({
      zoom,
      x: (availableWidth - layout.width * zoom) / 2,
      y: (height - layout.height * zoom) / 2,
    })
  }, [layout.height, layout.width, reservesPanelSpace])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => {
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    })
    observer.observe(viewport)
    setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const key = `${company.id}:${units.map((unit) => `${unit.id}:${unit.parentId}`).join('|')}`
    if (fittedKeyRef.current === key) return
    fittedKeyRef.current = key
    fit()
  }, [company.id, fit, units])

  useEffect(() => {
    setExpandedOutlineIds((current) => {
      const next = new Set(current)
      units.filter((unit) => unit.parentId === null).forEach((unit) => next.add(unit.id))
      if (selectedId) branch.forEach((unitId) => next.add(unitId))
      return next
    })
  }, [branch, selectedId, units])

  const revealNode = useCallback((unitId: string) => {
    const node = layout.byId.get(unitId)
    const viewport = viewportRef.current
    if (!node || !viewport) return
    const panelWidth = reservesPanelSpace && viewport.clientWidth > 820 ? Math.min(348, viewport.clientWidth * .4) : 0
    const availableWidth = viewport.clientWidth - panelWidth
    const leftBoundary = 58
    const rightBoundary = Math.max(leftBoundary + nodeWidth, availableWidth - 58)
    const topBoundary = 82
    const bottomBoundary = viewport.clientHeight - 70
    const currentCamera = cameraRef.current
    const visibleX = node.x * currentCamera.zoom + currentCamera.x
    const visibleY = (node.y + nodeHeight / 2) * currentCamera.zoom + currentCamera.y
    let x = currentCamera.x
    let y = currentCamera.y
    if (visibleX < leftBoundary) x += leftBoundary - visibleX
    else if (visibleX > rightBoundary) x -= visibleX - rightBoundary
    if (visibleY < topBoundary) y += topBoundary - visibleY
    else if (visibleY > bottomBoundary) y -= visibleY - bottomBoundary
    if (x === currentCamera.x && y === currentCamera.y) return
    setFocusing(true)
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
    focusTimerRef.current = window.setTimeout(() => setFocusing(false), 320)
    setCamera({ ...currentCamera, x, y })
  }, [layout.byId, reservesPanelSpace])

  useEffect(() => () => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
  }, [])

  const changeZoom = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    setFocusing(false)
    const rect = viewport.getBoundingClientRect()
    const pivotX = clientX === undefined ? viewport.clientWidth / 2 : clientX - rect.left
    const pivotY = clientY === undefined ? viewport.clientHeight / 2 : clientY - rect.top
    setCamera((current) => {
      const zoom = Math.max(.22, Math.min(1.55, current.zoom * factor))
      if (zoom === current.zoom) return current
      const worldX = (pivotX - current.x) / current.zoom
      const worldY = (pivotY - current.y) / current.zoom
      return { zoom, x: pivotX - worldX * zoom, y: pivotY - worldY * zoom }
    })
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const handleWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('.organization-map__outline')) return
      event.preventDefault()
      changeZoom(event.deltaY < 0 ? 1.1 : .9, event.clientX, event.clientY)
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [changeZoom])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input, a, select, .organization-map__panel, .organization-map__outline')) return
    setFocusing(false)
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4
    setCamera({ ...drag.camera, x: drag.camera.x + dx, y: drag.camera.y + dy })
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  useEffect(() => {
    if (selectedId) revealNode(selectedId)
  }, [revealNode, selectedId, viewportSize.height, viewportSize.width])

  return (
    <section className={`organization-map ${editing ? 'is-editing' : ''}`} aria-label="Інтерактивна карта структури">
      <div
        ref={viewportRef}
        className={`organization-map__viewport ${dragging ? 'is-dragging' : ''}`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="organization-map__toolbar">
          <label className="organization-map__search">
            <Search size={16} aria-hidden />
            <span className="sr-only">Знайти підрозділ або керівника</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Підрозділ або керівник" />
          </label>
          <div className="organization-map__camera" aria-label="Керування камерою">
            {compactOutline === 'overlay' && <button type="button" aria-label={outlineOpen ? 'Сховати компактну структуру' : 'Показати компактну структуру'} onClick={() => setOutlineOpen((value) => !value)}>
              {outlineOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>}
            <button type="button" aria-label="Зменшити карту" onClick={() => changeZoom(.86)}><Minus size={16} /></button>
            <button type="button" aria-label="Показати всю структуру" onClick={fit}><LocateFixed size={16} /></button>
            <button type="button" aria-label="Збільшити карту" onClick={() => changeZoom(1.16)}><Plus size={16} /></button>
          </div>
        </div>

        {compactOutline === 'overlay' && outlineOpen && <aside className="organization-map__outline" aria-label="Компактна структура організації">
          <header><span><Building2 size={15} /><strong>{company.name}</strong></span><small>{units.length} підрозділів</small></header>
          <div className="organization-map__outline-tree" role="tree" aria-label="Дерево підрозділів">
            {outline.map(({ unit, depth, hasChildren }) => {
              const expanded = expandedOutlineIds.has(unit.id)
              const selected = selectedId === unit.id
              return <div
                key={unit.id}
                className={`organization-map__outline-row ${selected ? 'is-selected' : ''}`}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={selected}
                {...(hasChildren ? { 'aria-expanded': expanded } : {})}
                style={{ '--outline-depth': depth } as React.CSSProperties}
              >
                {hasChildren ? <button
                  className="organization-map__outline-toggle"
                  type="button"
                  aria-label={`${expanded ? 'Згорнути' : 'Розгорнути'} ${unit.name}`}
                  onClick={() => setExpandedOutlineIds((current) => {
                    const next = new Set(current)
                    if (next.has(unit.id)) next.delete(unit.id)
                    else next.add(unit.id)
                    return next
                  })}
                >{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="organization-map__outline-spacer" aria-hidden />}
                <button type="button" className="organization-map__outline-select" onClick={() => onSelect(unit.id)}>
                  <span><strong>{unit.name}</strong><small title={unit.description ?? undefined}>{unit.description?.trim() || unit.manager?.displayName || `${unit.activeEmployeeCount} ос.`}</small></span>
                  <em>{unit.activeEmployeeCount}</em>
                </button>
              </div>
            })}
          </div>
        </aside>}

        <div className={`organization-map__world ${focusing ? 'is-focusing' : ''}`} style={{ width: layout.width, height: layout.height, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
          <svg className="organization-map__links" width={layout.width} height={layout.height} role="img" aria-label="Зв’язки між підрозділами">
            {layout.units.map(({ unit, x, y }) => {
              const parent = unit.parentId ? layout.byId.get(unit.parentId) : undefined
              const startX = parent?.x ?? layout.company.x
              const startY = parent ? parent.y + nodeHeight : layout.company.y + companyHeight
              const middleY = (startY + y) / 2
              const active = branch.has(unit.id) && (!unit.parentId || branch.has(unit.parentId))
              return <path key={unit.id} className={selectedId ? active ? 'is-active' : 'is-muted' : ''} d={`M ${startX} ${startY} C ${startX} ${middleY}, ${x} ${middleY}, ${x} ${y}`} />
            })}
          </svg>

          <div className="organization-map__company-wrap" style={{ left: layout.company.x - companyWidth / 2, top: layout.company.y }}>
            <button
              type="button"
              className="organization-map__node organization-map__node--company"
              aria-label={`${company.name}. ${company.description?.trim() || (company.manager ? `Керівник ${company.manager.displayName}` : 'Керівника не призначено')}`}
              onClick={onSelectCompany ?? fit}
            >
              <span className="organization-map__avatar"><Building2 size={20} /></span>
              <span><strong>{company.name}</strong><small title={company.description ?? undefined}>{company.description?.trim() || company.manager?.displayName || 'Без керівника'}</small></span>
            </button>
            {editing && onAddRoot && <button className="organization-map__add-child" type="button" aria-label={`Додати гілку до компанії ${company.name}`} onClick={onAddRoot}><Plus size={13} /></button>}
          </div>

          {!units.length && emptyState && <div className="organization-map__empty-message">{emptyState}</div>}

          {layout.units.map(({ unit, x, y }) => {
            const isSelected = selectedId === unit.id
            const isBranch = branch.has(unit.id)
            const matches = !normalizedSearch || `${unit.name} ${unit.description ?? ''} ${unit.manager?.displayName ?? ''}`.toLocaleLowerCase('uk').includes(normalizedSearch)
            return <div
              key={unit.id}
              className={`organization-map__node-wrap ${dropTargetId === unit.id ? 'is-drop-target' : ''} ${selectedId && !isBranch ? 'is-context-muted' : ''}`}
              style={{ left: x - nodeWidth / 2, top: y }}
              onDragEnter={() => onEmployeeDrop && setDropTargetId(unit.id)}
              onDragLeave={(event: ReactDragEvent<HTMLDivElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetId(null) }}
              onDragOver={(event: ReactDragEvent<HTMLDivElement>) => { if (!onEmployeeDrop) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
              onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
                if (!onEmployeeDrop) return
                event.preventDefault()
                const employeeId = event.dataTransfer.getData('application/x-bert-employee') || event.dataTransfer.getData('text/plain')
                setDropTargetId(null)
                if (employeeId) onEmployeeDrop(unit.id, employeeId)
              }}
            >
              <button
                type="button"
                className={`organization-map__node ${isSelected ? 'is-selected' : ''} ${isBranch ? 'is-branch' : ''} ${normalizedSearch && !matches ? 'is-search-muted' : ''}`}
                aria-pressed={isSelected}
                aria-label={`${unit.name}. ${unit.description?.trim() || `${unit.activeEmployeeCount} працівників. ${unit.manager ? `Керівник ${unit.manager.displayName}` : 'Керівника не призначено'}`}`}
                onClick={() => onSelect(unit.id)}
              >
                <span className="organization-map__avatar">
                  {unit.manager ? initials(unit.manager.displayName) : <UsersRound size={18} />}
                  {!unit.manager && <i aria-label="Керівника не призначено"><AlertTriangle size={10} /></i>}
                </span>
                <span><strong>{unit.name}</strong><small title={unit.description ?? undefined}>{unit.description?.trim() || `${unit.activeEmployeeCount} ос. · ${unit.manager?.displayName ?? 'без керівника'}`}</small></span>
              </button>
              {editing && onAddChild && <button className="organization-map__add-child" type="button" aria-label={`Додати підрозділ до ${unit.name}`} onClick={() => onAddChild(unit.id)}><Plus size={13} /></button>}
            </div>
          })}
        </div>

        {sidePanel && <aside className="organization-map__panel">{sidePanel}</aside>}
      </div>
    </section>
  )
}

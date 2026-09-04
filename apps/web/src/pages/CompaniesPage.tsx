import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronDown, ChevronRight, Network, Plus, Power, Users } from 'lucide-react'
import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { useAuth } from '../shared/auth/AuthProvider'
import { UserProfileLink } from '../features/employees/UserProfileDrawer'
import { Button, Drawer, EmptyState, ErrorState, Skeleton, StatusBadge } from '../shared/ui'

interface Company {
  id: string
  name: string
  slug: string
  description: string | null
  isActive: boolean
  timezone: string
  userCount: number
  unitCount: number
}

interface CompanyDetail extends Company {
  counts: { users: number; units: number }
}

interface OrgUnit {
  id: string
  parentId: string | null
  name: string
  activeEmployeeCount: number
}

interface Employee {
  id: string
  displayName: string
  positionTitle: string
  jobTitle: string
  orgUnit: { id: string; name: string } | null
}

export default function CompaniesPage() {
  const { user } = useAuth()
  const { companyId } = useParams()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const isAdmin = user?.accountType === 'ADMIN'
  const query = useQuery({ queryKey: ['companies'], queryFn: () => api<{ items: Company[] }>('/companies') })

  return (
    <div className="companies-page">
      <header className="directory-page-heading">
        <div><h1>Компанії</h1><p>Компанії допомагають орієнтуватися в командах і структурі спільного робочого простору.</p></div>
        {isAdmin && <Button onClick={() => setCreating(true)}><Plus size={17} />Нова компанія</Button>}
      </header>
      {query.isLoading ? <Skeleton rows={6} /> : query.isError ? <ErrorState /> : query.data?.items.length ? (
        <div className="company-grid company-grid--directory">
          {query.data.items.map((company) => (
            <article key={company.id} className="company-card company-card--directory">
              <div className="company-card__heading"><Building2 size={20} aria-hidden="true" /><StatusBadge status={company.isActive ? 'ACTIVE' : 'INACTIVE'} /></div>
              <div className="company-card__copy"><h2>{company.name}</h2><p>{company.description || 'Опис компанії ще не додано.'}</p></div>
              <div className="company-card__stats" aria-label="Коротка статистика">
                <span><Users size={15} /> {company.userCount} користувачів</span>
                <span><Network size={15} /> {company.unitCount} підрозділів</span>
              </div>
              <div className="company-card__actions">
                <Link className="button button--secondary" to={`/companies/${company.id}`}>Деталі</Link>
                <Link className="button button--primary" to={`/organization?companyId=${company.id}&view=structure`}><Network size={15} />Структура</Link>
              </div>
            </article>
          ))}
        </div>
      ) : <EmptyState title="Компаній ще немає" description="Адміністратор ще не створив компанії у робочому просторі." />}
      {creating && <CompanyEditor onClose={() => setCreating(false)} />}
      {companyId && <CompanyDrawer id={companyId} isAdmin={isAdmin} onClose={() => navigate('/companies')} />}
    </div>
  )
}

export function CompanyEditor({ onClose, company, onCreated }: { onClose: () => void; company?: CompanyDetail; onCreated?: (company: Company) => void }) {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: (value: object) => api<Company>(company ? `/admin/companies/${company.id}` : '/admin/companies', { method: company ? 'PATCH' : 'POST', body: jsonBody(value) }),
    onSuccess: (savedCompany) => {
      void client.invalidateQueries({ queryKey: ['companies'] })
      void client.invalidateQueries({ queryKey: ['admin-companies'] })
      if (company) void client.invalidateQueries({ queryKey: ['company', company.id] })
      if (!company) onCreated?.(savedCompany)
      onClose()
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({ name: data.get('name'), description: data.get('description'), slug: data.get('slug'), timezone: data.get('timezone'), isActive: data.get('isActive') === 'on' })
  }
  return (
    <Drawer size="lg" title={company ? 'Параметри компанії' : 'Нова компанія'} onRequestClose={onClose}>
      <form className="entity-form account-form" onSubmit={submit}>
        <label className="span-2">Назва<input name="name" required defaultValue={company?.name} /></label>
        <label className="span-2">Стислий опис<textarea name="description" rows={4} maxLength={320} defaultValue={company?.description ?? ''} placeholder="Чим займається компанія та за що відповідає команда" /></label>
        <label className="span-2">Системний slug<input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,62}" defaultValue={company?.slug} /></label>
        <label className="span-2">Часовий пояс<input name="timezone" required defaultValue={company?.timezone ?? 'Europe/Kyiv'} /></label>
        <label className="check-row span-2"><input type="checkbox" name="isActive" defaultChecked={company?.isActive ?? true} />Компанія активна</label>
        <Button className="span-2" disabled={mutation.isPending}>{company ? 'Зберегти' : 'Створити компанію'}</Button>
      </form>
    </Drawer>
  )
}

function CompanyDrawer({ id, isAdmin, onClose }: { id: string; isAdmin: boolean; onClose: () => void }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['company']))
  const query = useQuery({ queryKey: ['company', id], queryFn: () => api<CompanyDetail>(`/companies/${id}`) })
  const units = useQuery({ queryKey: ['company-structure', id], queryFn: () => api<{ items: OrgUnit[] }>(`/org/units?company=${encodeURIComponent(id)}`), enabled: Boolean(query.data) })
  const employees = useQuery({ queryKey: ['company-employees', id], queryFn: () => api<{ items: Employee[] }>(`/employees?company=${encodeURIComponent(id)}`), enabled: Boolean(query.data) })
  const status = useMutation({
    mutationFn: (active: boolean) => api(`/admin/companies/${id}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['companies'] }); void query.refetch() },
  })
  const tree = useMemo(() => makeTree(units.data?.items ?? []), [units.data?.items])
  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  if (query.isLoading) return <Drawer title="Компанія" onRequestClose={onClose}><Skeleton rows={5} /></Drawer>
  if (!query.data) return <Drawer title="Компанія" onRequestClose={onClose}><ErrorState /></Drawer>
  const company = query.data
  const people = employees.data?.items ?? []
  const unassigned = people.filter((employee) => !employee.orgUnit)
  return (
    <>
      <Drawer size="lg" title={company.name} onRequestClose={onClose}>
        <div className="company-detail company-detail--directory">
          <header className="company-detail__identity">
            <span className="company-detail__icon"><Building2 size={22} /></span>
            <div><StatusBadge status={company.isActive ? 'ACTIVE' : 'INACTIVE'} /><p>{company.description || 'Опис компанії ще не додано.'}</p></div>
          </header>
          <dl>
            <div><dt><Users size={16} />Користувачі</dt><dd>{company.counts.users}</dd></div>
            <div><dt><Network size={16} />Підрозділи</dt><dd>{company.counts.units}</dd></div>
          </dl>
          <section className="company-tree-section">
            <header><div><strong>Команда і структура</strong><small>Розгортайте лише потрібну гілку</small></div><Link to={`/organization?companyId=${company.id}&view=structure`}>Відкрити повністю</Link></header>
            <div className="company-tree" role="tree" aria-label={`Структура ${company.name}`}>
              <button type="button" className="company-tree__row company-tree__row--root" onClick={() => toggle('company')} aria-expanded={expanded.has('company')}>
                {expanded.has('company') ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<Building2 size={16} /><strong>{company.name}</strong><span>{company.counts.users}</span>
              </button>
              {expanded.has('company') && <div role="group">
                {tree.length ? tree.map((unit) => <CompanyTreeUnit key={unit.id} unit={unit} depth={1} expanded={expanded} employees={people} onToggle={toggle} />) : <p className="company-tree__empty">Підрозділів ще немає.</p>}
                {unassigned.length > 0 && <div className="company-tree__unassigned"><span>Без підрозділу</span>{unassigned.map((employee) => <EmployeeTreeLink key={employee.id} employee={employee} depth={2} />)}</div>}
              </div>}
            </div>
          </section>
          <div className="drawer-actions company-detail__actions">
            <Link className="button button--primary" to={`/organization?companyId=${company.id}&view=structure`}><Network size={16} />Структура</Link>
            {isAdmin && <Link className="button button--secondary" to={`/admin/companies/${company.id}/structure`}><Building2 size={16} />Керувати</Link>}
            {isAdmin && <Button variant="secondary" onClick={() => setEditing(true)}>Редагувати</Button>}
            {isAdmin && <Button variant={company.isActive ? 'danger' : 'primary'} onClick={() => status.mutate(!company.isActive)}><Power size={16} />{company.isActive ? 'Деактивувати' : 'Активувати'}</Button>}
          </div>
        </div>
      </Drawer>
      {editing && <CompanyEditor company={company} onClose={() => setEditing(false)} />}
    </>
  )
}

type TreeUnit = OrgUnit & { children: TreeUnit[] }

function makeTree(units: OrgUnit[]): TreeUnit[] {
  const nodes = new Map(units.map((unit) => [unit.id, { ...unit, children: [] as TreeUnit[] }]))
  const roots: TreeUnit[] = []
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

function CompanyTreeUnit({ unit, depth, expanded, employees, onToggle }: { unit: TreeUnit; depth: number; expanded: Set<string>; employees: Employee[]; onToggle: (id: string) => void }) {
  const members = employees.filter((employee) => employee.orgUnit?.id === unit.id)
  const hasChildren = unit.children.length > 0 || members.length > 0
  const isOpen = expanded.has(unit.id)
  const style = { '--tree-depth': depth } as CSSProperties
  return (
    <div role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
      <button type="button" className="company-tree__row" style={style} onClick={() => hasChildren && onToggle(unit.id)}>
        {hasChildren ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span />}<Network size={15} /><strong>{unit.name}</strong><span>{unit.activeEmployeeCount}</span>
      </button>
      {isOpen && <div role="group">{unit.children.map((child) => <CompanyTreeUnit key={child.id} unit={child} depth={depth + 1} expanded={expanded} employees={employees} onToggle={onToggle} />)}{members.map((employee) => <EmployeeTreeLink key={employee.id} employee={employee} depth={depth + 1} />)}</div>}
    </div>
  )
}

function EmployeeTreeLink({ employee, depth }: { employee: Employee; depth: number }) {
  return (
    <UserProfileLink className="company-tree__person" style={{ '--tree-depth': depth } as CSSProperties} userId={employee.id}>
      <span>{employee.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{employee.displayName}</strong><small>{employee.positionTitle || employee.jobTitle || 'Без посади'}</small></div>
    </UserProfileLink>
  )
}

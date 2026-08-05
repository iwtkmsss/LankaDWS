import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, Power, Search, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, jsonBody } from '../shared/api/client'
import { Button, Card, Drawer, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '../shared/ui'

interface Company {
  id: string
  name: string
  slug: string
  isActive: boolean
  timezone: string
  userCount: number
}
interface CompanyDetail extends Company {
  counts: { users: number; units: number }
  members: Array<{ id: string; displayName: string; jobTitle: string; isActive: boolean }>
}

export default function CompaniesPage() {
  const { companyId } = useParams()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const query = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api<{ items: Company[] }>('/admin/companies'),
  })
  const filteredCompanies = query.data?.items.filter((company) => {
    const matchesSearch = `${company.name} ${company.slug}`.toLocaleLowerCase('uk').includes(search.trim().toLocaleLowerCase('uk'))
    const matchesStatus = activeFilter === 'all' || company.isActive === (activeFilter === 'active')
    return matchesSearch && matchesStatus
  }) ?? []
  return (
    <div className="companies-page">
      <PageHeader
        title="Компанії"
        description="Окремі робочі простори, користувачі та дані. Глобальний адміністратор має доступ до всіх компаній."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={17} />
            Нова компанія
          </Button>
        }
      />
      <Card className="companies-intro">
        <Building2 size={22} />
        <div>
          <strong>Ізоляція за замовчуванням</strong>
          <span>
            Користувач бачить лише свою компанію. Після повторної активації компанії доступ повертається лише
            індивідуально активним користувачам.
          </span>
        </div>
      </Card>
      <Card className="list-card company-list-card">
        <div className="list-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Назва або slug компанії" />
          </label>
          <select aria-label="Фільтр компаній за станом" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)}>
            <option value="all">Усі стани</option>
            <option value="active">Активні</option>
            <option value="inactive">Деактивовані</option>
          </select>
        </div>
      </Card>
      {query.isLoading ? (
        <Skeleton rows={6} />
      ) : query.isError ? (
        <ErrorState />
      ) : filteredCompanies.length ? (
        <div className="company-grid">
          {filteredCompanies.map((company) => (
            <Link to={`/admin/companies/${company.id}`} key={company.id} className="company-card">
              <div>
                <span className="company-card__mark">{company.name.slice(0, 1).toUpperCase()}</span>
                <StatusBadge status={company.isActive ? 'ACTIVE' : 'INACTIVE'} />
              </div>
              <h2>{company.name}</h2>
              <p>/{company.slug}</p>
              <small>{company.timezone} · {company.userCount} користувачів</small>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title={query.data?.items.length ? 'Нічого не знайдено' : 'Компаній ще немає'}
          description={query.data?.items.length ? 'Змініть пошук або фільтр стану.' : 'Створіть першу компанію перед додаванням користувачів.'}
        />
      )}
      {creating && <CompanyEditor onClose={() => setCreating(false)} />}
      {companyId && <CompanyDrawer id={companyId} onClose={() => navigate('/admin/companies')} />}
    </div>
  )
}

function CompanyEditor({ onClose, company }: { onClose: () => void; company?: Company }) {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: (value: object) =>
      api<Company>(company ? `/admin/companies/${company.id}` : '/admin/companies', {
        method: company ? 'PATCH' : 'POST',
        body: jsonBody(value),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-companies'] })
      if (company) void client.invalidateQueries({ queryKey: ['admin-company', company.id] })
      onClose()
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    mutation.mutate({
      name: data.get('name'),
      slug: data.get('slug'),
      timezone: data.get('timezone'),
      isActive: data.get('isActive') === 'on',
    })
  }
  return (
    <Drawer size="lg" title={company ? 'Параметри компанії' : 'Нова компанія'} onRequestClose={onClose}>
      <form className="entity-form account-form" onSubmit={submit}>
        <div className="form-section">
          <span className="eyebrow">Робочий простір</span>
          <p>Slug використовується системою та не повинен змінюватися без потреби.</p>
        </div>
        <label className="span-2">
          Назва
          <input name="name" required defaultValue={company?.name} />
        </label>
        <label className="span-2">
          Slug
          <input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,62}" defaultValue={company?.slug} />
        </label>
        <label className="span-2">
          Часовий пояс
          <input name="timezone" required defaultValue={company?.timezone ?? 'Europe/Kyiv'} />
        </label>
        <label className="check-row span-2">
          <input type="checkbox" name="isActive" defaultChecked={company?.isActive ?? true} />
          Компанія активна
        </label>
        <Button className="span-2" disabled={mutation.isPending}>
          {company ? 'Зберегти' : 'Створити компанію'}
        </Button>
      </form>
    </Drawer>
  )
}

function CompanyDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const query = useQuery({
    queryKey: ['admin-company', id],
    queryFn: () => api<CompanyDetail>(`/admin/companies/${id}`),
  })
  const status = useMutation({
    mutationFn: (active: boolean) =>
      api(`/admin/companies/${id}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-companies'] })
      void query.refetch()
    },
  })
  if (query.isLoading)
    return (
      <Drawer title="Компанія" onRequestClose={onClose}>
        <Skeleton rows={5} />
      </Drawer>
    )
  if (!query.data)
    return (
      <Drawer title="Компанія" onRequestClose={onClose}>
        <ErrorState />
      </Drawer>
    )
  const company = query.data
  return (
    <>
      <Drawer title={company.name} onRequestClose={onClose}>
        <div className="company-detail">
          <span className="company-detail__mark">{company.name.slice(0, 1)}</span>
          <StatusBadge status={company.isActive ? 'ACTIVE' : 'INACTIVE'} />
          <p>
            /{company.slug} · {company.timezone}
          </p>
          <dl>
            <div>
              <dt>
                <Users size={16} />
                Користувачі
              </dt>
              <dd>{company.counts.users}</dd>
            </div>
            <div>
              <dt>
                <Building2 size={16} />
                Підрозділи
              </dt>
              <dd>{company.counts.units}</dd>
            </div>
          </dl>
          <section className="company-members">
            <header>
              <strong>Користувачі компанії</strong>
              <Link to={`/admin/users?companyId=${company.id}`}>Усі</Link>
            </header>
            {company.members.length ? (
              company.members.map((member) => (
                <Link to={`/admin/users/${member.id}`} key={member.id}>
                  <span>{member.displayName.slice(0, 1)}</span>
                  <div>
                    <strong>{member.displayName}</strong>
                    <small>{member.jobTitle || 'Без посади'}</small>
                  </div>
                  <StatusBadge status={member.isActive ? 'ACTIVE' : 'INACTIVE'} />
                </Link>
              ))
            ) : (
              <p>Користувачів ще немає.</p>
            )}
          </section>
          <div className="drawer-actions">
            <Link className="button button--primary" to={`/admin/users?companyId=${company.id}&new=1`}>
              <Plus size={16} />
              Додати користувача
            </Link>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Редагувати
            </Button>
            <Button variant={company.isActive ? 'danger' : 'primary'} onClick={() => status.mutate(!company.isActive)}>
              <Power size={16} />
              {company.isActive ? 'Деактивувати' : 'Активувати'}
            </Button>
          </div>
        </div>
      </Drawer>
      {editing && <CompanyEditor company={company} onClose={() => setEditing(false)} />}
    </>
  )
}
